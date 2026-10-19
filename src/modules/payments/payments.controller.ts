import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireStudioPermission } from '../../common/decorators/studio-permission.decorator';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { PaymentOrder, PaymentReceipt } from '../../contracts';
import { CheckoutDto } from './dto/checkout.dto';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** "Finalizar" da etapa 4. Pagar é da gestão do estúdio. */
  @Roles('STUDIO')
  @RequireStudioPermission('MANAGE')
  @Idempotent()
  @Post('tests/:testId/checkout')
  checkout(@CurrentUser() user: RequestUser, @Param('testId') testId: string, @Body() dto: CheckoutDto): Promise<PaymentOrder> {
    return this.payments.checkout(user, testId, dto);
  }

  @Roles('STUDIO')
  @Get('tests/:testId/payment')
  byTest(@CurrentUser() user: RequestUser, @Param('testId') testId: string): Promise<PaymentOrder> {
    return this.payments.findByTest(user, testId);
  }

  @Roles('STUDIO')
  @Get('payments/:id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<PaymentOrder> {
    return this.payments.findOne(user, id);
  }

  @Roles('STUDIO')
  @Get('payments/:id/receipt')
  receipt(@CurrentUser() user: RequestUser, @Param('id') id: string): Promise<PaymentReceipt> {
    return this.payments.receipt(user, id);
  }

  /** Chamado pelo provedor, sem token: quem autentica é a assinatura, conferida pelo gateway. */
  @Public()
  @Post('payments/webhooks/:provider')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ): Promise<{ received: true }> {
    return this.payments.webhook(provider, headers, body);
  }
}
