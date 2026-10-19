import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { PricingModule } from '../pricing/pricing.module';
import { PlaytestsLifecycleService } from './playtests-lifecycle.service';
import { PlaytestsController } from './playtests.controller';
import { PlaytestsService } from './playtests.service';

@Module({
  imports: [AnalysisModule, PricingModule],
  controllers: [PlaytestsController],
  providers: [PlaytestsService, PlaytestsLifecycleService],
  exports: [PlaytestsService],
})
export class PlaytestsModule {}
