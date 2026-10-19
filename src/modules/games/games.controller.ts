import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto, setTotal } from '../../common/pagination/pagination';
import { IMAGE_MAX_BYTES, imageFilter } from '../../common/storage/upload-filters';
import type { Game, GameAchievementConfig, GameOptions, GameReviewRow, MyGameAccess } from '../../contracts';
import { CreateGameDto } from './dto/create-game.dto';
import { GameAchievementDto, UpdateGameAchievementDto } from './dto/game-achievement.dto';
import { ListGamesQueryDto } from './dto/list-games-query.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { GamesService, type ImageKind } from './games.service';

/** Capa 16:9, ícone quadrado e logo — os três uploads do passo "Mídias" (Figma `1187:8743`). */
const TIPOS_DE_IMAGEM = { banner: 'banner', thumbnail: 'thumbnail', logo: 'logo' } as const;

/** A leitura vale para os dois perfis: o tester também abre a capa e os detalhes do jogo. */
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListGamesQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Game[]> {
    const { items, total } = await this.games.list(user, query);
    setTotal(response, total);
    return items;
  }

  /** Listas dos dropdowns do Novo jogo. Antes de `:id` para não virar um id. */
  @Get('options')
  options(): GameOptions {
    return this.games.options();
  }

  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Idempotent()
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateGameDto): Promise<Game> {
    return this.games.create(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Game> {
    return this.games.findOne(user, id);
  }

  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Patch(':id')
  update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateGameDto): Promise<Game> {
    return this.games.update(user, id, dto);
  }

  /** "Excluir projeto" — só sem teste publicado; com histórico, arquive. */
  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Delete(':id')
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<{ deleted: true }> {
    return this.games.remove(user, id);
  }

  /** Multipart com o arquivo no campo `file`. */
  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Post(':id/images/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMAGE_MAX_BYTES }, fileFilter: imageFilter }))
  uploadImage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(TIPOS_DE_IMAGEM)) kind: ImageKind,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<Game> {
    if (!file) throw new BadRequestException({ message: 'Envie a imagem no campo "file".' });
    return this.games.uploadImage(user, id, kind, file);
  }

  /** "Finalizar" do Novo jogo. */
  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Post(':id/finish-setup')
  @HttpCode(HttpStatus.OK)
  finishSetup(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Game> {
    return this.games.finishSetup(user, id);
  }

  @Roles('STUDIO')
  @Get(':id/my-access')
  myAccess(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<MyGameAccess> {
    return this.games.myAccess(user, id);
  }

  @Roles('STUDIO')
  @Get(':id/reviews')
  async reviews(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GameReviewRow[]> {
    const { items, total } = await this.games.reviews(user, id, query);
    setTotal(response, total);
    return items;
  }

  @Roles('STUDIO')
  @Get(':id/achievements')
  listAchievements(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<GameAchievementConfig[]> {
    return this.games.listAchievements(user, id);
  }

  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Post(':id/achievements')
  createAchievement(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: GameAchievementDto,
  ): Promise<GameAchievementConfig> {
    return this.games.createAchievement(user, id, dto);
  }

  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Patch(':id/achievements/:achievementId')
  updateAchievement(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('achievementId') achievementId: string,
    @Body() dto: UpdateGameAchievementDto,
  ): Promise<GameAchievementConfig> {
    return this.games.updateAchievement(user, id, achievementId, dto);
  }

  @Roles('STUDIO')
  @RequireStudioPermission('EDIT')
  @Delete(':id/achievements/:achievementId')
  removeAchievement(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('achievementId') achievementId: string,
  ): Promise<{ deleted: true }> {
    return this.games.removeAchievement(user, id, achievementId);
  }
}
