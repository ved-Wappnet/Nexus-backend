import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class LocationPingDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '796918ac-05e8-4044-a25a-37ca441ed1b4' })
  orderId?: string;

  @IsNumber()
  @ApiProperty({ example: 37.7749 })
  latitude!: number;

  @IsNumber()
  @ApiProperty({ example: -122.4194 })
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ example: 85.5 })
  heading?: number;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ example: 32.4 })
  speed?: number;
}
