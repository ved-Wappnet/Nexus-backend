import { PriceAlertType } from '@core/entities';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class CreatePriceAlertDto {
  @ApiProperty({ description: 'Notification email address for price alert' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({
    enum: PriceAlertType,
    default: PriceAlertType.ANY_DROP,
    description: 'Trigger condition for price alert',
  })
  @IsEnum(PriceAlertType)
  @IsOptional()
  alertType?: PriceAlertType = PriceAlertType.ANY_DROP;

  @ApiPropertyOptional({
    description: 'Specific target price threshold in USD',
  })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(0.01)
  targetPrice?: number;

  @ApiPropertyOptional({
    description:
      'Minimum percentage discount over Amazon/Flipkart to trigger alert (e.g. 10 for 10% cheaper)',
    default: 10,
  })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(90)
  competitorMarginPercent?: number = 10;
}

export class SimulatePriceDropDto {
  @ApiProperty({ description: 'New simulated product price to test alerts' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  newPrice!: number;
}
