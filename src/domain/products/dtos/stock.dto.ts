import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class StockDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiProperty({ example: 40, minimum: 0 })
  stockQuantity!: number;
}
