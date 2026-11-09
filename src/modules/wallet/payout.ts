import type { Prisma } from '@prisma/client';

/**
 * Um saque pago quita, das recompensas já validadas do jogador, as mais antigas
 * que cabem no valor — é o que vira `PAID` na participação.
 */
export async function markRewardsPaid(tx: Prisma.TransactionClient, playerId: string, amountCents: number): Promise<void> {
  const validadas = await tx.participation.findMany({
    where: { playerId, rewardStatus: 'VALIDATED' },
    orderBy: { finishedAt: 'asc' },
    select: { id: true, rewardCents: true },
  });
  let restante = amountCents;
  const pagas: string[] = [];
  for (const p of validadas) {
    if (p.rewardCents > restante) break;
    restante -= p.rewardCents;
    pagas.push(p.id);
  }
  if (pagas.length) await tx.participation.updateMany({ where: { id: { in: pagas } }, data: { rewardStatus: 'PAID' } });
}
