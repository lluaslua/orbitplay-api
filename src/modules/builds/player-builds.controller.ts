import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { BuildDownloadInfo } from '../../contracts';
import { BuildsService } from './builds.service';

/** Download da build pelo tester, depois de começar o teste (Tela 16). */
@Roles('PLAYER')
@Controller('player/tests/:testId/build')
export class PlayerBuildsController {
  constructor(private readonly builds: BuildsService) {}

  @Get()
  info(@CurrentUser() user: RequestUser, @Param('testId') testId: string): Promise<BuildDownloadInfo> {
    return this.builds.downloadInfo(user, testId);
  }

  /** O Express atende `Range`: download interrompido continua de onde parou (Tela 16, RN-04). */
  @Get('file')
  async file(@CurrentUser() user: RequestUser, @Param('testId') testId: string, @Res() response: Response): Promise<void> {
    const { path, fileName } = await this.builds.downloadPath(user, testId);
    response.download(path, fileName);
  }
}
