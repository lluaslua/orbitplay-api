import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Withdrawal } from '@prisma/client';
import { MIN_WITHDRAWAL_CENTS } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import { formatBRL } from '../../common/utils/money';
import type { Wallet, WithdrawalInfo } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import type { WithdrawalDto } from './dto/withdrawal.dto';

/**
 * Carteira do jogador (Tela 13). O saldo só recebe recompensa validada pelo
 * estúdio; o que ainda está em análise fica em `pendingBalanceCents`.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getWallet(user: RequestUser): Promise<Wallet> {
    const [perfil, extrato, saques] = await Promise.all([
      this.profileOf(user.id),
      this.prisma.ledgerEntry.findMany({ where: { playerId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.withdrawal.findMany({ where: { playerId: user.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    const bloqueio = this.blockedReason(perfil.balanceCents, saques.some((s) => s.status === 'REQUESTED'));
    return {
      balanceCents: perfil.balanceCents,
      pendingBalanceCents: perfil.pendingBalanceCents,
      minWithdrawalCents: MIN_WITHDRAWAL_CENTS,
      canWithdraw: bloqueio === null,
      withdrawBlockedReason: bloqueio,
      transactions: extrato.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        amountCents: e.amountCents,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
      withdrawals: saques.map(toWithdrawalInfo),
    };
  }

  /**
   * Pede o saque. O valor sai do saldo na hora e volta se o saque for recusado.
   * O perfil fica travado na transação: dois pedidos simultâneos não sacam duas vezes.
   */
  async requestWithdrawal(user: RequestUser, { amountCents, pixKey }: WithdrawalDto): Promise<WithdrawalInfo> {
    const saque = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "PlayerProfile" WHERE "userId" = ${user.id} FOR UPDATE`;
      const perfil = await tx.playerProfile.findUnique({ where: { userId: user.id } });
      if (!perfil) throw new ForbiddenException({ message: 'Esta conta não tem perfil de jogador.' });

      const aberto = await tx.withdrawal.count({ where: { playerId: user.id, status: 'REQUESTED' } });
      const bloqueio = this.blockedReason(perfil.balanceCents, aberto > 0);
      if (bloqueio) throw bloqueado(bloqueio);
      if (amountCents > perfil.balanceCents) throw bloqueado('O valor passa do saldo disponível.');

      await tx.playerProfile.update({ where: { userId: user.id }, data: { balanceCents: { decrement: amountCents } } });
      const criado = await tx.withdrawal.create({ data: { playerId: user.id, amountCents, pixKey: pixKey.trim() } });
      await tx.ledgerEntry.create({
        data: {
          playerId: user.id,
          type: 'WITHDRAWAL',
          status: 'AVAILABLE',
          amountCents: -amountCents,
          description: 'Saque via Pix',
          withdrawalId: criado.id,
        },
      });
      return criado;
    });
    return toWithdrawalInfo(saque);
  }

  /** O motivo vai pronto para o app — ele só habilita ou desabilita o botão (Tela 13, RN-03). */
  private blockedReason(saldo: number, temSaqueAberto: boolean): string | null {
    if (temSaqueAberto) return 'Já existe um saque em análise.';
    if (saldo < MIN_WITHDRAWAL_CENTS) return `O saque mínimo é de ${formatBRL(MIN_WITHDRAWAL_CENTS)}.`;
    return null;
  }

  private async profileOf(playerId: string) {
    const perfil = await this.prisma.playerProfile.findUnique({ where: { userId: playerId } });
    if (!perfil) throw new ForbiddenException({ message: 'Esta conta não tem perfil de jogador.' });
    return perfil;
  }
}

function bloqueado(mensagem: string) {
  return new UnprocessableEntityException({ message: mensagem, code: ErrorCode.WITHDRAWAL_BLOCKED });
}

/** A chave Pix nunca volta inteira. */
export function toWithdrawalInfo(saque: Withdrawal): WithdrawalInfo {
  return {
    id: saque.id,
    amountCents: saque.amountCents,
    status: saque.status,
    pixKey: saque.pixKey.length <= 4 ? '••••' : `•••${saque.pixKey.slice(-4)}`,
    note: saque.note,
    createdAt: saque.createdAt.toISOString(),
    processedAt: saque.processedAt?.toISOString() ?? null,
  };
}
