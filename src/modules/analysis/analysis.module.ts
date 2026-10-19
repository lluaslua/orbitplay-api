import { Module } from '@nestjs/common';
import { AchievementsService } from '../player/achievements.service';
import { AnalysisService } from './analysis.service';

@Module({
  // As conquistas moram aqui porque a análise também libera uma ("Fonte Primária").
  providers: [AnalysisService, AchievementsService],
  exports: [AnalysisService, AchievementsService],
})
export class AnalysisModule {}
