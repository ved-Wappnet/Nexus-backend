import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class TicketAttachmentDto {
  @IsString()
  @ApiProperty({ example: 'https://res.cloudinary.com/.../receipt.pdf' })
  url!: string;

  @IsString()
  @ApiProperty({ example: 'receipt.pdf' })
  name!: string;

  @ApiProperty({ example: 1048576 })
  size!: number;

  @IsString()
  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;
}

export class TicketReplyToDto {
  @IsString()
  @ApiProperty({ example: 'b1a2c3d4-...' })
  id!: string;

  @IsString()
  @ApiProperty({ example: 'John Doe' })
  senderName!: string;

  @IsString()
  @ApiProperty({ example: 'Can you please check the tracking number?' })
  text!: string;
}

export class CreateTicketMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @ApiPropertyOptional({ example: 'Please see the attached receipt.' })
  message?: string;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ type: [TicketAttachmentDto] })
  attachments?: TicketAttachmentDto[];

  @IsOptional()
  @ApiPropertyOptional({ type: TicketReplyToDto })
  replyTo?: TicketReplyToDto;
}
