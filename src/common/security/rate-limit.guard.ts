import {
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { ErrorCode } from '../constants/error-codes';
import type { AuthenticatedRequest } from '../interfaces/jwt-payload.interface';
import { SecurityLogService } from './security-log.service';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Requisições permitidas na janela. */
  limit: number;
  windowMs: number;
  /** `ip` (padrão), `user` (conta logada) ou `ip+email` (corpo `email`, para login/recuperação). */
  by?: 'ip' | 'user' | 'ip+email';
}

/** Limita a rota. Vale por rota, por chave (IP, conta ou IP+e-mail). */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

interface Janela {
  count: number;
  resetAt: number;
}

/**
 * Contadores em memória do processo. Com mais de uma instância da API, cada
 * uma conta sozinha: em produção escalada, troque por um store compartilhado (Redis).
 */
@Injectable()
export class RateLimitStore {
  private readonly janelas = new Map<string, Janela>();
  private readonly limpeza: NodeJS.Timeout;

  constructor() {
    this.limpeza = setInterval(() => this.varrer(), 60_000);
    this.limpeza.unref();
  }

  /** Conta uma requisição; devolve se passou do limite e os segundos até liberar. */
  hit(key: string, limit: number, windowMs: number): { exceeded: boolean; retryAfter: number } {
    const agora = Date.now();
    let janela = this.janelas.get(key);
    if (!janela || janela.resetAt <= agora) {
      janela = { count: 0, resetAt: agora + windowMs };
      this.janelas.set(key, janela);
    }
    janela.count += 1;
    return { exceeded: janela.count > limit, retryAfter: Math.max(1, Math.ceil((janela.resetAt - agora) / 1000)) };
  }

  /** Limite da janela já estourado, sem contar mais uma. */
  isBlocked(key: string, limit: number): { blocked: boolean; retryAfter: number } {
    const janela = this.janelas.get(key);
    if (!janela || janela.resetAt <= Date.now()) return { blocked: false, retryAfter: 0 };
    return { blocked: janela.count >= limit, retryAfter: Math.ceil((janela.resetAt - Date.now()) / 1000) };
  }

  clear(key: string): void {
    this.janelas.delete(key);
  }

  private varrer(): void {
    const agora = Date.now();
    for (const [chave, janela] of this.janelas) if (janela.resetAt <= agora) this.janelas.delete(chave);
  }
}

export function tooManyRequests(retryAfterSeconds: number) {
  return new HttpException(
    { message: 'Muitas tentativas. Aguarde um pouco e tente de novo.', code: ErrorCode.TOO_MANY_REQUESTS, retryAfter: retryAfterSeconds },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

export function clientIp(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'desconhecido';
}

abstract class BaseRateLimitGuard implements CanActivate {
  constructor(
    protected readonly reflector: Reflector,
    protected readonly store: RateLimitStore,
    protected readonly config: ConfigService,
    protected readonly log: SecurityLogService,
  ) {}

  protected abstract applies(options: RateLimitOptions | undefined): boolean;

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<boolean>('rateLimit.disabled')) return true;
    const alvos = [context.getHandler(), context.getClass()];
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, alvos);
    if (!this.applies(options)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rota = `${context.getClass().name}.${context.getHandler().name}`;
    const { limit, windowMs, key } = this.resolve(options, request, rota);
    const { exceeded, retryAfter } = this.store.hit(key, limit, windowMs);
    if (!exceeded) return true;

    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter));
    this.log.event('rate_limit', { route: rota, ip: clientIp(request) });
    throw tooManyRequests(retryAfter);
  }

  private resolve(options: RateLimitOptions | undefined, request: AuthenticatedRequest, rota: string) {
    if (!options) {
      const global = this.config.getOrThrow<number>('rateLimit.globalPerMinute');
      return { limit: global, windowMs: 60_000, key: `g:${clientIp(request)}` };
    }
    const por = options.by ?? 'ip';
    let quem = clientIp(request);
    if (por === 'user') quem = request.user?.id ?? quem;
    if (por === 'ip+email') {
      const email = String((request.body as { email?: unknown } | undefined)?.email ?? '').trim().toLowerCase();
      quem = `${quem}:${createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
    }
    return { limit: options.limit, windowMs: options.windowMs, key: `r:${rota}:${quem}` };
  }
}

/** Antes da autenticação: limite global por IP e os limites por IP / IP+e-mail. */
@Injectable()
export class IpRateLimitGuard extends BaseRateLimitGuard {
  constructor(reflector: Reflector, store: RateLimitStore, config: ConfigService, log: SecurityLogService) {
    super(reflector, store, config, log);
  }
  protected applies(options: RateLimitOptions | undefined): boolean {
    return !options || options.by !== 'user';
  }
}

/** Depois do JwtAuthGuard: os limites por conta (`by: 'user'`). */
@Injectable()
export class UserRateLimitGuard extends BaseRateLimitGuard {
  constructor(reflector: Reflector, store: RateLimitStore, config: ConfigService, log: SecurityLogService) {
    super(reflector, store, config, log);
  }
  protected applies(options: RateLimitOptions | undefined): boolean {
    return options?.by === 'user';
  }
}
