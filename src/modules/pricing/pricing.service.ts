import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DEFAULT_BOOST_CENTS } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type {
  ArchetypeId,
  PlayerTypeId,
  PlaytestBudget,
  PriceLine,
  PricingCatalog,
  QuoteRequest,
  TestModel,
} from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tabelas de preço e a conta da compra. É a única fonte do valor cobrado: o que
 * o app mostra no resumo é só uma prévia (Tela 09, RN-03 e RN-06).
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog(): Promise<PricingCatalog> {
    const [models, playerTypes, archetypes, boostCents] = await Promise.all([
      this.prisma.testModelConfig.findMany({ where: { active: true }, orderBy: { position: 'asc' } }),
      this.prisma.playerTypeConfig.findMany({ orderBy: { position: 'asc' } }),
      this.prisma.archetypeConfig.findMany({ orderBy: { position: 'asc' } }),
      this.boostCents(),
    ]);

    return {
      models: models.map((modelo) => ({
        id: modelo.id as TestModel,
        name: modelo.name,
        tagline: modelo.tagline,
        description: modelo.description,
        deliversTitle: modelo.deliversTitle,
        delivers: modelo.delivers,
        pricePerTestCents: modelo.pricePerTestCents,
        recommended: modelo.recommended,
        requiresPlugin: modelo.requiresPlugin,
        icon: modelo.icon,
      })),
      playerTypes: playerTypes.map((tipo) => ({
        id: tipo.id as PlayerTypeId,
        name: tipo.name,
        description: tipo.description,
        tier: tipo.tier,
        extraCents: tipo.extraCents,
      })),
      archetypes: archetypes.map((arquetipo) => ({
        id: arquetipo.id as ArchetypeId,
        name: arquetipo.name,
        description: arquetipo.description,
      })),
      boostCents,
    };
  }

  /**
   * `(base + perfil + impulso) × quantidade` — a fórmula do "Resumo da compra".
   * Sem limite de quantidade o total é zero: cada sessão é debitada do saldo do
   * estúdio conforme acontece.
   */
  async quote(input: QuoteRequest): Promise<PlaytestBudget> {
    const [modelo, perfil, impulso] = await Promise.all([
      this.prisma.testModelConfig.findUnique({ where: { id: input.model } }),
      this.prisma.playerTypeConfig.findUnique({ where: { id: input.playerType } }),
      input.boost ? this.boostCents() : Promise.resolve(0),
    ]);

    if (!modelo?.active) {
      throw new UnprocessableEntityException({
        message: 'Este modelo de teste não está disponível.',
        code: ErrorCode.MODEL_UNAVAILABLE,
      });
    }
    if (!perfil) {
      throw new UnprocessableEntityException({
        message: 'Tipo de jogador inválido.',
        code: ErrorCode.VALIDATION_ERROR,
        fields: { playerType: 'Tipo de jogador inválido.' },
      });
    }

    const pricePerTestCents = modelo.pricePerTestCents + perfil.extraCents + impulso;
    return {
      slots: input.slots,
      untilDisabled: input.untilDisabled,
      basePriceCents: modelo.pricePerTestCents,
      audienceCents: perfil.extraCents,
      boostCents: impulso,
      pricePerTestCents,
      totalCents: input.untilDisabled ? 0 : pricePerTestCents * input.slots,
      rewardPerSessionCents: input.rewardPerSessionCents,
      durationDays: input.durationDays,
    };
  }

  /** Os adicionais aparecem discriminados no resumo e no comprovante (Tela 09, RN-04). */
  breakdown(budget: PlaytestBudget, modelName: string): PriceLine[] {
    const vezes = budget.untilDisabled ? 'por sessão' : `× ${budget.slots}`;
    const linhas: PriceLine[] = [
      { label: `${modelName} (${vezes})`, amountCents: budget.basePriceCents * (budget.untilDisabled ? 1 : budget.slots) },
    ];
    if (budget.audienceCents) {
      linhas.push({ label: `Perfil de tester (${vezes})`, amountCents: budget.audienceCents * (budget.untilDisabled ? 1 : budget.slots) });
    }
    if (budget.boostCents) {
      linhas.push({ label: `Impulsionamento (${vezes})`, amountCents: budget.boostCents * (budget.untilDisabled ? 1 : budget.slots) });
    }
    return linhas;
  }

  private async boostCents(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'boostCents' } });
    return typeof setting?.value === 'number' ? setting.value : DEFAULT_BOOST_CENTS;
  }
}
