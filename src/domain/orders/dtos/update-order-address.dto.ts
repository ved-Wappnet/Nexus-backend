import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrderAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'Aarav Patel' })
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional({ example: '+1 (555) 234-5678' })
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'United States' })
  destinationCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'California' })
  destinationRegion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'San Francisco' })
  destinationCity?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '100 Nexus Distribution Way, Suite 400' })
  destinationAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @ApiPropertyOptional({ example: '94105' })
  destinationPostalCode?: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 37.7749 })
  destinationLatitude?: number;

  @IsOptional()
  @ApiPropertyOptional({ example: -122.4194 })
  destinationLongitude?: number;

  // Billing Details
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ example: true })
  billingSameAsShipping?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'Global Enterprise Corp' })
  billingName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @ApiPropertyOptional({ example: 'US-948291038' })
  billingTaxId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '100 Nexus Distribution Way, Suite 400' })
  billingAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'San Francisco' })
  billingCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'California' })
  billingRegion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @ApiPropertyOptional({ example: '94105' })
  billingPostalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @ApiPropertyOptional({ example: 'United States' })
  billingCountry?: string;
}
