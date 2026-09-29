import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';

const NO_EDGE_SPACES = /^(?!\s).*(?<!\s)$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Matches(EMAIL_PATTERN, { message: 'Enter a valid email address' })
  @Matches(NO_EDGE_SPACES, { message: 'Email cannot start or end with a space' })
  @ApiProperty({ name: 'email', required: true, example: 'user@example.com' })
  email!: string;
}
