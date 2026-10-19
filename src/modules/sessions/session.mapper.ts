import type { Prisma } from '@prisma/client';
import { TIMELINE_EVENT_TYPES } from '../../common/constants/domain.constants';
import type { AiInsight, Session, TimelineEvent } from '../../contracts';

export const sessionInclude = {
  insights: { orderBy: { createdAt: 'asc' } },
  participation: {
    include: {
      player: { select: { name: true, player: { select: { level: true } } } },
      playtest: {
        select: {
          id: true,
          title: true,
          gameId: true,
          game: { select: { name: true } },
          questions: { orderBy: { position: 'asc' } },
        },
      },
      events: { where: { type: { in: [...TIMELINE_EVENT_TYPES] } }, orderBy: { atSecond: 'asc' } },
    },
  },
} satisfies Prisma.SessionInclude;

export type SessionRow = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

const CATEGORIAS: AiInsight['category'][] = ['UX', 'BALANCE', 'PERFORMANCE', 'BUG', 'ENGAGEMENT'];
const SEVERIDADES: AiInsight['severity'][] = ['LOW', 'MEDIUM', 'HIGH'];

/** A sessão na visão do estúdio (contrato `Session`). */
export function toSession(row: SessionRow, videoUrl: string | null): Session {
  const participacao = row.participation;
  const respostas = row.answers as Record<string, unknown>;
  const transcricao = participacao.transcript as { text: string }[];

  return {
    id: row.id,
    testId: participacao.playtest.id,
    testTitle: participacao.playtest.title,
    gameId: participacao.playtest.gameId,
    gameName: participacao.playtest.game.name,
    playerId: participacao.playerId,
    playerName: participacao.player.name,
    playerLevel: participacao.player.player?.level ?? 1,
    durationSeconds: row.durationSeconds,
    feedbackQuality: row.feedbackQuality,
    bugsFound: row.bugsFound,
    overallRating: row.overallRating ?? 0,
    xpEarned: participacao.xpEarned,
    rewardCents: participacao.rewardCents,
    rewardStatus: participacao.rewardStatus,
    recordedAt: row.submittedAt.toISOString(),
    videoUrl,
    transcript: transcricao.map((fala) => fala.text).join(' '),
    timeline: participacao.events.map(
      (evento): TimelineEvent => ({
        id: evento.id,
        atSecond: evento.atSecond,
        type: evento.type as TimelineEvent['type'],
        label: evento.label,
        detail: evento.detail ?? undefined,
      }),
    ),
    insights: row.insights.map((insight) => ({
      id: insight.id,
      title: insight.title,
      description: insight.text,
      severity: SEVERIDADES.includes(insight.severity as AiInsight['severity']) ? (insight.severity as AiInsight['severity']) : 'MEDIUM',
      category: CATEGORIAS.includes(insight.category as AiInsight['category']) ? (insight.category as AiInsight['category']) : 'UX',
      confidence: insight.confidence ?? 0.5,
    })),
    // O estúdio lê as respostas na ordem do formulário.
    answers: participacao.playtest.questions
      .filter((pergunta) => pergunta.id in respostas)
      .map((pergunta) => ({ question: pergunta.label, answer: formatAnswer(respostas[pergunta.id], pergunta.scaleMax) })),
  };
}

function formatAnswer(valor: unknown, escalaMax: number | null): string {
  if (Array.isArray(valor)) return valor.join(', ');
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'number' && escalaMax) return `${valor} de ${escalaMax}`;
  return String(valor);
}
