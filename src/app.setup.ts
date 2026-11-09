import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { securityHeaders } from './common/security/security-headers.middleware';
import { StorageService } from './common/storage/storage.service';

/**
 * Rotas que recebem imagem em data URL (capas do jogo, perguntas do teste,
 * resposta de "Envio de arquivo"). Só nelas o corpo JSON passa de 1 MB.
 * Cada imagem continua limitada a 5 MB por `StorageService.storeDataUrl`.
 */
const ROTAS_COM_IMAGEM = /\/(games(\/[^/]+)?|tests(\/[^/]+)?|player\/tests\/[^/]+\/submit)\/?$/;
const LIMITE_PADRAO = '1mb';
const LIMITE_COM_IMAGEM = '20mb';

/**
 * Configuração de segurança e de borda da API, usada pelo `main.ts` e pelos
 * testes e2e — o que se testa é o que sobe em produção.
 * A aplicação precisa ser criada com `{ bodyParser: false }`: os parsers vêm daqui.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  const prefix = config.getOrThrow<string>('app.prefix');
  const production = config.getOrThrow<boolean>('app.production');

  app.disable('x-powered-by');
  // Atrás de proxy/balanceador, o IP do cliente (rate limit, logs) vem do X-Forwarded-For.
  const proxies = config.getOrThrow<number>('app.trustProxy');
  if (proxies > 0) app.set('trust proxy', proxies);

  app.setGlobalPrefix(prefix);
  app.use(securityHeaders(production));

  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Client-Platform'],
    // O total das listas paginadas e o nome dos downloads (CSV, .OBJ) vão nos cabeçalhos.
    exposedHeaders: ['X-Total-Count', 'Content-Disposition'],
    maxAge: 600,
  });

  // Corpo de 1 MB por padrão; o de imagem em data URL tem teto próprio e fica só nas rotas que o usam.
  const grande = json({ limit: LIMITE_COM_IMAGEM });
  // O webhook de pagamento é assinado sobre o corpo exato: guarda os bytes recebidos (só nessa rota).
  const guardaCorpo = (request: Request & { rawBody?: Buffer }, _response: Response, buffer: Buffer) => {
    if (request.path.includes('/payments/webhooks/')) request.rawBody = buffer;
  };
  const padrao = json({ limit: LIMITE_PADRAO, verify: guardaCorpo });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const caminho = request.path.startsWith(`/${prefix}`) ? request.path.slice(prefix.length + 1) : request.path;
    return (ROTAS_COM_IMAGEM.test(caminho) ? grande : padrao)(request, response, next);
  });
  app.use(urlencoded({ extended: false, limit: '100kb' }));

  // Capas, avatares e anexos de resposta são públicos; builds e gravações, não.
  // São só imagens PNG/JPEG/WebP (conferidas no upload), servidas sem sniffing e sem script.
  app.useStaticAssets(app.get(StorageService).publicDir, {
    prefix: `/${prefix}/files/`,
    index: false,
    dotfiles: 'deny',
    redirect: false,
    setHeaders: (response) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      response.setHeader('Cache-Control', 'public, max-age=3600');
    },
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
}
