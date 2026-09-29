import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ReleaseEscrowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  @ApiProperty({ example: 2, description: 'Milestone index (1: Upfront, 2: In-Transit Customs, 3: Delivery)' })
  milestoneIndex!: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Customs checkpoint scan verified on Transit Map' })
  notes?: string;
}
