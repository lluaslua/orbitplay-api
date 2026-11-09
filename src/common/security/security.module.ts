import { Global, Module } from '@nestjs/common';
import { RateLimitStore } from './rate-limit.guard';
import { SecurityLogService } from './security-log.service';
import { TokenService } from './token.service';

@Global()
@Module({
  providers: [TokenService, SecurityLogService, RateLimitStore],
  exports: [TokenService, SecurityLogService, RateLimitStore],
})
export class SecurityModule {}
