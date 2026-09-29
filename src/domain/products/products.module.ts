import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { SemanticSearchService } from './semantic-search.service';
import { AiReviewService } from './ai-review.service';

@Module({
  imports: [SharedModule],
  controllers: [ProductsController],
  providers: [ProductsService, SemanticSearchService, AiReviewService],
  exports: [ProductsService],
})
export class ProductsModule {}
