import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { GameAccessService } from '../../common/access/game-access.service';
import { studioIdOf } from '../../common/access/studio-scope';
import {
  AGE_RATING_LABELS,
  DEV_STAGE_LABELS,
  ENGINE_LABELS,
  GAME_MODE_LABELS,
  GAME_PERMISSIONS,
  GENRES,
  LANGUAGES,
  PLATFORM_LABELS,
  SUB_GENRES,
} from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { pageArgs, type PaginationQueryDto } from '../../common/pagination/pagination';
import { StorageService } from '../../common/storage/storage.service';
import { IMAGE_TYPES } from '../../common/storage/upload-filters';
import { daysAgo } from '../../common/utils/dates';
import { average, ratio, round, sum } from '../../common/utils/numbers';
import type {
  AgeRating,
  CatalogTab,
  DevelopmentStage,
  Game,
  GameAchievementConfig,
  GameEngine,
  GameMode,
  GameOptions,
  GameReviewRow,
  GameSpecs,
  GameStats,
  Genre,
  MyGameAccess,
  Platform,
  PublicGameCard,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateGameDto } from './dto/create-game.dto';
import type { GameAchievementDto, UpdateGameAchievementDto } from './dto/game-achievement.dto';
import type { ListGamesQueryDto } from './dto/list-games-query.dto';
import type { UpdateGameDto } from './dto/update-game.dto';

const comEstudio = { studio: { select: { name: true } } } satisfies Prisma.GameInclude;
type GameRow = Prisma.GameGetPayload<{ include: typeof comEstudio }>;

export type ImageKind = 'banner' | 'thumbnail' | 'logo';

/** O que o jogo usa enquanto o estúdio não envia imagem — conta como "falta" no Finalizar. */
const BANNER_PADRAO = '/assets/backgrounds/default-banner.svg';
const THUMB_PADRAO = '/assets/images/default-game.svg';

/** "Novos jogos": criados nos últimos 30 dias ou marcados como novos. */
const DIAS_DE_NOVO = 30;

const SPECS_PADRAO: GameSpecs = {
  minOs: 'Windows 10 64-bit',
  minCpu: 'A definir',
  minRam: '4 GB',
  minGpu: 'A definir',
  diskSpace: 'A definir',
  requiresController: false,
  requiresMicrophone: false,
  requiresWebcam: false,
};

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: GameAccessService,
  ) {}

  /** As listas dos dropdowns do Novo jogo. */
  options(): GameOptions {
    const lista = <T extends string>(labels: Record<T, string>) =>
      (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
    return {
      genres: GENRES.map((value) => ({ value, label: value })),
      subGenres: SUB_GENRES.map((value) => ({ value, label: value })),
      platforms: lista(PLATFORM_LABELS),
      gameModes: lista(GAME_MODE_LABELS),
      engines: lista(ENGINE_LABELS),
      developmentStages: lista(DEV_STAGE_LABELS),
      ageRatings: lista(AGE_RATING_LABELS),
      languages: LANGUAGES,
    };
  }

  async list(user: RequestUser, query: ListGamesQueryDto): Promise<{ items: Game[]; total: number }> {
    const where: Prisma.GameWhereInput = { AND: [await this.visibleTo(user, 'list', query.studioId), buscaPor(query.search)] };
    if (user.role === 'PLAYER' && query.tab) return this.listTab(where, query.tab, query, user.id);

    const [rows, total] = await Promise.all([
      this.prisma.game.findMany({ where, include: comEstudio, orderBy: { updatedAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.game.count({ where }),
    ]);
    return { items: await this.toGames(rows), total };
  }

  /**
   * Cards da landing pública (Figma `151:2272`): jogos ativos com teste aberto,
   * só com o que o card desenha.
   */
  async listPublic(query: ListGamesQueryDto): Promise<{ items: PublicGameCard[]; total: number }> {
    const where: Prisma.GameWhereInput = {
      AND: [{ status: 'ACTIVE', playtests: { some: { status: { in: ['ACTIVE', 'FULL'] } } } }, buscaPor(query.search)],
    };
    const { items, total } = query.tab === 'COMMUNITIES' ? { items: [], total: 0 } : await this.listTab(where, query.tab, query);
    const elite = await this.prisma.playtest.findMany({
      where: { gameId: { in: items.map((g) => g.id) }, status: { in: ['ACTIVE', 'FULL'] } },
      select: { gameId: true, eliteOnly: true },
    });

    return {
      total,
      items: items.map((game) => {
        const abertos = elite.filter((t) => t.gameId === game.id);
        return {
          id: game.id,
          name: game.name,
          studioName: game.studioName,
          bannerUrl: game.bannerUrl,
          thumbnailUrl: game.thumbnailUrl,
          genres: game.genres,
          isNew: game.isNew,
          endsAt: game.endsAt,
          playingNow: game.stats.playingNow,
          openTests: game.stats.activeTests,
          maxRewardCents: game.maxRewardCents,
          remainingRewardCents: game.stats.remainingRewardCents,
          eliteOnly: abertos.length > 0 && abertos.every((t) => t.eliteOnly),
        };
      }),
    };
  }

  async findOne(user: RequestUser, id: string): Promise<Game> {
    const row = await this.prisma.game.findFirst({ where: { id, ...(await this.visibleTo(user, 'detail')) }, include: comEstudio });
    if (!row) throw notFound();
    const [game] = await this.toGames([row]);
    return game;
  }

  /** Jogo da organização, ou 404 — nunca revela que existe jogo de outro estúdio. */
  async findOwned(studioId: string, id: string) {
    const game = await this.prisma.game.findFirst({ where: { id, studioId } });
    if (!game) throw notFound();
    return game;
  }

  /**
   * Nasce DRAFT (fora do catálogo até o Finalizar), dentro da organização de
   * quem pediu (Tela 04, RN-02). Quem
   * cria entra em "Responsáveis e permissões" com as quatro permissões.
   */
  async create(user: RequestUser, dto: CreateGameDto): Promise<Game> {
    const id = randomUUID();
    const imagens = await this.storeImages(id, dto);
    const row = await this.prisma.game.create({
      data: {
        id,
        studioId: studioIdOf(user),
        name: dto.name.trim(),
        tagline: dto.tagline?.trim() ?? '',
        shortDescription: dto.shortDescription ?? '',
        description: dto.description ?? '',
        bannerUrl: imagens.bannerUrl ?? BANNER_PADRAO,
        // Sem ícone, o card usa a capa.
        thumbnailUrl: imagens.thumbnailUrl ?? imagens.bannerUrl ?? THUMB_PADRAO,
        logoUrl: imagens.logoUrl ?? null,
        genres: dto.genres ?? [],
        subGenres: dto.subGenres ?? [],
        platforms: dto.platforms ?? [],
        gameModes: dto.gameModes ?? [],
        engine: dto.engine ?? null,
        developmentStage: dto.developmentStage ?? null,
        ageRating: dto.ageRating ?? null,
        languages: dto.languages ?? [],
        trailerUrl: dto.trailerUrl ?? null,
        specs: { ...SPECS_PADRAO },
        access: { create: { userId: user.id, permissions: GAME_PERMISSIONS } },
      },
      include: comEstudio,
    });
    const [game] = await this.toGames([row]);
    return game;
  }

  async update(user: RequestUser, id: string, dto: UpdateGameDto): Promise<Game> {
    const atual = await this.access.assert(user, id, 'EDIT_INFO');
    const imagens = await this.storeImages(id, dto);
    await this.prisma.game.update({
      where: { id },
      data: {
        ...imagens,
        name: dto.name?.trim(),
        tagline: dto.tagline?.trim(),
        shortDescription: dto.shortDescription,
        description: dto.description,
        genres: dto.genres,
        subGenres: dto.subGenres,
        platforms: dto.platforms,
        gameModes: dto.gameModes,
        engine: dto.engine,
        developmentStage: dto.developmentStage,
        ageRating: dto.ageRating,
        languages: dto.languages,
        trailerUrl: dto.trailerUrl,
        status: dto.status,
        specs: dto.specs ? { ...(atual.specs as unknown as GameSpecs), ...dto.specs } : undefined,
      },
    });
    return this.findOne(user, id);
  }

  /** Formato e tamanho já foram conferidos pelo filtro do upload (Tela 04, RN-05). */
  async uploadImage(user: RequestUser, id: string, kind: ImageKind, file: Express.Multer.File): Promise<Game> {
    try {
      await this.access.assert(user, id, 'EDIT_INFO');
      const key = `games/${id}/${kind}-${Date.now()}${IMAGE_TYPES[file.mimetype]}`;
      await this.storage.store(file.path, key, 'public');
      const url = this.storage.publicUrl(key);
      const campo: Record<ImageKind, keyof Prisma.GameUpdateInput> = { banner: 'bannerUrl', thumbnail: 'thumbnailUrl', logo: 'logoUrl' };
      await this.prisma.game.update({ where: { id }, data: { [campo[kind]]: url } });
    } finally {
      // Se o arquivo não foi movido, sai da pasta temporária.
      await rm(file.path, { force: true });
    }
    return this.findOne(user, id);
  }

  /**
   * As imagens do passo Mídias chegam como o app guarda o rascunho: data URL.
   * Cada uma vira arquivo em `public/games/<id>/` e o campo guarda a URL. Link
   * comum passa como veio; campo ausente fica de fora do update.
   */
  private async storeImages(
    id: string,
    dto: { bannerUrl?: string | null; logoUrl?: string | null; thumbnailUrl?: string | null },
  ): Promise<{ bannerUrl?: string; logoUrl?: string | null; thumbnailUrl?: string }> {
    const gravar = async (valor: string | null | undefined, kind: ImageKind) => {
      if (!valor || !valor.startsWith('data:')) return valor;
      const key = await this.storage.storeDataUrl(valor, `games/${id}/${kind}-${Date.now()}`, 'public');
      return this.storage.publicUrl(key);
    };
    const [bannerUrl, logoUrl, thumbnailUrl] = await Promise.all([
      gravar(dto.bannerUrl, 'banner'),
      gravar(dto.logoUrl, 'logo'),
      gravar(dto.thumbnailUrl, 'thumbnail'),
    ]);
    return {
      ...(bannerUrl ? { bannerUrl } : {}),
      ...(logoUrl !== undefined ? { logoUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    };
  }

  /**
   * "Finalizar" do Novo jogo (Figma `1187:9418`): confere os campos com * dos
   * dois primeiros passos. Faltando algum, 400 com a lista em `fields`; tudo
   * certo, o jogo é publicado (DRAFT -> ACTIVE).
   */
  async finishSetup(user: RequestUser, id: string): Promise<Game> {
    const game = await this.access.assert(user, id, 'EDIT_INFO');
    const faltando: Record<string, string> = {};
    const obrigatorio = (ok: boolean, campo: string, mensagem: string) => {
      if (!ok) faltando[campo] = mensagem;
    };

    obrigatorio(!!game.name.trim(), 'name', 'Dê um nome ao jogo.');
    obrigatorio(!!game.tagline.trim(), 'tagline', 'Preencha o subtítulo.');
    obrigatorio(!!game.shortDescription.trim(), 'shortDescription', 'Preencha a descrição curta.');
    obrigatorio(game.genres.length > 0, 'genres', 'Escolha pelo menos um gênero.');
    obrigatorio(game.platforms.length > 0, 'platforms', 'Escolha as plataformas.');
    obrigatorio(game.gameModes.length > 0, 'gameModes', 'Escolha o modo de jogo.');
    obrigatorio(!!game.developmentStage, 'developmentStage', 'Informe o estágio de desenvolvimento.');
    obrigatorio(!!game.ageRating, 'ageRating', 'Informe a classificação indicativa.');
    obrigatorio(game.bannerUrl !== BANNER_PADRAO, 'bannerUrl', 'Envie a imagem de capa.');
    obrigatorio(!!game.logoUrl, 'logoUrl', 'Envie o logo.');
    obrigatorio(game.thumbnailUrl !== THUMB_PADRAO, 'thumbnailUrl', 'Envie o ícone.');

    if (Object.keys(faltando).length) {
      throw new BadRequestException({
        message: 'Preencha os campos obrigatórios antes de finalizar.',
        code: ErrorCode.GAME_SETUP_INCOMPLETE,
        fields: faltando,
      });
    }

    // Finalizado, o jogo sai do rascunho e entra em "Jogos disponíveis" do jogador.
    // Pausado ou arquivado continua como o estúdio deixou.
    if (!game.setupCompletedAt || game.status === 'DRAFT') {
      await this.prisma.game.update({
        where: { id },
        data: {
          setupCompletedAt: game.setupCompletedAt ?? new Date(),
          ...(game.status === 'DRAFT' ? { status: 'ACTIVE' } : {}),
        },
      });
    }
    return this.findOne(user, id);
  }

  /**
   * "Excluir projeto": só jogo sem teste publicado ou pago. Com histórico, o
   * caminho é arquivar (`PATCH status: ARCHIVED`) — sessões e pagamentos ficam.
   */
  async remove(user: RequestUser, id: string): Promise<{ deleted: true }> {
    await this.access.assert(user, id, 'MANAGE_ACCESS');
    const comHistorico = await this.prisma.playtest.count({
      where: { gameId: id, OR: [{ status: { not: 'DRAFT' } }, { order: { status: 'PAID' } }, { participations: { some: {} } }] },
    });
    if (comHistorico) {
      throw new ConflictException({
        message: 'Este jogo já teve teste publicado. Arquive em vez de excluir.',
        code: ErrorCode.GAME_HAS_TESTS,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const rascunhos = await tx.playtest.findMany({ where: { gameId: id }, select: { id: true } });
      const ids = rascunhos.map((t) => t.id);
      await tx.order.deleteMany({ where: { playtestId: { in: ids } } });
      await tx.insight.deleteMany({ where: { playtestId: { in: ids } } });
      await tx.playtest.deleteMany({ where: { id: { in: ids } } });
      await tx.build.deleteMany({ where: { gameId: id } });
      await tx.playerGameAchievement.deleteMany({ where: { gameAchievement: { gameId: id } } });
      await tx.gameAchievement.deleteMany({ where: { gameId: id } });
      await tx.chatMessage.deleteMany({ where: { gameId: id } });
      await tx.game.delete({ where: { id } });
    });
    return { deleted: true };
  }

  /** O que a conta pode fazer no jogo — o app esconde o que não pode. */
  async myAccess(user: RequestUser, id: string): Promise<MyGameAccess> {
    await this.findOne(user, id);
    return { gameId: id, permissions: await this.access.permissionsOf(user, id) };
  }

  /** Aba "Avaliações" do jogo (Figma `312:7015`): as sessões de todos os testes. */
  async reviews(user: RequestUser, id: string, query: PaginationQueryDto): Promise<{ items: GameReviewRow[]; total: number }> {
    await this.access.assert(user, id, 'VIEW_REPORTS');
    const where: Prisma.SessionWhereInput = { participation: { playtest: { gameId: id }, status: { not: 'REJECTED' } } };
    const [rows, total] = await Promise.all([
      this.prisma.session.findMany({
        where,
        include: { participation: { select: { playtestId: true, player: { select: { name: true } }, playtest: { select: { title: true } } } } },
        orderBy: { submittedAt: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.session.count({ where }),
    ]);

    return {
      total,
      items: rows.map((s) => {
        const textos = Object.values(s.answers as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && !!v.trim());
        return {
          sessionId: s.id,
          testId: s.participation.playtestId,
          testTitle: s.participation.playtest.title,
          playerName: s.participation.player.name,
          date: s.submittedAt.toISOString(),
          overallRating: s.overallRating,
          feedbackQuality: s.feedbackQuality,
          bugsFound: s.bugsFound,
          comment: textos.sort((a, b) => b.length - a.length)[0] ?? null,
        };
      }),
    };
  }

  // --- Conquistas do jogo (aba "Conquistas" do estúdio) -----------------------

  async listAchievements(user: RequestUser, gameId: string): Promise<GameAchievementConfig[]> {
    await this.findOne(user, gameId);
    const conquistas = await this.prisma.gameAchievement.findMany({
      where: { OR: [{ gameId }, { gameId: null }] },
      include: { _count: { select: { players: { where: { gameId } } } } },
      orderBy: { position: 'asc' },
    });
    return conquistas.map(toAchievementConfig);
  }

  async createAchievement(user: RequestUser, gameId: string, dto: GameAchievementDto): Promise<GameAchievementConfig> {
    await this.access.assert(user, gameId, 'EDIT_INFO');
    const ultima = await this.prisma.gameAchievement.aggregate({ where: { gameId }, _max: { position: true } });
    const criada = await this.prisma.gameAchievement.create({
      data: {
        gameId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        icon: dto.icon ?? 'conquista-padrao',
        rule: dto.rule ?? null,
        position: dto.position ?? (ultima._max.position ?? -1) + 1,
      },
      include: { _count: { select: { players: { where: { gameId } } } } },
    });
    return toAchievementConfig(criada);
  }

  async updateAchievement(user: RequestUser, gameId: string, achievementId: string, dto: UpdateGameAchievementDto): Promise<GameAchievementConfig> {
    await this.access.assert(user, gameId, 'EDIT_INFO');
    await this.achievementOf(gameId, achievementId);
    const atualizada = await this.prisma.gameAchievement.update({
      where: { id: achievementId },
      data: { title: dto.title?.trim(), description: dto.description?.trim(), icon: dto.icon, rule: dto.rule, position: dto.position },
      include: { _count: { select: { players: { where: { gameId } } } } },
    });
    return toAchievementConfig(atualizada);
  }

  async removeAchievement(user: RequestUser, gameId: string, achievementId: string): Promise<{ deleted: true }> {
    await this.access.assert(user, gameId, 'EDIT_INFO');
    await this.achievementOf(gameId, achievementId);
    await this.prisma.$transaction([
      this.prisma.playerGameAchievement.deleteMany({ where: { gameAchievementId: achievementId } }),
      this.prisma.gameAchievement.delete({ where: { id: achievementId } }),
    ]);
    return { deleted: true };
  }

  /** As conquistas que valem para todos os jogos (`gameId` nulo) não se editam pelo jogo. */
  private async achievementOf(gameId: string, achievementId: string) {
    const conquista = await this.prisma.gameAchievement.findFirst({ where: { id: achievementId, gameId } });
    if (!conquista) throw new NotFoundException({ message: 'Conquista não encontrada neste jogo.' });
    return conquista;
  }

  /**
   * Jogos no formato do contrato. As estatísticas saem dos testes, das
   * participações e das sessões de cada jogo (Tela 03, RN-03) — três consultas
   * para a lista inteira, não três por jogo.
   */
  async toGames(rows: GameRow[]): Promise<Game[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);

    const [testes, participacoes, sessoes] = await Promise.all([
      this.prisma.playtest.findMany({
        where: { gameId: { in: ids } },
        select: {
          gameId: true,
          status: true,
          slots: true,
          untilDisabled: true,
          currentParticipants: true,
          rewardPerSessionCents: true,
          estimatedMinutes: true,
          expiresAt: true,
        },
      }),
      this.prisma.participation.findMany({
        where: { playtest: { gameId: { in: ids } } },
        select: { status: true, rewardStatus: true, playtest: { select: { gameId: true } } },
      }),
      this.prisma.session.findMany({
        where: { participation: { playtest: { gameId: { in: ids } } } },
        select: { overallRating: true, bugsFound: true, participation: { select: { playtest: { select: { gameId: true } } } } },
      }),
    ]);

    return rows.map((row) => {
      const doJogo = testes.filter((teste) => teste.gameId === row.id);
      const abertos = doJogo.filter((teste) => teste.status === 'ACTIVE' || teste.status === 'FULL');
      const suasParticipacoes = participacoes.filter((p) => p.playtest.gameId === row.id);
      const suasSessoes = sessoes.filter((s) => s.participation.playtest.gameId === row.id);
      const recompensas = abertos.map((teste) => teste.rewardPerSessionCents);
      const prazos = abertos.flatMap((teste) => (teste.expiresAt ? [teste.expiresAt.getTime()] : []));

      const stats: GameStats = {
        activeTests: abertos.length,
        completedTests: doJogo.filter((teste) => teste.status === 'FINISHED').length,
        totalPlayers: sum(doJogo.map((teste) => teste.currentParticipants)),
        averageRating: round(average(suasSessoes.flatMap((s) => (s.overallRating === null ? [] : [s.overallRating])))),
        bugsReported: sum(suasSessoes.map((s) => s.bugsFound)),
        pendingRewards: suasParticipacoes.filter((p) => p.status === 'PENDING_REVIEW' && p.rewardStatus === 'PENDING').length,
        remainingRewardCents: sum(
          abertos
            .filter((teste) => !teste.untilDisabled)
            .map((teste) => Math.max(teste.slots - teste.currentParticipants, 0) * teste.rewardPerSessionCents),
        ),
        playingNow: suasParticipacoes.filter((p) => p.status === 'IN_PROGRESS').length,
        campaignProgress: round(
          ratio(sum(abertos.map((teste) => teste.currentParticipants)), sum(abertos.map((teste) => teste.slots))),
          2,
        ),
      };

      return {
        id: row.id,
        studioId: row.studioId,
        studioName: row.studio.name,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        shortDescription: row.shortDescription,
        bannerUrl: row.bannerUrl,
        thumbnailUrl: row.thumbnailUrl,
        logoUrl: row.logoUrl,
        trailerUrl: row.trailerUrl,
        status: row.status,
        genres: row.genres as Genre[],
        subGenres: row.subGenres,
        platforms: row.platforms as Platform[],
        gameModes: row.gameModes as GameMode[],
        engine: row.engine as GameEngine | null,
        developmentStage: row.developmentStage as DevelopmentStage | null,
        ageRating: row.ageRating as AgeRating | null,
        languages: row.languages,
        setupCompleted: row.setupCompletedAt !== null,
        buildVersion: row.buildVersion,
        minRewardCents: recompensas.length ? Math.min(...recompensas) : 0,
        maxRewardCents: recompensas.length ? Math.max(...recompensas) : 0,
        estimatedMinutes: row.estimatedMinutes || Math.round(average(abertos.map((teste) => teste.estimatedMinutes))),
        stats,
        endsAt: prazos.length ? new Date(Math.max(...prazos)).toISOString() : null,
        isNew: row.isNew,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        specs: row.specs as unknown as GameSpecs,
      };
    });
  }

  /**
   * Abas de "Jogos disponíveis". As duas primeiras ordenam por número
   * calculado (jogadores, prêmio), então a ordem sai depois do cálculo.
   */
  private async listTab(
    base: Prisma.GameWhereInput,
    tab: CatalogTab | undefined,
    query: PaginationQueryDto,
    playerId?: string,
  ): Promise<{ items: Game[]; total: number }> {
    const filtros: Prisma.GameWhereInput[] = [base];
    if (tab === 'NEW') filtros.push({ OR: [{ isNew: true }, { createdAt: { gte: daysAgo(DIAS_DE_NOVO) } }] });
    if (tab === 'ELITE') filtros.push({ playtests: { some: { status: { in: ['ACTIVE', 'FULL'] }, eliteOnly: true } } });
    if (tab === 'TOP_PAYING' || tab === 'POPULAR') filtros.push({ playtests: { some: { status: { in: ['ACTIVE', 'FULL'] } } } });
    if (tab === 'COMMUNITIES' && playerId) filtros.push({ playtests: { some: { participations: { some: { playerId } } } } });

    const rows = await this.prisma.game.findMany({
      where: { AND: filtros },
      include: comEstudio,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const games = await this.toGames(rows);
    if (tab === 'POPULAR') games.sort((a, b) => b.stats.totalPlayers - a.stats.totalPlayers || b.stats.playingNow - a.stats.playingNow);
    if (tab === 'TOP_PAYING') games.sort((a, b) => b.maxRewardCents - a.maxRewardCents);

    const { skip, take } = pageArgs(query);
    return { items: games.slice(skip, skip + take), total: games.length };
  }

  /**
   * O estúdio vê os jogos da organização que as permissões deixam; o jogador,
   * jogos publicados (na lista, só os ativos); a administração vê tudo.
   */
  private async visibleTo(user: RequestUser, uso: 'list' | 'detail', studioId?: string): Promise<Prisma.GameWhereInput> {
    if (user.role === 'STUDIO') return this.access.visibleGames(user);
    if (user.role === 'PLAYER') return uso === 'list' ? { status: 'ACTIVE' } : { status: { not: 'DRAFT' } };
    return studioId ? { studioId } : {};
  }
}

/** "Buscar jogo..." — no nome do jogo ou do estúdio, sem diferenciar maiúsculas. */
function buscaPor(search: string | undefined): Prisma.GameWhereInput {
  const termo = search?.trim();
  if (!termo) return {};
  return {
    OR: [
      { name: { contains: termo, mode: 'insensitive' } },
      { studio: { name: { contains: termo, mode: 'insensitive' } } },
      { genres: { has: termo } },
    ],
  };
}

function toAchievementConfig(
  c: Prisma.GameAchievementGetPayload<{ include: { _count: { select: { players: true } } } }>,
): GameAchievementConfig {
  return {
    id: c.id,
    gameId: c.gameId,
    title: c.title,
    description: c.description,
    icon: c.icon,
    rule: c.rule,
    position: c.position,
    unlockedCount: c._count.players,
  };
}

function notFound() {
  return new NotFoundException({ message: 'Jogo não encontrado.' });
}
