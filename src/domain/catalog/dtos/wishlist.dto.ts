import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class WishlistDto {
  @IsString()
  @ApiProperty({ name: 'productId', required: true, example: 'c2f1a0e4-1b2c-4d5e-8f90-123456789abc' })
  productId!: string;
}
