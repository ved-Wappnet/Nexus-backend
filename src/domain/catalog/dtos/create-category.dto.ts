import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @ApiProperty({ name: 'name', required: true, example: 'Electronics' })
  name!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ name: 'slug', example: 'electronics' })
  slug?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ name: 'parentId', example: null })
  parentId?: string | null;
}
