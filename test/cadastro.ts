import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MailService } from '../src/common/mail/mail.service';

type Espiao = jest.SpyInstance<Promise<void>, Parameters<MailService['send']>>;

/** Fica de olho nos e-mails que a API manda. Devolva com `mockRestore()` no fim. */
export function espiarEmails(app: INestApplication): Espiao {
  return jest.spyOn(app.get(MailService), 'send');
}

/** O código de 6 dígitos do último e-mail que foi para `email`. */
export function ultimoCodigo(espiao: Espiao, email: string): string {
  const chamada = [...espiao.mock.calls].reverse().find(([para]) => para === email);
  const codigo = chamada && /\b(\d{6})\b/.exec(chamada[2])?.[1];
  if (!codigo) throw new Error(`Nenhum código enviado para ${email}.`);
  return codigo;
}

/** Cadastro inteiro: cria a conta, lê o código do e-mail e confirma. Devolve a sessão (o corpo do supertest). */
export async function cadastrar(app: INestApplication, dados: Record<string, unknown> & { email: string }) {
  const api = () => request(app.getHttpServer());
  const espiao = espiarEmails(app);
  try {
    await api().post('/api/auth/register').send({ acceptTerms: true, ...dados }).expect(201);
    const code = ultimoCodigo(espiao, dados.email);
    return (await api().post('/api/auth/verify-email').send({ email: dados.email, code }).expect(200)).body;
  } finally {
    espiao.mockRestore();
  }
}
