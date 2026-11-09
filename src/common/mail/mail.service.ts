import { Injectable, Logger, type OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Envio de e-mail: código de verificação do cadastro, código do MFA, link de
 * nova senha e convites.
 *
 * Com `SMTP_HOST` no .env, sai por SMTP de verdade (qualquer provedor: Gmail,
 * Outlook, Resend, SendGrid, SES). Sem ele, em desenvolvimento o e-mail inteiro
 * sai no log para teste; em produção a API nem sobe sem SMTP (`configuration.ts`).
 *
 * O corpo nunca é logado quando o envio é real: o código e o link são credenciais.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly config: MailConfig;
  private readonly transporte: Transporter | null;

  constructor(config: ConfigService) {
    this.config = config.getOrThrow<MailConfig>('mail');
    this.transporte = this.config.host
      ? createTransport({
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure,
          auth: this.config.user ? { user: this.config.user, pass: this.config.pass } : undefined,
          // Conexão lenta não segura a requisição do cadastro por minutos.
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null;
  }

  /** Falhou o envio: 503 com mensagem para a tela. O motivo técnico fica só no log. */
  async send(to: string, subject: string, body: string): Promise<void> {
    if (!this.transporte) {
      this.logger.log(`E-mail para ${to} — ${subject}\n${body}`);
      return;
    }

    try {
      await this.transporte.sendMail({ from: this.config.from || this.config.user, to, subject, text: body });
      this.logger.log(`E-mail enviado para ${to} — ${subject}`);
    } catch (erro) {
      this.logger.error(`Falha ao enviar "${subject}" para ${to}: ${(erro as Error).message}`);
      throw new ServiceUnavailableException({
        message: 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.',
      });
    }
  }

  onModuleDestroy(): void {
    this.transporte?.close();
  }
}
