import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { createValidationPipe } from './common/pipes/validation.pipe';
import { StorageService } from './common/storage/storage.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const prefix = config.getOrThrow<string>('app.prefix');

  // O app fala com `${VITE_API_URL}` = http://localhost:3333/api.
  app.setGlobalPrefix(prefix);

  app.enableCors({
    origin: config.getOrThrow<string[]>('app.corsOrigins'),
    // O total das listas paginadas e o nome dos downloads (CSV, .OBJ) vão nos cabeçalhos.
    exposedHeaders: ['X-Total-Count', 'Content-Disposition'],
  });

  // As perguntas do Novo teste, as imagens do Novo jogo e as respostas de
  // "Envio de arquivo" chegam como data URL, e o limite padrão do Express
  // (100 kB) recusaria o formulário inteiro. Cada imagem continua limitada a
  // 5 MB por `StorageService.storeDataUrl`.
  app.useBodyParser('json', { limit: '20mb' });

  // Capas e banners enviados são públicos; builds e gravações, não.
  app.useStaticAssets(app.get(StorageService).publicDir, {
    prefix: `/${prefix}/files/`,
    index: false,
    dotfiles: 'deny',
  });

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  await app.listen(config.getOrThrow<number>('app.port'));
}

void bootstrap();
