import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlaytestsModule } from '../playtests/playtests.module';
import { PricingModule } from '../pricing/pricing.module';
import { PAYMENT_GATEWAY, SandboxGateway, type PaymentGateway } from './payment-gateway';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PlaytestsModule, PricingModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentGateway => {
        const provedor = config.getOrThrow<string>('payments.provider');
        if (provedor === 'sandbox') return new SandboxGateway();
        throw new Error(`Gateway de pagamento "${provedor}" não implementado.`);
      },
    },
  ],
})
export class PaymentsModule {}
