import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TestQuestion } from '@prisma/client';
import { ELITE_TIER, TEXT_QUESTION_TYPES } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import {
  DEFAULT_REWARD_BONUSES,
  DEFAULT_TIER_RULES,
  DEFAULT_XP_RULES,
} from '../../common/settings/settings.defaults';
import { SettingsService } from '../../common/settings/settings.service';
import { StorageService } from '../../common/storage/storage.service';
import { clamp, ratio, round } from '../../common/utils/numbers';
import { runsOn } from '../../common/utils/platform';
import type { Participation, Platform, QuestionType, SessionOutcome, SessionResult } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalysisService } from '../analysis/analysis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from './achievements.service';
import type { SubmitSessionDto } from './dto/submit-session.dto';
import { rewardFor, scoreFeedback, tierFor, xpFor, type AnswerValue } from './feedback-score';
import { participationInclude, toParticipation } from './participation.mapper';

/** Começar e enviar um teste — as duas escritas do jogador que mexem em vaga, XP e dinheiro. */
@Injectable()
export class ParticipationService {
  private readonly logger = new Logger(ParticipationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly analysis: AnalysisService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Reserva a vaga (Tela 16). Chamar de novo com a participação em andamento
   * devolve a mesma, sem ocupar outra vaga (Tela 14, RN-02).
   */
  async start(user: RequestUser, testId: string, platform: Platform | null = null): Promise<Participation> {
    const chave = { playtestId_playerId: { playtestId: testId, playerId: user.id } };
    const existente = await this.prisma.participation.findUnique({ where: chave, include: participationInclude });
    if (existente) {
      if (existente.status === 'IN_PROGRESS') return toParticipation(existente);
      throw indisponivel('Você já participou deste teste.');
    }

    const [teste, perfil] = await Promise.all([
      this.prisma.playtest.findUnique({
        where: { id: testId },
        include: {
          game: { select: { studio: { select: { balanceCents: true } } } },
          build: { select: { platforms: true } },
          retestInvites: { where: { playerId: user.id }, select: { id: true } },
        },
      }),
      this.prisma.playerProfile.findUnique({ where: { userId: user.id } }),
    ]);
    if (!teste || teste.status === 'DRAFT') throw new NotFoundException({ message: 'Teste não encontrado.' });
    if (!perfil) throw new ForbiddenException({ message: 'Esta conta não tem perfil de jogador.' });
    if (teste.status === 'FULL') throw semVagas();
    if (teste.status !== 'ACTIVE' || (teste.expiresAt && teste.expiresAt < new Date())) {
      throw indisponivel('Este teste não está disponível.');
    }
    // Convidado pelo "Solicitar novo teste" entra mesmo sendo ELITE-only.
    const convidado = teste.retestInvites.length > 0;
    if (teste.eliteOnly && perfil.tier !== ELITE_TIER && !convidado) {
      throw new ForbiddenException({ message: 'Este teste é exclusivo para testers ELITE.', code: ErrorCode.ELITE_ONLY });
    }
    if (!runsOn(teste.build?.platforms, platform)) {
      throw new ConflictException({ message: 'Indisponível para seu dispositivo.', code: ErrorCode.DEVICE_INCOMPATIBLE });
    }
    if (teste.untilDisabled && teste.game.studio.balanceCents < teste.pricePerTestCents) {
      throw indisponivel('Este teste não está disponível.');
    }

    try {
      const criada = await this.prisma.$transaction(async (tx) => {
        // Reserva atômica: dois jogadores na última vaga não entram os dois.
        const reservou = await tx.$executeRaw`
          UPDATE "Playtest" SET "currentParticipants" = "currentParticipants" + 1
          WHERE "id" = ${testId} AND "status" = 'ACTIVE' AND ("untilDisabled" OR "currentParticipants" < "slots")`;
        if (reservou === 0) throw semVagas();

        await tx.$executeRaw`
          UPDATE "Playtest" SET "status" = 'FULL'
          WHERE "id" = ${testId} AND NOT "untilDisabled" AND "currentParticipants" >= "slots"`;

        if (convidado) {
          await tx.retestInvite.updateMany({ where: { playtestId: testId, playerId: user.id }, data: { acceptedAt: new Date() } });
        }
        return tx.participation.create({
          data: { playtestId: testId, playerId: user.id, rewardCents: teste.rewardPerSessionCents },
          include: participationInclude,
        });
      });
      return toParticipation(criada);
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return toParticipation(await this.prisma.participation.findUniqueOrThrow({ where: chave, include: participationInclude }));
      }
      throw erro;
    }
  }

  /**
   * Envia a sessão (Tela 18 → 19). Tudo numa transação: nota, XP, nível,
   * recompensa pendente e conquistas saem juntos ou nenhum sai. Um segundo
   * envio devolve o resultado do primeiro (Tela 18 RN-03, Tela 19 RN-03).
   */
  async submit(user: RequestUser, testId: string, dto: SubmitSessionDto): Promise<SessionResult> {
    const participacao = await this.prisma.participation.findUnique({
      where: { playtestId_playerId: { playtestId: testId, playerId: user.id } },
      include: {
        session: { select: { result: true } },
        playtest: {
          include: {
            questions: { orderBy: { position: 'asc' } },
            game: { select: { id: true, name: true, studioId: true, developmentStage: true } },
          },
        },
      },
    });
    if (!participacao || participacao.id !== dto.participationId) {
      throw new NotFoundException({ message: 'Participação não encontrada.' });
    }
    if (participacao.session) return participacao.session.result as unknown as SessionResult;
    if (participacao.status !== 'IN_PROGRESS') {
      throw new ConflictException({ message: 'Esta participação não está em andamento.', code: ErrorCode.NOT_IN_PROGRESS });
    }

    const teste = participacao.playtest;
    const respostas = await this.storeFiles(participacao.id, teste.questions, requiredAnswers(teste.questions, dto.answers));
    // Só resposta escrita conta como texto na nota; data, hora, link de arquivo e escolhas contam como preenchidas.
    const paraNota = Object.fromEntries(
      teste.questions
        .filter((pergunta) => pergunta.id in respostas)
        .map((pergunta) => [pergunta.id, TEXT_QUESTION_TYPES.includes(pergunta.type as QuestionType) ? respostas[pergunta.id] : true]),
    ) as Record<string, AnswerValue>;
    const feedback = scoreFeedback(paraNota, dto.bugsReported);
    // "Feedback completo": toda pergunta do formulário respondida.
    const completo = teste.questions.every((pergunta) => pergunta.id in respostas);
    const [regrasXp, bonus, regrasTier] = await Promise.all([
      this.settings.get('xpRules', DEFAULT_XP_RULES),
      this.settings.get('rewardBonuses', DEFAULT_REWARD_BONUSES),
      this.settings.get('tierRules', DEFAULT_TIER_RULES),
    ]);
    const xp = xpFor(regrasXp, completo, dto.bugsReported);
    const credito = rewardFor(teste.rewardPerSessionCents, bonus, completo, dto.bugsReported);
    const recompensa = credito.totalCents;
    const maiorTexto = Math.max(0, ...Object.values(paraNota).map((v) => (typeof v === 'string' ? v.trim().length : 0)));

    let resultado: SessionResult;
    let sessionId: string;
    try {
      ({ resultado, sessionId } = await this.prisma.$transaction(async (tx) => {
        const perfil = await tx.playerProfile.findUniqueOrThrow({ where: { userId: user.id } });
        const bruto = perfil.xp + xp.total;
        const subiu = bruto >= perfil.xpToNextLevel;
        const newLevel = subiu ? perfil.level + 1 : perfil.level;
        const newXp = subiu ? bruto - perfil.xpToNextLevel : bruto;
        const proximoNivel = subiu ? Math.round(perfil.xpToNextLevel * 1.2) : perfil.xpToNextLevel;
        const anteriores = perfil.completedSessions;
        const novaNota = round((perfil.rating * anteriores + feedback.total) / (anteriores + 1));

        await tx.playerProfile.update({
          where: { userId: user.id },
          data: {
            xp: newXp,
            level: newLevel,
            xpToNextLevel: proximoNivel,
            completedSessions: { increment: 1 },
            secondsPlayed: { increment: dto.durationSeconds },
            pendingBalanceCents: { increment: recompensa },
            rating: novaNota,
            tier: tierFor(perfil.tier, newLevel, novaNota, regrasTier),
          },
        });

        await tx.participation.update({
          where: { id: participacao.id },
          data: {
            status: 'PENDING_REVIEW',
            rewardStatus: 'PENDING',
            rewardCents: recompensa,
            xpEarned: xp.total,
            finishedAt: new Date(),
            durationSeconds: dto.durationSeconds,
            progress: 1,
          },
        });

        // A recompensa entra pendente: vai ao saldo quando o estúdio validar (Tela 19, RN-04).
        if (recompensa > 0) {
          await tx.ledgerEntry.create({
            data: {
              playerId: user.id,
              type: 'REWARD',
              status: 'PENDING',
              amountCents: recompensa,
              description: `${teste.game.name} — ${teste.title}`,
              participationId: participacao.id,
            },
          });
        }

        // Sem limite de quantidade, cada sessão sai do saldo do estúdio; sem saldo, o teste pausa.
        if (teste.untilDisabled) {
          const estudio = await tx.studio.update({
            where: { id: teste.game.studioId },
            data: { balanceCents: { decrement: teste.pricePerTestCents } },
          });
          if (estudio.balanceCents < teste.pricePerTestCents) {
            await tx.playtest.update({ where: { id: teste.id }, data: { status: 'PAUSED' } });
          }
        }

        const conquistas = await this.achievements.unlockAfterSession(tx, user.id, teste.game.id, {
          longestText: maiorTexto,
          developmentStage: teste.game.developmentStage,
        });
        const agora = new Date().toISOString();

        const resultado: SessionResult = {
          participationId: participacao.id,
          xpEarned: xp.total,
          newXp,
          newLevel,
          leveledUp: subiu,
          rewardCents: recompensa,
          rewardStatus: 'PENDING',
          unlockedAchievements: conquistas.global.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            icon: c.icon,
            xp: c.xp,
            unlockedAt: agora,
          })),
          feedbackQuality: feedback.total,
        };

        const outcome: SessionOutcome = {
          gameId: teste.game.id,
          gameName: teste.game.name,
          achievements: [
            ...conquistas.game.map((c) => ({ id: c.id, name: c.title, description: c.description })),
            ...conquistas.global.map((c) => ({ id: c.id, name: c.name, description: c.description })),
          ],
          feedbackQuality: { total: feedback.total, lines: feedback.lines },
          level: {
            from: perfil.level,
            to: newLevel,
            gainedXp: xp.total,
            progress: round(clamp(ratio(newXp, proximoNivel), 0, 1), 2),
            lines: xp.lines,
          },
          reward: { totalCents: recompensa, lines: credito.lines },
        };

        const sessao = await tx.session.create({
          data: {
            participationId: participacao.id,
            durationSeconds: dto.durationSeconds,
            bugsFound: dto.bugsReported,
            feedbackQuality: feedback.total,
            overallRating: ratingFrom(teste.questions, respostas),
            formSeconds: dto.formSeconds,
            answers: respostas as Prisma.InputJsonValue,
            outcome: outcome as unknown as Prisma.InputJsonValue,
            result: resultado as unknown as Prisma.InputJsonValue,
          },
        });

        // O sino: conquista para o jogador, sessão nova para quem vê os relatórios.
        const liberadas = [...conquistas.game.map((c) => c.title), ...conquistas.global.map((c) => c.name)];
        if (liberadas.length) {
          await this.notifications.notify(
            user.id,
            {
              type: 'ACHIEVEMENT_UNLOCKED',
              title: liberadas.length > 1 ? 'Novas conquistas!' : 'Nova conquista!',
              body: liberadas.join(', '),
              link: `/player/games/${teste.game.id}`,
              data: { gameId: teste.game.id },
            },
            tx,
          );
        }
        await this.notifications.notifyGameTeam(
          teste.game.id,
          'VIEW_REPORTS',
          {
            type: 'SESSION_SUBMITTED',
            title: 'Nova sessão para validar',
            body: `Um tester enviou "${teste.title}" de ${teste.game.name}.`,
            link: `/studio/reports/${teste.id}/sessions/${sessao.id}`,
            data: { testId: teste.id, sessionId: sessao.id },
          },
          tx,
        );

        return { resultado, sessionId: sessao.id };
      }));
    } catch (erro) {
      // Dois envios ao mesmo tempo: o segundo cai na chave única e recebe o do primeiro.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        const sessao = await this.prisma.session.findUnique({ where: { participationId: participacao.id } });
        if (sessao) return sessao.result as unknown as SessionResult;
      }
      throw erro;
    }

    // A análise roda depois do commit e não atrasa a resposta.
    void this.analysis.analyzeSession(sessionId).catch((erro) => this.logger.error(erro));
    return resultado;
  }

  /**
   * "Envio de arquivo": o app manda a imagem em data URL; ela vira arquivo em
   * `public/respostas/<participação>/` e a resposta guarda a URL.
   */
  private async storeFiles(
    participationId: string,
    perguntas: TestQuestion[],
    respostas: Record<string, AnswerValue>,
  ): Promise<Record<string, AnswerValue>> {
    const gravadas = { ...respostas };
    for (const pergunta of perguntas) {
      const valor = gravadas[pergunta.id];
      if (pergunta.type !== 'FILE_UPLOAD' || typeof valor !== 'string' || !valor.startsWith('data:')) continue;
      const key = await this.storage.storeDataUrl(valor, `respostas/${participationId}/${pergunta.id}-${Date.now()}`, 'public');
      gravadas[pergunta.id] = this.storage.publicUrl(key);
    }
    return gravadas;
  }
}

/**
 * Só ficam as respostas de perguntas do teste; obrigatória em branco recusa o
 * envio, com o erro no campo (Tela 07 RN-04, Tela 18 RN-01).
 */
function requiredAnswers(perguntas: TestQuestion[], respostas: Record<string, AnswerValue>): Record<string, AnswerValue> {
  const limpas: Record<string, AnswerValue> = {};
  const faltando: Record<string, string> = {};

  for (const pergunta of perguntas) {
    const valor = respostas[pergunta.id];
    const vazia =
      valor === undefined ||
      valor === null ||
      (typeof valor === 'string' && !valor.trim()) ||
      (Array.isArray(valor) && valor.length === 0);
    if (vazia) {
      if (pergunta.required) faltando[`answers.${pergunta.id}`] = 'Resposta obrigatória.';
      continue;
    }
    limpas[pergunta.id] = valor;
  }

  if (Object.keys(faltando).length) {
    throw new BadRequestException({
      message: 'Responda as perguntas obrigatórias.',
      code: ErrorCode.REQUIRED_ANSWERS,
      fields: faltando,
    });
  }
  return limpas;
}

/** A primeira pergunta de escala, levada para 0 a 5 — vira a nota da sessão. */
function ratingFrom(perguntas: TestQuestion[], respostas: Record<string, AnswerValue>): number | null {
  for (const pergunta of perguntas) {
    if (pergunta.type !== 'LINEAR_SCALE' && pergunta.type !== 'RATING') continue;
    const valor = Number(respostas[pergunta.id]);
    if (!Number.isFinite(valor)) continue;
    const min = pergunta.scaleMin ?? 1;
    const max = pergunta.scaleMax ?? 5;
    return round(clamp(ratio(valor - min, max - min), 0, 1) * 5);
  }
  return null;
}

function semVagas() {
  return new ConflictException({ message: 'Este teste não tem mais vagas.', code: ErrorCode.NO_SLOTS });
}

function indisponivel(mensagem: string) {
  return new ConflictException({ message: mensagem, code: ErrorCode.TEST_UNAVAILABLE });
}
