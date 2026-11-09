import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { RateLimit } from '../../common/security/rate-limit.guard';
import type { Wallet, WithdrawalInfo } from '../../contracts';
import { WithdrawalDto } from './dto/withdrawal.dto';
import { WalletService } from './wallet.service';

@Roles('PLAYER')
@Controller('player')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallet')
  get(@CurrentUser() user: RequestUser): Promise<Wallet> {
    return this.wallet.getWallet(user);
  }

  @RateLimit({ limit: 5, windowMs: 3_600_000, by: 'user' })
  @Idempotent()
  @Post('withdrawals')
  withdraw(@CurrentUser() user: RequestUser, @Body() dto: WithdrawalDto): Promise<WithdrawalInfo> {
    return this.wallet.requestWithdrawal(user, dto);
  }
}
