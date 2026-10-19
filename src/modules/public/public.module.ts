import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module';
import { ContentController, PublicController } from './public.controller';

@Module({
  imports: [GamesModule],
  controllers: [PublicController, ContentController],
})
export class PublicModule {}
