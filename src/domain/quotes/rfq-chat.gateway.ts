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
import { RfqChatAttachmentDto } from './dtos/send-rfq-chat-message.dto';
import { QuotesService } from './quotes.service';

export interface AuthenticatedRfqSocket extends Socket {
  data: {
    actor?: Actor;
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/rfq-chat',
})
export class RfqChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RfqChatGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly quotesService: QuotesService,
  ) {}

  async handleConnection(client: AuthenticatedRfqSocket) {
    try {
      const authHeader =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string) ||
        (client.handshake.query?.token as string);

      if (!authHeader) {
        this.logger.warn(`RFQ Chat client ${client.id} disconnected: missing token`);
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

      await client.join(`user:${payload.sub}`);
      this.logger.log(`RFQ Chat client ${client.id} authenticated as ${payload.email} (${payload.role})`);
    } catch (err: unknown) {
      this.logger.warn(`RFQ Chat client ${client.id} auth error: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedRfqSocket) {
    this.logger.log(`RFQ Chat client ${client.id} disconnected`);
  }

  @SubscribeMessage('joinRfqRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedRfqSocket,
    @MessageBody() data: { rfqId: string },
  ) {
    const actor = client.data.actor;
    if (!actor) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    try {
      await this.quotesService.validateQuoteAccess(actor, data.rfqId);
      const room = `rfq:${data.rfqId}`;
      await client.join(room);
      this.logger.log(`User ${actor.email} joined ${room}`);
      client.emit('joinedRfqRoom', { rfqId: data.rfqId });
      return { status: 'ok', rfqId: data.rfqId };
    } catch (err: unknown) {
      client.emit('error', { message: (err as Error).message });
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('leaveRfqRoom')
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedRfqSocket,
    @MessageBody() data: { rfqId: string },
  ) {
    const room = `rfq:${data.rfqId}`;
    await client.leave(room);
    client.emit('leftRfqRoom', { rfqId: data.rfqId });
    return { status: 'ok' };
  }

  @SubscribeMessage('sendRfqMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedRfqSocket,
    @MessageBody()
    data: {
      rfqId: string;
      message: string;
      attachments?: RfqChatAttachmentDto[];
    },
  ) {
    const actor = client.data.actor;
    if (!actor) {
      client.emit('error', { message: 'Unauthorized' });
      return { status: 'error', message: 'Unauthorized' };
    }

    try {
      const message = await this.quotesService.addChatMessage(
        actor,
        data.rfqId,
        data.message,
        data.attachments,
      );
      const room = `rfq:${data.rfqId}`;
      this.server.to(room).emit('newRfqMessage', message);

      // Also emit real-time notification to the counterparty's personal room
      void this.quotesService.getQuoteForChat(data.rfqId).then(async (quote) => {
        if (!quote) return;
        const recipients = await this.quotesService.getRecipientUserIdsForRfq(quote, actor.userId);
        for (const recipientId of recipients) {
          this.server.to(`user:${recipientId}`).emit('rfqNotification', {
            rfqId: quote.id,
            productTitle: quote.productTitle,
            storeName: quote.storeName,
            customerName: quote.customerName,
            message: message.message,
            senderId: message.senderId,
            senderName: message.senderName,
            senderRole: message.senderRole,
            attachmentsCount: message.attachments?.length || 0,
            createdAt: message.createdAt,
          });
        }
      });

      return { status: 'ok', data: message };
    } catch (err: unknown) {
      client.emit('error', { message: (err as Error).message });
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('deleteRfqMessage')
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthenticatedRfqSocket,
    @MessageBody() data: { rfqId: string; messageId: string },
  ) {
    const actor = client.data.actor;
    if (!actor) {
      client.emit('error', { message: 'Unauthorized' });
      return { status: 'error', message: 'Unauthorized' };
    }

    try {
      const result = await this.quotesService.deleteChatMessage(actor, data.rfqId, data.messageId);
      const room = `rfq:${data.rfqId}`;
      this.server.to(room).emit('rfqMessageDeleted', {
        rfqId: data.rfqId,
        messageId: data.messageId,
        deletedMessage: result.deletedMessage,
      });
      return { status: 'ok', data: result };
    } catch (err: unknown) {
      client.emit('error', { message: (err as Error).message });
      return { status: 'error', message: (err as Error).message };
    }
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedRfqSocket,
    @MessageBody() data: { rfqId: string; isTyping: boolean },
  ) {
    const actor = client.data.actor;
    if (!actor || !data?.rfqId) return;

    const room = `rfq:${data.rfqId}`;
    client.to(room).emit('rfqUserTyping', {
      rfqId: data.rfqId,
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      isTyping: Boolean(data.isTyping),
    });
  }

  @SubscribeMessage('markRfqRead')
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedRfqSocket,
    @MessageBody() data: { rfqId: string },
  ) {
    const actor = client.data.actor;
    if (!actor || !data?.rfqId) return;

    try {
      await this.quotesService.markChatAsRead(actor, data.rfqId);
      const room = `rfq:${data.rfqId}`;
      this.server.to(room).emit('rfqMessagesRead', {
        rfqId: data.rfqId,
        readerId: actor.userId,
        readAt: new Date().toISOString(),
      });
      return { status: 'ok' };
    } catch (err: unknown) {
      return { status: 'error', message: (err as Error).message };
    }
  }
}
