import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentStatuses, RfqStatuses, UserRoles } from '@core/constants';
import { RfqChatMessageEntity, RfqQuoteEntity } from '@core/entities';
import { Actor } from '@core/interfaces';
import { DatabaseService } from '@database/database.service';
import { NotificationsService } from '@domain/notifications/notifications.service';
import { RfqChatAttachmentDto } from './dtos/send-rfq-chat-message.dto';

export interface CreateRfqDto {
  productId: string;
  productTitle: string;
  productSlug: string;
  productImage?: string;
  unitPrice: number;
  targetQuantity: number;
  requestedUnitPrice: number;
  platformFeePercent?: number;
  deliveryTimeline: string;
  notes?: string;
  customerName?: string;
  customerEmail?: string;
  supplierId?: string;
  storeName?: string;
}

@Injectable()
export class QuotesService {
  constructor(
    @InjectRepository(RfqQuoteEntity)
    private readonly quoteRepo: Repository<RfqQuoteEntity>,
    @InjectRepository(RfqChatMessageEntity)
    private readonly chatRepo: Repository<RfqChatMessageEntity>,
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(actor: Actor, q?: string, status?: string): Promise<RfqQuoteEntity[]> {
    const qb = this.quoteRepo.createQueryBuilder('q').orderBy('q.createdAt', 'DESC');

    if (actor.role === UserRoles.CUSTOMER) {
      const userRes = await this.db.query(`SELECT email FROM users WHERE id = $1`, [actor.userId], actor);
      const userEmail = (userRes.rows[0]?.email || '').toLowerCase();
      qb.andWhere('(q.customerId = :userId OR LOWER(q.customerEmail) = :userEmail)', {
        userId: actor.userId,
        userEmail,
      });
    } else if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(`SELECT id, store_name FROM suppliers WHERE user_id = $1`, [actor.userId], actor);
      const supplierId = suppRes.rows[0]?.id;
      if (!supplierId) {
        return [];
      }
      qb.andWhere('q.supplierId = :supplierId', { supplierId });
    }

    if (status && status !== 'ALL') {
      qb.andWhere('q.status = :status', { status });
    }

    if (q && q.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(q.id::text) LIKE :term OR LOWER(q.productTitle) LIKE :term OR LOWER(q.customerEmail) LIKE :term OR LOWER(q.customerName) LIKE :term OR LOWER(q.storeName) LIKE :term)',
        { term }
      );
    }

    return qb.getMany();
  }

  async create(actor: Actor, dto: CreateRfqDto): Promise<RfqQuoteEntity> {
    const userRes = await this.db.query(`SELECT name, email FROM users WHERE id = $1`, [actor.userId], actor);
    const userName = userRes.rows[0]?.name || dto.customerName || 'Enterprise Buyer';
    const userEmail = userRes.rows[0]?.email || dto.customerEmail || 'buyer@nexus.b2b';

    const platformFeePercent = dto.platformFeePercent ?? 10.0;
    const totalGmv = dto.requestedUnitPrice * dto.targetQuantity;
    const platformFeeAmount = Math.round(totalGmv * (platformFeePercent / 100) * 100) / 100;
    const supplierPayoutAmount = Math.round((totalGmv - platformFeeAmount) * 100) / 100;

    const quote = this.quoteRepo.create({
      ...dto,
      customerId: actor.userId,
      customerName: userName,
      customerEmail: userEmail,
      platformFeePercent,
      platformFeeAmount,
      supplierPayoutAmount,
      supplierId: dto.supplierId || 'supp-1',
      storeName: dto.storeName || 'Prem Store Hub',
      status: RfqStatuses.SUBMITTED,
    });

    const saved = await this.quoteRepo.save(quote);

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'RFQ_CREATED', 'quotes', $2)`,
      [actor.userId, saved.id],
      actor,
    );

    // Notify supplier of new RFQ
    if (dto.supplierId) {
      this.db
        .query(`SELECT user_id FROM suppliers WHERE id = $1`, [dto.supplierId], actor)
        .then((res) => {
          const suppUserId = res.rows[0]?.user_id;
          if (suppUserId) {
            void this.notifications.create(suppUserId, {
              title: 'New RFQ Received',
              message: `${userName} requested ${dto.targetQuantity}x "${dto.productTitle}" at $${dto.requestedUnitPrice}/unit.`,
              type: 'RFQ',
              linkUrl: '/quotes',
              metadata: { quoteId: saved.id },
            });
          }
        })
        .catch(() => {});
    }

    return saved;
  }

  async counterOffer(actor: Actor, id: string, counterUnitPrice: number): Promise<RfqQuoteEntity> {
    const quote = await this.quoteRepo.findOneBy({ id });
    if (!quote) throw new NotFoundException(`RFQ Quote with ID ${id} not found`);

    if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(`SELECT id FROM suppliers WHERE user_id = $1`, [actor.userId], actor);
      const supplierId = suppRes.rows[0]?.id;
      if (quote.supplierId !== supplierId) {
        throw new ForbiddenException('You can only counter-offer quotes for your own store');
      }
    } else if (actor.role === UserRoles.CUSTOMER) {
      throw new ForbiddenException('Customers cannot counter-offer on their own RFQ');
    }

    quote.counterUnitPrice = counterUnitPrice;
    quote.status = RfqStatuses.COUNTER_OFFERED;

    const feePct = Number(quote.platformFeePercent || 10.0);
    const totalGmv = counterUnitPrice * quote.targetQuantity;
    quote.platformFeeAmount = Math.round(totalGmv * (feePct / 100) * 100) / 100;
    quote.supplierPayoutAmount = Math.round((totalGmv - quote.platformFeeAmount) * 100) / 100;

    const saved = await this.quoteRepo.save(quote);

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'RFQ_COUNTER_OFFERED', 'quotes', $2)`,
      [actor.userId, saved.id],
      actor,
    );

    // Notify customer of counter-offer
    if (quote.customerId) {
      void this.notifications.create(quote.customerId, {
        title: 'RFQ Counter-Offer Received',
        message: `${quote.storeName} offered $${counterUnitPrice}/unit for "${quote.productTitle}".`,
        type: 'RFQ',
        linkUrl: '/quotes',
        metadata: { quoteId: saved.id },
      });
    }

    return saved;
  }

  async updateStatus(actor: Actor, id: string, status: string): Promise<RfqQuoteEntity> {
    const quote = await this.quoteRepo.findOneBy({ id });
    if (!quote) throw new NotFoundException(`RFQ Quote with ID ${id} not found`);

    if (actor.role === UserRoles.CUSTOMER) {
      const userRes = await this.db.query(`SELECT email FROM users WHERE id = $1`, [actor.userId], actor);
      const userEmail = (userRes.rows[0]?.email || '').toLowerCase();
      if (quote.customerId !== actor.userId && quote.customerEmail.toLowerCase() !== userEmail) {
        throw new ForbiddenException('You can only update your own quotes');
      }
    } else if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(`SELECT id FROM suppliers WHERE user_id = $1`, [actor.userId], actor);
      const supplierId = suppRes.rows[0]?.id;
      if (quote.supplierId !== supplierId) {
        throw new ForbiddenException('You can only update quotes for your own store');
      }
    }

    quote.status = status;
    const saved = await this.quoteRepo.save(quote);

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, $2, 'quotes', $3)`,
      [actor.userId, `RFQ_STATUS_${status}`, saved.id],
      actor,
    );

    // Notify counterparty
    if (status === RfqStatuses.ACCEPTED || status === RfqStatuses.REJECTED) {
      const isAccepted = status === RfqStatuses.ACCEPTED;
      if (actor.role === UserRoles.CUSTOMER && quote.supplierId) {
        this.db
          .query(`SELECT user_id FROM suppliers WHERE id = $1`, [quote.supplierId], actor)
          .then((res) => {
            const suppUserId = res.rows[0]?.user_id;
            if (suppUserId) {
              void this.notifications.create(suppUserId, {
                title: `RFQ Quote ${isAccepted ? 'Accepted' : 'Declined'}`,
                message: `Customer ${isAccepted ? 'accepted' : 'declined'} the quote for "${quote.productTitle}".`,
                type: 'RFQ',
                linkUrl: '/quotes',
                metadata: { quoteId: saved.id },
              });
            }
          })
          .catch(() => {});
      } else if (actor.role === UserRoles.SUPPLIER && quote.customerId) {
        void this.notifications.create(quote.customerId, {
          title: `RFQ Quote ${isAccepted ? 'Accepted' : 'Declined'}`,
          message: `${quote.storeName} has ${isAccepted ? 'accepted' : 'declined'} your quote for "${quote.productTitle}".`,
          type: 'RFQ',
          linkUrl: '/quotes',
          metadata: { quoteId: saved.id },
        });
      }
    }

    return saved;
  }

  async remove(actor: Actor, id: string): Promise<{ success: boolean }> {
    const quote = await this.quoteRepo.findOneBy({ id });
    if (!quote) throw new NotFoundException(`RFQ Quote with ID ${id} not found`);

    if (actor.role === UserRoles.CUSTOMER) {
      if (quote.customerId !== actor.userId) {
        throw new ForbiddenException('You can only delete your own submitted quotes');
      }
      if (quote.status === RfqStatuses.PAID) {
        throw new ForbiddenException('Paid contracts cannot be deleted');
      }
    } else if (actor.role !== UserRoles.ADMIN && actor.role !== UserRoles.SUBADMIN) {
      throw new ForbiddenException('Insufficient permissions to delete quote');
    }

    await this.quoteRepo.delete(id);

    await this.db.query(
      `INSERT INTO audit_logs (actor_id, action, entity_name, entity_id)
       VALUES ($1, 'RFQ_DELETED', 'quotes', $2)`,
      [actor.userId, id],
      actor,
    );

    return { success: true };
  }

  async getInvoiceData(actor: Actor, quoteId: string) {
    const quote = await this.quoteRepo.findOneBy({ id: quoteId });
    if (!quote) throw new NotFoundException(`RFQ Quote with ID ${quoteId} not found`);

    if (actor.role === UserRoles.CUSTOMER) {
      const userRes = await this.db.query(`SELECT email FROM users WHERE id = $1`, [actor.userId], actor);
      const userEmail = (userRes.rows[0]?.email || '').toLowerCase();
      if (quote.customerId !== actor.userId && quote.customerEmail.toLowerCase() !== userEmail) {
        throw new ForbiddenException('You do not have access to this RFQ contract invoice');
      }
    } else if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(`SELECT id FROM suppliers WHERE user_id = $1`, [actor.userId], actor);
      const supplierId = suppRes.rows[0]?.id;
      if (quote.supplierId !== supplierId) {
        throw new ForbiddenException('You do not have access to this RFQ contract invoice');
      }
    }

    const effectiveUnitPrice = Number(quote.counterUnitPrice || quote.requestedUnitPrice || quote.unitPrice);
    const lineTotal = Number((effectiveUnitPrice * quote.targetQuantity).toFixed(2));
    const platformFee = Number(quote.platformFeeAmount || ((lineTotal * (quote.platformFeePercent || 10)) / 100).toFixed(2));
    const supplierPayout = Number(quote.supplierPayoutAmount || (lineTotal - platformFee).toFixed(2));

    return {
      invoiceNumber: `PO-RFQ-${quote.id.slice(0, 8).toUpperCase()}`,
      documentType: 'WHOLESALE_PURCHASE_ORDER',
      quoteId: quote.id,
      issueDate: quote.createdAt,
      status: quote.status,
      paymentMethod: 'Stripe Wholesale Escrow',
      paymentStatus: quote.status === RfqStatuses.PAID ? PaymentStatuses.PAID : (quote.status === RfqStatuses.ACCEPTED ? PaymentStatuses.AWAITING_PAYMENT : quote.status),
      issuer: {
        legalName: 'Nexus B2B Wholesale Marketplace Inc.',
        taxId: 'US-EIN-94-3829102',
        address: '100 Market St, Suite 500, San Francisco, CA 94105',
        supportEmail: 'wholesale@nexus.b2b',
        phone: '+1 (800) 555-NEXUS',
        website: 'nexus.b2b',
      },
      supplier: {
        id: quote.supplierId,
        storeName: quote.storeName || 'Verified Nexus Supplier',
        verified: true,
      },
      customer: {
        id: quote.customerId,
        name: quote.customerName || 'Enterprise Bulk Buyer',
        email: quote.customerEmail,
        accountType: 'Enterprise Wholesale Buyer',
      },
      logistics: {
        deliveryTimeline: quote.deliveryTimeline || 'Standard Freight - 3 to 5 Days',
        shippingTerms: 'FOB Destination / Courier Tracked',
        buyerNotes: quote.notes || 'None provided',
      },
      items: [
        {
          id: quote.productId,
          productId: quote.productId,
          productTitle: quote.productTitle,
          productSku: `RFQ-${quote.productSlug ? quote.productSlug.slice(0, 8).toUpperCase() : 'BULK-ITEM'}`,
          storeName: quote.storeName,
          quantity: quote.targetQuantity,
          unitPrice: effectiveUnitPrice,
          subtotal: lineTotal,
          originalMSRP: Number(quote.unitPrice),
        },
      ],
      subtotal: lineTotal,
      platformFeePercent: Number(quote.platformFeePercent || 10),
      platformFeeAmount: platformFee,
      supplierPayoutAmount: supplierPayout,
      taxRatePercent: 0,
      taxAmount: 0,
      shippingFee: 0,
      totalAmount: lineTotal,
    };
  }

  async validateQuoteAccess(actor: Actor, quoteId: string): Promise<RfqQuoteEntity> {
    const quote = await this.quoteRepo.findOneBy({ id: quoteId });
    if (!quote) throw new NotFoundException(`RFQ Quote with ID ${quoteId} not found`);

    if (actor.role === UserRoles.ADMIN) {
      return quote;
    }

    if (actor.role === UserRoles.CUSTOMER) {
      const userRes = await this.db.query(`SELECT email FROM users WHERE id = $1`, [actor.userId], actor);
      const userEmail = (userRes.rows[0]?.email || '').toLowerCase();
      if (quote.customerId !== actor.userId && quote.customerEmail.toLowerCase() !== userEmail) {
        throw new ForbiddenException('You do not have access to this RFQ negotiation');
      }
      return quote;
    }

    if (actor.role === UserRoles.SUPPLIER) {
      const suppRes = await this.db.query(`SELECT id FROM suppliers WHERE user_id = $1`, [actor.userId], actor);
      const supplierId = suppRes.rows[0]?.id;
      if (quote.supplierId !== supplierId) {
        throw new ForbiddenException('You do not have access to this RFQ negotiation');
      }
      return quote;
    }

    throw new ForbiddenException('Unauthorized access to RFQ negotiation');
  }

  async getChatMessages(actor: Actor, rfqId: string): Promise<RfqChatMessageEntity[]> {
    await this.validateQuoteAccess(actor, rfqId);
    return this.chatRepo.find({
      where: { rfqId },
      order: { createdAt: 'ASC' },
    });
  }

  async addChatMessage(
    actor: Actor,
    rfqId: string,
    messageText: string,
    attachments?: RfqChatAttachmentDto[],
  ): Promise<RfqChatMessageEntity> {
    const quote = await this.validateQuoteAccess(actor, rfqId);

    const userRes = await this.db.query(`SELECT name, email FROM users WHERE id = $1`, [actor.userId], actor);
    const senderName =
      userRes.rows[0]?.name ||
      (actor.role === UserRoles.SUPPLIER ? quote.storeName : quote.customerName) ||
      'Participant';

    const chatMsg = this.chatRepo.create({
      rfqId,
      senderId: actor.userId,
      senderName,
      senderRole: actor.role,
      message: messageText,
      attachments: attachments || [],
      isDeleted: false,
      readBy: [actor.userId],
    });

    const saved = await this.chatRepo.save(chatMsg);

    // Asynchronously notify counterparties
    try {
      this.getRecipientUserIdsForRfq(quote, actor.userId).then((recipientIds) => {
        for (const recipientId of recipientIds) {
          const isCustomer = recipientId === quote.customerId;
          const notificationTitle = isCustomer
            ? `Supplier message: ${quote.productTitle}`
            : `Buyer message: ${quote.productTitle}`;

          void this.notifications.create(recipientId, {
            title: notificationTitle,
            message: `${senderName}: ${messageText.slice(0, 100)}`,
            type: 'RFQ',
            linkUrl: `/quotes?quoteId=${quote.id}`,
            metadata: { quoteId: quote.id, messageId: saved.id },
          });
        }
      }).catch(() => {});
    } catch {
      // Non-blocking notification failure
    }

    return saved;
  }

  async getQuoteForChat(rfqId: string): Promise<RfqQuoteEntity | null> {
    return this.quoteRepo.findOneBy({ id: rfqId });
  }

  async getRecipientUserIdsForRfq(quote: RfqQuoteEntity, senderUserId: string): Promise<string[]> {
    const recipients: string[] = [];

    // Include customer if not the sender
    if (quote.customerId && quote.customerId !== senderUserId) {
      recipients.push(quote.customerId);
    }

    // Include supplier user if not the sender
    if (quote.supplierId) {
      try {
        const suppRes = await this.db.query<{ user_id: string }>(
          `SELECT user_id FROM suppliers WHERE id = $1`,
          [quote.supplierId],
        );
        const suppUserId = suppRes.rows[0]?.user_id;
        if (suppUserId && suppUserId !== senderUserId && !recipients.includes(suppUserId)) {
          recipients.push(suppUserId);
        }
      } catch {
        // Non-blocking
      }
    }

    return recipients;
  }

  async deleteChatMessage(
    actor: Actor,
    rfqId: string,
    messageId: string,
  ): Promise<{ success: boolean; messageId: string; deletedMessage: RfqChatMessageEntity }> {
    await this.validateQuoteAccess(actor, rfqId);

    const message = await this.chatRepo.findOneBy({ id: messageId, rfqId });
    if (!message) {
      throw new NotFoundException(`Message with ID ${messageId} not found`);
    }

    if (actor.role !== UserRoles.ADMIN && message.senderId !== actor.userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.message = '[This message was deleted]';
    message.attachments = [];

    const saved = await this.chatRepo.save(message);

    return {
      success: true,
      messageId: saved.id,
      deletedMessage: saved,
    };
  }

  async markChatAsRead(actor: Actor, rfqId: string): Promise<{ success: boolean }> {
    await this.validateQuoteAccess(actor, rfqId);

    await this.db.query(
      `UPDATE rfq_chat_messages 
       SET read_by = CASE 
         WHEN read_by ? $1 THEN read_by 
         ELSE read_by || jsonb_build_array($1::text) 
       END
       WHERE rfq_id = $2`,
      [actor.userId, rfqId],
      actor,
    );

    return { success: true };
  }
}

