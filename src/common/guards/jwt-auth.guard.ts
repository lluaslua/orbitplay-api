import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest, JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Lê o `Authorization: Bearer <token>` que o interceptor do axios anexa e
 * confere a conta no banco: desativada, ou com sessões invalidadas depois da
 * emissão do token (troca de senha, de papel), não passa.
 *
 * Qualquer 401 fora da tela de login faz o app apagar o token guardado
 * (orbitplay-app/src/lib/api.ts) — é assim que ele percebe a sessão vencida.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [tipo, token] = request.headers.authorization?.split(' ') ?? [];
    if (tipo?.toLowerCase() !== 'bearer' || !token) throw sessaoExpirada();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw sessaoExpirada();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, studioId: true, studioPermission: true, sessionsValidAfter: true },
    });
    if (!user || user.status !== 'ACTIVE') throw sessaoExpirada();

    // `iat` é em segundos; comparar no mesmo passo evita recusar o token
    // emitido no mesmo segundo da troca de senha.
    const invalidadasEm = user.sessionsValidAfter
      ? Math.floor(user.sessionsValidAfter.getTime() / 1000)
      : 0;
    if ((payload.iat ?? 0) < invalidadasEm) throw sessaoExpirada();

    request.user = {
      id: user.id,
      role: user.role,
      studioId: user.studioId,
      studioPermission: user.studioPermission,
    };
    return true;
  }
}

function sessaoExpirada() {
  return new UnauthorizedException({ message: 'Sua sessão expirou. Entre de novo.' });
}
