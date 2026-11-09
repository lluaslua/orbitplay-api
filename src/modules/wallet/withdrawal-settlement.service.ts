import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecurityLogService } from '../../common/security/security-log.service';
import { formatBRL } from '../../common/utils/money';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { markRewardsPaid } from './payout';

const INTERVALO_MS = 5_000;

/** Saques pagos por volta, para uma fila grande não travar o processo. */
const SAQUES_POR_VOLTA = 20;

export const SIMULATED_PAYOUT_NOTE = 'Pix simulado: nenhum dinheiro real foi movimentado.';

/**
 * O Pix simulado: o saque em análise vira pago depois de `SIMULATED_PAYOUT_SECONDS`,
 * para a carteira funcionar de ponta a ponta sem mover dinheiro de verdade. O saldo já
 * saiu no pedido; aqui só o status muda. Com 0 segundos o job não roda e a Central
 * continua processando à mão.
 */
@Injectable()
export class WithdrawalSettlementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalSettlementService.name);
  private timer?: NodeJS.Timeout;
  private readonly delaySeconds: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly securityLog: SecurityLogService,
  ) {
    this.delaySeconds = config.getOrThrow<number>('wallet.simulatedPayoutSeconds');
  }

  onModuleInit() {
    if (this.delaySeconds <= 0) return;
    this.timer = setInterval(() => void this.settleDue(), INTERVALO_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Paga os saques em análise com mais de `afterSeconds`. Devolve quantos pagou. */
  async settleDue(afterSeconds = this.delaySeconds): Promise<number> {
    try {
      const devidos = await this.prisma.withdrawal.findMany({
        where: { status: 'REQUESTED', createdAt: { lte: new Date(Date.now() - afterSeconds * 1000) } },
        orderBy: { createdAt: 'asc' },
        take: SAQUES_POR_VOLTA,
        select: { id: true },
      });

      let pagos = 0;
      for (const { id } of devidos) pagos += (await this.pay(id)) ? 1 : 0;
      return pagos;
    } catch (erro) {
      this.logger.error(erro);
      return 0;
    }
  }

  private async pay(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // O filtro por status garante que um saque que a Central já processou não é pago de novo.
      const { count } = await tx.withdrawal.updateMany({
        where: { id, status: 'REQUESTED' },
        data: { status: 'PAID', note: SIMULATED_PAYOUT_NOTE, processedAt: new Date() },
      });
      if (count === 0) return false;

      const saque = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
      await markRewardsPaid(tx, saque.playerId, saque.amountCents);
      await this.notifications.notify(
        saque.playerId,
        {
          type: 'WITHDRAWAL_PAID',
          title: 'Saque pago!',
          body: `${formatBRL(saque.amountCents)} foram enviados para a sua chave Pix (simulado).`,
          link: '/player/wallet',
          data: { withdrawalId: id },
        },
        tx,
      );
      this.securityLog.event('withdrawal.settled_simulated', { withdrawalId: id, amountCents: saque.amountCents });
      return true;
    });
  }
}
