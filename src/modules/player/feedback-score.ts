import { clamp, round, sum } from '../../common/utils/numbers';
import { formatBRL, formatScore } from '../../common/utils/money';
import {
  AUTOMATIC_TIERS,
  DEFAULT_TIER,
  type RewardBonuses,
  type TierRule,
  type XpRules,
} from '../../common/settings/settings.defaults';

export type AnswerValue = string | number | string[] | boolean;

export interface Scored {
  total: number;
  /** A memória de cálculo que a tela de conclusão mostra acima do número (Figma `287:5085`). */
  lines: string[];
}

/**
 * Qualidade do feedback, de 0 a 10: texto longo, bugs reportados e respostas
 * completas puxam a nota. É a fórmula do mock (`scoreFeedback`, de 1 a 5) em dobro.
 */
export function scoreFeedback(respostas: Record<string, AnswerValue>, bugs: number): Scored {
  const valores = Object.values(respostas);
  const texto = sum(valores.filter((v): v is string => typeof v === 'string').map((v) => v.trim().length));

  const base = 2.5;
  const detalhe = clamp(texto / 220, 0, 1.5);
  const bonusBugs = clamp(bugs * 0.2, 0, 0.6);
  const completude = clamp(valores.length * 0.1, 0, 0.4);
  const total = round(clamp(base + detalhe + bonusBugs + completude, 1, 5) * 2);

  return {
    total,
    lines: [
      `Base: ${formatScore(base * 2)}`,
      `Bônus por texto detalhado: +${formatScore(detalhe * 2)}`,
      `Bônus por bug reportado: +${formatScore(bonusBugs * 2)}`,
      `Bônus por respostas completas: +${formatScore(completude * 2)}`,
    ],
  };
}

/**
 * XP da sessão no formato da tela de conclusão (Figma `287:5085`): "XP base:
 * 50", "Bônus por feedback completo: +5", "Bônus por bug reportado: +5".
 */
export function xpFor(regras: XpRules, completo: boolean, bugs: number): Scored {
  const bonusCompleto = completo ? regras.completeFeedback : 0;
  const bonusBug = bugs > 0 ? regras.bugReported : 0;
  return {
    total: regras.base + bonusCompleto + bonusBug,
    lines: [
      `XP base: ${regras.base}`,
      `Bônus por feedback completo: +${bonusCompleto}`,
      `Bônus por bug reportado: +${bonusBug}`,
    ],
  };
}

/**
 * Recompensa da sessão, com os mesmos dois bônus da tela de conclusão:
 * "Crédito base: R$ 0,45", "+R$ 0,05" por feedback completo e por bug.
 */
export function rewardFor(baseCents: number, bonus: RewardBonuses, completo: boolean, bugs: number): { totalCents: number; lines: string[] } {
  const bonusCompleto = completo ? bonus.completeFeedbackCents : 0;
  const bonusBug = bugs > 0 ? bonus.bugReportedCents : 0;
  return {
    totalCents: baseCents + bonusCompleto + bonusBug,
    lines: [
      `Crédito base: ${formatBRL(baseCents)}`,
      `Bônus por feedback completo: +${formatBRL(bonusCompleto)}`,
      `Bônus por bug reportado: +${formatBRL(bonusBug)}`,
    ],
  };
}

/** Tier pela regra da `Setting`; tier dado à mão (QA) não muda. */
export function tierFor(atual: string, level: number, rating: number, regras: TierRule[]): string {
  if (!AUTOMATIC_TIERS.includes(atual)) return atual;
  return regras.find((regra) => level >= regra.minLevel && rating >= regra.minRating)?.tier ?? DEFAULT_TIER;
}
