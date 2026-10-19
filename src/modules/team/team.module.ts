import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudioAccessController } from './studio-access.controller';
import { StudioAccessService } from './studio-access.service';
import { GameAccessController, TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  // O convite de membro usa o mesmo link de senha da recuperação.
  imports: [AuthModule],
  controllers: [TeamController, GameAccessController, StudioAccessController],
  providers: [TeamService, StudioAccessService],
})
export class TeamModule {}
