import { NotificationEntity, NotificationType } from '@core/entities';
import { Actor } from '@core/interfaces';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationsGateway } from './notifications.gateway';

export interface CreateNotificationDto {
  title: string;
  message: string;
  type: NotificationType;
  linkUrl?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(userId: string, dto: CreateNotificationDto): Promise<NotificationEntity> {
    try {
      const entity = this.notificationRepo.create({
        userId,
        title: dto.title,
        message: dto.message,
        type: dto.type,
        linkUrl: dto.linkUrl || null,
        metadata: dto.metadata || null,
        isRead: false,
      });

      const saved = await this.notificationRepo.save(entity);

      // Fetch new unread count for this user
      const unreadCount = await this.notificationRepo.count({
        where: { userId, isRead: false },
      });

      // Push real-time event to the user's room
      this.gateway.sendToUser(userId, 'newNotification', {
        id: saved.id,
        userId: saved.userId,
        title: saved.title,
        message: saved.message,
        type: saved.type,
        isRead: saved.isRead,
        linkUrl: saved.linkUrl,
        metadata: saved.metadata,
        createdAt: saved.createdAt.toISOString(),
      });

      this.gateway.broadcastUnreadCount(userId, unreadCount);

      return saved;
    } catch (error) {
      this.logger.error(`Failed to create notification for ${userId}: ${(error as Error).message}`);
      throw error;
    }
  }

  async list(actor: Actor, unreadOnly = false, limit = 50): Promise<NotificationEntity[]> {
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.userId = :userId', { userId: actor.userId })
      .orderBy('n.createdAt', 'DESC')
      .take(limit);

    if (unreadOnly) {
      qb.andWhere('n.isRead = false');
    }

    return qb.getMany();
  }

  async getUnreadCount(actor: Actor): Promise<number> {
    return this.notificationRepo.count({
      where: { userId: actor.userId, isRead: false },
    });
  }

  async markAsRead(actor: Actor, id: string): Promise<NotificationEntity> {
    const notification = await this.notificationRepo.findOne({
      where: { id, userId: actor.userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (!notification.isRead) {
      notification.isRead = true;
      await this.notificationRepo.save(notification);

      const unreadCount = await this.notificationRepo.count({
        where: { userId: actor.userId, isRead: false },
      });
      this.gateway.broadcastUnreadCount(actor.userId, unreadCount);
    }

    return notification;
  }

  async markAllAsRead(actor: Actor): Promise<{ updated: number }> {
    const result = await this.notificationRepo.update(
      { userId: actor.userId, isRead: false },
      { isRead: true },
    );

    this.gateway.broadcastUnreadCount(actor.userId, 0);

    return { updated: result.affected || 0 };
  }

  async clearAll(actor: Actor): Promise<{ deleted: number }> {
    const result = await this.notificationRepo.delete({ userId: actor.userId });
    this.gateway.broadcastUnreadCount(actor.userId, 0);
    return { deleted: result.affected || 0 };
  }
}
