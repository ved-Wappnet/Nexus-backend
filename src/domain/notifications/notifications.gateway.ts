import { Actor, UserRole } from '@core/interfaces';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

export interface AuthenticatedNotificationSocket extends Socket {
  data: {
    actor?: Actor;
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: AuthenticatedNotificationSocket) {
    try {
      const authHeader =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string) ||
        (client.handshake.query?.token as string);

      if (!authHeader) {
        this.logger.debug(`Notification client ${client.id} missing auth token`);
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

      const userRoom = `user:${payload.sub}`;
      await client.join(userRoom);
      this.logger.debug(`Notification client ${client.id} joined user room ${userRoom}`);
    } catch (error) {
      this.logger.warn(`Failed notification socket auth for ${client.id}: ${(error as Error).message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedNotificationSocket) {
    this.logger.debug(`Notification client disconnected: ${client.id}`);
  }

  sendToUser(userId: string, event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  broadcastUnreadCount(userId: string, count: number) {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('unreadCountUpdated', { count });
  }
}
