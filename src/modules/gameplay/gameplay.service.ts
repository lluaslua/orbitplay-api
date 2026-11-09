import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { assertPlausibleEvents } from '../../common/security/telemetry-limits';
import { StorageService } from '../../common/storage/storage.service';
import { VIDEO_TYPES } from '../../common/storage/upload-filters';
import { DEFAULT_PLAY_RULES } from '../../common/settings/settings.defaults';
import { SettingsService } from '../../common/settings/settings.service';
import { clamp } from '../../common/utils/numbers';
import type { PlayStatus } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConsentDto } from './dto/consent.dto';
import type { SessionEventDto } from './dto/events.dto';
import type { PlayCloseDto } from './dto/play.dto';
import { creditedSeconds, playStatus } from './play-status';

/**
 * O que acontece entre "Começar" e o formulário (Telas 16 e 17): o
 * consentimento, o progresso, os eventos com o tempo da sessão e a gravação.
 */
@Injectable()
export class GameplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
  ) {}

  /** O que o modelo exige tem de ser aceito antes de a gravação começar (Tela 16 RN-02, Tela 17 RN-01). */
  async consent(user: RequestUser, participationId: string, dto: ConsentDto): Promise<{ consentAt: string }> {
    const participacao = await this.inProgress(user, participationId);
    const teste = participacao.playtest;

    const faltando: Record<string, string> = {};
    if (teste.requiresRecording && !dto.recording) faltando.recording = 'Este teste exige gravação da tela.';
    if (teste.requiresMicrophone && !dto.microphone) faltando.microphone = 'Este teste exige o microfone.';
    if (teste.requiresWebcam && !dto.webcam) faltando.webcam = 'Este teste exige a webcam.';
    if (Object.keys(faltando).length) {
      throw new UnprocessableEntityException({
        message: 'Aceite as permissões que o teste exige para continuar.',
        code: ErrorCode.CONSENT_REQUIRED,
        fields: faltando,
      });
    }

    const atualizada = await this.prisma.participation.update({
      where: { id: participacao.id },
      data: { consentAt: participacao.consentAt ?? new Date() },
    });
    return { consentAt: atualizada.consentAt!.toISOString() };
  }

  async progress(user: RequestUser, participationId: string, progress: number): Promise<{ progress: number }> {
    const participacao = await this.inProgress(user, participationId);
    const atualizada = await this.prisma.participation.update({
      where: { id: participacao.id },
      data: { progress: clamp(progress, 0, 1) },
    });
    return { progress: atualizada.progress };
  }

  /** Bugs, checkpoints, microfone/webcam e gatilhos do plug-in, com o segundo da sessão (Tela 17, RN-04). */
  async events(user: RequestUser, participationId: string, eventos: SessionEventDto[]): Promise<{ received: number }> {
    const participacao = await this.inProgress(user, participationId);
    assertPlausibleEvents(
      eventos,
      participacao.startedAt,
      await this.prisma.sessionEvent.count({ where: { participationId: participacao.id } }),
    );
    const { count } = await this.prisma.sessionEvent.createMany({
      data: eventos.map((evento) => ({
        participationId: participacao.id,
        atSecond: evento.atSecond,
        type: evento.type,
        label: evento.label,
        detail: evento.detail,
        payload: evento.payload as Prisma.InputJsonValue | undefined,
      })),
    });
    return { received: count };
  }

  /**
   * Gravação da sessão. Pode chegar depois do formulário — o upload de vídeo
   * demora —, mas nunca sem o consentimento.
   */
  async recording(user: RequestUser, participationId: string, file: Express.Multer.File): Promise<{ uploaded: true }> {
    try {
      const participacao = await this.own(user, participationId);
      if (participacao.status !== 'IN_PROGRESS' && participacao.status !== 'PENDING_REVIEW') {
        throw new ConflictException({ message: 'Esta participação não aceita mais gravação.', code: ErrorCode.NOT_IN_PROGRESS });
      }
      if (!participacao.consentAt) {
        throw new UnprocessableEntityException({
          message: 'A gravação só pode ser enviada depois do consentimento.',
          code: ErrorCode.CONSENT_REQUIRED,
        });
      }

      const key = `recordings/${participacao.id}/${Date.now()}${VIDEO_TYPES[file.mimetype]}`;
      await this.storage.store(file.path, key, 'private');
      await this.prisma.participation.update({ where: { id: participacao.id }, data: { videoKey: key } });
      if (participacao.videoKey) await this.storage.remove(participacao.videoKey, 'private');
    } finally {
      await rm(file.path, { force: true });
    }
    return { uploaded: true };
  }

  // --- O jogo aberto pelo app (Tela 17) -------------------------------------

  /** O app abriu a build. Começa a contar a partir daqui: as batidas só valem com o jogo aberto. */
  async openGame(user: RequestUser, participationId: string): Promise<PlayStatus> {
    const participacao = await this.inProgress(user, participationId);
    if (!participacao.playtest.buildId) {
      throw new ConflictException({ message: 'Este teste não tem jogo para abrir.', code: ErrorCode.NOT_IN_PROGRESS });
    }
    const atualizada = await this.prisma.participation.update({
      where: { id: participacao.id },
      data: { launchCount: { increment: 1 }, lastHeartbeatAt: new Date(), lastExitCode: null },
    });
    return this.status(atualizada, participacao.playtest.estimatedMinutes);
  }

  /** Batida a cada 30s com o jogo aberto: soma o tempo ativo, limitado pelo relógio do servidor. */
  async heartbeat(user: RequestUser, participationId: string, activeSeconds: number): Promise<PlayStatus> {
    const participacao = await this.inProgress(user, participationId);
    const atualizada = await this.credit(participacao, activeSeconds, {});
    return this.status(atualizada, participacao.playtest.estimatedMinutes);
  }

  /**
   * O jogo fechou. Fechar com erro vira um BUG na linha do tempo da sessão: o
   * estúdio vê o travamento mesmo que o jogador não conte.
   */
  async closeGame(user: RequestUser, participationId: string, dto: PlayCloseDto): Promise<PlayStatus> {
    const participacao = await this.inProgress(user, participationId);
    const atualizada = await this.credit(participacao, dto.activeSeconds, { lastHeartbeatAt: null, lastExitCode: dto.exitCode });
    if (dto.exitCode) {
      await this.prisma.sessionEvent.create({
        data: {
          participationId: participacao.id,
          atSecond: atualizada.activeSeconds,
          type: 'BUG',
          label: 'O jogo fechou com erro',
          detail: `Código de saída ${dto.exitCode}.`,
        },
      });
    }
    return this.status(atualizada, participacao.playtest.estimatedMinutes);
  }

  /**
   * Soma a batida só se ninguém bateu no meio (`lastHeartbeatAt` igual ao
   * lido): duas batidas juntas não contam o mesmo tempo duas vezes.
   */
  private async credit(
    participacao: { id: string; lastHeartbeatAt: Date | null },
    informados: number,
    data: Prisma.ParticipationUpdateManyMutationInput,
  ) {
    const agora = new Date();
    const segundos = creditedSeconds(informados, participacao.lastHeartbeatAt, agora);
    await this.prisma.participation.updateMany({
      where: { id: participacao.id, lastHeartbeatAt: participacao.lastHeartbeatAt },
      data: {
        activeSeconds: { increment: segundos },
        lastHeartbeatAt: participacao.lastHeartbeatAt ? agora : null,
        ...data,
      },
    });
    return this.prisma.participation.findUniqueOrThrow({ where: { id: participacao.id } });
  }

  private async status(
    jogo: { launchCount: number; activeSeconds: number; lastHeartbeatAt: Date | null; lastExitCode: number | null },
    estimatedMinutes: number,
  ): Promise<PlayStatus> {
    return playStatus(jogo, estimatedMinutes, await this.settings.get('playRules', DEFAULT_PLAY_RULES));
  }

  private async own(user: RequestUser, participationId: string) {
    const participacao = await this.prisma.participation.findFirst({
      where: { id: participationId, playerId: user.id },
      include: {
        playtest: {
          select: { requiresRecording: true, requiresMicrophone: true, requiresWebcam: true, buildId: true, estimatedMinutes: true },
        },
      },
    });
    if (!participacao) throw new NotFoundException({ message: 'Participação não encontrada.' });
    return participacao;
  }

  private async inProgress(user: RequestUser, participationId: string) {
    const participacao = await this.own(user, participationId);
    if (participacao.status !== 'IN_PROGRESS') {
      throw new ConflictException({ message: 'Esta participação não está em andamento.', code: ErrorCode.NOT_IN_PROGRESS });
    }
    return participacao;
  }
}
