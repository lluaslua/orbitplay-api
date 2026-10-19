import type { Prisma } from '@prisma/client';
import { addDays } from '../../common/utils/dates';
import type {
  ArchetypeId,
  PlayerTypeId,
  Playtest,
  QuestionType,
  TestLocation,
  TestModel,
} from '../../contracts';

export const playtestInclude = {
  game: { select: { name: true, thumbnailUrl: true, studioId: true } },
  questions: { orderBy: { position: 'asc' } },
} satisfies Prisma.PlaytestInclude;

export type PlaytestRow = Prisma.PlaytestGetPayload<{ include: typeof playtestInclude }>;

/** Rótulo da tag de tipo nas tabelas ("DEMO ABERTA", "A/B"). */
export const KIND_BY_MODEL: Record<TestModel, string> = {
  TELEMETRY: 'DEMO ABERTA',
  FREE_EXPLORATION: 'DEMO ABERTA',
  AB_TEST: 'A/B',
  AB_IMAGES: 'A/B',
};

/**
 * O teste no formato do contrato. Antes do pagamento ele não tem início nem
 * prazo; o contrato pede texto, então vão a criação e o prazo previsto.
 */
export function toPlaytest(row: PlaytestRow): Playtest {
  return {
    id: row.id,
    gameId: row.gameId,
    gameName: row.game.name,
    gameThumbnailUrl: row.game.thumbnailUrl,
    title: row.title,
    model: row.model,
    status: row.status,
    instructions: row.instructions,
    requiresRecording: row.requiresRecording,
    requiresMicrophone: row.requiresMicrophone,
    requiresWebcam: row.requiresWebcam,
    requiresController: row.requiresController,
    eliteOnly: row.eliteOnly,
    questions: row.questions.map((pergunta) => ({
      id: pergunta.id,
      type: pergunta.type as QuestionType,
      label: pergunta.label,
      helperText: pergunta.helperText ?? undefined,
      required: pergunta.required,
      imageUrl: pergunta.imageUrl ?? undefined,
      options: pergunta.options,
      ...(pergunta.columns.length ? { columns: pergunta.columns } : {}),
      scaleMin: pergunta.scaleMin ?? undefined,
      scaleMax: pergunta.scaleMax ?? undefined,
      scaleMinLabel: pergunta.scaleMinLabel ?? undefined,
      scaleMaxLabel: pergunta.scaleMaxLabel ?? undefined,
    })),
    audience: {
      locations: row.locations as TestLocation[],
      playerType: row.playerType as PlayerTypeId,
      archetype: row.archetype as ArchetypeId,
      minAge: row.minAge,
      maxAge: row.maxAge,
    },
    budget: {
      slots: row.slots,
      untilDisabled: row.untilDisabled,
      basePriceCents: row.basePriceCents,
      audienceCents: row.audienceCents,
      boostCents: row.boostCents,
      pricePerTestCents: row.pricePerTestCents,
      totalCents: row.totalCents,
      rewardPerSessionCents: row.rewardPerSessionCents,
      durationDays: row.durationDays,
    },
    currentParticipants: row.currentParticipants,
    estimatedMinutes: row.estimatedMinutes,
    buildFileName: row.buildFileName,
    buildSizeMb: row.buildSizeMb,
    kind: row.kind,
    plugin: row.plugin,
    createdAt: row.createdAt.toISOString(),
    startsAt: (row.startsAt ?? row.createdAt).toISOString(),
    expiresAt: (row.expiresAt ?? addDays(row.createdAt, row.durationDays)).toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
