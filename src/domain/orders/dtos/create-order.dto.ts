import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class CreateOrderItemDto {
  @IsUUID()
  @ApiProperty({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  @ApiProperty({ example: 1, minimum: 1, maximum: 99 })
  quantity!: number;
}

export class CreateOrderDto {
  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  productId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 99 })
  quantity?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @ApiPropertyOptional({ type: [CreateOrderItemDto] })
  items?: CreateOrderItemDto[];

  @IsOptional()
  @ApiPropertyOptional({ example: 'MILESTONE_ESCROW', enum: ['FULL_UPFRONT', 'MILESTONE_ESCROW'] })
  paymentMode?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'Aarav Patel' })
  recipientName?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: '+1 (555) 234-5678' })
  recipientPhone?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'United States' })
  destinationCountry?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'California' })
  destinationRegion?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'San Francisco' })
  destinationCity?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: '100 Nexus Distribution Way, Suite 400' })
  destinationAddress?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: '94105' })
  destinationPostalCode?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: true })
  billingSameAsShipping?: boolean;

  @IsOptional()
  @ApiPropertyOptional({ example: 'Global Enterprise Corp' })
  billingName?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'US-948291038' })
  billingTaxId?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: '100 Nexus Distribution Way, Suite 400' })
  billingAddress?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'San Francisco' })
  billingCity?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'California' })
  billingRegion?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: '94105' })
  billingPostalCode?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 'United States' })
  billingCountry?: string;
}

