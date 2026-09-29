import { DeliveryPartnerVerificationStatuses } from '@core/constants';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

export class VerifyPartnerDto {
  @IsEnum(DeliveryPartnerVerificationStatuses)
  @ApiProperty({
    enum: DeliveryPartnerVerificationStatuses,
    example: DeliveryPartnerVerificationStatuses.APPROVED,
    description: 'New verification status',
  })
  status!: DeliveryPartnerVerificationStatuses;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'Driver license photo was blurry and expired. Please re-upload.',
    description: 'Reason when rejecting an application',
  })
  rejectionReason?: string;
}
