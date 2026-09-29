import { appConfig } from '@config/app';
import { cloudinaryConfig } from '@config/cloudinary';
import { dbConfig } from '@config/database';
import { smtpConfig } from '@config/smtp';
import { stripeConfig } from '@config/stripe';
import {
  AuditLogEntity,
  CategoryEntity,
  OrderEntity,
  OrderItemEntity,
  ProductEntity,
  RfqQuoteEntity,
  SupplierEntity,
  TicketEntity,
  TicketMessageEntity,
  UserEntity,
  WishlistEntity,
  NotificationEntity,
  ProductReviewEntity,
  RfqChatMessageEntity,
  DeliveryPartnerEntity,
  CampaignAnalyticsEntity,
} from '@core/entities';
import { DatabaseModule } from '@database/database.module';
import { DomainModule } from '@domain/domain.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '@shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, dbConfig, cloudinaryConfig, smtpConfig, stripeConfig],
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.getOrThrow<string>('db.host'),
        port: config.getOrThrow<number>('db.port'),
        username: config.getOrThrow<string>('db.username'),
        password: config.getOrThrow<string>('db.password'),
        database: config.getOrThrow<string>('db.name'),
        entities: [
          UserEntity,
          SupplierEntity,
          CategoryEntity,
          ProductEntity,
          OrderEntity,
          OrderItemEntity,
          WishlistEntity,
          TicketEntity,
          TicketMessageEntity,
          AuditLogEntity,
          RfqQuoteEntity,
          RfqChatMessageEntity,
          NotificationEntity,
          ProductReviewEntity,
          DeliveryPartnerEntity,
          CampaignAnalyticsEntity,
        ],
        synchronize: true,
        logging: ['error'],
      }),
    }),
    DatabaseModule,
    SharedModule,
    DomainModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
