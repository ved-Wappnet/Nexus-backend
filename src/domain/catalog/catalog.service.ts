import { TicketStatuses, UserRoles } from '@core/constants';
import { Actor } from '@core/interfaces';
import { mapCategory, mapProduct, mapSupplier, mapTicket, mapTicketMessage, slugify } from '@core/utils';
import { DatabaseService } from '@database/database.service';
import { CreateCategoryDto, CreateTicketDto, TicketPatchDto, WishlistDto } from '@domain/catalog/dtos';
import { NotificationsService } from '@domain/notifications/notifications.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class CatalogService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async categories(actor: Actor) {
    const { rows } = await this.db.query(`SELECT * FROM categories ORDER BY name`, [], actor);
    return rows.map(mapCategory);
  }

  async createCategory(actor: Actor, dto: CreateCategoryDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Category name is required');

    const parentId = dto.parentId ?? null;
    if (parentId) {
      const parent = await this.db.query(`SELECT id FROM categories WHERE id = $1`, [parentId], actor);
      if (!parent.rowCount) throw new NotFoundException('Parent category not found');
    }

    const baseSlug = slugify(dto.slug?.trim() || name) || 'category';
    let slug = baseSlug;
    for (let i = 0; i < 20; i++) {
      const taken = await this.db.query(`SELECT id FROM categories WHERE slug = $1`, [slug], actor);
      if (!taken.rowCount) break;
      slug = `${baseSlug}-${i + 2}`;
    }

    try {
      const { rows } = await this.db.query(
        `INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING *`,
        [name, slug, parentId],
        actor,
      );
      await this.db.query(
        `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
         VALUES ($1, 'CATEGORY_CREATED', 'categories', $2)`,
        [actor.userId, rows[0].id],
        actor,
      );
      return mapCategory(rows[0]);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === '23505') throw new ConflictException('Category slug already exists');
      throw err;
    }
  }

  async suppliers(actor: Actor) {
    const { rows } = await this.db.query(`SELECT * FROM suppliers ORDER BY store_name`, [], actor);
    return rows.map(mapSupplier);
  }

  async wishlist(actor: Actor) {
    const { rows } = await this.db.query(
      `SELECT p.*, s.store_name, c.name AS category_name
       FROM wishlists w
       JOIN products p ON p.id = w.product_id
       JOIN suppliers s ON s.id = p.supplier_id
       JOIN categories c ON c.id = p.category_id
       WHERE w.customer_id = $1`,
      [actor.userId],
      actor,
    );
    return rows.map((r) => mapProduct(r));
  }

  async toggleWishlist(actor: Actor, dto: WishlistDto) {
    return this.db.tx(actor, async (client) => {
      const existing = await client.query(
        `SELECT id FROM wishlists WHERE customer_id = $1 AND product_id = $2`,
        [actor.userId, dto.productId],
      );
      if (existing.rowCount) {
        await client.query(`DELETE FROM wishlists WHERE id = $1`, [existing.rows[0].id]);
      } else {
        await client.query(`INSERT INTO wishlists (customer_id, product_id) VALUES ($1, $2)`, [
          actor.userId,
          dto.productId,
        ]);
      }
      const { rows } = await client.query(
        `SELECT p.*, s.store_name, c.name AS category_name
         FROM wishlists w
         JOIN products p ON p.id = w.product_id
         JOIN suppliers s ON s.id = p.supplier_id
         JOIN categories c ON c.id = p.category_id
         WHERE w.customer_id = $1`,
        [actor.userId],
      );
      return rows.map((r) => mapProduct(r));
    });
  }

  async tickets(actor: Actor, q?: string, status?: string) {
    await this.ensureMessagesTable(actor);
    const params: unknown[] = [];
    let baseWhere = '1=1';

    if (actor.role === UserRoles.CUSTOMER) {
      params.push(actor.userId);
      baseWhere = `t.customer_id = $${params.length}`;
    } else if (actor.role === UserRoles.DELIVERY_PARTNER) {
      params.push(actor.userId);
      baseWhere = `(t.customer_id = $${params.length} OR EXISTS (
        SELECT 1 FROM orders o
        JOIN delivery_partners dp ON dp.id = o.delivery_partner_id
        WHERE o.id = t.order_id AND dp.user_id = $${params.length}
      ))`;
    } else if (actor.role === UserRoles.SUPPLIER) {
      params.push(actor.userId);
      baseWhere = `(t.customer_id = $${params.length} OR EXISTS (
        SELECT 1 FROM order_items oi
        JOIN suppliers s ON s.id = oi.supplier_id
        WHERE oi.order_id = t.order_id AND s.user_id = $${params.length}
      ))`;
    }

    if (status && status !== 'ALL') {
      params.push(status);
      baseWhere += ` AND t.status = $${params.length}`;
    }

    if (q && q.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      params.push(term);
      const qIdx = params.length;
      baseWhere += ` AND (
        LOWER(t.id::text) LIKE $${qIdx} OR
        LOWER(t.subject) LIKE $${qIdx} OR
        LOWER(t.body) LIKE $${qIdx} OR
        (t.order_id IS NOT NULL AND LOWER(t.order_id::text) LIKE $${qIdx})
      )`;
    }

    params.push(actor.userId);
    const userParamIdx = params.length;

    const sql = `
      SELECT 
        t.*,
        COALESCE((
          SELECT COUNT(*)::int 
          FROM ticket_messages tm
          LEFT JOIN ticket_reads tr ON tr.ticket_id = tm.ticket_id AND tr.user_id = $${userParamIdx}
          WHERE tm.ticket_id = t.id
            AND tm.sender_id != $${userParamIdx}
            AND (tr.last_read_at IS NULL OR tm.created_at > tr.last_read_at)
        ), 0) AS unread_count,
        COALESCE((
          SELECT COUNT(*)::int 
          FROM ticket_messages tm 
          WHERE tm.ticket_id = t.id
        ), 0) AS total_messages,
        (
          SELECT jsonb_build_object(
            'id', tm.id,
            'senderId', tm.sender_id,
            'senderName', tm.sender_name,
            'senderRole', tm.sender_role,
            'message', tm.message,
            'attachmentsCount', COALESCE(jsonb_array_length(tm.attachments), 0),
            'createdAt', tm.created_at
          )
          FROM ticket_messages tm
          WHERE tm.ticket_id = t.id
          ORDER BY tm.created_at DESC
          LIMIT 1
        ) AS last_message
      FROM tickets t
      WHERE ${baseWhere}
      ORDER BY COALESCE((
        SELECT tm.created_at 
        FROM ticket_messages tm 
        WHERE tm.ticket_id = t.id 
        ORDER BY tm.created_at DESC 
        LIMIT 1
      ), t.created_at) DESC
    `;
    const { rows } = await this.db.query(sql, params, actor);
    return rows.map(mapTicket);
  }


  async createTicket(actor: Actor, dto: CreateTicketDto) {
    const { rows } = await this.db.query(
      `INSERT INTO tickets (customer_id, order_id, subject, body, status)
       VALUES ($1, $2, $3, $4, '${TicketStatuses.OPEN}')
       RETURNING *`,
      [actor.userId, dto.orderId || null, dto.subject.trim(), dto.body.trim()],
      actor,
    );
    const ticket = rows[0];

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'TICKET_CREATED', 'tickets', $2)`,
      [actor.userId, ticket.id],
      actor,
    );

    return mapTicket(ticket);
  }

  async updateTicket(actor: Actor, id: string, dto: TicketPatchDto) {
    await this.validateTicketAccess(actor, id);

    const { rows } = await this.db.query(
      `UPDATE tickets SET status = $2 WHERE id = $1 RETURNING *`,
      [id, dto.status],
      actor,
    );
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id) VALUES ($1,'TICKET_UPDATED','tickets',$2)`,
      [actor.userId, id],
      actor,
    );
    return mapTicket(rows[0]);
  }

  private async ensureMessagesTable(actor: Actor) {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS ticket_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_role VARCHAR(32) NOT NULL DEFAULT '${UserRoles.CUSTOMER}',
        sender_name VARCHAR(255) NOT NULL DEFAULT 'User',
        sender_email VARCHAR(255) NOT NULL DEFAULT '',
        message TEXT DEFAULT '',
        attachments JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS reply_to JSONB DEFAULT NULL;
      ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
      CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_created ON ticket_messages(ticket_id, created_at);
      CREATE TABLE IF NOT EXISTS ticket_reads (
        ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (ticket_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_reads_user ON ticket_reads(user_id);`,
      [],
      actor,
    );
  }

  async findTicketById(ticketId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.db.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId]);
    return rows[0] || null;
  }

  async getTicketParticipantUsers(ticketId: string): Promise<{ id: string; name: string; email: string; role: string }[]> {
    try {
      const { rows } = await this.db.query(
        `SELECT DISTINCT u.id, u.email, u.role,
           COALESCE(u.full_name, split_part(u.email, '@', 1)) as name
         FROM users u
         WHERE u.id IN (
           SELECT sender_id FROM ticket_messages WHERE ticket_id = $1
           UNION
           SELECT customer_id FROM tickets WHERE id = $1
           UNION
           SELECT s.user_id FROM order_items oi
           JOIN suppliers s ON s.id = oi.supplier_id
           JOIN tickets t ON t.order_id = oi.order_id
           WHERE t.id = $1
           UNION
           SELECT dp.user_id FROM delivery_partners dp
           JOIN orders o ON o.delivery_partner_id = dp.id
           JOIN tickets t ON t.order_id = o.id
           WHERE t.id = $1
         )`,
        [ticketId],
      );
      return rows as { id: string; name: string; email: string; role: string }[];
    } catch {
      return [];
    }
  }

  async markTicketAsRead(actor: Actor, ticketId: string) {
    await this.ensureMessagesTable(actor);
    await this.validateTicketAccess(actor, ticketId);
    await this.db.query(
      `INSERT INTO ticket_reads (ticket_id, user_id, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (ticket_id, user_id)
       DO UPDATE SET last_read_at = EXCLUDED.last_read_at`,
      [ticketId, actor.userId],
      actor,
    );
    return { success: true };
  }

  async validateTicketAccess(actor: Actor, ticketId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.db.query(`SELECT * FROM tickets WHERE id = $1`, [ticketId], actor);
    if (!rows.length) throw new NotFoundException('Ticket not found');

    const ticket = rows[0];
    if (actor.role === UserRoles.CUSTOMER) {
      if (ticket['customer_id'] !== actor.userId) {
        throw new ForbiddenException('You do not have access to this ticket');
      }
    } else if (actor.role === UserRoles.DELIVERY_PARTNER) {
      const isOwner = ticket['customer_id'] === actor.userId;
      if (!isOwner) {
        if (!ticket['order_id']) {
          throw new ForbiddenException('You do not have access to this ticket');
        }
        const { rows: dpOrders } = await this.db.query(
          `SELECT 1 FROM orders o
           JOIN delivery_partners dp ON dp.id = o.delivery_partner_id
           WHERE o.id = $1 AND dp.user_id = $2`,
          [ticket['order_id'], actor.userId],
          actor,
        );
        if (!dpOrders.length) {
          throw new ForbiddenException('You do not have access to this ticket');
        }
      }
    } else if (actor.role === UserRoles.SUPPLIER) {
      const isOwner = ticket['customer_id'] === actor.userId;
      if (!isOwner) {
        if (!ticket['order_id']) {
          throw new ForbiddenException('You do not have access to this ticket');
        }
        const { rows: supplierItems } = await this.db.query(
          `SELECT 1 FROM order_items oi
           JOIN suppliers s ON s.id = oi.supplier_id
           WHERE oi.order_id = $1 AND s.user_id = $2`,
          [ticket['order_id'], actor.userId],
          actor,
        );
        if (!supplierItems.length) {
          throw new ForbiddenException('You do not have access to this ticket');
        }
      }
    }
    return ticket;
  }

  async getTicketMessages(actor: Actor, ticketId: string) {
    await this.ensureMessagesTable(actor);
    await this.validateTicketAccess(actor, ticketId);

    // Auto mark ticket read when viewing message history
    await this.markTicketAsRead(actor, ticketId).catch(() => {});

    const { rows } = await this.db.query(
      `SELECT tm.*,
         EXISTS (
           SELECT 1 FROM ticket_reads tr
           WHERE tr.ticket_id = tm.ticket_id
             AND tr.user_id != tm.sender_id
             AND tr.last_read_at >= tm.created_at
         ) as is_read
       FROM ticket_messages tm
       WHERE tm.ticket_id = $1
       ORDER BY tm.created_at ASC`,
      [ticketId],
      actor,
    );
    return rows.map(mapTicketMessage);
  }

  async addTicketMessage(
    actor: Actor,
    ticketId: string,
    messageText?: string,
    attachments?: unknown[],
    replyTo?: { id: string; senderName: string; text: string },
  ) {
    await this.ensureMessagesTable(actor);
    const ticket = await this.validateTicketAccess(actor, ticketId);

    if (ticket['status'] === TicketStatuses.RESOLVED || ticket['status'] === TicketStatuses.CLOSED) {
      throw new BadRequestException('This ticket has been resolved or closed. Further messages are not allowed.');
    }

    const cleanMessage = (messageText || '').trim();
    const safeAttachments = Array.isArray(attachments) ? attachments : [];

    if (!cleanMessage && safeAttachments.length === 0) {
      throw new BadRequestException('Message or attachment is required');
    }

    const userRes = await this.db.query(`SELECT name, email FROM users WHERE id = $1`, [actor.userId], actor);
    const senderName = userRes.rows[0]?.name || actor.email.split('@')[0] || 'User';
    const senderEmail = userRes.rows[0]?.email || actor.email;

    const { rows } = await this.db.query(
      `INSERT INTO ticket_messages (ticket_id, sender_id, sender_role, sender_name, sender_email, message, attachments, reply_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        ticketId,
        actor.userId,
        actor.role,
        senderName,
        senderEmail,
        cleanMessage,
        JSON.stringify(safeAttachments),
        replyTo ? JSON.stringify(replyTo) : null,
      ],
      actor,
    );

    // Auto mark ticket read for sender
    await this.markTicketAsRead(actor, ticketId).catch(() => {});

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'TICKET_MESSAGE_SENT', 'tickets', $2)`,
      [actor.userId, ticketId],
      actor,
    );

    // Notify ticket owner if sender is not the owner
    const ticketOwnerId = ticket['customer_id'] ? String(ticket['customer_id']) : null;
    if (ticketOwnerId && actor.userId !== ticketOwnerId) {
      void this.notifications.create(ticketOwnerId, {
        title: `Ticket #${ticketId.substring(0, 8)} Reply`,
        message: `${senderName}: ${cleanMessage || 'Sent an attachment'}`,
        type: 'TICKET',
        linkUrl: '/tickets',
        metadata: { ticketId },
      });
    }

    return mapTicketMessage({ ...rows[0], is_read: false });
  }

  async toggleMessageReaction(actor: Actor, ticketId: string, messageId: string, emoji: string) {
    await this.ensureMessagesTable(actor);
    await this.validateTicketAccess(actor, ticketId);

    const safeEmoji = (emoji || '').trim();
    if (!safeEmoji) throw new BadRequestException('Emoji is required');

    const { rows } = await this.db.query(
      `SELECT id, reactions FROM ticket_messages WHERE id = $1 AND ticket_id = $2`,
      [messageId, ticketId],
      actor,
    );
    if (!rows.length) throw new NotFoundException('Message not found');

    const rawReactions: Record<string, string[]> = (rows[0].reactions as Record<string, string[]>) || {};
    const userList: string[] = Array.isArray(rawReactions[safeEmoji]) ? [...rawReactions[safeEmoji]] : [];

    const existingIdx = userList.indexOf(actor.userId);
    if (existingIdx >= 0) {
      userList.splice(existingIdx, 1);
    } else {
      userList.push(actor.userId);
    }

    if (userList.length > 0) {
      rawReactions[safeEmoji] = userList;
    } else {
      delete rawReactions[safeEmoji];
    }

    await this.db.query(
      `UPDATE ticket_messages SET reactions = $1 WHERE id = $2`,
      [JSON.stringify(rawReactions), messageId],
      actor,
    );

    return { messageId, reactions: rawReactions };
  }

  async deleteTicketMessage(actor: Actor, ticketId: string, messageId: string) {
    await this.ensureMessagesTable(actor);
    await this.validateTicketAccess(actor, ticketId);

    const { rows } = await this.db.query(
      `SELECT * FROM ticket_messages WHERE id = $1 AND ticket_id = $2`,
      [messageId, ticketId],
      actor,
    );
    if (!rows.length) throw new NotFoundException('Message not found');

    const msg = rows[0];
    const isAdmin = actor.role === UserRoles.ADMIN || actor.role === UserRoles.SUBADMIN;
    if (!isAdmin && msg.sender_id !== actor.userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    const { rows: updatedRows } = await this.db.query(
      `UPDATE ticket_messages
       SET is_deleted = TRUE,
           deleted_at = NOW(),
           message = '[This message was deleted]',
           attachments = '[]'::jsonb
       WHERE id = $1 AND ticket_id = $2
       RETURNING *`,
      [messageId, ticketId],
      actor,
    );

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'TICKET_MESSAGE_DELETED', 'tickets', $2)`,
      [actor.userId, ticketId],
      actor,
    );

    return {
      success: true,
      messageId,
      deletedMessage: mapTicketMessage(updatedRows[0]),
    };
  }
}

