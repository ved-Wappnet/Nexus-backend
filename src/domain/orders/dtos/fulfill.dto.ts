import { OrderStatuses } from '@core/constants';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class FulfillDto {
  @IsIn([
    OrderStatuses.PENDING,
    OrderStatuses.PROCESSING,
    OrderStatuses.SHIPPED,
    OrderStatuses.OUT_FOR_DELIVERY,
    OrderStatuses.DELIVERED,
    OrderStatuses.CANCELLED,
  ])
  @ApiProperty({
    enum: OrderStatuses,
    example: OrderStatuses.SHIPPED,
  })
  status!: OrderStatuses;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'FedEx' })
  carrier?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'FDX-99882244' })
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'https://www.fedex.com/fedextrack/?trknbr=FDX-99882244' })
  trackingUrl?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '2026-09-20T18:00:00.000Z' })
  estimatedDelivery?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Chicago Logistics Hub' })
  checkpointLocation?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Package picked up by courier' })
  checkpointNote?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'b5a03429-1234-4567-890a-bcdef1234567', description: 'Assigned Delivery Partner UUID' })
  deliveryPartnerId?: string;
}
