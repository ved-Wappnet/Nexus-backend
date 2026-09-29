import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @ApiProperty({ example: 'Delivery delay inquiry' })
  subject!: string;

  @IsString()
  @MinLength(5)
  @ApiProperty({ example: 'My order has been in shipped status for several days without tracking updates.' })
  body!: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({ example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' })
  orderId?: string;
}
