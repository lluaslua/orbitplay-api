/**
 * Lê o .env uma vez; o resto da API pede os valores pelo ConfigService
 * (`app.port`, `jwt.secret`...). O `DATABASE_URL` é lido direto pelo Prisma.
 *
 * Em produção (`NODE_ENV=production`) a API se recusa a subir com configuração
 * insegura: segredo fraco, CORS aberto, gateway de pagamento de teste.
 */
const SEGREDOS_FRACOS = ['troque-este-segredo', 'changeme', 'secret', 'jwt_secret', 'sandbox'];

function inteiro(nome: string, padrao: number): number {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') return padrao;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) throw new Error(`${nome} precisa ser um número válido.`);
  return numero;
}

export default () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não definido — copie .env.example para .env.');
  }

  const production = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT ?? 3333);
  const prefix = process.env.API_PREFIX ?? 'api';
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean);
  const provider = process.env.PAYMENT_PROVIDER ?? 'sandbox';

  if (production) {
    const problemas: string[] = [];
    if (secret.length < 32 || SEGREDOS_FRACOS.some((fraco) => secret.toLowerCase().includes(fraco))) {
      problemas.push('JWT_SECRET precisa ter 32+ caracteres aleatórios (ex.: `openssl rand -base64 48`).');
    }
    if (corsOrigins.includes('*')) problemas.push('CORS_ORIGINS não pode ser "*".');
    if (provider === 'sandbox' && process.env.ALLOW_SANDBOX_PAYMENTS !== 'true') {
      problemas.push('PAYMENT_PROVIDER=sandbox aprova pagamentos sem cobrar: use um gateway real.');
    }
    if (!process.env.PUBLIC_API_URL?.startsWith('https://')) problemas.push('PUBLIC_API_URL precisa ser https:// em produção.');
    if (!process.env.APP_URL?.startsWith('https://') && process.env.ALLOW_INSECURE_APP_URL !== 'true') {
      problemas.push('APP_URL precisa ser https:// em produção (o link de redefinição de senha usa).');
    }
    if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) {
      problemas.push('SMTP_HOST e MAIL_FROM são obrigatórios em produção: sem e-mail ninguém confirma o cadastro nem recupera a senha.');
    }
    if (problemas.length) throw new Error(`Configuração insegura para produção:\n - ${problemas.join('\n - ')}`);
  } else if (secret.length < 32) {
    // eslint-disable-next-line no-console
    console.warn('[segurança] JWT_SECRET com menos de 32 caracteres: aceitável só em desenvolvimento.');
  }

  return {
    app: {
      port,
      prefix,
      production,
      corsOrigins,
      /** Quantos proxies confiáveis estão na frente da API (para o IP real no rate limit). 0 = nenhum. */
      trustProxy: inteiro('TRUST_PROXY_HOPS', 0),
      /** Onde o app roda — base do link de redefinição de senha. */
      url: process.env.APP_URL ?? 'http://localhost:5173',
      /** Endereço público da API — base das URLs de imagens enviadas. */
      publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${port}/${prefix}`,
    },
    jwt: {
      secret,
      expiresInSeconds: inteiro('JWT_EXPIRES_IN_SECONDS', 43_200),
      rememberExpiresInSeconds: inteiro('JWT_REMEMBER_EXPIRES_IN_SECONDS', 2_592_000),
    },
    security: {
      bcryptCost: Math.min(15, Math.max(10, inteiro('BCRYPT_COST', 12))),
      loginMaxFailures: inteiro('LOGIN_MAX_FAILURES', 5),
      loginLockMinutes: inteiro('LOGIN_LOCK_MINUTES', 15),
    },
    rateLimit: {
      disabled: process.env.RATE_LIMIT_DISABLED === 'true',
      globalPerMinute: inteiro('RATE_LIMIT_GLOBAL_PER_MINUTE', 600),
    },
    storage: {
      dir: process.env.STORAGE_DIR ?? 'storage',
      buildMaxSizeMb: inteiro('BUILD_MAX_SIZE_MB', 4096),
    },
    wallet: {
      /** Segundos até o Pix simulado "pagar" um saque. 0 desliga: o saque fica em análise até a Central processar. */
      simulatedPayoutSeconds: inteiro('SIMULATED_PAYOUT_SECONDS', 15),
    },
    payments: {
      provider,
      /** Segredo HMAC do webhook do provedor (obrigatório para o webhook ser aceito). */
      webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? '',
      webhookToleranceSeconds: inteiro('PAYMENT_WEBHOOK_TOLERANCE_SECONDS', 300),
    },
    /** Envio de e-mail por SMTP. Sem `SMTP_HOST`, em desenvolvimento o e-mail sai só no log. */
    mail: {
      host: process.env.SMTP_HOST ?? '',
      port: inteiro('SMTP_PORT', 587),
      /** true na porta 465 (TLS direto); na 587 o TLS vem pelo STARTTLS. */
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
      from: process.env.MAIL_FROM ?? '',
    },
  };
};
