import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class VisualSearchDto {
  @ApiPropertyOptional({ description: 'Optional image URL (e.g. external product photo or CDN link)' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Optional base64 image data URI' })
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional({ description: 'Optional user hint or keyword context to assist visual matching' })
  @IsOptional()
  @IsString()
  hint?: string;
}
