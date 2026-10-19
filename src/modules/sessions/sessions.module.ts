import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  // A validação libera conquistas ("Corrida que Paga", "Caçador de Bugs").
  imports: [AnalysisModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
