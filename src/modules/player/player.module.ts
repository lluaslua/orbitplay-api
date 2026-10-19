import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { UsersModule } from '../users/users.module';
import { ParticipationService } from './participation.service';
import { PlayerController } from './player.controller';
import { PlayerService } from './player.service';

@Module({
  imports: [AnalysisModule, UsersModule],
  controllers: [PlayerController],
  providers: [PlayerService, ParticipationService],
  // A comunidade pergunta se o tester já jogou o jogo.
  exports: [PlayerService],
})
export class PlayerModule {}
