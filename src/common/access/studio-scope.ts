import { ForbiddenException } from '@nestjs/common';
import type { RequestUser } from '../interfaces/jwt-payload.interface';

/**
 * A organização de quem pediu. Tudo de estúdio é filtrado por ela (Handoff,
 * Telas 02 e 03, RN-01) — nunca pelo id da conta.
 */
export function studioIdOf(user: RequestUser): string {
  if (user.role !== 'STUDIO' || !user.studioId) {
    throw new ForbiddenException({ message: 'Esta conta não pertence a um estúdio.' });
  }
  return user.studioId;
}
