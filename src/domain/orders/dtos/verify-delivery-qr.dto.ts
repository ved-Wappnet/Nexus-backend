import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyDeliveryQrDto {
  @ApiProperty({
    description: 'Scanned QR code content, raw payload, or alphanumeric delivery signoff token',
    example: 'NX-DLV-8B4F2A-9E10',
  })
  @IsString()
  @IsNotEmpty()
  qrCodeOrToken!: string;

  @ApiPropertyOptional({
    description: 'Optional Order ID if scanned from within order context',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsString()
  @IsOptional()
  orderId?: string;
}
