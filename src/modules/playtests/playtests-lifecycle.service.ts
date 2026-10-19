import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalysisService } from '../analysis/analysis.service';
import { NotificationsService } from '../notifications/notifications.service';

const INTERVALO_MS = 60_000;

/** Análise que não terminou neste tempo é tentada de novo — a API pode ter reiniciado no meio. */
const ANALISE_PARADA_MS = 5 * 60_000;

/** Quantas análises paradas refazer por volta, para não travar o processo. */
const REANALISES_POR_VOLTA = 20;

/**
 * Encerra os testes cujo prazo passou — saem do catálogo e o relatório fecha:
 * PROCESSING enquanto houver sessão sem análise, FINISHED depois — e refaz as
 * análises que falharam, para nenhum teste ficar "Gerando insights IA" para sempre.
 */
@Injectable()
export class PlaytestsLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaytestsLifecycleService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysis: AnalysisService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), INTERVALO_MS);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    await this.closeExpired();
    await this.retryAnalyses();
  }

  async closeExpired(): Promise<void> {
    try {
      const vencidos = await this.prisma.playtest.findMany({
        where: { status: { in: ['ACTIVE', 'FULL', 'PAUSED'] }, expiresAt: { lt: new Date() } },
        select: { id: true },
      });

      for (const { id } of vencidos) {
        const pendentes = await this.prisma.session.count({
          where: { participation: { playtestId: id }, analysis: { equals: Prisma.DbNull } },
        });
        await this.prisma.playtest.update({
          where: { id },
          data: { status: pendentes ? 'PROCESSING' : 'FINISHED', endedAt: new Date() },
        });
        if (!pendentes) await this.notifications.reportReady(id);
      }
    } catch (erro) {
      this.logger.error('Falha ao encerrar testes vencidos', erro as Error);
    }
  }

  /** A análise roda sem esperar a resposta; se caiu, é aqui que ela volta. */
  async retryAnalyses(): Promise<void> {
    try {
      const paradas = await this.prisma.session.findMany({
        where: { analysis: { equals: Prisma.DbNull }, submittedAt: { lt: new Date(Date.now() - ANALISE_PARADA_MS) } },
        select: { id: true },
        orderBy: { submittedAt: 'asc' },
        take: REANALISES_POR_VOLTA,
      });
      for (const { id } of paradas) await this.analysis.analyzeSession(id);
    } catch (erro) {
      this.logger.error('Falha ao refazer análises', erro as Error);
    }
  }
}
