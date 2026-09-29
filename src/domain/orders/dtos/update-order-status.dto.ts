import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrderStatuses } from '@core/constants';

export class UpdateOrderStatusDto {
    @IsEnum(OrderStatuses)
    @ApiProperty({ enum: OrderStatuses })
    status!: OrderStatuses;
} 