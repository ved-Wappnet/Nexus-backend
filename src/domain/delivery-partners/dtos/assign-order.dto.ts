import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignOrderDto {
  @IsUUID()
  @IsNotEmpty()
  @ApiProperty({ example: 'b5a03429-1234-4567-890a-bcdef1234567', description: 'Approved Delivery Partner ID' })
  deliveryPartnerId!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'Assigned to verified local courier for same-day delivery' })
  assignmentNote?: string;
}
