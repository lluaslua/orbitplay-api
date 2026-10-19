import type {
  AgeRating,
  ArchetypeId,
  CatalogTab,
  DeathCauseTracking,
  DevelopmentStage,
  GameEngine,
  GameMode,
  GamePermission,
  Genre,
  InsightTone,
  LoginTab,
  OptionItem,
  PaymentMethod,
  Platform,
  PlayerTypeId,
  QuestionType,
  RankingPeriod,
  SessionEventType,
  StudioPermission,
  TestLocation,
  TestModel,
  TriggerLogic,
  UserRole,
} from '../../contracts';

/**
 * Os contratos são só tipos; a validação dos DTOs precisa dos valores em tempo
 * de execução. O `Record` obriga a citar cada membro da união — acrescentar um
 * valor em src/contracts sem acrescentar aqui não compila.
 */
function membros<T extends string>(todos: Record<T, true>): T[] {
  return Object.keys(todos) as T[];
}

export const USER_ROLES = membros<UserRole>({ OWNER: true, ADMIN: true, STUDIO: true, PLAYER: true });

export const LOGIN_TABS = membros<LoginTab>({ STUDIO: true, PLAYER: true });

export const STUDIO_PERMISSIONS = membros<StudioPermission>({ MANAGE: true, EDIT: true, VIEW: true });

/** "Gênero*" do Novo jogo — o texto `1183:7598` do Figma, na mesma ordem. */
export const GENRES = membros<Genre>({
  Action: true,
  Adventure: true,
  RPG: true,
  Strategy: true,
  Simulation: true,
  Sports: true,
  Racing: true,
  Fighting: true,
  Shooter: true,
  Platformer: true,
  Puzzle: true,
  'Card Game': true,
  'Board Game': true,
  Horror: true,
  Survival: true,
  Rhythm: true,
  Party: true,
  Casual: true,
  Educational: true,
  'Visual Novel': true,
  Sandbox: true,
  MMO: true,
  MOBA: true,
  'Battle Royale': true,
  Stealth: true,
  Roguelike: true,
  Roguelite: true,
  'Tower Defense': true,
  'Auto Battler': true,
  Idle: true,
  Management: true,
  Tycoon: true,
  'Life Sim': true,
  'Dating Sim': true,
  'Interactive Fiction': true,
  'Music Game': true,
  Trivia: true,
  Arcade: true,
  Tactical: true,
  Extraction: true,
  Soulslike: true,
});

/** Os gêneros em português do cadastro antigo, para converter jogos e buscas antigas. */
export const LEGACY_GENRES: Record<string, Genre> = {
  Ação: 'Action',
  Aventura: 'Adventure',
  Corrida: 'Racing',
  Estratégia: 'Strategy',
  Simulação: 'Simulation',
  Esporte: 'Sports',
  Terror: 'Horror',
};

/** "Sub-Gênero*" — as tags do texto `1183:7695` do Figma, na mesma ordem. */
export const SUB_GENRES: string[] = [
  'Deckbuilding', 'Collectible Card Game', 'Trading Card Game', 'Tactical RPG', 'Action RPG', 'JRPG', 'CRPG',
  'MMORPG', 'Metroidvania', 'Soulslike', 'Hack and Slash', 'Beat ’em Up', 'Twin-Stick Shooter', 'Bullet Hell',
  'Shoot ’em Up', 'Hero Shooter', 'Tactical Shooter', 'Arena Shooter', 'Extraction Shooter', 'Survival Horror',
  'Psychological Horror', 'Roguelike', 'Roguelite', 'Dungeon Crawler', 'Open World', 'Sandbox', 'Narrative Adventure',
  'Point-and-Click', 'Walking Simulator', 'Puzzle Platformer', 'Precision Platformer', 'Rhythm Action',
  'Real-Time Strategy', 'Turn-Based Strategy', '4X', 'Grand Strategy', 'Tactical Strategy', 'Tower Defense',
  'Auto Battler', 'MOBA', 'Battle Royale', 'Social Deduction', 'Party Game', 'Cozy', 'Farming Sim', 'Life Sim',
  'City Builder', 'Colony Sim', 'Management Sim', 'Tycoon', 'Vehicle Simulation', 'Sports Management',
  'Kart Racing', 'Arcade Racing', 'Sim Racing', 'Fighting 2D', 'Fighting 3D', 'Platform Fighter', 'Visual Novel',
  'Dating Sim', 'Interactive Fiction', 'Idle', 'Incremental', 'Clicker', 'Match-3', 'Hidden Object', 'Trivia',
  'Educational', 'PvP', 'PvE', 'Co-op', 'Local Multiplayer', 'Online Multiplayer', 'Asynchronous Multiplayer',
  'Competitive', 'Casual', 'Hardcore', 'Procedural', 'Narrative-Driven', 'Exploration', 'Crafting', 'Base Building',
  'Resource Management', 'Character Collection', 'Gacha', 'Monster Taming', 'Creature Collector',
  'Deck Construction', 'Drafting', 'Autobattle', 'Permadeath', 'Extraction', 'Boss Rush', 'Wave Survival',
  'Horde Mode', 'Time Management', 'Stealth', 'Immersive Sim', 'Physics-Based', 'Parkour', 'Rhythm', 'Tactical',
  'Turn-Based', 'Real-Time', 'Isometric', 'Side-Scrolling', 'Top-Down', 'First-Person', 'Third-Person',
];

export const PLATFORMS = membros<Platform>({
  PC: true,
  MAC: true,
  LINUX: true,
  ANDROID: true,
  IOS: true,
  WEB: true,
  CONSOLE: true,
});

/** O dropdown "Plataformas*" (`1186:8388`) chama o PC de Windows. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  PC: 'Windows',
  MAC: 'macOS',
  LINUX: 'Linux',
  ANDROID: 'Android',
  IOS: 'iOS',
  WEB: 'Web',
  CONSOLE: 'Console',
};

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  SINGLE_PLAYER: 'Single Player',
  MULTIPLAYER: 'Multiplayer',
  PVP: 'PvP',
  PVE: 'PvE',
  COOP: 'Co-op',
};
export const GAME_MODES = Object.keys(GAME_MODE_LABELS) as GameMode[];

export const ENGINE_LABELS: Record<GameEngine, string> = {
  UNITY: 'Unity',
  UNREAL: 'Unreal',
  GODOT: 'Godot',
  PROPRIETARY: 'Proprietária',
  OTHER: 'Outra',
};
export const ENGINES = Object.keys(ENGINE_LABELS) as GameEngine[];

export const DEV_STAGE_LABELS: Record<DevelopmentStage, string> = {
  CONCEPT: 'Conceito',
  PROTOTYPE: 'Protótipo',
  ALPHA: 'Alpha',
  BETA: 'Beta',
  EARLY_ACCESS: 'Early Access',
  RELEASED: 'Lançado',
};
export const DEV_STAGES = Object.keys(DEV_STAGE_LABELS) as DevelopmentStage[];

/** Estágios em que a build ainda é experimental — "Cobaia de Protótipo". */
export const EXPERIMENTAL_STAGES: DevelopmentStage[] = ['CONCEPT', 'PROTOTYPE', 'ALPHA'];

export const AGE_RATING_LABELS: Record<AgeRating, string> = {
  L: 'Livre (L)',
  '12': '12 Anos',
  '14': '14 Anos',
  '16': '16 Anos',
  '18': '18 Anos',
};
export const AGE_RATINGS = Object.keys(AGE_RATING_LABELS) as AgeRating[];

/** "Idiomas disponíveis" — o dropdown do Figma (`1187:8677`) começa por português e inglês. */
export const LANGUAGES: OptionItem[] = [
  { value: 'pt-BR', label: 'Português' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
  { value: 'fr', label: 'Francês' },
  { value: 'de', label: 'Alemão' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: 'Japonês' },
  { value: 'ko', label: 'Coreano' },
  { value: 'zh', label: 'Chinês' },
];
export const LANGUAGE_CODES = LANGUAGES.map((idioma) => idioma.value);

/** Idiomas da interface (seletor "PT" da navbar). */
export const UI_LOCALES = ['pt-BR', 'en', 'es'];

export const GAME_PERMISSIONS = membros<GamePermission>({
  MANAGE_ACCESS: true,
  EDIT_INFO: true,
  MANAGE_TESTS: true,
  VIEW_REPORTS: true,
});

export const CATALOG_TABS = membros<CatalogTab>({
  POPULAR: true,
  TOP_PAYING: true,
  NEW: true,
  ELITE: true,
  COMMUNITIES: true,
});

export const RANKING_PERIODS = membros<RankingPeriod>({ week: true, month: true, all: true });

export const DEATH_CAUSES = membros<DeathCauseTracking>({ COLLISION: true, CODE: true, ERROR: true });

export const TRIGGER_LOGICS = membros<TriggerLogic>({ ON_CHANGE: true, THRESHOLD: true, CUMULATIVE: true });

/** Tier que abre a aba "Exclusivos ELITE". */
export const ELITE_TIER = 'ELITE';

/**
 * Regras de conquista que o estúdio pode escolher para o jogo. Contagem vira
 * o "5/10" da tela de conclusão (`target`).
 */
export const GAME_ACHIEVEMENT_RULES: Record<string, { label: string; target?: number }> = {
  GAME_FIRST_TEST: { label: 'Primeira sessão no jogo', target: 1 },
  GAME_TESTS_10: { label: '10 sessões no jogo', target: 10 },
  FEEDBACK_100_CHARS: { label: 'Feedback com mais de 100 caracteres' },
  BUG_CONFIRMED: { label: 'Bug reportado em sessão aprovada pelo estúdio' },
  AI_INSIGHT_SOURCE: { label: 'Sessão usada em um insight de IA' },
  EXPERIMENTAL_BUILD: { label: 'Jogou uma build em Conceito, Protótipo ou Alpha' },
  GAME_FIRST_REWARD: { label: 'Primeiro pagamento no jogo' },
};

export const TEST_MODELS = membros<TestModel>({
  TELEMETRY: true,
  FREE_EXPLORATION: true,
  AB_TEST: true,
  AB_IMAGES: true,
});

export const QUESTION_TYPES = membros<QuestionType>({
  SHORT_TEXT: true,
  PARAGRAPH: true,
  MULTIPLE_CHOICE: true,
  CHECKBOXES: true,
  DROPDOWN: true,
  FILE_UPLOAD: true,
  LINEAR_SCALE: true,
  RATING: true,
  MULTIPLE_CHOICE_GRID: true,
  CHECKBOX_GRID: true,
  DATE: true,
  TIME: true,
});

export const TEST_LOCATIONS = membros<TestLocation>({ BRASIL: true, EUA: true, GLOBAL: true });

export const PLAYER_TYPE_IDS = membros<PlayerTypeId>({
  ALL: true,
  CASUAL: true,
  EXPERIENT: true,
  TRAINED: true,
  QA: true,
});

export const ARCHETYPE_IDS = membros<ArchetypeId>({
  ALL: true,
  CONQUEROR: true,
  EXPLORER: true,
  SOCIALIZER: true,
  KILLER: true,
});

export const PAYMENT_METHODS = membros<PaymentMethod>({ PIX: true, BOLETO: true, CARD: true, PAYPAL: true });

export const SESSION_EVENT_TYPES = membros<SessionEventType>({
  BUG: true,
  DEATH: true,
  CHECKPOINT: true,
  RAGE_QUIT: true,
  HIGHLIGHT: true,
  COMMENT: true,
  MIC_ON: true,
  MIC_OFF: true,
  CAM_ON: true,
  CAM_OFF: true,
  TRIGGER: true,
  POSITION: true,
});

/** Os eventos que viram a linha do tempo do relatório (`TimelineEvent`). */
export const TIMELINE_EVENT_TYPES = ['BUG', 'DEATH', 'CHECKPOINT', 'RAGE_QUIT', 'HIGHLIGHT', 'COMMENT'] as const;

/** O campo do chat e a API usam o mesmo limite (orbitplay-app/src/utils/constants.ts). */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;

/** Faixa etária do público — os limites do slider da etapa 4 (o 99 aparece como "99+"). */
export const AUDIENCE_AGE = { min: 16, max: 99 } as const;

/** "Quantidade de teste" da etapa 4. */
export const TEST_SLOTS = { min: 1, max: 1000 } as const;

/**
 * Tipos de pergunta que não existem sem opções (Handoff, Tela 07, RN-02). As
 * grades têm regra própria: linhas em `options` e colunas em `columns`.
 */
export const OPTION_QUESTION_TYPES: QuestionType[] = ['MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN'];

/** Grades: `options` são as linhas e `columns` as colunas; a resposta é "Linha: Coluna". */
export const GRID_QUESTION_TYPES: QuestionType[] = ['MULTIPLE_CHOICE_GRID', 'CHECKBOX_GRID'];
export const MIN_GRID_COLUMNS = 2;

/** Os tipos de resposta escrita — os únicos que pesam como texto na nota de qualidade. */
export const TEXT_QUESTION_TYPES: QuestionType[] = ['SHORT_TEXT', 'PARAGRAPH'];

/** Escolha com uma opção só não é escolha. */
export const MIN_QUESTION_OPTIONS = 2;

/** Rótulo do modelo no card do catálogo do jogador (`AvailableTest.modelLabel`). */
export const TEST_MODEL_LABELS: Record<TestModel, string> = {
  TELEMETRY: 'Exploração livre + Telemetria',
  FREE_EXPLORATION: 'Exploração livre',
  AB_TEST: 'Teste A/B',
  AB_IMAGES: 'Teste A/B de imagens',
};

/** Tom da tag de arquétipo nas tabelas do relatório. */
export const ARCHETYPE_TONES: Record<ArchetypeId, InsightTone> = {
  ALL: 'amethyst',
  CONQUEROR: 'amber',
  EXPLORER: 'emerald',
  SOCIALIZER: 'sapphire',
  KILLER: 'ruby',
};

/** Preço do "Impulsionar teste!" quando a tabela `Setting` não tem o valor. */
export const DEFAULT_BOOST_CENTS = 15;

/** Saque mínimo da carteira do jogador. */
export const MIN_WITHDRAWAL_CENTS = 2000;

/** Validade do link de redefinição de senha. */
export const RESET_TOKEN_TTL_MINUTES = 60;
