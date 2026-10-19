import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Cliente = PrismaService | Prisma.TransactionClient;

/**
 * Leitura da tabela `Setting` com valor padrão: chave ausente ou de tipo
 * diferente do padrão cai no padrão, e a API continua funcionando.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T, client: Cliente = this.prisma): Promise<T> {
    const setting = await client.setting.findUnique({ where: { key } });
    const valor = setting?.value as unknown;
    if (valor === null || valor === undefined) return fallback;
    if (Array.isArray(fallback) !== Array.isArray(valor) || typeof valor !== typeof fallback) return fallback;
    return valor as T;
  }
}

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
