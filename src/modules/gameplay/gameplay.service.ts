import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { StorageService } from '../../common/storage/storage.service';
import { VIDEO_TYPES } from '../../common/storage/upload-filters';
import { clamp } from '../../common/utils/numbers';
import { PrismaService } from '../../prisma/prisma.service';
import type { ConsentDto } from './dto/consent.dto';
import type { SessionEventDto } from './dto/events.dto';

/**
 * O que acontece entre "Começar" e o formulário (Telas 16 e 17): o
 * consentimento, o progresso, os eventos com o tempo da sessão e a gravação.
 */
@Injectable()
export class GameplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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

  private async own(user: RequestUser, participationId: string) {
    const participacao = await this.prisma.participation.findFirst({
      where: { id: participationId, playerId: user.id },
      include: { playtest: { select: { requiresRecording: true, requiresMicrophone: true, requiresWebcam: true } } },
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
