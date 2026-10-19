import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../contracts';

export const ROLES_KEY = 'roles';

/** Restringe a rota — ou o controller inteiro — a um perfil. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
