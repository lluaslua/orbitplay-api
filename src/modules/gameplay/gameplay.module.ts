import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageService } from '../../common/storage/storage.service';
import { GameplayController } from './gameplay.controller';
import { GameplayService } from './gameplay.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [StorageService],
      useFactory: (storage: StorageService) => ({ dest: storage.tmpDir }),
    }),
  ],
  controllers: [GameplayController],
  providers: [GameplayService],
})
export class GameplayModule {}
