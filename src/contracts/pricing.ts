import type { ArchetypeId, PlayerTypeId, TestModel, TestModelInfo } from './test';

/** Card de "Tipo de jogador" da etapa 4. `tier` é a faixa em cifrões. */
export interface PlayerTypeOption {
  id: PlayerTypeId;
  name: string;
  description: string;
  tier: string;
  extraCents: number;
}

/** Card de "Arquétipos" da etapa 4. Não muda o preço. */
export interface ArchetypeOption {
  id: ArchetypeId;
  name: string;
  description: string;
}

/**
 * Tudo o que as etapas 1 e 4 precisam para montar os cards e o resumo da
 * compra. Preço e requisitos vêm da API, não de constante no app (Tela 06, RN-03).
 */
export interface PricingCatalog {
  models: TestModelInfo[];
  playerTypes: PlayerTypeOption[];
  archetypes: ArchetypeOption[];
  boostCents: number;
}

/**
 * O que muda o preço. A resposta é o `PlaytestBudget` recalculado — a etapa 4
 * pede de novo a cada mudança (Tela 09, RN-03).
 */
export interface QuoteRequest {
  model: TestModel;
  playerType: PlayerTypeId;
  boost: boolean;
  slots: number;
  untilDisabled: boolean;
  rewardPerSessionCents: number;
  durationDays: number;
}
