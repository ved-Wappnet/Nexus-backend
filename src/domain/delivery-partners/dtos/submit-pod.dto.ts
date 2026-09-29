import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class SubmitProofOfDeliveryDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Base64 digital signature image data URL' })
  signatureDataUrl?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ description: 'Delivery dropoff verification photo URL / base64' })
  photoUrl?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'John Doe (Receiving Manager)' })
  recipientName?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Package safely handed over at warehouse dock 4.' })
  notes?: string;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ example: 37.7749 })
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @ApiPropertyOptional({ example: -122.4194 })
  longitude?: number;
}
