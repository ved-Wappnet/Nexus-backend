import { UserRoles } from '@core/constants';
import { UserRole } from '@core/interfaces';
import { ApiProperty } from '@nestjs/swagger';

export class UserPublicViewModel {
  @ApiProperty({ example: 'c2f1a0e4-1b2c-4d5e-8f90-123456789abc' })
  id!: string;

  @ApiProperty({ example: 'Alex Nexus' })
  name!: string;

  @ApiProperty({ example: 'user@example.com' })
  email!: string;

  @ApiProperty({ enum: UserRoles, example: UserRoles.CUSTOMER })
  role!: UserRole;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: '2026-01-15T10:00:00.000Z' })
  createdAt!: Date;
}

export class LoginViewModel {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token!: string;

  @ApiProperty({ type: UserPublicViewModel })
  user!: UserPublicViewModel;
}
