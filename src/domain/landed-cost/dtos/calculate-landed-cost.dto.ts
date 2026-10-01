import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CalculateLandedCostDto {
  @ApiPropertyOptional({ description: 'Product ID in catalog' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Product title / name' })
  @IsOptional()
  @IsString()
  productTitle?: string;

  @ApiPropertyOptional({ description: 'Product category', example: 'electronics' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Customs HS Tariff Code', example: '8471.30' })
  @IsOptional()
  @IsString()
  hsCode?: string;

  @ApiProperty({ description: 'Base wholesale unit price in USD', example: 120.0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ description: 'Order quantity', example: 25, default: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Destination 2-letter ISO Country Code (e.g. US, DE, IN, GB, AE, CA, AU, JP)', example: 'DE' })
  @IsString()
  destinationCountry!: string;

  @ApiPropertyOptional({ description: 'Target currency code (USD, EUR, GBP, INR, AED, CAD, JPY, AUD)', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Exchange rate against 1 USD if pre-locked' })
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;
}
