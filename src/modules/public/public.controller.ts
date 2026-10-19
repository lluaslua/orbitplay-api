import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { setTotal } from '../../common/pagination/pagination';
import { DEFAULT_APP_DOWNLOADS, DEFAULT_TUTORIAL } from '../../common/settings/settings.defaults';
import { SettingsService } from '../../common/settings/settings.service';
import type { AppDownload, PublicGameCard, TutorialContent } from '../../contracts';
import { ListGamesQueryDto } from '../games/dto/list-games-query.dto';
import { GamesService } from '../games/games.service';

/**
 * O que a landing do site mostra sem login (Figma `151:2272` e `181:605`):
 * jogos com teste aberto e os instaladores do app.
 */
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly games: GamesService,
    private readonly settings: SettingsService,
  ) {}

  /** "Jogos disponiveis — Jogos em teste agora, escolha e ganhe!". Abas: POPULAR, TOP_PAYING, NEW, ELITE. */
  @Get('games')
  async listGames(@Query() query: ListGamesQueryDto, @Res({ passthrough: true }) response: Response): Promise<PublicGameCard[]> {
    const { items, total } = await this.games.listPublic(query);
    setTotal(response, total);
    return items;
  }

  /** "Instale o OrbitPlay / Também disponível para:". */
  @Get('downloads')
  downloads(): Promise<AppDownload[]> {
    return this.settings.get('appDownloads', DEFAULT_APP_DOWNLOADS);
  }
}

/** Textos do tutorial do teste (Figma `224:7273` a `224:7540`), editáveis sem deploy. */
@Controller('content')
export class ContentController {
  constructor(private readonly settings: SettingsService) {}

  @Get('tutorial')
  tutorial(): Promise<TutorialContent> {
    return this.settings.get('tutorial', DEFAULT_TUTORIAL);
  }
}
