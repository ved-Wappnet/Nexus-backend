import { CurrentUser } from '@core/decorators';
import { JwtAuthGuard } from '@core/guards';
import { Actor } from '@core/interfaces';
import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() actor: Actor,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const isUnreadOnly = unreadOnly === 'true' || unreadOnly === '1';
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10), 1), 100) : 50;
    return this.notificationsService.list(actor, isUnreadOnly, parsedLimit);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() actor: Actor) {
    const count = await this.notificationsService.getUnreadCount(actor);
    return { count };
  }

  @Patch(':id/read')
  async markAsRead(@CurrentUser() actor: Actor, @Param('id') id: string) {
    return this.notificationsService.markAsRead(actor, id);
  }

  @Post('read-all')
  async markAllAsRead(@CurrentUser() actor: Actor) {
    return this.notificationsService.markAllAsRead(actor);
  }

  @Delete()
  async clearAll(@CurrentUser() actor: Actor) {
    return this.notificationsService.clearAll(actor);
  }
}
