import { AccountTypes } from '@core/constants';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const NO_EDGE_SPACES = /^(?!\s).*(?<!\s)$/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const PASSWORD_PATTERN = /^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,64}$/;

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Matches(NO_EDGE_SPACES, { message: 'Name cannot start or end with a space' })
  @ApiProperty({ name: 'name', required: true, minLength: 2, example: 'Alex Nexus' })
  name!: string;

  @IsEmail({}, { message: 'Enter a valid email address' })
  @Matches(EMAIL_PATTERN, { message: 'Enter a valid email address' })
  @Matches(NO_EDGE_SPACES, { message: 'Email cannot start or end with a space' })
  @ApiProperty({ name: 'email', required: true, example: 'user@example.com' })
  email!: string;

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

  @IsEnum(AccountTypes)
  @ApiProperty({ name: 'accountType', required: true, enum: AccountTypes, example: AccountTypes.CUSTOMER })
  accountType!: AccountTypes;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '+1 (555) 839-2041' })
  phone?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'CARGO_VAN' })
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'CA-889-NX' })
  vehiclePlateNumber?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'United States' })
  country?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'California' })
  regionState?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: 'San Francisco' })
  city?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: '94102, 94103, 94107' })
  servicePostalCodes?: string;
}
