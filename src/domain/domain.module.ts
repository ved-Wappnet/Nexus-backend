import { Module } from '@nestjs/common';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth';
import { CatalogModule } from './catalog';
import { ChatbotModule } from './chatbot';
import { CurrencyModule } from './currency/currency.module';
import { DashboardModule } from './dashboard';
import { DeliveryPartnersModule } from './delivery-partners/delivery-partners.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products';
import { QuotesModule } from './quotes/quotes.module';
import { MarketingModule } from './marketing/marketing.module';

@Module({
  imports: [
    AuthModule,
    ProductsModule,
    CatalogModule,
    OrdersModule,
    DashboardModule,
    QuotesModule,
    PaymentsModule,
    AuditLogsModule,
    NotificationsModule,
    CurrencyModule,
    ChatbotModule,
    DeliveryPartnersModule,
    MarketingModule,
  ],
})
export class DomainModule {}
