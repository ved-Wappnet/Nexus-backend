import { ROLES_KEY } from '@core/constants';
import { UserRole } from '@core/interfaces';
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
