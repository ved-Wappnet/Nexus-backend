import { ApiProperty } from '@nestjs/swagger';

export class ErrorViewModel {
  @ApiProperty({ name: 'status', format: 'boolean', example: false })
  status!: boolean;

  @ApiProperty({ name: 'message', format: 'string', example: 'Invalid email or password' })
  message!: string;
}
