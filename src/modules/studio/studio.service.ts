import { Injectable } from '@nestjs/common';
import { studioIdOf } from '../../common/access/studio-scope';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { daysAgo } from '../../common/utils/dates';
import { average, ratio, round, sum } from '../../common/utils/numbers';
import type { PluginDetection, StudioDashboard } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/**
 * Home do estúdio (Figma `291:1257`). Os números são consolidados aqui, só com
 * dados da organização — a UI não recalcula nada (Tela 02, RN-01 e RN-02).
 */
@Injectable()
export class StudioService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(user: RequestUser): Promise<StudioDashboard> {
    const studioId = studioIdOf(user);
    const doEstudio = { playtest: { game: { studioId } } };

    const [testes, participacoes, sessoes, insights, gatilhos, mercado] = await Promise.all([
      this.prisma.playtest.findMany({
        where: { game: { studioId } },
        select: { gameId: true, status: true, plugin: true, build: { select: { pluginTriggers: true, pluginHeatmaps: true } } },
      }),
      this.prisma.participation.findMany({ where: doEstudio, select: { status: true } }),
      this.prisma.session.findMany({
        where: { participation: doEstudio },
        select: {
          durationSeconds: true,
          overallRating: true,
          bugsFound: true,
          submittedAt: true,
          analysis: true,
          participation: { select: { playtest: { select: { plugin: true } } } },
        },
      }),
      this.prisma.insight.findMany({ where: { playtest: { game: { studioId } } }, select: { scope: true } }),
      this.prisma.sessionEvent.count({ where: { type: 'TRIGGER', participation: doEstudio } }),
      // "Benchmark de mercado": os testes abertos de outros estúdios que mais andaram.
      this.prisma.playtest.findMany({
        where: { status: { in: ['ACTIVE', 'FULL'] }, game: { studioId: { not: studioId } } },
        select: { id: true, slots: true, currentParticipants: true, rewardPerSessionCents: true, game: { select: { name: true } } },
      }),
    ]);

    const abertos = testes.filter((t) => t.status === 'ACTIVE' || t.status === 'FULL');
    const notas = sessoes.flatMap((s) => (s.overallRating === null ? [] : [s.overallRating]));
    const engajamentos = sessoes.flatMap((s) => {
      const valor = (s.analysis as { classification?: { engagement?: number } } | null)?.classification?.engagement;
      return typeof valor === 'number' ? [valor] : [];
    });
    const pontosAtivos = sum(
      abertos
        .filter((t) => t.plugin && t.build)
        .map((t) =>
          [t.build!.pluginTriggers, t.build!.pluginHeatmaps]
            .flatMap((lista) => lista as unknown as PluginDetection[])
            .filter((item) => item.enabled).length,
        ),
    );
    const ultimoDia = daysAgo(1);
    const hoje = new Date();

    return {
      highlights: {
        gamesTested: new Set(testes.filter((t) => t.status !== 'DRAFT').map((t) => t.gameId)).size,
        testsRun: sessoes.length,
        gameplayHours: Math.round(sum(sessoes.map((s) => s.durationSeconds)) / 3600),
        averageRating: round(average(notas) * 2),
        engagement: round(average(engajamentos), 2),
        aiInsights: insights.length,
        testsWithPlugin: sessoes.filter((s) => s.participation.playtest.plugin).length,
      },
      overview: {
        activeTests: abertos.length,
        playersPlaying: participacoes.filter((p) => p.status === 'IN_PROGRESS').length,
        testsPerHour: round(sessoes.filter((s) => s.submittedAt >= ultimoDia).length / 24),
      },
      keyFactors: {
        funFactor: round(average(notas)),
        bugs: sum(sessoes.map((s) => s.bugsFound)),
        retention: round(ratio(sessoes.length, participacoes.length), 2),
      },
      plugin: {
        activePoints: pontosAtivos,
        triggers: gatilhos,
        aiInsights: insights.filter((i) => i.scope !== 'REPORT').length,
      },
      benchmark: mercado
        .map((t) => ({ id: t.id, name: t.game.name, progress: round(ratio(t.currentParticipants, t.slots), 2), rewardCents: t.rewardPerSessionCents }))
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 5),
      totalTests: testes.length,
      ratingsOverTime: Array.from({ length: 6 }, (_, i) => {
        const mes = new Date(hoje.getFullYear(), hoje.getMonth() - (5 - i), 1);
        const doMes = sessoes.filter(
          (s) => s.overallRating !== null && s.submittedAt.getFullYear() === mes.getFullYear() && s.submittedAt.getMonth() === mes.getMonth(),
        );
        return { label: MESES[mes.getMonth()], rating: round(average(doMes.map((s) => s.overallRating!))) };
      }),
    };
  }
}
