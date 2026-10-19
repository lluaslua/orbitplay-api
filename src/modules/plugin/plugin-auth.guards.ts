import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../../common/constants/error-codes';
import { PrismaService } from '../../prisma/prisma.service';

/** Finalidade gravada no token de telemetria — outro JWT da API não passa por aqui. */
export const TELEMETRY_PURPOSE = 'telemetry';

export interface PluginRequest extends Request {
  pluginKey: { id: string; gameId: string };
}

export interface TelemetryRequest extends Request {
  telemetry: { participationId: string; playerId: string };
}

export function hashPluginCode(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

/**
 * Autentica o plug-in pelo código de acesso, no cabeçalho `X-Orbit-Plugin-Key`.
 * As rotas são @Public — o plug-in não tem conta de usuário.
 */
@Injectable()
export class PluginKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PluginRequest>();
    const code = request.header('x-orbit-plugin-key');
    if (!code) throw invalido();

    const chave = await this.prisma.pluginKey.findUnique({
      where: { codeHash: hashPluginCode(code) },
      select: { id: true, gameId: true, revokedAt: true },
    });
    if (!chave || chave.revokedAt) throw invalido();

    await this.prisma.pluginKey.update({ where: { id: chave.id }, data: { lastUsedAt: new Date() } });
    request.pluginKey = { id: chave.id, gameId: chave.gameId };
    return true;
  }
}

/**
 * Autentica a telemetria que o jogo manda durante o teste: o token que o app
 * gerou em `POST /player/participations/:id/telemetry-token` e passou à build.
 */
@Injectable()
export class TelemetryTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TelemetryRequest>();
    const [tipo, token] = request.headers.authorization?.split(' ') ?? [];
    if (tipo?.toLowerCase() !== 'bearer' || !token) throw tokenInvalido();

    let payload: { sub: string; pid: string; purpose: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw tokenInvalido();
    }
    if (payload.purpose !== TELEMETRY_PURPOSE) throw tokenInvalido();

    const participacao = await this.prisma.participation.findUnique({
      where: { id: payload.sub },
      select: { playerId: true, status: true },
    });
    if (!participacao || participacao.playerId !== payload.pid || participacao.status !== 'IN_PROGRESS') {
      throw tokenInvalido();
    }

    request.telemetry = { participationId: payload.sub, playerId: payload.pid };
    return true;
  }
}

function invalido() {
  return new UnauthorizedException({ message: 'Código de acesso inválido ou revogado.', code: ErrorCode.INVALID_PLUGIN_KEY });
}

function tokenInvalido() {
  return new UnauthorizedException({
    message: 'Token de telemetria inválido, expirado ou de um teste encerrado.',
    code: ErrorCode.INVALID_TELEMETRY_TOKEN,
  });
}
