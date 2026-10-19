import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StorageService } from '../../common/storage/storage.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    MulterModule.registerAsync({
      inject: [StorageService],
      useFactory: (storage: StorageService) => ({ dest: storage.tmpDir }),
    }),
  ],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
