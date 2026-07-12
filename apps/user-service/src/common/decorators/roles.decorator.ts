import { SetMetadata } from '@nestjs/common';
import { Role } from '@oneandro/common';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles. Requires RolesGuard to be active (it is, globally). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
