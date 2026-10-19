import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ARCHETYPE_TONES } from '../../common/constants/domain.constants';
import { clock } from '../../common/utils/dates';
import { clamp, ratio, round, sum } from '../../common/utils/numbers';
import type { ArchetypeId, SessionDetail } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../player/achievements.service';
import { insightsFromSession } from './session-insights';

type Analysis = Pick<SessionDetail, 'classification' | 'evaluation' | 'telemetry'> & { provider: string };

/**
 * Análise da sessão. Hoje é local e sem custo: classifica pelo perfil do tester,
 * avalia pelo formulário e resume os gatilhos do plug-in.
 *
 * A troca por IA — Whisper para a transcrição, um LLM para classificação e
 * insights — entra aqui, de preferência atrás de uma fila, sem mexer em quem
 * chama. Enquanto a análise não roda, o relatório mostra "processando".
 */
@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly notifications: NotificationsService,
  ) {}

  async analyzeSession(sessionId: string): Promise<void> {
    try {
      const sessao = await this.prisma.session.findUniqueOrThrow({
        where: { id: sessionId },
        include: {
          participation: {
            include: {
              player: { include: { player: true } },
              playtest: {
                select: { id: true, gameId: true, status: true, estimatedMinutes: true, questions: { select: { id: true } } },
              },
              events: { where: { type: { in: ['TRIGGER', 'BUG', 'DEATH', 'RAGE_QUIT'] } }, orderBy: { atSecond: 'asc' } },
            },
          },
        },
      });

      const participacao = sessao.participation;
      const perfil = participacao.player.player;
      const arquetipo = (perfil?.archetype ?? 'EXPLORER') as ArchetypeId;
      const [arquetipoConfig, tipoConfig] = await Promise.all([
        this.prisma.archetypeConfig.findUnique({ where: { id: arquetipo } }),
        this.prisma.playerTypeConfig.findUnique({ where: { id: perfil?.playerType ?? 'CASUAL' } }),
      ]);

      const respostas = sessao.answers as Record<string, unknown>;
      const textos = Object.values(respostas).filter((v): v is string => typeof v === 'string');
      const completude = round(ratio(Object.keys(respostas).length, participacao.playtest.questions.length) * 10);
      const detalhamento = round(clamp(sum(textos.map((t) => t.trim().length)) / 220, 0, 1) * 10);
      const bugs = round(clamp(sessao.bugsFound * 2, 0, 10));
      const gatilhos = participacao.events.filter((e) => e.type === 'TRIGGER');

      // Insights da sessão: gravados uma vez — refazer a análise não duplica.
      const jaTem = await this.prisma.insight.count({ where: { sessionId } });
      const rascunhos = jaTem
        ? []
        : insightsFromSession({
            durationSeconds: sessao.durationSeconds,
            estimatedMinutes: participacao.playtest.estimatedMinutes,
            overallRating: sessao.overallRating,
            events: participacao.events,
            transcript: (participacao.transcript as { at: string; text: string }[]) ?? [],
          });

      const analise: Analysis = {
        provider: 'heuristic',
        classification: {
          archetype: arquetipoConfig?.name ?? arquetipo,
          archetypeTone: ARCHETYPE_TONES[arquetipo] ?? 'emerald',
          playerType: tipoConfig?.name ?? perfil?.playerType ?? 'Casual',
          score: sessao.feedbackQuality,
          funFactor: sessao.overallRating !== null ? round(sessao.overallRating * 2) : sessao.feedbackQuality,
          engagement: round(clamp(ratio(sessao.durationSeconds, participacao.playtest.estimatedMinutes * 60), 0, 1), 2),
          insights: jaTem + rascunhos.length,
        },
        evaluation: {
          score: sessao.feedbackQuality,
          criteria: [
            { name: 'Completude das respostas', score: completude, note: completude >= 10 ? 'Respondeu tudo' : 'Deixou perguntas em branco' },
            { name: 'Detalhamento', score: detalhamento, note: detalhamento >= 7 ? 'Comentários específicos' : 'Comentários curtos' },
            { name: 'Bugs reportados', score: bugs, note: sessao.bugsFound ? `${sessao.bugsFound} bug(s) reportado(s)` : 'Nenhum bug reportado' },
          ],
        },
        telemetry: {
          triggers: new Set(gatilhos.map((g) => g.label)).size,
          suggestions: 0,
          total: gatilhos.length,
          events: gatilhos.slice(0, 50).map((g) => ({
            id: g.id,
            trigger: g.label,
            at: clock(g.atSecond),
            duration: String((g.payload as { duration?: unknown } | null)?.duration ?? '-'),
            reaction: g.detail ?? '-',
            insight: '-',
          })),
        },
      };

      await this.prisma.$transaction(async (tx) => {
        await tx.session.update({
          where: { id: sessionId },
          data: { analysis: analise as unknown as Prisma.InputJsonValue },
        });
        if (!rascunhos.length) return;

        await tx.insight.createMany({
          data: rascunhos.map((r) => ({ playtestId: participacao.playtest.id, sessionId, kind: 'INSIGHT', scope: 'REPORT', ...r })),
        });
        // "Fonte Primária: seus dados foram usados em um insight de IA do estúdio."
        const liberadas = await this.achievements.unlockGameRules(tx, participacao.playerId, participacao.playtest.gameId, ['AI_INSIGHT_SOURCE']);
        if (liberadas.length) {
          await this.notifications.notify(
            participacao.playerId,
            {
              type: 'ACHIEVEMENT_UNLOCKED',
              title: 'Nova conquista!',
              body: liberadas.map((c) => c.title).join(', '),
              link: `/player/games/${participacao.playtest.gameId}`,
              data: { gameId: participacao.playtest.gameId },
            },
            tx,
          );
        }
      });

      // Teste encerrado esperando análise: com a última pronta, o relatório fecha.
      if (participacao.playtest.status === 'PROCESSING') {
        const pendentes = await this.prisma.session.count({
          where: { participation: { playtestId: participacao.playtest.id }, analysis: { equals: Prisma.DbNull } },
        });
        if (!pendentes) {
          const { count } = await this.prisma.playtest.updateMany({
            where: { id: participacao.playtest.id, status: 'PROCESSING' },
            data: { status: 'FINISHED' },
          });
          if (count) await this.notifications.reportReady(participacao.playtest.id);
        }
      }
    } catch (erro) {
      this.logger.error(`Falha ao analisar a sessão ${sessionId}`, erro as Error);
    }
  }
}
