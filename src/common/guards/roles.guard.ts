import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../contracts';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

/** Sem @Roles() a rota vale para todos os perfis; rota @Public() não tem perfil para conferir. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const alvos = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, alvos)) return true;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, alvos);
    if (!roles?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user && roles.includes(user.role)) return true;

    throw new ForbiddenException({ message: 'Seu perfil não tem acesso a esta área.' });
  }
}
