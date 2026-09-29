import { AuthModule } from '@domain/auth/auth.module';
import { NotificationsModule } from '@domain/notifications/notifications.module';
import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { TicketsGateway } from './tickets.gateway';

@Module({
  imports: [AuthModule, SharedModule, NotificationsModule],
  controllers: [CatalogController],
  providers: [CatalogService, TicketsGateway],
  exports: [CatalogService, TicketsGateway],
})
export class CatalogModule {}

