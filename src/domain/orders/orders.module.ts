import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '@domain/notifications/notifications.module';
import { PaymentsModule } from '@domain/payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { OrdersService } from './orders.service';
import { PayoutsController } from './payouts.controller';
import { PdfGeneratorService } from './pdf-generator.service';

@Module({
  imports: [forwardRef(() => PaymentsModule), NotificationsModule],
  controllers: [OrdersController, PayoutsController],
  providers: [OrdersService, OrdersGateway, PdfGeneratorService],
  exports: [OrdersService, OrdersGateway, PdfGeneratorService],
})
export class OrdersModule {}
