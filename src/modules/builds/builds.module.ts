import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { StorageService } from '../../common/storage/storage.service';
import { BuildsController } from './builds.controller';
import { BuildsService } from './builds.service';
import { PlayerBuildsController } from './player-builds.controller';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [StorageService, ConfigService],
      useFactory: (storage: StorageService, config: ConfigService) => ({
        dest: storage.tmpDir,
        limits: { fileSize: config.getOrThrow<number>('storage.buildMaxSizeMb') * 1024 * 1024 },
      }),
    }),
  ],
  controllers: [BuildsController, PlayerBuildsController],
  providers: [BuildsService],
  exports: [BuildsService],
})
export class BuildsModule {}
