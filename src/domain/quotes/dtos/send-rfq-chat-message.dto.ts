import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class RfqChatAttachmentDto {
  @IsString()
  @ApiProperty({ example: 'https://res.cloudinary.com/.../packaging-spec.pdf' })
  url!: string;

  @IsString()
  @ApiProperty({ example: 'packaging-spec.pdf' })
  name!: string;

  @IsOptional()
  @ApiPropertyOptional({ example: 1048576 })
  size?: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'application/pdf' })
  mimeType?: string;
}

export class SendRfqChatMessageDto {
  @IsString()
  @MaxLength(4000)
  @ApiProperty({ example: 'Can you provide 500 units with custom embossed packaging?' })
  message!: string;

  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({ type: [RfqChatAttachmentDto] })
  attachments?: RfqChatAttachmentDto[];
}
