import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Eventos de segurança em uma linha JSON, para o SIEM/monitoramento ler.
 * Nunca recebe senha, token nem corpo de requisição: e-mail entra só como
 * hash curto (correlaciona tentativas sem gravar o endereço).
 */
@Injectable()
export class SecurityLogService {
  private readonly logger = new Logger('Security');

  event(type: string, details: Record<string, unknown> = {}): void {
    this.logger.warn(JSON.stringify({ type, ...details, at: new Date().toISOString() }));
  }

  static emailRef(email: string): string {
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
  }
}
