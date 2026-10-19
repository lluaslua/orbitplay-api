export type PaymentMethod = 'PIX' | 'BOLETO' | 'CARD' | 'PAYPAL';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'EXPIRED';

export interface CheckoutPayload {
  method: PaymentMethod;
}

/** Uma linha da memória de cálculo do resumo da compra. */
export interface PriceLine {
  label: string;
  amountCents: number;
}

/**
 * Pedido de um teste. A etapa 5 só aparece com `status: 'PAID'`; enquanto
 * PENDING, a tela fica em "processando" (Tela 10, RN-01 e RN-04).
 */
export interface PaymentOrder {
  id: string;
  testId: string;
  status: PaymentStatus;
  method: PaymentMethod;
  amountCents: number;
  breakdown: PriceLine[];
  /** Pix copia-e-cola, linha digitável ou link de pagamento — conforme o método. */
  instructions: Record<string, string> | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

/** "Baixar comprovante" — só existe para pedido pago (Tela 10, RN-03). */
export interface PaymentReceipt {
  receiptNumber: string;
  orderId: string;
  testId: string;
  testTitle: string;
  gameName: string;
  studio: { name: string; cnpj: string | null };
  method: PaymentMethod;
  breakdown: PriceLine[];
  amountCents: number;
  paidAt: string;
}
