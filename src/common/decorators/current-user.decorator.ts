import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, RequestUser } from '../interfaces/jwt-payload.interface';

/** Quem fez a requisição, como o JwtAuthGuard carregou do banco. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
