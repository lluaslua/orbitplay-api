import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ELITE_TIER, MIN_WITHDRAWAL_CENTS, TEST_MODEL_LABELS } from '../../common/constants/domain.constants';
import { daysAgo } from '../../common/utils/dates';
import { ratio, round, sum } from '../../common/utils/numbers';
import { runsOn } from '../../common/utils/platform';
import { genreLabel } from '../../common/utils/vocabulary';
import type {
  Achievement,
  AvailableTest,
  GameAchievement,
  Participation,
  ParticipationStatus,
  Platform,
  PlayerDashboard,
  PlayerGameHistory,
  PlayerGameTest,
  PlayerRanking,
  PlayerSessionReview,
  QuestionType,
  RankingPeriod,
  RankingRow,
  SessionOutcome,
  UnavailableReason,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { achievementProgress } from './achievements.service';
import type { UpdatePlayerProfileDto } from './dto/player-profile.dto';
import { KIND_TONE, participationInclude, toParticipation } from './participation.mapper';

/** Janela de cada período do ranking, em dias. `all` compara com a semana passada. */
const DIAS_DO_PERIODO: Record<RankingPeriod, number> = { week: 7, month: 30, all: 7 };

/** O Figma prevê recompensa para o Top 10. */
const TOP_RANKING = 10;

const testeComJogo = {
  game: { select: { name: true, thumbnailUrl: true, genres: true, studio: { select: { name: true } } } },
} satisfies Prisma.PlaytestInclude;

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Dia da semana em que os saques aprovados são pagos (segunda). */
const DIA_DE_PAGAMENTO = 1;

/** Leituras do jogador. Tudo é filtrado pelo jogador do token (Tela 13, RN-01). */
@Injectable()
export class PlayerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** Home do jogador (Figma `197:496`). */
  async getDashboard(playerId: string, platform: Platform | null = null): Promise<PlayerDashboard> {
    const perfil = await this.profileOf(playerId);
    const [participacoes, ganhos, catalogo, ranking] = await Promise.all([
      this.prisma.participation.findMany({
        where: { playerId },
        include: { playtest: { include: testeComJogo } },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { playerId, type: 'REWARD', status: { not: 'CANCELED' } },
        select: { amountCents: true, createdAt: true },
      }),
      this.getCatalog(playerId, undefined, platform),
      this.getRanking(playerId, 'week'),
    ]);

    const emAndamento = participacoes.filter((p) => p.status === 'IN_PROGRESS');
    const atual = emAndamento[0];
    const semana = daysAgo(7);
    const hoje = new Date();

    const jogados = new Set(participacoes.map((p) => p.playtest.gameId));
    const destaque = [
      ...new Set(
        catalogo
          .filter((card) => card.status === 'AVAILABLE' && !jogados.has(card.gameId))
          .sort((a, b) => b.rewardCents - a.rewardCents)
          .map((card) => card.gameId),
      ),
    ].slice(0, 4);

    const generos = new Map<string, number>();
    participacoes.forEach((p) => p.playtest.game.genres.forEach((g) => generos.set(g, (generos.get(g) ?? 0) + 1)));
    const totalGeneros = sum([...generos.values()]);

    return {
      ongoing: atual
        ? {
            gameId: atual.playtest.gameId,
            tracks: emAndamento
              .filter((p) => p.playtest.gameId === atual.playtest.gameId)
              .map((p) => ({ id: p.playtestId, name: p.playtest.title, progress: p.progress, rewardCents: p.rewardCents })),
          }
        : null,
      featuredGameIds: destaque,
      earnings: {
        last7DaysCents: sum(ganhos.filter((g) => g.createdAt >= semana).map((g) => g.amountCents)),
        totalCents: sum(ganhos.map((g) => g.amountCents)),
        nextPayoutDays: (DIA_DE_PAGAMENTO - hoje.getDay() + 7) % 7 || 7,
        series: Array.from({ length: 7 }, (_, i) => {
          const dia = daysAgo(6 - i, hoje);
          const doDia = ganhos.filter((g) => g.createdAt.toDateString() === dia.toDateString());
          return { label: DIAS[dia.getDay()], cents: sum(doDia.map((g) => g.amountCents)) };
        }),
      },
      missions: {
        rankPosition: await this.users.rankOf(perfil.level, perfil.xp),
        // Posições ganhas no ranking da semana.
        rankDelta: ranking.delta,
        pending: emAndamento.length,
        nextGoalCents: Math.max(MIN_WITHDRAWAL_CENTS - perfil.balanceCents, 0),
        genres: [...generos.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([genero, n]) => ({ label: genreLabel(genero), value: Math.round(ratio(n, totalGeneros) * 100) })),
      },
      myTests: participacoes.slice(0, 5).map((p) => ({
        id: p.id,
        name: p.playtest.game.name,
        progress: p.status === 'IN_PROGRESS' ? p.progress : 1,
        rewardCents: p.rewardCents,
        gameId: p.playtest.gameId,
        testId: p.playtestId,
        inProgress: p.status === 'IN_PROGRESS',
      })),
    };
  }

  /**
   * Catálogo: testes abertos (qualquer perfil) e os que o
   * jogador já começou, com o estado da participação.
   */
  async getCatalog(playerId: string, gameId?: string, platform: Platform | null = null): Promise<AvailableTest[]> {
    const perfil = await this.profileOf(playerId);
    const testes = await this.prisma.playtest.findMany({
      where: {
        ...(gameId ? { gameId } : {}),
        status: { not: 'DRAFT' },
        OR: [{ status: { in: ['ACTIVE', 'FULL'] } }, { participations: { some: { playerId } } }],
      },
      include: {
        ...testeComJogo,
        build: { select: { platforms: true } },
        participations: { where: { playerId }, select: { status: true, progress: true } },
        retestInvites: { where: { playerId }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const agora = new Date();
    const elite = perfil.tier === ELITE_TIER;
    return testes
      // Todo teste aberto aparece para todos; o público-alvo não restringe. Os exclusivos ELITE aparecem indisponíveis para quem não é, e o convite os abre.
      .map((teste) => {
        const participacao = teste.participations[0];
        const convidado = teste.retestInvites.length > 0;
        const noPrazo = teste.status === 'ACTIVE' && (!teste.expiresAt || teste.expiresAt > agora);
        const comVaga = teste.untilDisabled || teste.currentParticipants < teste.slots;
        const motivo: UnavailableReason | undefined = !noPrazo
          ? teste.status === 'FULL' ? 'NO_SLOTS' : 'CLOSED'
          : !comVaga
            ? 'NO_SLOTS'
            : teste.eliteOnly && !elite && !convidado
              ? 'ELITE_ONLY'
              : !runsOn(teste.build?.platforms, platform)
                ? 'DEVICE_INCOMPATIBLE'
                : undefined;
        const status: ParticipationStatus = participacao?.status ?? (motivo ? 'UNAVAILABLE' : 'AVAILABLE');

        return {
          id: teste.id,
          testId: teste.id,
          gameId: teste.gameId,
          gameName: teste.game.name,
          studioName: teste.game.studio.name,
          thumbnailUrl: teste.game.thumbnailUrl,
          genres: teste.game.genres,
          modelLabel: TEST_MODEL_LABELS[teste.model],
          estimatedMinutes: teste.estimatedMinutes,
          rewardCents: teste.rewardPerSessionCents,
          slotsTotal: teste.slots,
          slotsTaken: teste.currentParticipants,
          expiresAt: (teste.expiresAt ?? agora).toISOString(),
          status,
          requiresRecording: teste.requiresRecording,
          eliteOnly: teste.eliteOnly,
          ...(!participacao && motivo ? { unavailableReason: motivo } : {}),
        };
      });
  }

  async listParticipations(playerId: string): Promise<Participation[]> {
    const rows = await this.prisma.participation.findMany({
      where: { playerId },
      include: participationInclude,
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(toParticipation);
  }

  async listAchievements(playerId: string): Promise<Achievement[]> {
    const conquistas = await this.prisma.achievement.findMany({
      include: { players: { where: { playerId }, select: { unlockedAt: true } } },
      orderBy: { id: 'asc' },
    });
    return conquistas.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      xp: c.xp,
      unlockedAt: c.players[0]?.unlockedAt.toISOString(),
    }));
  }

  /**
   * Tabela "Testes disponíveis" do jogo (Figma `199:1291`). "Baixando build" é
   * estado do app do tester — a API só sabe que ele começou (CONTINUE).
   */
  async listGameTests(playerId: string, gameId: string, platform: Platform | null = null): Promise<PlayerGameTest[]> {
    const cards = await this.getCatalog(playerId, gameId, platform);
    const testes = await this.prisma.playtest.findMany({
      where: { id: { in: cards.map((card) => card.testId) } },
      include: { participations: { where: { playerId }, select: { progress: true } } },
    });

    return cards.map((card) => {
      const teste = testes.find((t) => t.id === card.testId)!;
      const action: PlayerGameTest['action'] =
        card.status === 'AVAILABLE'
          ? 'START'
          : card.status === 'IN_PROGRESS'
            ? 'CONTINUE'
            : card.status === 'UNAVAILABLE'
              ? 'UNAVAILABLE'
              : 'REVIEW';
      return {
        id: teste.id,
        name: teste.title,
        kind: teste.kind,
        kindTone: KIND_TONE[teste.model],
        expiresAt: card.expiresAt,
        estimatedMinutes: teste.estimatedMinutes,
        slotsTaken: teste.currentParticipants,
        slotsTotal: teste.slots,
        progress: teste.participations[0]?.progress ?? 0,
        rewardCents: teste.rewardPerSessionCents,
        boosted: teste.boostCents > 0,
        action,
        eliteOnly: teste.eliteOnly,
        requiresController: teste.requiresController,
        ...(card.unavailableReason ? { unavailableReason: card.unavailableReason } : {}),
      };
    });
  }

  /** Aba "Conquistas" do jogo (Figma `224:6222`): as do jogo e as que valem para todos. */
  async listGameAchievements(playerId: string, gameId: string): Promise<GameAchievement[]> {
    const [conquistas, sessoesNoJogo] = await Promise.all([
      this.prisma.gameAchievement.findMany({
        where: { OR: [{ gameId }, { gameId: null }] },
        include: { players: { where: { playerId, gameId }, select: { unlockedAt: true } } },
        orderBy: { position: 'asc' },
      }),
      this.prisma.session.count({ where: { participation: { playerId, playtest: { gameId } } } }),
    ]);
    return conquistas.map((c) => {
      const progresso = achievementProgress(c.rule, sessoesNoJogo);
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        icon: c.icon,
        locked: c.players.length === 0,
        ...(progresso ? { progress: progresso } : {}),
      };
    });
  }

  /**
   * Ranking pelo XP ganho no período (card "Missões e Ranking", Figma
   * `197:496`). A variação compara com o período anterior do mesmo tamanho.
   */
  async getRanking(playerId: string, period: RankingPeriod): Promise<PlayerRanking> {
    const agora = new Date();
    const dias = DIAS_DO_PERIODO[period];
    const inicio = period === 'all' ? null : daysAgo(dias, agora);
    const atual = await this.xpRanking(inicio, agora);
    // "Geral" compara com o ranking de uma semana atrás; os outros, com a janela anterior.
    const anterior =
      period === 'all' ? await this.xpRanking(null, daysAgo(dias, agora)) : await this.xpRanking(daysAgo(dias * 2, agora), inicio!);

    const posicao = (lista: { playerId: string }[]) => lista.findIndex((linha) => linha.playerId === playerId) + 1;
    const agoraEm = posicao(atual);
    const antesEm = posicao(anterior);

    const ids = [...new Set([...atual.slice(0, TOP_RANKING).map((l) => l.playerId), playerId])];
    const contas = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, avatarUrl: true, player: { select: { tier: true, level: true } } },
    });
    const linha = (dado: { playerId: string; xp: number; sessions: number }, position: number): RankingRow => {
      const conta = contas.find((c) => c.id === dado.playerId);
      return {
        position,
        playerId: dado.playerId,
        name: conta?.name ?? '',
        avatarUrl: conta?.avatarUrl ?? null,
        tier: conta?.player?.tier ?? '',
        level: conta?.player?.level ?? 1,
        xp: dado.xp,
        sessions: dado.sessions,
      };
    };

    return {
      period,
      top: atual.slice(0, TOP_RANKING).map((dado, i) => linha(dado, i + 1)),
      me: agoraEm ? linha(atual[agoraEm - 1], agoraEm) : null,
      delta: agoraEm && antesEm ? antesEm - agoraEm : 0,
      totalPlayers: atual.length,
    };
  }

  /** Jogadores por XP ganho em sessões enviadas na janela — recusada não conta. */
  private async xpRanking(desde: Date | null, ate: Date): Promise<{ playerId: string; xp: number; sessions: number }[]> {
    const grupos = await this.prisma.participation.groupBy({
      by: ['playerId'],
      where: { status: { in: ['PENDING_REVIEW', 'COMPLETED'] }, finishedAt: { ...(desde ? { gte: desde } : {}), lt: ate } },
      _sum: { xpEarned: true },
      _count: { _all: true },
    });
    return grupos
      .map((g) => ({ playerId: g.playerId, xp: g._sum.xpEarned ?? 0, sessions: g._count._all }))
      .filter((g) => g.xp > 0)
      .sort((a, b) => b.xp - a.xp || a.playerId.localeCompare(b.playerId));
  }

  /** Localização e data de nascimento — o que decide em que público o jogador cabe. */
  async updateProfile(playerId: string, dto: UpdatePlayerProfileDto): Promise<{ location: string; birthDate: string | null }> {
    await this.profileOf(playerId);
    const perfil = await this.prisma.playerProfile.update({
      where: { userId: playerId },
      data: { location: dto.location, birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined },
    });
    return { location: perfil.location, birthDate: perfil.birthDate?.toISOString() ?? null };
  }

  /** Terminou o tutorial: da próxima vez o modal mostra "Rever tutorial" (Figma `224:7540`). */
  async markTutorialSeen(playerId: string): Promise<{ tutorialSeen: true; seenAt: string }> {
    const perfil = await this.profileOf(playerId);
    const visto = perfil.tutorialSeenAt ?? (await this.prisma.playerProfile.update({
      where: { userId: playerId },
      data: { tutorialSeenAt: new Date() },
    })).tutorialSeenAt!;
    return { tutorialSeen: true, seenAt: visto.toISOString() };
  }

  /** Aba "Meus testes" do jogo (Figma `224:5627`): o que já foi entregue. */
  async listGameHistory(playerId: string, gameId: string): Promise<PlayerGameHistory[]> {
    const participacoes = await this.prisma.participation.findMany({
      where: { playerId, status: { not: 'IN_PROGRESS' }, playtest: { gameId } },
      include: { playtest: true },
      orderBy: { finishedAt: 'desc' },
    });
    const agora = new Date();

    return participacoes.map((p) => ({
      id: p.id,
      testId: p.playtestId,
      name: p.playtest.title,
      kind: p.playtest.kind,
      kindTone: KIND_TONE[p.playtest.model],
      expiresAt: p.playtest.expiresAt && p.playtest.expiresAt > agora ? p.playtest.expiresAt.toISOString() : null,
      estimatedMinutes: p.playtest.estimatedMinutes,
      slotsTaken: p.playtest.currentParticipants,
      slotsTotal: p.playtest.slots,
      progress: 1,
      rewardCents: p.rewardCents,
      status: p.status === 'REJECTED' ? 'Recusado' : p.status === 'PENDING_REVIEW' ? 'Completo! (Em análise)' : 'Completo!',
    }));
  }

  /** Sessão para revisar antes do formulário (TELA 18): a do teste pedido, ou a em andamento mais recente. */
  async getSessionReview(playerId: string, testId?: string): Promise<PlayerSessionReview> {
    const participacao = await this.prisma.participation.findFirst({
      where: { playerId, ...(testId ? { playtestId: testId } : { status: 'IN_PROGRESS' }) },
      include: {
        playtest: {
          select: {
            gameId: true,
            title: true,
            kind: true,
            rewardPerSessionCents: true,
            questions: { orderBy: { position: 'asc' } },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (!participacao) throw new NotFoundException({ message: 'Nenhuma sessão para revisar.' });

    const feitas = await this.prisma.session.count({ where: { participation: { playerId } } });
    const transcricao = participacao.transcript as { at: string; text: string }[];
    return {
      id: participacao.id,
      status: participacao.status,
      testId: participacao.playtestId,
      gameId: participacao.playtest.gameId,
      testName: participacao.playtest.title,
      testKind: participacao.playtest.kind,
      rewardCents: participacao.playtest.rewardPerSessionCents,
      testsDone: feitas,
      transcript: transcricao.map(({ at, text }) => ({ at, text })),
      // A imagem da pergunta vai junto: o formulário do jogador mostra a mesma do estúdio.
      questions: participacao.playtest.questions.map((pergunta) => ({
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
    };
  }

  /** O que a sessão rendeu (TELA 19), como foi calculado no envio. Recarregar não recalcula nada. */
  async getSessionOutcome(playerId: string, testId?: string): Promise<SessionOutcome> {
    const sessao = await this.prisma.session.findFirst({
      where: { participation: { playerId, ...(testId ? { playtestId: testId } : {}) } },
      orderBy: { submittedAt: 'desc' },
      select: { outcome: true },
    });
    if (!sessao) throw new NotFoundException({ message: 'Nenhuma sessão enviada ainda.' });
    return sessao.outcome as unknown as SessionOutcome;
  }

  /** O tester tem participação em algum teste do jogo — a regra de entrada no chat. */
  async hasPlayedGame(playerId: string, gameId: string): Promise<boolean> {
    return (await this.prisma.participation.count({ where: { playerId, playtest: { gameId } } })) > 0;
  }

  private async profileOf(playerId: string) {
    const perfil = await this.prisma.playerProfile.findUnique({ where: { userId: playerId } });
    if (!perfil) throw new ForbiddenException({ message: 'Esta conta não tem perfil de jogador.' });
    return perfil;
  }
}
