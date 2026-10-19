/** Card "Missões e Ranking" da Home do jogador (Figma `197:496`). */
export type RankingPeriod = 'week' | 'month' | 'all';

export interface RankingRow {
  position: number;
  playerId: string;
  name: string;
  avatarUrl: string | null;
  tier: string;
  level: number;
  /** XP ganho no período. */
  xp: number;
  sessions: number;
}

export interface PlayerRanking {
  period: RankingPeriod;
  /** Top 10 — o Figma prevê recompensa para eles. */
  top: RankingRow[];
  /** Quem está vendo. `null` se ainda não pontuou no período. */
  me: RankingRow | null;
  /** Posições que subiu desde o período anterior (negativo: desceu). */
  delta: number;
  totalPlayers: number;
}

/** Conteúdo do tutorial do teste (Figma `224:7273` a `224:7540`). */
export interface TutorialContent {
  title: string;
  intro: string;
  video: { title: string; description: string; url: string };
  observe: { title: string; items: { title: string; text: string }[] };
  tips: { title: string; items: { title: string; text: string }[] };
  ready: { title: string; text: string; warning: string };
}

/** "Instale o OrbitPlay / Também disponível para:" da landing (Figma `181:605`). */
export interface AppDownload {
  platform: string;
  label: string;
  url: string;
  version: string;
}
