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

export interface AuthenticatedOrderSocket extends Socket {
  data: {
    actor?: Actor;
  };
}

export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  customerEmail?: string;
  totalAmount: number;
  status: string;
  itemsCount: number;
  createdAt: string;
}

export interface OrderStatusUpdatedPayload {
  orderId: string;
  previousStatus?: string;
  newStatus: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  checkpointLocation?: string | null;
  checkpointNote?: string | null;
  estimatedDelivery?: string | null;
  updatedAt: string;
}

export interface OrderItemUpdatedPayload {
  orderId: string;
  itemId: string;
  status: string;
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  checkpointLocation?: string | null;
  checkpointNote?: string | null;
  estimatedDelivery?: string | null;
  updatedAt: string;
}

export interface OrderPaidPayload {
  orderId: string;
  amount: number;
  status: string;
  paidAt: string;
}

export interface OrderEscrowUpdatedPayload {
  orderId: string;
  milestoneIndex: number;
  milestoneTitle: string;
  releasedAmount: number;
  totalReleasedAmount?: number;
  status: string;
  releaseTxHash?: string;
  updatedAt: string;
  dispute?: any;
}

export interface DriverDispatchedPayload {
  orderId: string;
  partnerId: string;
  partnerName: string;
  vehicleType: string;
  vehiclePlateNumber: string;
  trackingNumber?: string;
  destinationAddress?: string;
  destinationCity?: string;
  dispatchedAt: string;
}

export interface DriverApproachingDockPayload {
  orderId: string;
  partnerId: string;
  partnerName: string;
  vehicleType: string;
  vehiclePlateNumber: string;
  distanceMeters: number;
  estimatedArrivalMinutes: number;
  destinationAddress?: string;
  destinationCity?: string;
  deliveryQrToken?: string;
  arrivedAt: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/orders',
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(OrdersGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: AuthenticatedOrderSocket) {
    try {
      const authHeader =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string) ||
        (client.handshake.query?.token as string);

      if (!authHeader) {
        this.logger.debug(`Orders client ${client.id} missing auth token`);
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

      // Join user specific room
      const userRoom = `user:${payload.sub}`;
      await client.join(userRoom);

      // Join role based rooms
      if (payload.role === UserRoles.ADMIN || payload.role === UserRoles.SUBADMIN) {
        await client.join('role:admin');
      } else if (payload.role === UserRoles.SUPPLIER) {
        await client.join('role:supplier');
      } else if (payload.role === UserRoles.DELIVERY_PARTNER) {
        await client.join('role:delivery_partner');
      }

      this.logger.debug(
        `Orders client ${client.id} connected as ${payload.email} (${payload.role})`,
      );
    } catch (error) {
      this.logger.warn(`Failed orders socket auth for ${client.id}: ${(error as Error).message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedOrderSocket) {
    this.logger.debug(`Orders client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinOrder')
  async handleJoinOrder(
    @ConnectedSocket() client: AuthenticatedOrderSocket,
    @MessageBody() data: { orderId: string },
  ) {
    if (!data?.orderId) return { status: 'error', message: 'Missing orderId' };
    const room = `order:${data.orderId}`;
    await client.join(room);
    this.logger.debug(`Client ${client.id} joined ${room}`);
    return { status: 'ok', room };
  }

  @SubscribeMessage('leaveOrder')
  async handleLeaveOrder(
    @ConnectedSocket() client: AuthenticatedOrderSocket,
    @MessageBody() data: { orderId: string },
  ) {
    if (!data?.orderId) return { status: 'error', message: 'Missing orderId' };
    const room = `order:${data.orderId}`;
    await client.leave(room);
    this.logger.debug(`Client ${client.id} left ${room}`);
    return { status: 'ok', room };
  }

  broadcastOrderCreated(
    order: OrderCreatedPayload,
    customerId: string,
    supplierUserIds: string[] = [],
  ) {
    if (!this.server) return;

    // Send to customer
    this.server.to(`user:${customerId}`).emit('orderCreated', order);

    // Send to each supplier involved
    for (const suppId of supplierUserIds) {
      if (suppId) {
        this.server.to(`user:${suppId}`).emit('orderCreated', order);
      }
    }

    // Send to all administrators & local delivery fleet
    this.server.to('role:admin').emit('orderCreated', order);
    this.server.to('role:delivery_partner').emit('orderCreated', order);
  }

  broadcastOrderStatusUpdated(
    orderId: string,
    customerId: string,
    supplierUserIds: string[] = [],
    payload: OrderStatusUpdatedPayload,
  ) {
    if (!this.server) return;

    // Emit to active inspection room
    this.server.to(`order:${orderId}`).emit('orderStatusUpdated', payload);

    // Emit to customer
    this.server.to(`user:${customerId}`).emit('orderStatusUpdated', payload);

    // Emit to suppliers
    for (const suppId of supplierUserIds) {
      if (suppId) {
        this.server.to(`user:${suppId}`).emit('orderStatusUpdated', payload);
      }
    }

    // Emit to admins & delivery partners
    this.server.to('role:admin').emit('orderStatusUpdated', payload);
    this.server.to('role:delivery_partner').emit('orderStatusUpdated', payload);
  }

  broadcastOrderItemUpdated(
    orderId: string,
    itemId: string,
    customerId: string,
    supplierUserId: string,
    payload: OrderItemUpdatedPayload,
  ) {
    if (!this.server) return;

    this.server.to(`order:${orderId}`).emit('orderItemUpdated', payload);
    this.server.to(`user:${customerId}`).emit('orderItemUpdated', payload);
    if (supplierUserId) {
      this.server.to(`user:${supplierUserId}`).emit('orderItemUpdated', payload);
    }
    this.server.to('role:admin').emit('orderItemUpdated', payload);
  }

  broadcastOrderPaid(
    orderId: string,
    customerId: string,
    supplierUserIds: string[] = [],
    payload: OrderPaidPayload,
  ) {
    if (!this.server) return;

    this.server.to(`order:${orderId}`).emit('orderPaid', payload);
    this.server.to(`user:${customerId}`).emit('orderPaid', payload);
    for (const suppId of supplierUserIds) {
      if (suppId) {
        this.server.to(`user:${suppId}`).emit('orderPaid', payload);
      }
    }
    this.server.to('role:admin').emit('orderPaid', payload);
  }

  broadcastOrderEscrowUpdated(
    orderId: string,
    customerId: string,
    supplierUserIds: string[] = [],
    payload: OrderEscrowUpdatedPayload,
  ) {
    if (!this.server) return;

    this.server.to(`order:${orderId}`).emit('orderEscrowUpdated', payload);
    this.server.to(`user:${customerId}`).emit('orderEscrowUpdated', payload);
    for (const suppId of supplierUserIds) {
      if (suppId) {
        this.server.to(`user:${suppId}`).emit('orderEscrowUpdated', payload);
      }
    }
    this.server.to('role:admin').emit('orderEscrowUpdated', payload);
  }

  broadcastDeliveryPartnerUpdated(partner: any) {
    if (!this.server) return;
    this.server.to('role:admin').emit('deliveryPartnerUpdated', partner);
    if (partner?.user_id) {
      this.server.to(`user:${partner.user_id}`).emit('deliveryPartnerUpdated', partner);
    }
  }

  broadcastDeliveryPartnerRegistered(partner: any) {
    if (!this.server) return;
    this.server.to('role:admin').emit('deliveryPartnerRegistered', partner);
  }

  @SubscribeMessage('updateDriverLocation')
  async handleUpdateDriverLocation(
    @ConnectedSocket() client: AuthenticatedOrderSocket,
    @MessageBody()
    data: {
      orderId?: string;
      partnerId?: string;
      latitude: number;
      longitude: number;
      heading?: number;
      speed?: number;
    },
  ) {
    if (!data || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      return { status: 'error', message: 'Invalid coordinates' };
    }

    const payload = {
      orderId: data.orderId,
      partnerId: data.partnerId || client.data.actor?.userId,
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      heading: Number(data.heading || 0),
      speed: Number(data.speed || 0),
      updatedAt: new Date().toISOString(),
    };

    if (data.orderId) {
      this.server.to(`order:${data.orderId}`).emit('driverLocationUpdated', payload);
    }
    this.server.to('role:admin').emit('driverLocationUpdated', payload);

    return { status: 'ok', payload };
  }

  @SubscribeMessage('sendChatMessage')
  async handleSendChatMessage(
    @ConnectedSocket() client: AuthenticatedOrderSocket,
    @MessageBody()
    data: {
      orderId: string;
      text: string;
      sender: 'courier' | 'customer';
    },
  ) {
    if (!data?.orderId || !data?.text) {
      return { status: 'error', message: 'Missing orderId or text' };
    }

    const payload = {
      orderId: data.orderId,
      id: `${data.sender}-${Date.now()}`,
      text: data.text,
      sender: data.sender,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    this.server.to(`order:${data.orderId}`).emit('chatMessage', payload);
    return { status: 'ok', payload };
  }

  broadcastDriverLocation(
    orderId: string,
    customerId: string,
    payload: {
      orderId: string;
      partnerId?: string;
      latitude: number;
      longitude: number;
      heading?: number;
      speed?: number;
      updatedAt: string;
    },
  ) {
    if (!this.server) return;
    if (orderId) {
      this.server.to(`order:${orderId}`).emit('driverLocationUpdated', payload);
    }
    if (customerId) {
      this.server.to(`user:${customerId}`).emit('driverLocationUpdated', payload);
    }
    this.server.to('role:admin').emit('driverLocationUpdated', payload);
  }

  broadcastProofOfDelivery(
    orderId: string,
    customerId: string,
    supplierUserIds: string[] = [],
    payload: any,
  ) {
    if (!this.server) return;
    if (orderId) {
      this.server.to(`order:${orderId}`).emit('proofOfDeliverySubmitted', payload);
    }
    if (customerId) {
      this.server.to(`user:${customerId}`).emit('proofOfDeliverySubmitted', payload);
    }
    for (const suppId of supplierUserIds) {
      if (suppId) {
        this.server.to(`user:${suppId}`).emit('proofOfDeliverySubmitted', payload);
      }
    }
    this.server.to('role:admin').emit('proofOfDeliverySubmitted', payload);
  }

  broadcastDriverDispatched(
    orderId: string,
    customerId: string,
    supplierUserIds: string[] = [],
    payload: DriverDispatchedPayload,
  ) {
    if (!this.server) return;
    if (orderId) {
      this.server.to(`order:${orderId}`).emit('driverDispatched', payload);
    }
    if (customerId) {
      this.server.to(`user:${customerId}`).emit('driverDispatched', payload);
    }
    for (const suppId of supplierUserIds) {
      if (suppId) {
        this.server.to(`user:${suppId}`).emit('driverDispatched', payload);
      }
    }
    this.server.to('role:admin').emit('driverDispatched', payload);
    this.server.to('role:delivery_partner').emit('driverDispatched', payload);
  }

  broadcastDriverApproachingDock(
    orderId: string,
    customerId: string,
    payload: DriverApproachingDockPayload,
  ) {
    if (!this.server) return;
    if (orderId) {
      this.server.to(`order:${orderId}`).emit('driverApproachingDock', payload);
    }
    if (customerId) {
      this.server.to(`user:${customerId}`).emit('driverApproachingDock', payload);
    }
    this.server.to('role:admin').emit('driverApproachingDock', payload);
  }
}
