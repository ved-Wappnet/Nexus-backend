import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  @ApiProperty({ description: 'Rating from 1 to 5 stars', minimum: 1, maximum: 5, example: 5 })
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiPropertyOptional({ description: 'Review summary headline', example: 'Outstanding build quality and fast shipping!' })
  title?: string;

  @IsString()
  @MaxLength(3000)
  @ApiProperty({ description: 'Detailed review feedback', example: 'The product exceeded expectations. Solid packaging and seamless setup.' })
  comment!: string;
}

export class ListReviewsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @ApiPropertyOptional({ default: 1 })
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  @ApiPropertyOptional({ default: 10 })
  pageSize?: number = 10;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  @ApiPropertyOptional({ description: 'Filter reviews by exact star rating (1-5)' })
  rating?: number;

  @IsOptional()
  @ApiPropertyOptional({ description: 'Filter only verified buyer reviews' })
  verifiedOnly?: string | boolean;
}
