/** Os quatro modelos da etapa 1 do Novo teste (Figma 317:2262). */
export type TestModel = 'TELEMETRY' | 'FREE_EXPLORATION' | 'AB_TEST' | 'AB_IMAGES';

/**
 * `PROCESSING` é o estado "Gerando insights IA" das tabelas do estúdio: a coleta
 * acabou e a análise ainda está rodando.
 */
export type TestStatus = 'DRAFT' | 'ACTIVE' | 'FULL' | 'PROCESSING' | 'FINISHED' | 'PAUSED';

/**
 * Tipos de pergunta do seletor da etapa 2 (Figma: o menu solto em `319:7981`,
 * ao lado do frame). São doze, na ordem em que o menu lista.
 */
export type QuestionType =
  | 'SHORT_TEXT'
  | 'PARAGRAPH'
  | 'MULTIPLE_CHOICE'
  | 'CHECKBOXES'
  | 'DROPDOWN'
  | 'FILE_UPLOAD'
  | 'LINEAR_SCALE'
  | 'RATING'
  | 'MULTIPLE_CHOICE_GRID'
  | 'CHECKBOX_GRID'
  | 'DATE'
  | 'TIME';

export interface FormQuestion {
  id: string;
  type: QuestionType;
  label: string;
  helperText?: string;
  required: boolean;
  /** Imagem anexada pelo botão ao lado de "Obrigatória", já reduzida (data URL WebP). */
  imageUrl?: string;
  /** Escolhas e listas: as opções. Nas grades: as linhas. */
  options?: string[];
  /** Só nas grades (`GRID_CHOICE` / `GRID_CHECKBOX`): as colunas. */
  columns?: string[];
  scaleMin?: number;
  scaleMax?: number;
  scaleMinLabel?: string;
  scaleMaxLabel?: string;
}

/** Conteúdo de um card de modelo. Cada campo é um bloco desenhado no card. */
export interface TestModelInfo {
  id: TestModel;
  name: string;
  /** Frase de efeito logo abaixo do título. */
  tagline: string;
  description: string;
  /** Cabeçalho da lista — muda para "O que a telemetria captura:" no modelo com plug-in. */
  deliversTitle: string;
  delivers: string[];
  pricePerTestCents: number;
  /** Card em destaque: borda laranja, degradê e o selo "Recomendado!". */
  recommended?: boolean;
  /** Mostra o lockup do OrbitPlug-in e a nota de rodapé sobre a build integrada. */
  requiresPlugin?: boolean;
  /** Prefixo dos SVGs em `public/icons/figma/model/`. */
  icon: string;
}

export type TestLocation = 'BRASIL' | 'EUA' | 'GLOBAL';

/** Os cinco cards de "Tipo de jogador" da etapa 4. */
export type PlayerTypeId = 'ALL' | 'CASUAL' | 'EXPERIENT' | 'TRAINED' | 'QA';

/** Os cinco cards de "Arquétipos" da etapa 4. */
export type ArchetypeId = 'ALL' | 'CONQUEROR' | 'EXPLORER' | 'SOCIALIZER' | 'KILLER';

/** Público do teste — Figma `319:9516`, seção "Público". */
export interface PlaytestAudience {
  locations: TestLocation[];
  playerType: PlayerTypeId;
  archetype: ArchetypeId;
  minAge: number;
  maxAge: number;
}

/**
 * Orçamento — Figma `319:9516` e o card "Resumo da compra".
 *
 * A conta da compra é `(base + perfil + impulso) × quantidade`. `rewardPerSessionCents`
 * é outra coisa: o que o **jogador** recebe por sessão, e não entra nesse total.
 */
export interface PlaytestBudget {
  /** "Quantidade de teste". */
  slots: number;
  /** "Até desativar o teste" — roda sem limite de quantidade. */
  untilDisabled: boolean;
  /** Preço do modelo escolhido, por teste. */
  basePriceCents: number;
  /** Adicional do perfil de jogador, por teste. */
  audienceCents: number;
  /** Adicional do impulsionamento, por teste. */
  boostCents: number;
  /** Soma dos três acima. */
  pricePerTestCents: number;
  totalCents: number;
  rewardPerSessionCents: number;
  durationDays: number;
}

export interface Playtest {
  id: string;
  gameId: string;
  gameName: string;
  gameThumbnailUrl: string;
  title: string;
  model: TestModel;
  status: TestStatus;
  instructions: string;
  requiresRecording: boolean;
  requiresMicrophone: boolean;
  requiresWebcam: boolean;
  /** "Jogável com controle*" da etapa 3 (Figma `319:7985`). */
  requiresController: boolean;
  /** Só jogadores ELITE entram — a aba "Exclusivos ELITE" do catálogo. */
  eliteOnly: boolean;
  questions: FormQuestion[];
  audience: PlaytestAudience;
  budget: PlaytestBudget;
  currentParticipants: number;
  estimatedMinutes: number;
  buildFileName: string;
  buildSizeMb: number;
  /** Texto da tag de tipo nas tabelas, ex.: "DEMO ABERTA". */
  kind: string;
  /** Se o Orbit Plug-in de telemetria está ativo neste teste. */
  plugin: boolean;
  createdAt: string;
  startsAt: string;
  expiresAt: string;
  /** `null` enquanto o teste não termina — as tabelas mostram "-". */
  endedAt: string | null;
}

/** Estado acumulado do stepper de criacao (TELAS 06-10). */
export interface TestDraft {
  gameId: string | null;
  model: TestModel | null;
  title: string;
  instructions: string;
  questions: FormQuestion[];
  requiresRecording: boolean;
  requiresMicrophone: boolean;
  requiresWebcam: boolean;
  /** "Jogável com controle*" da etapa 3. */
  requiresController: boolean;
  /** A build enviada na etapa 3 (`POST /games/:gameId/builds`). */
  buildId: string | null;
  buildFileName: string | null;
  buildSizeMb: number | null;
  buildVersion: string;
  audience: PlaytestAudience;
  budget: PlaytestBudget;
}
