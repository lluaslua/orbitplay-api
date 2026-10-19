import { Module } from '@nestjs/common';
import { PlayerModule } from '../player/player.module';
import { CommunityAccessGuard } from './community-access.guard';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';

@Module({
  imports: [PlayerModule],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityAccessGuard],
})
export class CommunityModule {}
