import { Injectable, Logger } from '@nestjs/common';

/**
 * Envio de e-mail. Ainda não há transporte real (SMTP/SES): em desenvolvimento
 * o e-mail inteiro — inclusive o link de redefinição — sai no log para teste.
 *
 * Em produção o corpo NUNCA é logado (o link de redefinição é uma credencial) e
 * nenhum e-mail é enviado: configure o transporte aqui antes de ir ao ar, senão
 * recuperação de senha e convites não chegam a ninguém.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(`Transporte de e-mail não configurado: "${subject}" não foi enviado.`);
      return;
    }
    this.logger.log(`E-mail para ${to} — ${subject}\n${body}`);
  }
}
