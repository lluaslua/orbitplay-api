import { ForbiddenException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ErrorCode } from '../../common/constants/error-codes';
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
  /** Valor que o provedor diz ter sido pago. Quando vem, tem de ser igual ao do pedido. */
  amountCents?: number;
}

/**
 * O que um gateway de verdade (Mercado Pago, Pagar.me, Stripe...) precisa
 * implementar. O webhook tem que conferir a assinatura do provedor — é o que
 * impede qualquer um de marcar um pedido como pago.
 */
export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  /** `rawBody` é o corpo exato recebido — a assinatura se confere sobre ele, não sobre o JSON reinterpretado. */
  parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody: Buffer | undefined,
  ): Promise<ChargeResult>;
}

/**
 * Confere `X-Orbit-Signature: t=<unix>,v1=<hmac-sha256 hex de "<t>.<corpo>">`: assinatura
 * válida, comparação em tempo constante e carimbo dentro da tolerância (barra repetição).
 * Serve de referência para o gateway real, que segue a assinatura do próprio provedor.
 */
export function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer | undefined,
  secret: string,
  toleranceSeconds: number,
  now = Date.now(),
): void {
  const recusar = () =>
    new UnauthorizedException({ message: 'Assinatura do webhook inválida.', code: ErrorCode.INVALID_WEBHOOK });
  if (!secret || !rawBody) throw recusar();
  const cabecalho = headers['x-orbit-signature'];
  const valor = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  const partes = Object.fromEntries((valor ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(partes.t);
  if (!Number.isFinite(t) || !partes.v1 || Math.abs(now / 1000 - t) > toleranceSeconds) throw recusar();

  const esperado = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const recebido = Buffer.from(partes.v1, 'hex');
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) throw recusar();
}

/**
 * Gateway de desenvolvimento: aprova na hora, sem cobrar nada. O webhook dele
 * existe para simular a confirmação assíncrona do Pix e do boleto, e é
 * recusado em produção.
 */
export class SandboxGateway implements PaymentGateway {
  readonly name = 'sandbox';

  constructor(
    private readonly webhookSecret = '',
    private readonly toleranceSeconds = 300,
  ) {}

  async charge({ orderId, method }: ChargeRequest): Promise<ChargeResult> {
    return { status: 'PAID', providerRef: `sandbox_${orderId}_${Date.now()}`, instructions: instrucoes(method) };
  }

  async parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody: Buffer | undefined,
  ): Promise<ChargeResult> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException({ message: 'O gateway sandbox não aceita webhook em produção.' });
    }
    // Sem segredo configurado ou com assinatura errada, ninguém marca pedido como pago.
    verifyWebhookSignature(headers, rawBody, this.webhookSecret, this.toleranceSeconds);
    const { providerRef, status, amountCents } = (body ?? {}) as {
      providerRef?: unknown;
      status?: unknown;
      amountCents?: unknown;
    };
    const validos: PaymentStatus[] = ['PENDING', 'PAID', 'FAILED', 'CANCELED', 'EXPIRED'];
    if (typeof providerRef !== 'string' || !validos.includes(status as PaymentStatus)) {
      throw new UnprocessableEntityException({ message: 'Webhook sandbox espera { providerRef, status }.' });
    }
    return {
      status: status as PaymentStatus,
      providerRef,
      instructions: null,
      ...(typeof amountCents === 'number' ? { amountCents } : {}),
    };
  }
}

function instrucoes(method: PaymentMethod): Record<string, string> | null {
  if (method === 'PIX') return { pixCopiaECola: '00020126580014BR.GOV.BCB.PIX0136sandbox-orbitplay5204000053039865802BR6304ABCD' };
  if (method === 'BOLETO') return { linhaDigitavel: '00190.00009 01234.567890 12345.678901 1 00000000000000' };
  return null;
}
