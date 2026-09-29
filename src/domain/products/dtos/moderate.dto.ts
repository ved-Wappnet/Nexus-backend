import { ProductStatuses } from '@core/constants';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ModerateDto {
  @IsIn([ProductStatuses.APPROVED, ProductStatuses.REJECTED])
  @ApiProperty({ enum: [ProductStatuses.APPROVED, ProductStatuses.REJECTED], example: ProductStatuses.APPROVED })
  status!: ProductStatuses.APPROVED | ProductStatuses.REJECTED;
}
