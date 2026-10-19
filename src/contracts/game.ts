export type GameStatus = 'ACTIVE' | 'DRAFT' | 'PAUSED' | 'ARCHIVED';

/** O rótulo de cada código vem em `GET /games/options` (PC aparece como "Windows"). */
export type Platform = 'PC' | 'MAC' | 'LINUX' | 'ANDROID' | 'IOS' | 'WEB' | 'CONSOLE';

/** A lista do campo "Gênero*" do Novo jogo — texto `1183:7598` do Figma, na mesma ordem. */
export type Genre =
  | 'Action'
  | 'Adventure'
  | 'RPG'
  | 'Strategy'
  | 'Simulation'
  | 'Sports'
  | 'Racing'
  | 'Fighting'
  | 'Shooter'
  | 'Platformer'
  | 'Puzzle'
  | 'Card Game'
  | 'Board Game'
  | 'Horror'
  | 'Survival'
  | 'Rhythm'
  | 'Party'
  | 'Casual'
  | 'Educational'
  | 'Visual Novel'
  | 'Sandbox'
  | 'MMO'
  | 'MOBA'
  | 'Battle Royale'
  | 'Stealth'
  | 'Roguelike'
  | 'Roguelite'
  | 'Tower Defense'
  | 'Auto Battler'
  | 'Idle'
  | 'Management'
  | 'Tycoon'
  | 'Life Sim'
  | 'Dating Sim'
  | 'Interactive Fiction'
  | 'Music Game'
  | 'Trivia'
  | 'Arcade'
  | 'Tactical'
  | 'Extraction'
  | 'Soulslike';

/** "Modo de jogo*" (dropdown `1186:8497`). */
export type GameMode = 'SINGLE_PLAYER' | 'MULTIPLAYER' | 'PVP' | 'PVE' | 'COOP';

/** "Engine" (dropdown `1186:8554`). */
export type GameEngine = 'UNITY' | 'UNREAL' | 'GODOT' | 'PROPRIETARY' | 'OTHER';

/** "Estágio de desenvolvimento*" (dropdown `1186:8611` e texto `1185:8349`). */
export type DevelopmentStage = 'CONCEPT' | 'PROTOTYPE' | 'ALPHA' | 'BETA' | 'EARLY_ACCESS' | 'RELEASED';

/** "Classificação indicativa*" (dropdown `1186:8640`). */
export type AgeRating = 'L' | '12' | '14' | '16' | '18';

export interface GameStats {
  activeTests: number;
  completedTests: number;
  totalPlayers: number;
  averageRating: number;
  bugsReported: number;
  pendingRewards: number;
  /** "Prêmio restante" do card de jogo — o que sobra da verba dos testes abertos. */
  remainingRewardCents: number;
  /** "Jogando agora" — simultâneos, diferente de `totalPlayers`, que é acumulado. */
  playingNow: number;
  /**
   * 0 a 1 — a barra azul no rodapé da capa, na tela de configuração de testes.
   * O Figma desenha a barra sem rótulo, então o valor vive como dado do jogo em
   * vez de ser derivado de uma fórmula inventada.
   */
  campaignProgress: number;
}

export interface Game {
  id: string;
  studioId: string;
  studioName: string;
  name: string;
  /** "Subtítulo / tagline*". */
  tagline: string;
  description: string;
  /** "Descrição curta*". */
  shortDescription: string;
  /** "Imagem de capa*", 16:9. */
  bannerUrl: string;
  /** "Ícone / thumbnail*", quadrada. */
  thumbnailUrl: string;
  /** "Logo*", PNG com fundo transparente. */
  logoUrl: string | null;
  /** "Trailer / vídeo*". */
  trailerUrl: string | null;
  status: GameStatus;
  genres: Genre[];
  /** "Sub-Gênero*" — as tags do texto `1183:7695`. */
  subGenres: string[];
  platforms: Platform[];
  gameModes: GameMode[];
  engine: GameEngine | null;
  developmentStage: DevelopmentStage | null;
  ageRating: AgeRating | null;
  /** Códigos BCP 47: "pt-BR", "en"... */
  languages: string[];
  /** O "Finalizar" do cadastro já passou. Sem ele, o jogo não recebe teste. */
  setupCompleted: boolean;
  buildVersion: string;
  minRewardCents: number;
  maxRewardCents: number;
  estimatedMinutes: number;
  stats: GameStats;
  /** Fim da janela de testes — vira "Termina em 27h 32m" na capa. `null` quando não há. */
  endsAt: string | null;
  /** Tag "Novo" na capa. */
  isNew: boolean;
  createdAt: string;
  updatedAt: string;
  specs: GameSpecs;
}

export interface GameSpecs {
  minOs: string;
  minCpu: string;
  minRam: string;
  minGpu: string;
  diskSpace: string;
  requiresController: boolean;
  requiresMicrophone: boolean;
  requiresWebcam: boolean;
}

/**
 * "Salvar" de qualquer passo do Novo jogo. Só o nome é obrigatório aqui; os
 * campos com * são cobrados no "Finalizar" (`POST /games/:id/finish-setup`).
 */
export interface CreateGamePayload {
  name: string;
  tagline?: string;
  shortDescription?: string;
  description?: string;
  /**
   * Imagens do passo Mídias: URL ou a própria imagem em data URL (como o app
   * guarda o rascunho) — a API grava o arquivo e devolve a URL pública.
   */
  bannerUrl?: string;
  logoUrl?: string | null;
  thumbnailUrl?: string | null;
  /**
   * Os campos de lista aceitam o código (`Racing`, `SINGLE_PLAYER`) ou o rótulo
   * que a tela mostra (`Corrida`, `Single Player`). A resposta sempre traz o código.
   */
  genres?: (Genre | string)[];
  subGenres?: string[];
  platforms?: (Platform | string)[];
  gameModes?: (GameMode | string)[];
  engine?: GameEngine | string | null;
  developmentStage?: DevelopmentStage | string | null;
  ageRating?: AgeRating | string | null;
  languages?: string[];
  trailerUrl?: string | null;
}

export interface OptionItem<T extends string = string> {
  value: T;
  label: string;
}

/** As listas dos dropdowns do Novo jogo — `GET /games/options`. */
export interface GameOptions {
  genres: OptionItem<Genre>[];
  subGenres: OptionItem[];
  platforms: OptionItem<Platform>[];
  gameModes: OptionItem<GameMode>[];
  engines: OptionItem<GameEngine>[];
  developmentStages: OptionItem<DevelopmentStage>[];
  ageRatings: OptionItem<AgeRating>[];
  languages: OptionItem[];
}

/** Abas de "Jogos disponíveis" (Figma `849:2926`) e da landing (`151:2272`). */
export type CatalogTab = 'POPULAR' | 'TOP_PAYING' | 'NEW' | 'ELITE' | 'COMMUNITIES';

/**
 * Card de jogo da landing pública — só o que o card desenha, sem nada de
 * quem está vendo (não há login).
 */
export interface PublicGameCard {
  id: string;
  name: string;
  studioName: string;
  bannerUrl: string;
  thumbnailUrl: string;
  genres: string[];
  isNew: boolean;
  endsAt: string | null;
  playingNow: number;
  openTests: number;
  maxRewardCents: number;
  remainingRewardCents: number;
  eliteOnly: boolean;
}

/** Linha da aba "Avaliações" do jogo, somando todos os testes (Figma `312:7015`). */
export interface GameReviewRow {
  sessionId: string;
  testId: string;
  testTitle: string;
  playerName: string;
  date: string;
  /** 0 a 5. */
  overallRating: number | null;
  feedbackQuality: number;
  bugsFound: number;
  /** A resposta aberta mais longa da sessão — é o comentário da linha. */
  comment: string | null;
}

/** Conquista do jogo como o estúdio cadastra (aba "Conquistas", Figma `312:7015`). */
export interface GameAchievementConfig {
  id: string;
  gameId: string | null;
  title: string;
  description: string;
  icon: string;
  /** Regra automática (`GAME_ACHIEVEMENT_RULES`); `null` é dada à mão. */
  rule: string | null;
  position: number;
  unlockedCount: number;
}

export interface GameAchievementPayload {
  title: string;
  description: string;
  icon?: string;
  rule?: string | null;
  position?: number;
}
