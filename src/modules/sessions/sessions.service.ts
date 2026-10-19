import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import { GameAccessService } from '../../common/access/game-access.service';
import { studioIdOf } from '../../common/access/studio-scope';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { pageArgs } from '../../common/pagination/pagination';
import { StorageService } from '../../common/storage/storage.service';
import { formatBRL } from '../../common/utils/money';
import type { RetestInviteInfo, Session } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../player/achievements.service';
import type { RetestDto } from './dto/retest.dto';
import type { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import type { SessionFeedbackDto } from './dto/session-feedback.dto';
import type { SessionValidationDto } from './dto/session-validation.dto';
import { sessionInclude, toSession, type SessionRow } from './session.mapper';

const FINALIDADE_VIDEO = 'session-video';
const VIDEO_TTL_SEGUNDOS = 3600;

/** Sessões enviadas, na visão do estúdio dono do teste (Tela 12, RN-01). */
@Injectable()
export class SessionsService {
  private readonly publicApiUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly storage: StorageService,
    private readonly access: GameAccessService,
    private readonly achievements: AchievementsService,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.publicApiUrl = config.getOrThrow<string>('app.publicApiUrl');
  }

  async list(user: RequestUser, query: ListSessionsQueryDto): Promise<{ items: Session[]; total: number }> {
    if (query.testId) await this.access.assertForTest(user, query.testId, 'VIEW_REPORTS');
    const where: Prisma.SessionWhereInput = {
      participation: {
        playtest: { game: this.access.visibleGames(user), ...(query.testId ? { id: query.testId } : {}) },
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.session.findMany({ where, include: sessionInclude, orderBy: { submittedAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.session.count({ where }),
    ]);
    return { items: await Promise.all(rows.map((row) => this.withVideo(row))), total };
  }

  async findOne(user: RequestUser, id: string): Promise<Session> {
    await this.access.assertForSession(user, id, 'VIEW_REPORTS');
    return this.withVideo(await this.findOwnedRow(studioIdOf(user), id));
  }

  /** Caminho do vídeo, conferindo o link temporário. */
  async videoPath(sessionId: string, token: string | undefined): Promise<string> {
    try {
      const { sub, purpose } = await this.jwt.verifyAsync<{ sub: string; purpose: string }>(token ?? '');
      if (purpose !== FINALIDADE_VIDEO || sub !== sessionId) throw new Error('finalidade');
    } catch {
      throw new UnauthorizedException({ message: 'Link do vídeo inválido ou expirado.' });
    }

    const sessao = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { participation: { select: { videoKey: true } } },
    });
    const key = sessao?.participation.videoKey;
    if (!key) throw new NotFoundException({ message: 'Esta sessão não tem gravação.' });
    return this.storage.pathOf(key, 'private');
  }

  /**
   * Aprova ou recusa a sessão. Aprovada, a recompensa sai de "em análise" e vai
   * ao saldo do jogador; recusada, é cancelada (Tela 19, RN-01 e RN-04). Uma
   * decisão só: repetir recebe 409.
   */
  async validate(user: RequestUser, id: string, { approved, note }: SessionValidationDto): Promise<Session> {
    await this.access.assertForSession(user, id, 'MANAGE_TESTS');
    const sessao = await this.findOwnedRow(studioIdOf(user), id);
    const participacao = sessao.participation;
    if (participacao.rewardStatus !== 'PENDING') {
      throw new ConflictException({ message: 'Esta sessão já foi avaliada.', code: ErrorCode.SESSION_ALREADY_VALIDATED });
    }

    await this.prisma.$transaction(async (tx) => {
      // Só a primeira decisão passa, mesmo com dois cliques ao mesmo tempo.
      const { count } = await tx.participation.updateMany({
        where: { id: participacao.id, rewardStatus: 'PENDING' },
        data: approved
          ? { status: 'COMPLETED', rewardStatus: 'VALIDATED' }
          : { status: 'REJECTED', rewardStatus: 'REJECTED' },
      });
      if (count === 0) {
        throw new ConflictException({ message: 'Esta sessão já foi avaliada.', code: ErrorCode.SESSION_ALREADY_VALIDATED });
      }

      await tx.ledgerEntry.updateMany({
        where: { participationId: participacao.id },
        data: { status: approved ? 'AVAILABLE' : 'CANCELED' },
      });
      await tx.playerProfile.update({
        where: { userId: participacao.playerId },
        data: {
          pendingBalanceCents: { decrement: participacao.rewardCents },
          ...(approved ? { balanceCents: { increment: participacao.rewardCents } } : {}),
        },
      });
      await tx.session.update({
        where: { id },
        data: { validatedAt: new Date(), validatedById: user.id, validationNote: note },
      });

      // "Corrida que Paga" (primeiro pagamento no jogo) e "Caçador de Bugs"
      // (bug numa sessão que o estúdio aprovou).
      const gameId = participacao.playtest.gameId;
      const liberadas = approved
        ? await this.achievements.unlockGameRules(tx, participacao.playerId, gameId, [
            'GAME_FIRST_REWARD',
            ...(sessao.bugsFound > 0 ? ['BUG_CONFIRMED'] : []),
          ])
        : [];

      await this.notifications.notify(
        participacao.playerId,
        approved
          ? {
              type: 'REWARD_RELEASED',
              title: 'Recompensa liberada!',
              body: `${formatBRL(participacao.rewardCents)} de ${participacao.playtest.game.name} já estão no seu saldo.`,
              link: '/player/wallet',
              data: { sessionId: id, gameId, rewardCents: participacao.rewardCents, achievements: liberadas.map((c) => c.title) },
            }
          : {
              type: 'REWARD_REJECTED',
              title: 'Sessão não aprovada',
              body: note ? `O estúdio recusou a sessão: ${note}` : `O estúdio de ${participacao.playtest.game.name} recusou a sessão.`,
              link: `/player/games/${gameId}`,
              data: { sessionId: id, gameId },
            },
        tx,
      );
    });

    return this.findOne(user, id);
  }

  /** "Avaliar/agradecer" (Tela 12). */
  async feedback(user: RequestUser, id: string, { rating, message }: SessionFeedbackDto): Promise<Session> {
    await this.access.assertForSession(user, id, 'MANAGE_TESTS');
    const sessao = await this.findOwnedRow(studioIdOf(user), id);
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id }, data: { studioRating: rating, studioMessage: message } });
      await this.notifications.notify(
        sessao.participation.playerId,
        {
          type: 'STUDIO_THANKS',
          title: `${sessao.participation.playtest.game.name} agradeceu seu teste!`,
          body: message?.trim() || `O estúdio deu nota ${rating} de 5 ao seu feedback.`,
          link: `/player/games/${sessao.participation.playtest.gameId}`,
          data: { sessionId: id, rating },
        },
        tx,
      );
    });
    return this.findOne(user, id);
  }

  /**
   * "Solicitar novo teste" (Figma `329:9178`): chama o mesmo tester para outro
   * teste ativo do jogo. O convite passa pelos filtros de público daquele teste.
   */
  async requestRetest(user: RequestUser, id: string, dto: RetestDto): Promise<RetestInviteInfo> {
    const gameId = await this.access.assertForSession(user, id, 'MANAGE_TESTS');
    const sessao = await this.findOwnedRow(studioIdOf(user), id);
    const playerId = sessao.participation.playerId;

    const alvo = await this.prisma.playtest.findFirst({
      where: {
        gameId,
        status: { in: ['ACTIVE', 'FULL'] },
        ...(dto.testId ? { id: dto.testId } : {}),
        participations: { none: { playerId } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true },
    });
    if (!alvo) {
      throw new UnprocessableEntityException({
        message: dto.testId
          ? 'Esse teste não está aberto ou o tester já participou dele.'
          : 'Não há outro teste aberto deste jogo que o tester ainda não tenha feito. Publique um novo teste e convide de novo.',
        code: ErrorCode.RETEST_NOT_ALLOWED,
      });
    }

    const convite = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.retestInvite.upsert({
        where: { playtestId_playerId: { playtestId: alvo.id, playerId } },
        create: { sessionId: id, playerId, playtestId: alvo.id, message: dto.message?.trim() || null },
        update: { sessionId: id, message: dto.message?.trim() || null },
      });
      await this.notifications.notify(
        playerId,
        {
          type: 'RETEST_INVITE',
          title: 'Convite para um novo teste',
          body: dto.message?.trim() || `${sessao.participation.playtest.game.name} quer que você teste "${alvo.title}".`,
          link: `/player/games/${gameId}`,
          data: { testId: alvo.id, gameId },
        },
        tx,
      );
      return criado;
    });

    return {
      id: convite.id,
      sessionId: id,
      testId: alvo.id,
      testTitle: alvo.title,
      playerId,
      message: convite.message,
      createdAt: convite.createdAt.toISOString(),
    };
  }

  private async findOwnedRow(studioId: string, id: string): Promise<SessionRow> {
    const row = await this.prisma.session.findFirst({
      where: { id, participation: { playtest: { game: { studioId } } } },
      include: sessionInclude,
    });
    if (!row) throw new NotFoundException({ message: 'Sessão não encontrada.' });
    return row;
  }

  /** O `<video>` do app não manda o token, então a URL leva um link que vale uma hora. */
  private async withVideo(row: SessionRow): Promise<Session> {
    if (!row.participation.videoKey) return toSession(row, null);
    const token = await this.jwt.signAsync({ sub: row.id, purpose: FINALIDADE_VIDEO }, { expiresIn: VIDEO_TTL_SEGUNDOS });
    return toSession(row, `${this.publicApiUrl}/sessions/${row.id}/video?token=${token}`);
  }
}
