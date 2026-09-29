import { DatabaseModule } from '@database/database.module';
import { NotificationsModule } from '@domain/notifications/notifications.module';
import { OrdersModule } from '@domain/orders/orders.module';
import { Module, forwardRef } from '@nestjs/common';
import { DeliveryPartnersController } from './delivery-partners.controller';
import { DeliveryPartnersService } from './delivery-partners.service';

@Module({
  imports: [DatabaseModule, NotificationsModule, forwardRef(() => OrdersModule)],
  controllers: [DeliveryPartnersController],
  providers: [DeliveryPartnersService],
  exports: [DeliveryPartnersService],
})
export class DeliveryPartnersModule {}
