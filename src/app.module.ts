import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { GameAccessModule } from './common/access/game-access.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { StudioPermissionGuard } from './common/guards/studio-permission.guard';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { MailModule } from './common/mail/mail.module';
import { SettingsModule } from './common/settings/settings.service';
import { StorageModule } from './common/storage/storage.module';
import configuration from './config/configuration';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BuildsModule } from './modules/builds/builds.module';
import { CommunityModule } from './modules/community/community.module';
import { GameplayModule } from './modules/gameplay/gameplay.module';
import { GamesModule } from './modules/games/games.module';
import { MeModule } from './modules/me/me.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlayerModule } from './modules/player/player.module';
import { PluginModule } from './modules/plugin/plugin.module';
import { PlaytestsModule } from './modules/playtests/playtests.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { PublicModule } from './modules/public/public.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { StudioModule } from './modules/studio/studio.module';
import { TeamModule } from './modules/team/team.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    StorageModule,
    MailModule,
    AuditModule,
    SettingsModule,
    GameAccessModule,
    NotificationsModule,
    // Contas
    AuthModule,
    UsersModule,
    MeModule,
    AdminModule,
    // Estúdio
    GamesModule,
    BuildsModule,
    PricingModule,
    PlaytestsModule,
    PaymentsModule,
    SessionsModule,
    ReportsModule,
    StudioModule,
    TeamModule,
    PluginModule,
    // Jogador
    PlayerModule,
    GameplayModule,
    WalletModule,
    // Os dois
    CommunityModule,
    // Sem login: landing, downloads e conteúdo do tutorial
    PublicModule,
  ],
  providers: [
    // Toda rota exige token, salvo as @Public(). A ordem importa: os dois
    // seguintes leem o usuário que o JwtAuthGuard carrega do banco.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: StudioPermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
