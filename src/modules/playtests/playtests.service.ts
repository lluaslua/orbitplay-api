import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type Build, type TestModel } from '@prisma/client';
import { GameAccessService } from '../../common/access/game-access.service';
import { studioIdOf } from '../../common/access/studio-scope';
import { GRID_QUESTION_TYPES, TEST_MODEL_LABELS } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { pageArgs } from '../../common/pagination/pagination';
import { addDays } from '../../common/utils/dates';
import type { Playtest } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService } from '../pricing/pricing.service';
import type { CreatePlaytestDto } from './dto/create-playtest.dto';
import type { ListPlaytestsQueryDto } from './dto/list-playtests-query.dto';
import { KIND_BY_MODEL, playtestInclude, toPlaytest, type PlaytestRow } from './playtest.mapper';

@Injectable()
export class PlaytestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GameAccessService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(user: RequestUser, query: ListPlaytestsQueryDto): Promise<{ items: Playtest[]; total: number }> {
    const where: Prisma.PlaytestWhereInput = {
      game: this.access.visibleGames(user),
      ...(query.gameId ? { gameId: query.gameId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.playtest.findMany({ where, include: playtestInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.playtest.count({ where }),
    ]);
    return { items: rows.map(toPlaytest), total };
  }

  async findOne(user: RequestUser, id: string): Promise<Playtest> {
    const row = await this.prisma.playtest.findFirst({ where: { id, game: this.access.visibleGames(user) }, include: playtestInclude });
    if (!row) throw new NotFoundException({ message: 'Teste não encontrado.' });
    return toPlaytest(row);
  }

  /** Teste de um jogo da organização, ou 404. */
  async findOwnedRow(studioId: string, id: string): Promise<PlaytestRow> {
    const row = await this.prisma.playtest.findFirst({ where: { id, game: { studioId } }, include: playtestInclude });
    if (!row) throw new NotFoundException({ message: 'Teste não encontrado.' });
    return row;
  }

  /**
   * Publica o rascunho do stepper como DRAFT — ele só vai a ACTIVE quando o
   * pedido for pago (Tela 10, RN-01). Tudo o que o app mandou de preço é
   * ignorado: o orçamento sai do PricingService (Tela 09, RN-06).
   */
  async create(user: RequestUser, dto: CreatePlaytestDto): Promise<Playtest> {
    const game = await this.access.assert(user, dto.gameId, 'MANAGE_TESTS');
    // O jogo recebe teste depois do "Finalizar" do cadastro (Figma `1187:9418`).
    if (!game.setupCompletedAt) {
      throw new UnprocessableEntityException({
        message: 'Finalize o cadastro do jogo antes de criar um teste.',
        code: ErrorCode.GAME_SETUP_INCOMPLETE,
      });
    }

    if (dto.audience.minAge > dto.audience.maxAge) {
      throw invalido('audience.minAge', 'A idade mínima passa da máxima.');
    }
    const ids = dto.questions.map((pergunta) => pergunta.id);
    if (new Set(ids).size !== ids.length) throw invalido('questions', 'Há perguntas com o mesmo id.');
    dto.questions.forEach((pergunta, i) => {
      if (GRID_QUESTION_TYPES.includes(pergunta.type) && !pergunta.options?.some((linha) => linha.trim())) {
        throw invalido(`questions.${i}.options`, 'Adicione pelo menos uma linha.');
      }
    });

    const build = await this.assertBuildFits(game.id, dto.model, dto.buildId);
    const budget = await this.pricing.quote({
      model: dto.model,
      playerType: dto.audience.playerType,
      boost: dto.budget.boostCents > 0,
      slots: dto.budget.slots,
      untilDisabled: dto.budget.untilDisabled,
      rewardPerSessionCents: dto.budget.rewardPerSessionCents,
      durationDays: dto.budget.durationDays,
    });

    const row = await this.prisma.playtest.create({
      data: {
        gameId: game.id,
        buildId: build?.id,
        createdById: user.id,
        title: dto.title.trim() || `${TEST_MODEL_LABELS[dto.model]} — ${game.name}`,
        model: dto.model,
        status: 'DRAFT',
        kind: KIND_BY_MODEL[dto.model],
        plugin: dto.model === 'TELEMETRY',
        instructions: dto.instructions,
        requiresRecording: dto.requiresRecording,
        requiresMicrophone: dto.requiresMicrophone,
        requiresWebcam: dto.requiresWebcam,
        requiresController: dto.requiresController ?? false,
        eliteOnly: dto.eliteOnly ?? false,
        locations: dto.audience.locations,
        playerType: dto.audience.playerType,
        archetype: dto.audience.archetype,
        minAge: dto.audience.minAge,
        maxAge: dto.audience.maxAge,
        ...budget,
        estimatedMinutes: game.estimatedMinutes || 25,
        buildFileName: build?.fileName ?? '',
        buildSizeMb: build?.sizeMb ?? 0,
        questions: {
          create: dto.questions.map((pergunta, position) => ({
            id: pergunta.id,
            position,
            type: pergunta.type,
            label: pergunta.label.trim(),
            helperText: pergunta.helperText,
            required: pergunta.required,
            imageUrl: pergunta.imageUrl,
            options: pergunta.options ?? [],
            columns: GRID_QUESTION_TYPES.includes(pergunta.type) ? (pergunta.columns ?? []) : [],
            scaleMin: pergunta.scaleMin,
            scaleMax: pergunta.scaleMax,
            scaleMinLabel: pergunta.scaleMinLabel,
            scaleMaxLabel: pergunta.scaleMaxLabel,
          })),
        },
      },
      include: playtestInclude,
    });
    return toPlaytest(row);
  }

  /**
   * A build do teste: enviada, validada e compatível com o modelo (Tela 08,
   * RN-01 a RN-03). O A/B de imagens é o único que roda sem build.
   */
  async assertBuildFits(gameId: string, model: TestModel, buildId: string | null | undefined): Promise<Build | null> {
    if (!buildId) {
      if (model === 'AB_IMAGES') return null;
      throw new UnprocessableEntityException({
        message: 'Envie a build e espere a validação antes de publicar o teste.',
        code: ErrorCode.BUILD_NOT_READY,
        fields: { buildId: 'Envie a build.' },
      });
    }

    const build = await this.prisma.build.findFirst({ where: { id: buildId, gameId } });
    if (!build || build.status === 'PROCESSING') {
      throw new UnprocessableEntityException({
        message: build ? 'A build ainda está sendo processada.' : 'Build não encontrada para este jogo.',
        code: ErrorCode.BUILD_NOT_READY,
      });
    }
    if (build.status === 'INVALID') {
      throw new UnprocessableEntityException({
        message: build.error ?? 'A build foi recusada. Envie outra.',
        code: ErrorCode.BUILD_INVALID,
      });
    }
    if (model === 'TELEMETRY' && !build.pluginEnabled) {
      throw new UnprocessableEntityException({
        message: 'O modelo com telemetria exige a build com o Orbit Plug-in detectado e ativo.',
        code: ErrorCode.PLUGIN_REQUIRED,
      });
    }
    if (model !== 'TELEMETRY' && build.pluginEnabled) {
      throw new UnprocessableEntityException({
        message: 'Esta build tem o Orbit Plug-in ativo, mas o modelo escolhido não usa telemetria. Troque o modelo ou remova o plug-in.',
        code: ErrorCode.PLUGIN_INCOMPATIBLE,
      });
    }
    return build;
  }

  /** Pausar e retomar. Retomar teste lotado volta a FULL, não a ACTIVE. */
  async setStatus(user: RequestUser, id: string, status: 'PAUSED' | 'ACTIVE'): Promise<Playtest> {
    const row = await this.findOwnedRow(studioIdOf(user), id);
    await this.access.assert(user, row.gameId, 'MANAGE_TESTS');

    if (status === 'PAUSED' && row.status !== 'ACTIVE' && row.status !== 'FULL') {
      throw naoEditavel('Só um teste em andamento pode ser pausado.');
    }
    if (status === 'ACTIVE') {
      if (row.status !== 'PAUSED') throw naoEditavel('Só um teste pausado pode ser retomado.');
      if (row.expiresAt && row.expiresAt < new Date()) throw naoEditavel('O prazo deste teste já acabou.');
    }

    const lotado = !row.untilDisabled && row.currentParticipants >= row.slots;
    const novo = status === 'PAUSED' ? 'PAUSED' : lotado ? 'FULL' : 'ACTIVE';
    return toPlaytest(await this.prisma.playtest.update({ where: { id }, data: { status: novo }, include: playtestInclude }));
  }

  /**
   * "Finalizar teste": sai do catálogo e fecha o relatório. Fica PROCESSING
   * enquanto houver sessão sem análise (Tela 05, RN-02). Repetir não muda nada.
   */
  async finish(user: RequestUser, id: string): Promise<Playtest> {
    const row = await this.findOwnedRow(studioIdOf(user), id);
    await this.access.assert(user, row.gameId, 'MANAGE_TESTS');
    if (row.status === 'FINISHED' || row.status === 'PROCESSING') return toPlaytest(row);
    if (row.status === 'DRAFT') throw naoEditavel('Este teste ainda não foi publicado.');

    const pendentes = await this.prisma.session.count({
      where: { participation: { playtestId: id }, analysis: { equals: Prisma.DbNull } },
    });
    const encerrado = await this.prisma.playtest.update({
      where: { id },
      data: { status: pendentes ? 'PROCESSING' : 'FINISHED', endedAt: new Date() },
      include: playtestInclude,
    });
    if (encerrado.status === 'FINISHED') await this.notifications.reportReady(id);
    return toPlaytest(encerrado);
  }

  /** Chamado pelo pagamento confirmado, na mesma transação que marca o pedido como pago. */
  async activateInTransaction(
    tx: Prisma.TransactionClient,
    playtest: { id: string; gameId: string; durationDays: number },
  ): Promise<void> {
    const agora = new Date();
    const publicado = await tx.playtest.update({
      where: { id: playtest.id },
      data: { status: 'ACTIVE', startsAt: agora, expiresAt: addDays(agora, playtest.durationDays) },
    });
    await tx.game.updateMany({ where: { id: playtest.gameId, status: 'DRAFT' }, data: { status: 'ACTIVE' } });
    await this.notifications.notifyGameTeam(
      playtest.gameId,
      'MANAGE_TESTS',
      {
        type: 'TEST_PUBLISHED',
        title: 'Teste publicado',
        body: `"${publicado.title}" está no catálogo e já recebe testers.`,
        link: `/studio/games/${playtest.gameId}`,
        data: { testId: playtest.id, gameId: playtest.gameId },
      },
      tx,
    );
  }
}

function invalido(campo: string, mensagem: string) {
  return new BadRequestException({
    message: 'Confira os campos destacados.',
    code: ErrorCode.VALIDATION_ERROR,
    fields: { [campo]: mensagem },
  });
}

function naoEditavel(mensagem: string) {
  return new UnprocessableEntityException({ message: mensagem, code: ErrorCode.TEST_NOT_EDITABLE });
}
