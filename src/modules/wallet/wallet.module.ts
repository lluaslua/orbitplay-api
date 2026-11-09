import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { WithdrawalSettlementService } from './withdrawal-settlement.service';

@Module({
  controllers: [WalletController],
  providers: [WalletService, WithdrawalSettlementService],
})
export class WalletModule {}
