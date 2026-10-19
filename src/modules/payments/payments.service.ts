import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type Order } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { studioIdOf } from '../../common/access/studio-scope';
import { TEST_MODEL_LABELS } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { PaymentOrder, PaymentReceipt, PlayerTypeId, PriceLine } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PlaytestsService } from '../playtests/playtests.service';
import { PricingService } from '../pricing/pricing.service';
import type { CheckoutDto } from './dto/checkout.dto';
import { PAYMENT_GATEWAY, type ChargeResult, type PaymentGateway } from './payment-gateway';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playtests: PlaytestsService,
    private readonly pricing: PricingService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Paga e publica o teste (Telas 09 e 10). Idempotente por natureza: um pedido
   * por teste — pago ou em processamento, a resposta é o mesmo pedido, sem
   * nova cobrança (Tela 10, RN-02). Recusado, cancelado ou expirado, tenta de novo.
   */
  async checkout(user: RequestUser, testId: string, { method }: CheckoutDto): Promise<PaymentOrder> {
    const studioId = studioIdOf(user);
    const teste = await this.prisma.playtest.findFirst({
      where: { id: testId, game: { studioId } },
      include: { order: true, game: { select: { studio: { select: { balanceCents: true } } } } },
    });
    if (!teste) throw new NotFoundException({ message: 'Teste não encontrado.' });

    const anterior = teste.order;
    if (anterior && (anterior.status === 'PAID' || anterior.status === 'PENDING')) return toOrder(anterior);
    if (teste.status !== 'DRAFT') {
      throw new UnprocessableEntityException({ message: 'Este teste já foi publicado.', code: ErrorCode.PAYMENT_NOT_ALLOWED });
    }

    // A build pode ter mudado desde a criação (plug-in removido, por exemplo).
    await this.playtests.assertBuildFits(teste.gameId, teste.model, teste.buildId);

    // O preço cobrado é o de agora, recalculado aqui (Tela 09, RN-06).
    const budget = await this.pricing.quote({
      model: teste.model,
      playerType: teste.playerType as PlayerTypeId,
      boost: teste.boostCents > 0,
      slots: teste.slots,
      untilDisabled: teste.untilDisabled,
      rewardPerSessionCents: teste.rewardPerSessionCents,
      durationDays: teste.durationDays,
    });
    const breakdown = this.pricing.breakdown(budget, TEST_MODEL_LABELS[teste.model]);

    if (teste.untilDisabled && teste.game.studio.balanceCents < budget.pricePerTestCents) {
      throw new UnprocessableEntityException({
        message: 'Teste sem limite de quantidade é debitado do saldo do estúdio a cada sessão, e o saldo não cobre nem uma.',
        code: ErrorCode.INSUFFICIENT_BALANCE,
      });
    }

    // O pedido é gravado antes da cobrança: se ela travar no meio, fica
    // PENDING e ninguém cobra de novo.
    let pedido: Order;
    try {
      const dados = {
        method,
        status: 'PENDING' as const,
        amountCents: budget.totalCents,
        breakdown: breakdown as unknown as Prisma.InputJsonValue,
        provider: this.gateway.name,
      };
      pedido = anterior
        ? await this.prisma.order.update({
            where: { id: anterior.id },
            data: { ...dados, providerRef: null, instructions: Prisma.DbNull, failureReason: null },
          })
        : await this.prisma.order.create({ data: { ...dados, studioId, playtestId: teste.id, createdById: user.id } });
    } catch (erro) {
      // Dois cliques ao mesmo tempo: o segundo encontra o pedido do primeiro.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        const existente = await this.prisma.order.findUniqueOrThrow({ where: { playtestId: teste.id } });
        return toOrder(existente);
      }
      throw erro;
    }

    await this.prisma.playtest.update({
      where: { id: teste.id },
      data: {
        basePriceCents: budget.basePriceCents,
        audienceCents: budget.audienceCents,
        boostCents: budget.boostCents,
        pricePerTestCents: budget.pricePerTestCents,
        totalCents: budget.totalCents,
      },
    });

    const resultado: ChargeResult =
      budget.totalCents === 0
        ? { status: 'PAID', providerRef: `saldo_${pedido.id}`, instructions: null }
        : await this.gateway.charge({
            orderId: pedido.id,
            amountCents: budget.totalCents,
            method,
            description: `OrbitPlay — ${teste.title}`,
          });

    return toOrder(await this.applyResult(pedido.id, resultado));
  }

  async findOne(user: RequestUser, orderId: string): Promise<PaymentOrder> {
    const pedido = await this.prisma.order.findFirst({ where: { id: orderId, studioId: studioIdOf(user) } });
    if (!pedido) throw new NotFoundException({ message: 'Pedido não encontrado.' });
    return toOrder(pedido);
  }

  /** Para retomar a etapa 5 depois de fechar a janela (Tela 10, "recuperação segura"). */
  async findByTest(user: RequestUser, testId: string): Promise<PaymentOrder> {
    const pedido = await this.prisma.order.findFirst({ where: { playtestId: testId, studioId: studioIdOf(user) } });
    if (!pedido) throw new NotFoundException({ message: 'Este teste ainda não tem pedido.' });
    return toOrder(pedido);
  }

  /** O comprovante corresponde à transação confirmada — não existe antes dela (Tela 10, RN-03). */
  async receipt(user: RequestUser, orderId: string): Promise<PaymentReceipt> {
    const pedido = await this.prisma.order.findFirst({
      where: { id: orderId, studioId: studioIdOf(user) },
      include: {
        playtest: { select: { title: true, game: { select: { name: true } } } },
        studio: { select: { name: true, cnpj: true } },
      },
    });
    if (!pedido) throw new NotFoundException({ message: 'Pedido não encontrado.' });
    if (pedido.status !== 'PAID' || !pedido.receiptNumber || !pedido.paidAt) {
      throw new ConflictException({ message: 'O pagamento ainda não foi confirmado.', code: ErrorCode.PAYMENT_NOT_PAID });
    }

    return {
      receiptNumber: pedido.receiptNumber,
      orderId: pedido.id,
      testId: pedido.playtestId,
      testTitle: pedido.playtest.title,
      gameName: pedido.playtest.game.name,
      studio: { name: pedido.studio.name, cnpj: pedido.studio.cnpj },
      method: pedido.method,
      breakdown: pedido.breakdown as unknown as PriceLine[],
      amountCents: pedido.amountCents,
      paidAt: pedido.paidAt.toISOString(),
    };
  }

  /** Confirmação assíncrona do provedor (Pix, boleto). Repetida, não muda nada. */
  async webhook(
    provider: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): Promise<{ received: true }> {
    if (provider !== this.gateway.name) throw new NotFoundException({ message: 'Provedor desconhecido.' });

    const evento = await this.gateway.parseWebhook(headers, body);
    const pedido = await this.prisma.order.findFirst({ where: { providerRef: evento.providerRef } });
    if (!pedido) throw new NotFoundException({ message: 'Pedido não encontrado.' });

    await this.applyResult(pedido.id, {
      ...evento,
      instructions: evento.instructions ?? (pedido.instructions as Record<string, string> | null),
    });
    return { received: true };
  }

  /** Marca o pedido e, se pago, publica o teste — na mesma transação. */
  private applyResult(orderId: string, resultado: ChargeResult): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const atual = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { playtest: { select: { id: true, gameId: true, durationDays: true, status: true } } },
      });
      if (atual.status === 'PAID') return atual;

      const pago = resultado.status === 'PAID';
      if (pago && atual.playtest.status === 'DRAFT') {
        await this.playtests.activateInTransaction(tx, atual.playtest);
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: resultado.status,
          providerRef: resultado.providerRef,
          instructions: resultado.instructions ?? Prisma.DbNull,
          failureReason: resultado.failureReason ?? null,
          paidAt: pago ? new Date() : null,
          receiptNumber: pago ? receiptNumber() : null,
        },
      });
    });
  }
}

function receiptNumber(): string {
  const dia = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `OP-${dia}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function toOrder(pedido: Order): PaymentOrder {
  return {
    id: pedido.id,
    testId: pedido.playtestId,
    status: pedido.status,
    method: pedido.method,
    amountCents: pedido.amountCents,
    breakdown: pedido.breakdown as unknown as PriceLine[],
    instructions: pedido.instructions as Record<string, string> | null,
    failureReason: pedido.failureReason,
    createdAt: pedido.createdAt.toISOString(),
    paidAt: pedido.paidAt?.toISOString() ?? null,
  };
}
