export type LedgerType = 'REWARD' | 'WITHDRAWAL' | 'ADJUSTMENT';

/** PENDING ainda não conta no saldo; AVAILABLE conta; CANCELED não conta mais. */
export type LedgerStatus = 'PENDING' | 'AVAILABLE' | 'CANCELED';

export type WithdrawalStatus = 'REQUESTED' | 'PAID' | 'REJECTED';

export interface WalletTransaction {
  id: string;
  type: LedgerType;
  status: LedgerStatus;
  /** Positivo entra, negativo sai. */
  amountCents: number;
  description: string;
  createdAt: string;
}

export interface WithdrawalInfo {
  id: string;
  amountCents: number;
  status: WithdrawalStatus;
  /** Mascarada: só os últimos caracteres. */
  pixKey: string;
  note: string | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * Carteira da home do jogador (Tela 13). Se o saque pode ser pedido — e por que
 * não, quando não pode — vem pronto: o app só habilita ou desabilita (RN-03).
 */
export interface Wallet {
  balanceCents: number;
  pendingBalanceCents: number;
  minWithdrawalCents: number;
  canWithdraw: boolean;
  withdrawBlockedReason: string | null;
  transactions: WalletTransaction[];
  withdrawals: WithdrawalInfo[];
}

export interface WithdrawalRequest {
  amountCents: number;
  pixKey: string;
}
