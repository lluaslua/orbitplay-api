import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { setTotal } from '../../common/pagination/pagination';
import type { RetestInviteInfo, Session } from '../../contracts';
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import { RetestDto } from './dto/retest.dto';
import { SessionFeedbackDto } from './dto/session-feedback.dto';
import { SessionValidationDto } from './dto/session-validation.dto';
import { SessionsService } from './sessions.service';

/** Sessões gravadas pelos testers, vistas pelo estúdio dono do teste. */
@Roles('STUDIO')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListSessionsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Session[]> {
    const { items, total } = await this.sessions.list(user, query);
    setTotal(response, total);
    return items;
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<Session> {
    return this.sessions.findOne(user, id);
  }

  /** Autenticada pelo link temporário da `videoUrl`; atende `Range` para o player avançar. */
  @Public()
  @Get(':id/video')
  async video(@Param('id') id: string, @Query('token') token: string | undefined, @Res() response: Response): Promise<void> {
    response.sendFile(await this.sessions.videoPath(id, token));
  }

  @RequireStudioPermission('EDIT')
  @Post(':id/validation')
  @HttpCode(HttpStatus.OK)
  validate(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SessionValidationDto): Promise<Session> {
    return this.sessions.validate(user, id, dto);
  }

  /** "Agradeçer teste!" — nota e mensagem ao tester, que recebe no sino. */
  @RequireStudioPermission('EDIT')
  @Post(':id/feedback')
  @HttpCode(HttpStatus.OK)
  feedback(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SessionFeedbackDto): Promise<Session> {
    return this.sessions.feedback(user, id, dto);
  }

  /** "Solicitar novo teste". ("Pedir anulação do teste" é a validação com `approved: false`.) */
  @RequireStudioPermission('EDIT')
  @Post(':id/retest')
  retest(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: RetestDto): Promise<RetestInviteInfo> {
    return this.sessions.requestRetest(user, id, dto);
  }
}
