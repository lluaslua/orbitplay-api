import { Module } from '@nestjs/common';
import { PluginKeyGuard, TelemetryTokenGuard } from './plugin-auth.guards';
import { GamePluginController, PluginController, TelemetryTokenController } from './plugin.controller';
import { PluginService } from './plugin.service';

@Module({
  controllers: [PluginController, GamePluginController, TelemetryTokenController],
  providers: [PluginService, PluginKeyGuard, TelemetryTokenGuard],
  exports: [PluginService],
})
export class PluginModule {}
