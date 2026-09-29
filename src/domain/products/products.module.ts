import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { SemanticSearchService } from './semantic-search.service';
import { AiReviewService } from './ai-review.service';
import { PriceComparisonService } from './price-comparison.service';

@Module({
  imports: [SharedModule],
  controllers: [ProductsController],
  providers: [ProductsService, SemanticSearchService, AiReviewService, PriceComparisonService],
  exports: [ProductsService, PriceComparisonService],
})
export class ProductsModule {}

