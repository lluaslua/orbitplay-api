import { Injectable, Logger } from '@nestjs/common';

/**
 * Envio de e-mail. Por enquanto só registra no log — em desenvolvimento, o link
 * de redefinição de senha aparece no terminal da API. Antes de ir para produção,
 * troque por SMTP/SES aqui: o log expõe o link para quem lê o terminal.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`E-mail para ${to} — ${subject}\n${body}`);
  }
}
