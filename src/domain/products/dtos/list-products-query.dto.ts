import { ProductStatuses } from '@core/constants';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ListProductsQueryDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Search title, description, or store name' })
  q?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '10' })
  minPrice?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '200' })
  maxPrice?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ enum: ProductStatuses })
  status?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '1' })
  page?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '12' })
  pageSize?: string;
}
