import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ChatMessageItemDto {
  @ApiProperty({ description: 'Role of the message author', enum: ['user', 'assistant', 'system'] })
  @IsString()
  @IsNotEmpty()
  role!: 'user' | 'assistant' | 'system';

  @ApiProperty({ description: 'Content of the message' })
  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class SendChatMessageDto {
  @ApiProperty({ description: 'Current message from user' })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ description: 'Conversation history context', type: [ChatMessageItemDto] })
  @IsOptional()
  @IsArray()
  history?: ChatMessageItemDto[];

  @ApiPropertyOptional({ description: 'Optional order ID context if user is inquiring about a specific order' })
  @IsOptional()
  @IsString()
  activeOrderId?: string;

  @ApiPropertyOptional({ description: 'Optional file attachments metadata (images, videos, docs)' })
  @IsOptional()
  @IsArray()
  attachments?: any[];
}
