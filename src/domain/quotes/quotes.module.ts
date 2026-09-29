import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RfqChatMessageEntity, RfqQuoteEntity } from '@core/entities';
import { NotificationsModule } from '@domain/notifications/notifications.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { RfqChatGateway } from './rfq-chat.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([RfqQuoteEntity, RfqChatMessageEntity]),
    NotificationsModule,
  ],
  controllers: [QuotesController],
  providers: [QuotesService, RfqChatGateway],
  exports: [QuotesService, RfqChatGateway],
})
export class QuotesModule {}

