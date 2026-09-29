import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum EscrowDisputeType {
  DAMAGED_GOODS = 'DAMAGED_GOODS',
  MISSING_QUANTITY = 'MISSING_QUANTITY',
  SPECIFICATION_MISMATCH = 'SPECIFICATION_MISMATCH',
  QUALITY_DEFECT = 'QUALITY_DEFECT',
  OTHER = 'OTHER',
}

export enum EscrowResolutionType {
  REFUND_BUYER = 'REFUND_BUYER',
  SPLIT_SETTLEMENT = 'SPLIT_SETTLEMENT',
  RELEASE_TO_SUPPLIER = 'RELEASE_TO_SUPPLIER',
}

export class CreateEscrowDisputeDto {
  @ApiProperty({
    enum: EscrowDisputeType,
    example: EscrowDisputeType.DAMAGED_GOODS,
    description: 'Category of defect or shipment discrepancy',
  })
  @IsEnum(EscrowDisputeType)
  disputeType!: EscrowDisputeType;

  @ApiProperty({
    example: 'Damaged hydraulic pump casing on 6 units',
    description: 'Brief headline of the dispute claim',
  })
  @IsString()
  reason!: string;

  @ApiProperty({
    example: 'Upon uncrating pallet #2, six of the pump housings showed severe impact cracks sustained in transit.',
    description: 'Comprehensive description of the delivery issue',
  })
  @IsString()
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://storage.nexus.com/evidence/damaged-crate-1.jpg'],
    description: 'URLs to photographic or inspection proof documents',
  })
  @IsOptional()
  @IsArray()
  evidenceUrls?: string[];

  @ApiPropertyOptional({
    example: 2250.0,
    description: 'Claimed dispute refund amount (defaults to 30% milestone balance)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  claimAmount?: number;
}

export class ResolveEscrowDisputeDto {
  @ApiProperty({
    enum: EscrowResolutionType,
    example: EscrowResolutionType.SPLIT_SETTLEMENT,
    description: 'Arbitration outcome strategy',
  })
  @IsEnum(EscrowResolutionType)
  resolutionType!: EscrowResolutionType;

  @ApiPropertyOptional({
    example: 1125.0,
    description: 'Amount refunded to buyer if partial or full refund',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  refundedAmount?: number;

  @ApiPropertyOptional({
    example: 1125.0,
    description: 'Amount released to supplier if partial or release',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  releasedAmount?: number;

  @ApiProperty({
    example: 'Agreed settlement: 50% refunded for damaged pumps, 50% released for acceptable units.',
    description: 'Official arbitration ruling explanation',
  })
  @IsString()
  resolutionNotes!: string;
}
