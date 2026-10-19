import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { PaymentMethod, PaymentStatus } from '../../contracts';

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface ChargeRequest {
  orderId: string;
  amountCents: number;
  method: PaymentMethod;
  description: string;
}

export interface ChargeResult {
  status: PaymentStatus;
  providerRef: string;
  /** Pix copia-e-cola, linha digitável ou link — o que o método pede. */
  instructions: Record<string, string> | null;
  failureReason?: string;
}

/**
 * O que um gateway de verdade (Mercado Pago, Pagar.me, Stripe...) precisa
 * implementar. O webhook tem que conferir a assinatura do provedor — é o que
 * impede qualquer um de marcar um pedido como pago.
 */
export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<ChargeResult>;
}

/**
 * Gateway de desenvolvimento: aprova na hora, sem cobrar nada. O webhook dele
 * existe para simular a confirmação assíncrona do Pix e do boleto, e é
 * recusado em produção.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';

  async charge({ orderId, method }: ChargeRequest): Promise<ChargeResult> {
    return { status: 'PAID', providerRef: `sandbox_${orderId}_${Date.now()}`, instructions: instrucoes(method) };
  }

  async parseWebhook(_headers: Record<string, string | string[] | undefined>, body: unknown): Promise<ChargeResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException({ message: 'O gateway sandbox não aceita webhook em produção.' });
    }
    const { providerRef, status } = (body ?? {}) as { providerRef?: unknown; status?: unknown };
    const validos: PaymentStatus[] = ['PENDING', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED'];
    if (typeof providerRef !== 'string' || !validos.includes(status as PaymentStatus)) {
      throw new UnprocessableEntityException({ message: 'Webhook sandbox espera { providerRef, status }.' });
    }
    return { status: status as PaymentStatus, providerRef, instructions: null };
  }
}

function instrucoes(method: PaymentMethod): Record<string, string> | null {
  if (method === 'PIX') return { pixCopiaECola: '00020126580014BR.GOV.BCB.PIX0136sandbox-orbitplay5204000053039865802BR6304ABCD' };
  if (method === 'BOLETO') return { linhaDigitavel: '00190.00009 01234.567890 12345.678901 1 00000000000000' };
  return null;
}
