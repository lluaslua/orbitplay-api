import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    UsersModule,
    // Global: o JwtAuthGuard, registrado no AppModule, também usa o JwtService.
    // A validade é decidida por token, conforme o "Lembrar login".
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('jwt.secret') }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  // A Central de usuários manda o convite pelo mesmo link da recuperação.
  exports: [AuthService],
})
export class AuthModule {}
