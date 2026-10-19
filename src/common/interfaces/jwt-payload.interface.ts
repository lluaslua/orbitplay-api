import type { Request } from 'express';
import type { StudioPermission, UserRole } from '../../contracts';

/** O que vai assinado no token. `sub` é o id da conta. */
export interface JwtPayload {
  sub: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

/**
 * Quem fez a requisição, lido do banco a cada chamada: papel, status e
 * organização valem na hora em que mudam, sem esperar o token vencer.
 */
export interface RequestUser {
  id: string;
  role: UserRole;
  studioId: string | null;
  studioPermission: StudioPermission | null;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
}
