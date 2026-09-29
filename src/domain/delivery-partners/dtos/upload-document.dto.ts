import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadDocumentDto {
  @IsIn(['GOVT_ID', 'DRIVING_LICENSE', 'VEHICLE_RC', 'TRANSIT_INSURANCE', 'OTHER'])
  @ApiProperty({
    example: 'DRIVING_LICENSE',
    description: 'Document category',
    enum: ['GOVT_ID', 'DRIVING_LICENSE', 'VEHICLE_RC', 'TRANSIT_INSURANCE', 'OTHER'],
  })
  type!: 'GOVT_ID' | 'DRIVING_LICENSE' | 'VEHICLE_RC' | 'TRANSIT_INSURANCE' | 'OTHER';

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'California_CDL_Commercial.pdf', description: 'Original filename or label' })
  name!: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'https://res.cloudinary.com/.../doc.pdf', description: 'Hosted document or data URL' })
  url!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '1.4 MB' })
  fileSize?: string;
}
