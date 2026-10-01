import { Module } from '@nestjs/common';
import { DatabaseModule } from '@database/database.module';
import { CurrencyModule } from '../currency/currency.module';
import { LandedCostController } from './landed-cost.controller';
import { LandedCostService } from './landed-cost.service';

@Module({
  imports: [DatabaseModule, CurrencyModule],
  controllers: [LandedCostController],
  providers: [LandedCostService],
  exports: [LandedCostService],
})
export class LandedCostModule {}
