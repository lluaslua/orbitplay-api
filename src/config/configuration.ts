/**
 * Lê o .env uma vez; o resto da API pede os valores pelo ConfigService
 * (`app.port`, `jwt.secret`...). O `DATABASE_URL` é lido direto pelo Prisma.
 */
export default () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não definido — copie .env.example para .env.');
  }

  const port = Number(process.env.PORT ?? 3333);
  const prefix = process.env.API_PREFIX ?? 'api';

  return {
    app: {
      port,
      prefix,
      corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
        .split(',')
        .map((origem) => origem.trim())
        .filter(Boolean),
      /** Onde o app roda — base do link de redefinição de senha. */
      url: process.env.APP_URL ?? 'http://localhost:5173',
      /** Endereço público da API — base das URLs de imagens enviadas. */
      publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${port}/${prefix}`,
    },
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresInSeconds: Number(process.env.JWT_EXPIRES_IN_SECONDS ?? 43_200),
      rememberExpiresInSeconds: Number(process.env.JWT_REMEMBER_EXPIRES_IN_SECONDS ?? 2_592_000),
    },
    storage: {
      dir: process.env.STORAGE_DIR ?? 'storage',
      buildMaxSizeMb: Number(process.env.BUILD_MAX_SIZE_MB ?? 4096),
    },
    payments: {
      provider: process.env.PAYMENT_PROVIDER ?? 'sandbox',
    },
  };
};
