import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

function parseJsonIfString({ value }: { value: unknown }) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export class UpsertProductDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Wireless Headphones' })
  title?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Required when an admin creates a product for a supplier' })
  supplierId?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ example: 79.99 })
  price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ example: 10.0 })
  platformFeePercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({ example: 25 })
  stockQuantity?: number;

  @IsOptional()
  @Transform(parseJsonIfString)
  @ApiPropertyOptional({
    type: 'array',
    example: [{ url: 'https://cdn.example.com/p.jpg', alt: 'Headphones', isPrimary: true }],
  })
  images?: { url: string; alt: string; isPrimary: boolean }[];

  @IsOptional()
  @Transform(parseJsonIfString)
  @IsObject()
  @ApiPropertyOptional({ example: { color: 'black', wireless: true } })
  attributes?: Record<string, string | number | boolean>;
}
