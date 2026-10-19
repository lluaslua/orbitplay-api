import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { StudioPermission } from '../../contracts';
import { STUDIO_PERMISSION_KEY } from '../decorators/studio-permission.decorator';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';

const NIVEL: Record<StudioPermission, number> = { VIEW: 0, EDIT: 1, MANAGE: 2 };

@Injectable()
export class StudioPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const exigida = this.reflector.getAllAndOverride<StudioPermission | undefined>(
      STUDIO_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!exigida) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permitido =
      user?.role === 'STUDIO' &&
      !!user.studioId &&
      !!user.studioPermission &&
      NIVEL[user.studioPermission] >= NIVEL[exigida];

    if (permitido) return true;
    throw new ForbiddenException({
      message: 'Sua conta não tem permissão para esta ação no estúdio.',
      code: 'STUDIO_PERMISSION',
    });
  }
}
