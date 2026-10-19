import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type {
  CreatedPluginKey,
  PluginConfig,
  PluginInfo,
  PluginKeyInfo,
  PluginValidation,
  TelemetryToken,
} from '../../contracts';
import { CreatePluginKeyDto, PluginConfigDto, TelemetryBatchDto } from './dto/plugin.dto';
import { PluginKeyGuard, TelemetryTokenGuard, type PluginRequest, type TelemetryRequest } from './plugin-auth.guards';
import { PluginService } from './plugin.service';

/**
 * O que o OrbitPlug-in chama de dentro da Unity e do jogo. Não há conta de
 * usuário: a Unity se autentica pelo código de acesso e o jogo, pelo token de
 * telemetria que o app passou para a build.
 */
@Controller('plugin')
export class PluginController {
  constructor(private readonly plugin: PluginService) {}

  /** "Baixar plug-in", "Ver documentação" e "Abrir site". */
  @Public()
  @Get('info')
  info(): Promise<PluginInfo> {
    return this.plugin.info();
  }

  /** "Validar código de acesso" (Figma `423:2774`). */
  @Public()
  @UseGuards(PluginKeyGuard)
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(@Req() request: PluginRequest): Promise<PluginValidation> {
    return this.plugin.validate(request.pluginKey.gameId);
  }

  /** O Inspector (`423:3000`) salva mapas e gatilhos do projeto. */
  @Public()
  @UseGuards(PluginKeyGuard)
  @Put('config')
  saveConfig(@Req() request: PluginRequest, @Body() dto: PluginConfigDto): Promise<PluginConfig> {
    return this.plugin.saveConfig(request.pluginKey.gameId, dto);
  }

  /** Em lote, até 500 por chamada: o jogo acumula e manda de tempos em tempos. */
  @Public()
  @UseGuards(TelemetryTokenGuard)
  @Post('telemetry')
  telemetry(@Req() request: TelemetryRequest, @Body() dto: TelemetryBatchDto): Promise<{ received: number }> {
    return this.plugin.ingest(request.telemetry.participationId, dto.events);
  }
}

/** "Configurar Orbit Plug-in" na tela do jogo: os códigos de acesso da Unity. */
@Roles('STUDIO')
@Controller('games/:gameId/plugin')
export class GamePluginController {
  constructor(private readonly plugin: PluginService) {}

  @Get('keys')
  listKeys(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<PluginKeyInfo[]> {
    return this.plugin.listKeys(user, gameId);
  }

  @RequireStudioPermission('EDIT')
  @Post('keys')
  createKey(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string, @Body() dto: CreatePluginKeyDto): Promise<CreatedPluginKey> {
    return this.plugin.createKey(user, gameId, dto);
  }

  @RequireStudioPermission('EDIT')
  @Delete('keys/:keyId')
  revokeKey(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string, @Param('keyId') keyId: string): Promise<PluginKeyInfo> {
    return this.plugin.revokeKey(user, gameId, keyId);
  }

  /** O que a Unity enviou por último. `null` antes do primeiro envio. */
  @Get('config')
  config(@CurrentUser() user: RequestUser, @Param('gameId') gameId: string): Promise<PluginConfig | null> {
    return this.plugin.configForStudio(user, gameId);
  }
}

/** O app do tester pede o token ao abrir a build. */
@Roles('PLAYER')
@Controller('player/participations/:id')
export class TelemetryTokenController {
  constructor(private readonly plugin: PluginService) {}

  @Post('telemetry-token')
  @HttpCode(HttpStatus.OK)
  token(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<TelemetryToken> {
    return this.plugin.telemetryToken(user, id);
  }
}
