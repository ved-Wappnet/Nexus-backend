import { OrderStatuses } from '@core/constants';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateTaskStatusDto {
  @IsIn([OrderStatuses.OUT_FOR_DELIVERY, OrderStatuses.DELIVERED])
  @ApiProperty({
    enum: [OrderStatuses.OUT_FOR_DELIVERY, OrderStatuses.DELIVERED],
    example: OrderStatuses.OUT_FOR_DELIVERY,
  })
  status!: OrderStatuses.OUT_FOR_DELIVERY | OrderStatuses.DELIVERED;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Courier has departed the distribution hub.' })
  checkpointNote?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'San Francisco, CA' })
  checkpointLocation?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Recipient signature confirmed at gate 3' })
  proofNote?: string;
}
