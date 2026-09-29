import { Module } from '@nestjs/common';
import { SharedModule } from '@shared/shared.module';
import { MarketingController } from './marketing.controller';
import { MarketingAiService } from './marketing-ai.service';

@Module({
  imports: [SharedModule],
  controllers: [MarketingController],
  providers: [MarketingAiService],
  exports: [MarketingAiService],
})
export class MarketingModule {}
