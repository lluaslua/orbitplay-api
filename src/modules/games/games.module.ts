import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageService } from '../../common/storage/storage.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [
    // O upload cai na pasta temporária e só vai para o lugar certo depois de validado.
    MulterModule.registerAsync({
      inject: [StorageService],
      useFactory: (storage: StorageService) => ({ dest: storage.tmpDir }),
    }),
  ],
  controllers: [GamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
