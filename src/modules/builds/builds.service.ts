import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, type Build } from '@prisma/client';
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import { GameAccessService } from '../../common/access/game-access.service';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { StorageService } from '../../common/storage/storage.service';
import { originalName } from '../../common/storage/upload-filters';
import { round } from '../../common/utils/numbers';
import type { BuildDownloadInfo, BuildInfo, PluginDetection } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { configAsManifest } from '../plugin/plugin.service';
import type { UpdateBuildDto, UpdatePluginDto } from './dto/update-plugin.dto';
import { scanBuild, toDetections } from './plugin-manifest';

@Injectable()
export class BuildsService implements OnModuleInit {
  private readonly logger = new Logger(BuildsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: GameAccessService,
  ) {}

  /** Processamento interrompido por reinício não fica "processando" para sempre. */
  async onModuleInit() {
    await this.prisma.build.updateMany({
      where: { status: 'PROCESSING' },
      data: { status: 'INVALID', error: 'O processamento foi interrompido. Envie a build de novo.' },
    });
  }

  async list(user: RequestUser, gameId: string): Promise<BuildInfo[]> {
    await this.access.assert(user, gameId, 'MANAGE_TESTS');
    const builds = await this.prisma.build.findMany({ where: { gameId }, orderBy: { createdAt: 'desc' } });
    return builds.map(toBuildInfo);
  }

  async findOne(user: RequestUser, gameId: string, buildId: string): Promise<BuildInfo> {
    return toBuildInfo(await this.findOwned(user, gameId, buildId));
  }

  /**
   * Recebe a build e responde logo, com status PROCESSING; o hash e a busca do
   * plug-in rodam em seguida, e o app acompanha pelo GET (Tela 08: enviando →
   * processando → validado).
   */
  async upload(user: RequestUser, gameId: string, file: Express.Multer.File, version?: string): Promise<BuildInfo> {
    let build: Build;
    try {
      await this.access.assert(user, gameId, 'MANAGE_TESTS');
      const fileName = originalName(file).replace(/[^\p{L}\p{N}._\- ]+/gu, '_');
      build = await this.prisma.build.create({
        data: {
          gameId,
          uploadedById: user.id,
          fileName,
          sizeMb: round(file.size / (1024 * 1024)),
          version: version?.trim() || versionOf(fileName),
          platforms: platformsOf(fileName),
        },
      });
      const key = `builds/${build.id}/${fileName}`;
      await this.storage.store(file.path, key, 'private');
      build = await this.prisma.build.update({ where: { id: build.id }, data: { storageKey: key } });
    } finally {
      await rm(file.path, { force: true });
    }

    void this.process(build.id, build.storageKey!, gameId, build.version);
    return toBuildInfo(build);
  }

  /** A extensão diz o sistema; o estúdio corrige quando a build roda em mais de um. */
  async update(user: RequestUser, gameId: string, buildId: string, dto: UpdateBuildDto): Promise<BuildInfo> {
    const build = await this.findOwned(user, gameId, buildId);
    return toBuildInfo(await this.prisma.build.update({ where: { id: build.id }, data: { platforms: [...new Set(dto.platforms)] } }));
  }

  /** "Configurar gatilhos" e "Remover Plug-in" (Tela 08). */
  async updatePlugin(user: RequestUser, gameId: string, buildId: string, dto: UpdatePluginDto): Promise<BuildInfo> {
    const build = await this.findOwned(user, gameId, buildId);
    if (dto.enabled && (build.status !== 'VALID' || !build.pluginDetected)) {
      throw new UnprocessableEntityException({
        message: 'Esta build não tem o Orbit Plug-in validado.',
        code: ErrorCode.PLUGIN_REQUIRED,
      });
    }

    const aplicar = (lista: PluginDetection[]) =>
      lista.map((item) => {
        const mudanca = dto.items?.find((m) => m.id === item.id);
        if (!mudanca) return item;

        // O que se configura respeita o tipo detectado (Tela 08, RN-04).
        const invalidas = mudanca.selectedMetrics.filter((metrica) => !item.metrics.includes(metrica));
        if (invalidas.length) {
          throw new UnprocessableEntityException({
            message: `"${item.name}" não aceita: ${invalidas.join(', ')}.`,
            code: ErrorCode.VALIDATION_ERROR,
            fields: { [`items.${item.id}.selectedMetrics`]: 'Métrica não disponível para este tipo.' },
          });
        }
        if (!item.amountEditable && mudanca.amount != null) {
          throw new UnprocessableEntityException({
            message: `"${item.name}" não tem quantidade controlável.`,
            code: ErrorCode.VALIDATION_ERROR,
            fields: { [`items.${item.id}.amount`]: 'Indisponível para este tipo.' },
          });
        }
        return { ...item, enabled: mudanca.enabled, selectedMetrics: mudanca.selectedMetrics, amount: mudanca.amount ?? null };
      });

    const atualizada = await this.prisma.build.update({
      where: { id: build.id },
      data: {
        pluginEnabled: dto.enabled,
        pluginTriggers: aplicar(build.pluginTriggers as unknown as PluginDetection[]) as unknown as Prisma.InputJsonValue,
        pluginHeatmaps: aplicar(build.pluginHeatmaps as unknown as PluginDetection[]) as unknown as Prisma.InputJsonValue,
      },
    });
    return toBuildInfo(atualizada);
  }

  /**
   * O tester baixa a build do teste em que entrou (Tela 16). O teste só começa
   * depois do download e da validação — o hash vai junto para o app conferir.
   */
  async downloadInfo(user: RequestUser, testId: string): Promise<BuildDownloadInfo> {
    const build = await this.buildOfParticipation(user, testId);
    return {
      testId,
      fileName: build.fileName,
      sizeMb: build.sizeMb,
      version: build.version,
      sha256: build.sha256,
      downloadPath: `/player/tests/${testId}/build/file`,
    };
  }

  async downloadPath(user: RequestUser, testId: string): Promise<{ path: string; fileName: string }> {
    const build = await this.buildOfParticipation(user, testId);
    return { path: this.storage.pathOf(build.storageKey!, 'private'), fileName: build.fileName };
  }

  private async buildOfParticipation(user: RequestUser, testId: string) {
    const participacao = await this.prisma.participation.findUnique({
      where: { playtestId_playerId: { playtestId: testId, playerId: user.id } },
      include: { playtest: { include: { build: true } } },
    });
    if (!participacao || participacao.status !== 'IN_PROGRESS') {
      throw new NotFoundException({ message: 'Comece o teste para baixar a build.' });
    }
    const build = participacao.playtest.build;
    if (!build || build.status !== 'VALID' || !build.storageKey) {
      throw new NotFoundException({ message: 'Este teste ainda não tem build para download.' });
    }
    return build;
  }

  private async findOwned(user: RequestUser, gameId: string, buildId: string): Promise<Build> {
    await this.access.assert(user, gameId, 'MANAGE_TESTS');
    const build = await this.prisma.build.findFirst({ where: { id: buildId, gameId } });
    if (!build) throw new NotFoundException({ message: 'Build não encontrada.' });
    return build;
  }

  private async process(buildId: string, key: string, gameId: string, version: string): Promise<void> {
    try {
      const scan = await scanBuild(this.storage.pathOf(key, 'private'));

      // O que o Inspector da Unity enviou (`PUT /plugin/config`) completa o
      // manifesto: gatilho configurado depois da build também aparece.
      const config = scan.manifest ? await this.prisma.gamePluginConfig.findUnique({ where: { gameId } }) : null;
      const extra = config ? configAsManifest(config) : { triggers: [], heatmaps: [] };
      const juntar = <T extends { name: string }>(daBuild: T[], daUnity: T[]) => [
        ...daBuild,
        ...daUnity.filter((item) => !daBuild.some((b) => b.name === item.name)),
      ];
      const triggers = scan.manifest ? toDetections(juntar(scan.manifest.triggers, extra.triggers), 'tr') : [];
      const heatmaps = scan.manifest ? toDetections(juntar(scan.manifest.heatmaps, extra.heatmaps), 'hm') : [];

      await this.prisma.$transaction([
        this.prisma.build.update({
          where: { id: buildId },
          data: {
            status: 'VALID',
            sha256: scan.sha256,
            error: scan.manifestError,
            pluginDetected: !!scan.manifest,
            pluginEnabled: !!scan.manifest,
            pluginSdkVersion: scan.manifest?.sdkVersion ?? null,
            pluginTriggers: triggers as unknown as Prisma.InputJsonValue,
            pluginHeatmaps: heatmaps as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.game.update({ where: { id: gameId }, data: { buildVersion: version } }),
      ]);
    } catch (erro) {
      this.logger.error(`Falha ao processar a build ${buildId}`, erro as Error);
      await this.prisma.build
        .update({ where: { id: buildId }, data: { status: 'INVALID', error: 'Não foi possível ler o arquivo. Envie de novo.' } })
        .catch(() => undefined);
    }
  }
}

export function toBuildInfo(build: Build): BuildInfo {
  return {
    id: build.id,
    gameId: build.gameId,
    fileName: build.fileName,
    sizeMb: build.sizeMb,
    version: build.version,
    sha256: build.sha256,
    status: build.status,
    error: build.error,
    platforms: build.platforms,
    plugin: {
      detected: build.pluginDetected,
      enabled: build.pluginEnabled,
      sdkVersion: build.pluginSdkVersion,
      triggers: build.pluginTriggers as unknown as PluginDetection[],
      heatmaps: build.pluginHeatmaps as unknown as PluginDetection[],
    },
    createdAt: build.createdAt.toISOString(),
  };
}

/**
 * Sistema da build pela extensão — o "Compatível com MAC / Windows" da etapa 3.
 * Projeto de engine (.unity, .unreal) exporta para os dois.
 */
/**
 * A etapa 3 do app não pede versão: ela sai do nome do arquivo
 * ("RachaDeRua-1.3.0.exe" → "1.3.0") ou fica "1.0.0".
 */
export function versionOf(fileName: string): string {
  return /(\d+(?:\.\d+){1,3})/.exec(fileName)?.[1] ?? '1.0.0';
}

export function platformsOf(fileName: string): string[] {
  const extensao = extname(fileName).toLowerCase();
  if (extensao === '.exe') return ['PC'];
  if (extensao === '.dmg') return ['MAC'];
  if (extensao === '.apk') return ['ANDROID'];
  // Um .zip pode ter qualquer coisa dentro: sem plataforma conhecida, nada é barrado (`runsOn`).
  if (extensao === '.zip') return [];
  return ['PC', 'MAC'];
}
