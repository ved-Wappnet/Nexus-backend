import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NO_EDGE_SPACES = /^(?!\s).*(?<!\s)$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PASSWORD_PATTERN = /^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,64}$/;
const OTP_PATTERN = /^\d{6}$/;

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @Matches(EMAIL_PATTERN, { message: 'Enter a valid email address' })
  @Matches(NO_EDGE_SPACES, { message: 'Email cannot start or end with a space' })
  @ApiProperty({ name: 'email', required: true, example: 'user@example.com' })
  email!: string;

  @IsString()
  @Matches(OTP_PATTERN, { message: 'Enter the 6-digit verification code' })
  @ApiProperty({ name: 'otp', required: true, example: '482913' })
  otp!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @Matches(NO_EDGE_SPACES, { message: 'Password cannot start or end with a space' })
  @Matches(PASSWORD_PATTERN, {
    message:
      'Password must be 8–64 characters and include uppercase, lowercase, number, and symbol',
  })
  @ApiProperty({ name: 'password', required: true, minLength: 8, maxLength: 64, example: 'Secret123!' })
  password!: string;
}
