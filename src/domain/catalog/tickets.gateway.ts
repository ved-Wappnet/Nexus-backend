import { UserRoles } from '@core/constants';
import { Actor, UserRole } from '@core/interfaces';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { NotificationsService } from '@domain/notifications/notifications.service';
import { CatalogService } from './catalog.service';

export interface AuthenticatedSocket extends Socket {
  data: {
    actor?: Actor;
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/tickets',
})
export class TicketsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TicketsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly catalogService: CatalogService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const authHeader =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string) ||
        (client.handshake.query?.token as string);

      if (!authHeader) {
        this.logger.warn(`Client ${client.id} disconnected: missing auth token`);
        client.disconnect();
        return;
      }

      const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
      const payload = this.jwtService.verify<{ sub: string; email: string; role: UserRole }>(token);

      if (!payload?.sub) {
        client.disconnect();
        return;
      }

      client.data.actor = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };

      // Auto join personal user room and role room for global notifications
      await client.join(`user:${payload.sub}`);
      await client.join(`role:${payload.role}`);

      this.logger.log(`Client ${client.id} connected & authenticated as ${payload.email} (${payload.role})`);
    } catch (err: unknown) {
      this.logger.warn(`Client ${client.id} auth failed: ${(err as Error).message}`);
      client.disconnect();
    }

  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('joinTicket')
  async handleJoinTicket(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { ticketId: string },
  ) {
    const actor = client.data.actor;
    if (!actor) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    try {
      await this.catalogService.validateTicketAccess(actor, data.ticketId);
      const room = `ticket:${data.ticketId}`;
      await client.join(room);
      this.logger.log(`User ${actor.email} joined room ${room}`);
      client.emit('joinedTicket', { ticketId: data.ticketId });
    } catch (err: unknown) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('leaveTicket')
  async handleLeaveTicket(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { ticketId: string },
  ) {
    const room = `ticket:${data.ticketId}`;
    await client.leave(room);
    client.emit('leftTicket', { ticketId: data.ticketId });
  }

  @SubscribeMessage('sendTicketMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      ticketId: string;
      message?: string;
      attachments?: { url: string; name: string; size: number; mimeType: string }[];
      replyTo?: { id: string; senderName: string; text: string };
    },
  ) {
    const actor = client.data.actor;
    if (!actor) {
      client.emit('error', { message: 'Unauthorized' });
      return { status: 'error', message: 'Unauthorized' };
    }

    try {
      const message = await this.catalogService.addTicketMessage(
        actor,
        data.ticketId,
        data.message,
        data.attachments,
        data.replyTo,
      );
      const room = `ticket:${data.ticketId}`;
      this.server.to(room).emit('newTicketMessage', message);
      await this.broadcastTicketNotification(data.ticketId, message);
      return { status: 'ok', data: message };
    } catch (err: unknown) {
      client.emit('error', { message: (err as Error).message });
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('markTicketRead')
  async handleMarkTicketRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { ticketId: string },
  ) {
    const actor = client.data.actor;
    if (!actor || !data?.ticketId) return;
    try {
      await this.catalogService.markTicketAsRead(actor, data.ticketId);
      const room = `ticket:${data.ticketId}`;
      this.server.to(room).emit('messagesRead', {
        ticketId: data.ticketId,
        readerId: actor.userId,
        readAt: new Date().toISOString(),
      });
      return { status: 'ok' };
    } catch (err: unknown) {
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('toggleReaction')
  async handleToggleReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { ticketId: string; messageId: string; emoji: string },
  ) {
    const actor = client.data.actor;
    if (!actor || !data?.ticketId || !data?.messageId || !data?.emoji) return;
    try {
      const res = await this.catalogService.toggleMessageReaction(
        actor,
        data.ticketId,
        data.messageId,
        data.emoji,
      );
      const room = `ticket:${data.ticketId}`;
      this.server.to(room).emit('messageReactionUpdated', {
        ticketId: data.ticketId,
        messageId: res.messageId,
        reactions: res.reactions,
      });
      return { status: 'ok', data: res };
    } catch (err: unknown) {
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('deleteTicketMessage')
  async handleDeleteTicketMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { ticketId: string; messageId: string },
  ) {
    const actor = client.data.actor;
    if (!actor) {
      client.emit('error', { message: 'Unauthorized' });
      return { status: 'error', message: 'Unauthorized' };
    }

    try {
      const res = await this.catalogService.deleteTicketMessage(actor, data.ticketId, data.messageId);
      const room = `ticket:${data.ticketId}`;
      this.server.to(room).emit('ticketMessageDeleted', {
        ticketId: data.ticketId,
        messageId: data.messageId,
        deletedMessage: res.deletedMessage,
      });
      return { status: 'ok', data: res };
    } catch (err: unknown) {
      client.emit('error', { message: (err as Error).message });
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { ticketId: string; isTyping: boolean },
  ) {
    const actor = client.data.actor;
    if (!actor) return;
    const room = `ticket:${data.ticketId}`;
    client.to(room).emit('userTyping', {
      ticketId: data.ticketId,
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      isTyping: data.isTyping,
    });
  }

  async broadcastTicketMessage(ticketId: string, message: unknown) {
    if (this.server) {
      this.server.to(`ticket:${ticketId}`).emit('newTicketMessage', message);
      await this.broadcastTicketNotification(ticketId, message as any);
    }
  }

  broadcastTicketStatus(ticketId: string, status: string) {
    if (this.server) {
      this.server.to(`ticket:${ticketId}`).emit('ticketStatusUpdated', { ticketId, status });
    }
  }

  async broadcastTicketNotification(ticketId: string, message: any) {
    if (!this.server || !message) return;
    try {
      const ticket = await this.catalogService.findTicketById(ticketId);
      if (!ticket) return;

      const rawMsg = message.message || '';
      const notificationPayload = {
        ticketId,
        ticketSubject: ticket['subject'],
        messageId: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        senderRole: message.senderRole,
        message: rawMsg,
        attachmentsCount: message.attachments?.length || 0,
        createdAt: message.createdAt || new Date().toISOString(),
        isMention: false,
        mentionText: '',
      };

      // 1. Emit to customer owner if not sender
      if (ticket['customer_id'] && ticket['customer_id'] !== message.senderId) {
        this.server.to(`user:${ticket['customer_id']}`).emit('ticketNotification', notificationPayload);
      }

      // 2. Emit to admin/subadmin staff if not sender
      if (message.senderRole !== UserRoles.ADMIN && message.senderRole !== UserRoles.SUBADMIN) {
        this.server.to(`role:${UserRoles.ADMIN}`).to(`role:${UserRoles.SUBADMIN}`).emit('ticketNotification', notificationPayload);
      }

      // 3. Load all participants in this ticket (customer, order suppliers, previous message senders)
      const participants = await this.catalogService.getTicketParticipantUsers(ticketId);
      const mentionedUserIds = new Set<string>();
      const lower = rawMsg.toLowerCase();

      // Check if message mentions @all or @everyone
      const isAllMention = /(^|[\s.,!?;:(])@(all|everyone)\b/i.test(rawMsg);
      if (isAllMention) {
        for (const p of participants) {
          if (p.id !== message.senderId) {
            mentionedUserIds.add(p.id);
          }
        }
        this.server.to(`role:${UserRoles.ADMIN}`).to(`role:${UserRoles.SUBADMIN}`).emit('ticketNotification', {
          ...notificationPayload,
          isMention: true,
          mentionText: `${message.senderName} tagged @all in ticket #${ticketId.slice(0, 8)}`,
        });
      }

      // Check role tags: @Admin / @Support
      if (lower.includes('@admin') || lower.includes('@support')) {
        this.server.to(`role:${UserRoles.ADMIN}`).to(`role:${UserRoles.SUBADMIN}`).emit('ticketNotification', {
          ...notificationPayload,
          isMention: true,
          mentionText: `${message.senderName} tagged @Support in ticket #${ticketId.slice(0, 8)}`,
        });
      }

      // Check role tag: @Customer
      if (lower.includes('@customer') && ticket['customer_id'] && ticket['customer_id'] !== message.senderId) {
        mentionedUserIds.add(ticket['customer_id'] as string);
      }

      // Check role tag: @Supplier
      if (lower.includes('@supplier')) {
        for (const p of participants) {
          if (p.role === UserRoles.SUPPLIER && p.id !== message.senderId) {
            mentionedUserIds.add(p.id);
          }
        }
      }

      // Check specific user name mentions: e.g. @Prem or @PremShinde
      for (const p of participants) {
        if (p.id === message.senderId) continue;
        const cleanName = (p.name || '').replace(/\s+/g, '');
        const firstName = (p.name || '').split(/\s+/)[0];
        const emailHandle = (p.email || '').split('@')[0];

        const candidateHandles = [cleanName, firstName, emailHandle]
          .filter((h): h is string => Boolean(h && h.length >= 2))
          .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        if (candidateHandles.length > 0) {
          const pattern = new RegExp(`(^|[\\s.,!?;:(])@(${candidateHandles.join('|')})\\b`, 'i');
          if (pattern.test(rawMsg)) {
            mentionedUserIds.add(p.id);
          }
        }
      }

      // 4. Support legacy @[Name](userId) mentions if present
      const legacyMentionRegex = /@\[([^\]]+)\]\(([0-9a-fA-F-]+)\)/g;
      let legMatch: RegExpExecArray | null;
      while ((legMatch = legacyMentionRegex.exec(rawMsg)) !== null) {
        const taggedUserId = legMatch[2];
        if (taggedUserId && taggedUserId !== message.senderId) {
          mentionedUserIds.add(taggedUserId);
        }
      }

      // 5. Send targeted mention notifications (Socket & In-App DB)
      for (const targetUserId of mentionedUserIds) {
        const notice = isAllMention
          ? `${message.senderName} tagged @all in ticket #${ticketId.slice(0, 8)}`
          : `${message.senderName} mentioned you in ticket #${ticketId.slice(0, 8)}`;

        this.server.to(`user:${targetUserId}`).emit('ticketNotification', {
          ...notificationPayload,
          isMention: true,
          mentionText: notice,
        });

        // Persist notification for the mentioned user
        try {
          const cleanSnippet = rawMsg.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').slice(0, 90);
          await this.notificationsService.create(targetUserId, {
            title: isAllMention ? `${message.senderName} tagged @all` : `Mentioned by ${message.senderName}`,
            message: isAllMention
              ? `You and all participants were tagged in ticket "${ticket['subject']}": "${cleanSnippet}"`
              : `You were tagged in ticket "${ticket['subject']}": "${cleanSnippet}"`,
            type: 'TICKET',
            linkUrl: `/tickets?ticketId=${ticketId}`,
            metadata: { ticketId, messageId: message.id, senderId: message.senderId, isAllMention },
          });
        } catch (e) {
          this.logger.warn(`Failed to create mention notification: ${(e as Error).message}`);
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Failed to broadcast ticket notification: ${(err as Error).message}`);
    }
  }
}

