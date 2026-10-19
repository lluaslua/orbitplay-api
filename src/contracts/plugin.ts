/**
 * O OrbitPlug-in dentro da Unity (Figma `423:2774`, `425:3032`, `423:3000`) e o
 * que ele troca com a API: o código de acesso, a configuração de mapas e
 * gatilhos e a telemetria enviada pelo jogo durante o teste.
 */

/** Código de acesso gerado pelo estúdio. O código inteiro só aparece na criação. */
export interface PluginKeyInfo {
  id: string;
  gameId: string;
  name: string;
  /** "opk_…a1b2" — para reconhecer o código na lista. */
  preview: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedPluginKey extends PluginKeyInfo {
  /** Mostrado uma única vez: a API guarda só o hash. */
  code: string;
}

/** "Validar código de acesso" — o que o plug-in mostra depois de validar. */
export interface PluginValidation {
  valid: true;
  gameId: string;
  gameName: string;
  studioName: string;
  /** Configuração já enviada antes, para o Inspector abrir preenchido. */
  config: PluginConfig | null;
}

/** De onde vem a causa da morte ("Diagnóstico de Causa da Morte"). */
export type DeathCauseTracking = 'COLLISION' | 'CODE' | 'ERROR';

/** Lógica do gatilho: "On Change", "Threshold" ou "Cumulative". */
export type TriggerLogic = 'ON_CHANGE' | 'THRESHOLD' | 'CUMULATIVE';

/** "Mapa 1 / Parâmetros do Mapa" do componente Orbit_Heatmap.cs. */
export interface PluginMapConfig {
  name: string;
  /** "Objeto alvo", ex.: "Player (Transform)". */
  targetObject: string;
  deathCondition?: {
    script: string;
    variable: string;
    /** "<=", "<", "==", ">=", ">". */
    operator: string;
    value: number;
  };
  deathCauseTracking: DeathCauseTracking[];
  /** Mapa 2D ou 3D — muda o botão "3D" do relatório. */
  dimensions?: 2 | 3;
}

/** "Trigger 1 / Parâmetros do Gatilho" do componente Orbit_Triggers.cs. */
export interface PluginTriggerConfig {
  name: string;
  /** "Variável/função alvo", ex.: "()Especial_01". */
  target: string;
  /** "Tipo do gatilho": Int, Float, Bool, Time.DeltaTime, Vector3... */
  valueType: string;
  logic: TriggerLogic;
  /** Só no THRESHOLD: o valor que dispara, ex.: vida <= 0. */
  threshold?: number;
  /** Veio do "Auto-Scout" em vez de ser cadastrado à mão. */
  autoScouted?: boolean;
}

export interface PluginConfig {
  sdkVersion: string | null;
  maps: PluginMapConfig[];
  triggers: PluginTriggerConfig[];
  updatedAt: string;
}

/** "Baixar plug-in", "Ver documentação" e "Abrir site". */
export interface PluginInfo {
  sdkVersion: string;
  downloadUrl: string;
  docsUrl: string;
  siteUrl: string;
  engines: string[];
}

/** Token que o app passa para a build ao abrir o jogo; o plug-in manda a telemetria com ele. */
export interface TelemetryToken {
  token: string;
  expiresAt: string;
  /** Relativo a VITE_API_URL. */
  endpoint: string;
}

/** Evento que o plug-in manda do jogo. */
export interface TelemetryEventInput {
  atSecond: number;
  type: 'TRIGGER' | 'POSITION' | 'DEATH';
  /** TRIGGER: nome do gatilho. POSITION e DEATH: nome do mapa. */
  label: string;
  /** TRIGGER: valor da variável. */
  value?: number;
  /** POSITION e DEATH: posição no mundo. */
  x?: number;
  y?: number;
  z?: number;
  /** DEATH: o que o "Diagnóstico de Causa da Morte" registrou. */
  cause?: DeathCauseTracking;
  detail?: string;
}

/** Uma célula do mapa de calor exportado. */
export interface HeatmapCell {
  x: number;
  y: number;
  z: number;
  /** Amostras de posição na célula. */
  samples: number;
  deaths: number;
  /** 0 a 1, relativo à célula mais cheia. */
  density: number;
}

export interface HeatmapExport {
  map: string;
  cellSize: number;
  sessions: number;
  totalSamples: number;
  totalDeaths: number;
  /** Deslocamento aplicado para levar o mapa a 0,0,0 ("Move to 0,0,0"). */
  origin: { x: number; y: number; z: number };
  cells: HeatmapCell[];
}
