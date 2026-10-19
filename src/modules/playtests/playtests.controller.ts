import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { setTotal } from '../../common/pagination/pagination';
import type { Playtest } from '../../contracts';
import { CreatePlaytestDto } from './dto/create-playtest.dto';
import { ListPlaytestsQueryDto } from './dto/list-playtests-query.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { PlaytestsService } from './playtests.service';

/**
 * `/tests` — o `Playtest` completo, com orçamento, é visão do estúdio. O tester
 * vê os testes pelo catálogo e pela tela do jogo, em /player.
 */
@Roles('STUDIO')
@Controller('tests')
export class PlaytestsController {
  constructor(private readonly playtests: PlaytestsService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListPlaytestsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Playtest[]> {
    const { items, total } = await this.playtests.list(user, query);
    setTotal(response, total);
    return items;
  }

  /** Cria o teste como DRAFT; a publicação vem com o pagamento (`POST /tests/:id/checkout`). */
  @RequireStudioPermission('EDIT')
  @Idempotent()
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePlaytestDto): Promise<Playtest> {
    return this.playtests.create(user, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Playtest> {
    return this.playtests.findOne(user, id);
  }

  @RequireStudioPermission('EDIT')
  @Patch(':id/status')
  setStatus(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetStatusDto): Promise<Playtest> {
    return this.playtests.setStatus(user, id, dto.status);
  }

  /** Ação crítica: o app confirma antes de chamar. */
  @RequireStudioPermission('EDIT')
  @Post(':id/finish')
  @HttpCode(HttpStatus.OK)
  finish(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Playtest> {
    return this.playtests.finish(user, id);
  }
}
