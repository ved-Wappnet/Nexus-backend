import { IPaginationOptions } from '@core/interfaces';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PaginationDto implements IPaginationOptions {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @ApiPropertyOptional({ name: 'page', description: 'Page number', example: 1 })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @ApiPropertyOptional({ name: 'pageSize', description: 'Items per page', example: 12 })
  pageSize?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ name: 'search', description: 'Search term', example: 'headphones' })
  search?: string;
}
