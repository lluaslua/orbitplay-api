import { Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type GamePluginConfig, type PluginKey } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { GameAccessService } from '../../common/access/game-access.service';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { DEFAULT_PLUGIN_INFO } from '../../common/settings/settings.defaults';
import { SettingsService } from '../../common/settings/settings.service';
import type {
  CreatedPluginKey,
  PluginConfig,
  PluginInfo,
  PluginKeyInfo,
  PluginMapConfig,
  PluginManifest,
  PluginTriggerConfig,
  PluginValidation,
  TelemetryToken,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreatePluginKeyDto, PluginConfigDto, TelemetryEventDto } from './dto/plugin.dto';
import { hashPluginCode, TELEMETRY_PURPOSE } from './plugin-auth.guards';

/** Validade do token de telemetria: uma sessão longa, com folga. */
const TELEMETRY_TTL_SEGUNDOS = 6 * 3600;

const LOGICA: Record<PluginTriggerConfig['logic'], string> = {
  ON_CHANGE: 'On Change',
  THRESHOLD: 'Threshold',
  CUMULATIVE: 'Cumulative',
};

/**
 * OrbitPlug-in: o código de acesso que o estúdio gera, a configuração que a
 * Unity envia e a telemetria que o jogo manda durante o teste.
 */
@Injectable()
export class PluginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GameAccessService,
    private readonly settings: SettingsService,
    private readonly jwt: JwtService,
  ) {}

  info(): Promise<PluginInfo> {
    return this.settings.get('pluginInfo', DEFAULT_PLUGIN_INFO);
  }

  // --- Códigos de acesso (estúdio) -------------------------------------------

  async listKeys(user: RequestUser, gameId: string): Promise<PluginKeyInfo[]> {
    await this.access.assert(user, gameId, 'MANAGE_TESTS');
    const chaves = await this.prisma.pluginKey.findMany({ where: { gameId }, orderBy: { createdAt: 'desc' } });
    return chaves.map(toKeyInfo);
  }

  /** O código só aparece nesta resposta: a API guarda o hash. */
  async createKey(user: RequestUser, gameId: string, dto: CreatePluginKeyDto): Promise<CreatedPluginKey> {
    await this.access.assert(user, gameId, 'MANAGE_TESTS');
    const code = `opk_${randomBytes(24).toString('base64url')}`;
    const chave = await this.prisma.pluginKey.create({
      data: { gameId, codeHash: hashPluginCode(code), last4: code.slice(-4), name: dto.name?.trim() ?? '', createdById: user.id },
    });
    return { ...toKeyInfo(chave), code };
  }

  async revokeKey(user: RequestUser, gameId: string, keyId: string): Promise<PluginKeyInfo> {
    await this.access.assert(user, gameId, 'MANAGE_TESTS');
    const chave = await this.prisma.pluginKey.findFirst({ where: { id: keyId, gameId } });
    if (!chave) throw new NotFoundException({ message: 'Código de acesso não encontrado.' });
    const revogada = chave.revokedAt ? chave : await this.prisma.pluginKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
    return toKeyInfo(revogada);
  }

  /** Configuração vista pelo estúdio, na tela do jogo. */
  async configForStudio(user: RequestUser, gameId: string): Promise<PluginConfig | null> {
    await this.access.assert(user, gameId, 'MANAGE_TESTS');
    const config = await this.prisma.gamePluginConfig.findUnique({ where: { gameId } });
    return config ? toConfig(config) : null;
  }

  // --- Lado do plug-in -------------------------------------------------------

  /** "Validar código de acesso" (Figma `423:2774`). */
  async validate(gameId: string): Promise<PluginValidation> {
    const game = await this.prisma.game.findUniqueOrThrow({
      where: { id: gameId },
      select: { id: true, name: true, studio: { select: { name: true } }, pluginConfig: true },
    });
    return {
      valid: true,
      gameId: game.id,
      gameName: game.name,
      studioName: game.studio.name,
      config: game.pluginConfig ? toConfig(game.pluginConfig) : null,
    };
  }

  /** O Inspector salvou mapas e gatilhos; a próxima build com o SDK já vem com eles. */
  async saveConfig(gameId: string, dto: PluginConfigDto): Promise<PluginConfig> {
    const dados = {
      sdkVersion: dto.sdkVersion ?? null,
      maps: dto.maps as unknown as Prisma.InputJsonValue,
      triggers: dto.triggers as unknown as Prisma.InputJsonValue,
    };
    const config = await this.prisma.gamePluginConfig.upsert({
      where: { gameId },
      create: { gameId, ...dados },
      update: dados,
    });
    return toConfig(config);
  }

  // --- Telemetria -------------------------------------------------------------

  /** O app pede ao abrir a build e passa o token para o jogo (linha de comando ou variável de ambiente). */
  async telemetryToken(user: RequestUser, participationId: string): Promise<TelemetryToken> {
    const participacao = await this.prisma.participation.findFirst({
      where: { id: participationId, playerId: user.id, status: 'IN_PROGRESS' },
      select: { id: true, playtest: { select: { plugin: true } } },
    });
    if (!participacao) throw new NotFoundException({ message: 'Participação em andamento não encontrada.' });

    const token = await this.jwt.signAsync(
      { sub: participacao.id, pid: user.id, purpose: TELEMETRY_PURPOSE },
      { expiresIn: TELEMETRY_TTL_SEGUNDOS },
    );
    return {
      token,
      expiresAt: new Date(Date.now() + TELEMETRY_TTL_SEGUNDOS * 1000).toISOString(),
      endpoint: '/plugin/telemetry',
    };
  }

  /** Eventos do jogo viram `SessionEvent`, como os que o app manda — o relatório lê os dois igual. */
  async ingest(participationId: string, eventos: TelemetryEventDto[]): Promise<{ received: number }> {
    const { count } = await this.prisma.sessionEvent.createMany({
      data: eventos.map((evento) => ({
        participationId,
        atSecond: evento.atSecond,
        type: evento.type,
        label: evento.label,
        detail: evento.detail ?? (evento.cause ? causaLegivel(evento.cause) : undefined),
        payload: semVazios({ value: evento.value, x: evento.x, y: evento.y, z: evento.z, cause: evento.cause }),
      })),
    });
    return { received: count };
  }
}

/**
 * A configuração no formato do manifesto do SDK, para a varredura da build
 * juntar com o que ela achou (`toDetections`).
 */
export function configAsManifest(config: GamePluginConfig): Pick<PluginManifest, 'triggers' | 'heatmaps'> {
  const triggers = config.triggers as unknown as PluginTriggerConfig[];
  const maps = config.maps as unknown as PluginMapConfig[];
  return {
    triggers: triggers.map((t) => ({ name: t.name, varType: t.valueType, kind: LOGICA[t.logic] ?? t.logic })),
    heatmaps: maps.map((m) => ({ name: m.name, varType: 'Vector3.position', kind: m.targetObject || 'Vector3' })),
  };
}

function toKeyInfo(chave: PluginKey): PluginKeyInfo {
  return {
    id: chave.id,
    gameId: chave.gameId,
    name: chave.name,
    preview: `opk_…${chave.last4}`,
    createdAt: chave.createdAt.toISOString(),
    lastUsedAt: chave.lastUsedAt?.toISOString() ?? null,
    revokedAt: chave.revokedAt?.toISOString() ?? null,
  };
}

function toConfig(config: GamePluginConfig): PluginConfig {
  return {
    sdkVersion: config.sdkVersion,
    maps: config.maps as unknown as PluginMapConfig[],
    triggers: config.triggers as unknown as PluginTriggerConfig[],
    updatedAt: config.updatedAt.toISOString(),
  };
}

function causaLegivel(causa: string): string {
  return { COLLISION: 'Morte por colisão', CODE: 'Morte por código', ERROR: 'Morte por erro' }[causa] ?? causa;
}

function semVazios(valores: Record<string, unknown>): Prisma.InputJsonValue {
  return Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== undefined)) as Prisma.InputJsonValue;
}
