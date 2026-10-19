import type { Prisma, TestModel } from '@prisma/client';
import type { Participation, PlayerGameTest } from '../../contracts';

export const participationInclude = {
  playtest: { select: { gameId: true, game: { select: { name: true, thumbnailUrl: true } } } },
} satisfies Prisma.ParticipationInclude;

export type ParticipationRow = Prisma.ParticipationGetPayload<{ include: typeof participationInclude }>;

export function toParticipation(row: ParticipationRow): Participation {
  return {
    id: row.id,
    testId: row.playtestId,
    gameId: row.playtest.gameId,
    gameName: row.playtest.game.name,
    thumbnailUrl: row.playtest.game.thumbnailUrl,
    status: row.status,
    rewardCents: row.rewardCents,
    rewardStatus: row.rewardStatus,
    xpEarned: row.xpEarned,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString(),
    durationSeconds: row.durationSeconds ?? undefined,
  };
}

/** Tom da tag de tipo nas tabelas do jogador. */
export const KIND_TONE: Record<TestModel, PlayerGameTest['kindTone']> = {
  TELEMETRY: 'topaz',
  FREE_EXPLORATION: 'topaz',
  AB_TEST: 'amethyst',
  AB_IMAGES: 'sapphire',
};
