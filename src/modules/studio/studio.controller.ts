import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { StudioDashboard } from '../../contracts';
import { StudioService } from './studio.service';

@Roles('STUDIO')
@Controller('studio')
export class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: RequestUser): Promise<StudioDashboard> {
    return this.studio.getDashboard(user);
  }
}
