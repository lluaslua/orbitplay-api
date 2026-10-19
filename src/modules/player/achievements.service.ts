import { Injectable } from '@nestjs/common';
import type { Achievement, GameAchievement, Prisma } from '@prisma/client';
import { EXPERIMENTAL_STAGES, GAME_ACHIEVEMENT_RULES } from '../../common/constants/domain.constants';
import type { DevelopmentStage } from '../../contracts';

/** Detalhes da sessão enviada que algumas regras olham. */
export interface SessionFacts {
  /** A maior resposta em texto, em caracteres. */
  longestText: number;
  /** Estágio do jogo no cadastro, na hora do envio. */
  developmentStage: string | null;
}

/**
 * Conquistas. Cada uma tem uma regra (`rule`); a que não tem regra conhecida
 * só é dada manualmente.
 *
 * No envio da sessão:
 *   FIRST_SESSION       primeira sessão na plataforma
 *   SESSIONS_10         10 sessões enviadas
 *   BUGS_10             10 bugs reportados, somando todas as sessões
 *   HOURS_20            20 horas de sessões
 *   QUALITY_STREAK_5    nota de feedback 9,5+ nas 5 últimas sessões
 *   LEVEL_10            nível 10
 *   GAME_FIRST_TEST     primeira sessão no jogo          ("Primeira Largada")
 *   GAME_TESTS_10       10 sessões no jogo               ("Piloto Frequente")
 *   FEEDBACK_100_CHARS  resposta com mais de 100 letras  ("Crítico Construtivo")
 *   EXPERIMENTAL_BUILD  jogo em Conceito/Protótipo/Alpha ("Cobaia de Protótipo")
 *
 * Na validação do estúdio: GAME_FIRST_REWARD ("Corrida que Paga") e
 * BUG_CONFIRMED ("Caçador de Bugs"). Na análise: AI_INSIGHT_SOURCE ("Fonte Primária").
 */
@Injectable()
export class AchievementsService {
  async unlockAfterSession(
    tx: Prisma.TransactionClient,
    playerId: string,
    gameId: string,
    facts: SessionFacts = { longestText: 0, developmentStage: null },
  ): Promise<{ global: Achievement[]; game: GameAchievement[] }> {
    const [perfil, bugs, noJogo, ultimas] = await Promise.all([
      tx.playerProfile.findUniqueOrThrow({ where: { userId: playerId } }),
      tx.session.aggregate({ where: { participation: { playerId } }, _sum: { bugsFound: true } }),
      tx.session.count({ where: { participation: { playerId, playtest: { gameId } } } }),
      tx.session.findMany({
        where: { participation: { playerId } },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        select: { feedbackQuality: true },
      }),
    ]);

    const cumpre: Record<string, boolean> = {
      FIRST_SESSION: perfil.completedSessions >= 1,
      SESSIONS_10: perfil.completedSessions >= 10,
      BUGS_10: (bugs._sum.bugsFound ?? 0) >= 10,
      HOURS_20: perfil.secondsPlayed >= 20 * 3600,
      QUALITY_STREAK_5: ultimas.length === 5 && ultimas.every((s) => s.feedbackQuality >= 9.5),
      LEVEL_10: perfil.level >= 10,
      GAME_FIRST_TEST: noJogo >= 1,
      GAME_TESTS_10: noJogo >= 10,
      FEEDBACK_100_CHARS: facts.longestText > 100,
      EXPERIMENTAL_BUILD: EXPERIMENTAL_STAGES.includes(facts.developmentStage as DevelopmentStage),
    };
    const regras = Object.keys(cumpre).filter((regra) => cumpre[regra]);

    const jaTem = await tx.playerAchievement.findMany({ where: { playerId }, select: { achievementId: true } });
    const global = await tx.achievement.findMany({
      where: { rule: { in: regras }, id: { notIn: jaTem.map((c) => c.achievementId) } },
    });
    if (global.length) {
      await tx.playerAchievement.createMany({ data: global.map((c) => ({ playerId, achievementId: c.id })) });
      await tx.playerProfile.update({
        where: { userId: playerId },
        data: { achievementsCount: { increment: global.length } },
      });
    }

    const game = await this.unlockGameRules(tx, playerId, gameId, regras);
    return { global, game };
  }

  /** Libera as conquistas do jogo com estas regras que o jogador ainda não tem. */
  async unlockGameRules(tx: Prisma.TransactionClient, playerId: string, gameId: string, regras: string[]): Promise<GameAchievement[]> {
    if (!regras.length) return [];
    const conquistas = await tx.gameAchievement.findMany({
      where: {
        OR: [{ gameId }, { gameId: null }],
        rule: { in: regras },
        players: { none: { playerId, gameId } },
      },
    });
    if (conquistas.length) {
      await tx.playerGameAchievement.createMany({
        data: conquistas.map((c) => ({ playerId, gameAchievementId: c.id, gameId })),
        skipDuplicates: true,
      });
    }
    return conquistas;
  }
}

/** O "5/10" das conquistas de contagem: quantas sessões o jogador já tem no jogo. */
export function achievementProgress(rule: string | null, sessoesNoJogo: number): { current: number; target: number } | undefined {
  const alvo = rule ? GAME_ACHIEVEMENT_RULES[rule]?.target : undefined;
  if (!alvo || alvo <= 1) return undefined;
  return { current: Math.min(sessoesNoJogo, alvo), target: alvo };
}
