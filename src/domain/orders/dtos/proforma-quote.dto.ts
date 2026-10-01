import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProFormaQuoteItemDto {
  @ApiPropertyOptional({ description: 'Product ID' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({ description: 'Product Title' })
  @IsString()
  productTitle!: string;

  @ApiPropertyOptional({ description: 'Product SKU' })
  @IsOptional()
  @IsString()
  productSku?: string;

  @ApiPropertyOptional({ description: 'Supplier / Store Name' })
  @IsOptional()
  @IsString()
  storeName?: string;

  @ApiProperty({ description: 'Quantity ordered', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: 'Unit price' })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Applied discount percentage' })
  @IsOptional()
  @IsNumber()
  discountPercent?: number;

  @ApiPropertyOptional({ description: 'Custom tier price if pre-calculated' })
  @IsOptional()
  @IsNumber()
  customTierPrice?: number;
}

export class GenerateProFormaQuoteDto {
  @ApiPropertyOptional({ description: 'Optional existing Order ID to base quote on' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Optional RFQ ID' })
  @IsOptional()
  @IsString()
  rfqId?: string;

  @ApiPropertyOptional({ description: 'Buyer Company Name', example: 'Acme Global Logistics Ltd' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ description: 'Buyer Full Name / Contact Person', example: 'Sarah Jenkins' })
  @IsOptional()
  @IsString()
  buyerName?: string;

  @ApiPropertyOptional({ description: 'Buyer Business Email', example: 'procurement@acme-global.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Buyer Corporate Tax ID / GSTIN / VAT', example: 'US-EIN-98471928' })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiPropertyOptional({ description: 'Billing / Corporate Address', example: '450 Lexington Ave, New York, NY 10017' })
  @IsOptional()
  @IsString()
  billingAddress?: string;

  @ApiPropertyOptional({ description: 'Shipping Destination', example: 'Fulfillment Hub 3, Los Angeles, CA' })
  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @ApiPropertyOptional({ description: 'Target currency code (USD, EUR, GBP, INR, AED, CAD)', default: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Target currency exchange rate against USD', default: 1.0 })
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;

  @ApiPropertyOptional({ description: 'Quote Line Items', type: [ProFormaQuoteItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProFormaQuoteItemDto)
  items?: ProFormaQuoteItemDto[];

  @ApiPropertyOptional({ description: 'Optional buyer notes or terms requested' })
  @IsOptional()
  @IsString()
  notes?: string;
}
