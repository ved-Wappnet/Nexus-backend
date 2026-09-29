import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NO_EDGE_SPACES = /^(?!\s).*(?<!\s)$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export class LoginDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Matches(EMAIL_PATTERN, { message: 'Enter a valid email address' })
  @Matches(NO_EDGE_SPACES, { message: 'Email cannot start or end with a space' })
  @ApiProperty({ name: 'email', required: true, example: 'user@example.com' })
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(NO_EDGE_SPACES, { message: 'Password cannot start or end with a space' })
  @ApiProperty({ name: 'password', required: true, example: 'Secret123!' })
  password!: string;
}
