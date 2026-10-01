import { PriceAlertEntity, ProductEntity } from '@core/entities';
import { NotificationsModule } from '@domain/notifications/notifications.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SharedModule } from '@shared/shared.module';
import { AiReviewService } from './ai-review.service';
import { PriceAlertService } from './price-alert.service';
import { PriceComparisonService } from './price-comparison.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { SemanticSearchService } from './semantic-search.service';

@Module({
  imports: [
    SharedModule,
    NotificationsModule,
    TypeOrmModule.forFeature([PriceAlertEntity, ProductEntity]),
  ],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    SemanticSearchService,
    AiReviewService,
    PriceComparisonService,
    PriceAlertService,
  ],
  exports: [ProductsService, PriceComparisonService, PriceAlertService],
})
export class ProductsModule {}

