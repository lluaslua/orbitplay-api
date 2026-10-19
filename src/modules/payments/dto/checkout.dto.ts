import { IsIn } from 'class-validator';
import { PAYMENT_METHODS } from '../../../common/constants/domain.constants';
import type { CheckoutPayload, PaymentMethod } from '../../../contracts';

export class CheckoutDto implements CheckoutPayload {
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethod;
}
