export type BuildStatus = 'PROCESSING' | 'VALID' | 'INVALID';

export type PluginVarTone = 'emerald' | 'sapphire' | 'amethyst';

/**
 * Uma linha das tabelas de gatilhos e de mapas de calor da etapa 3
 * (Figma `319:8624`), com a configuração escolhida pelo estúdio.
 */
export interface PluginDetection {
  id: string;
  /** Tipo da variável detectada, ex.: "Int", "Vector3.position". */
  varType: string;
  varTone: PluginVarTone;
  name: string;
  kind: string;
  /** `false` deixa "Quantidade controle" como "Indisponível". */
  amountEditable: boolean;
  /** Métricas que o tipo permite — as caixas da coluna "Ações". */
  metrics: string[];
  enabled: boolean;
  selectedMetrics: string[];
  amount: number | null;
}

export interface BuildInfo {
  id: string;
  gameId: string;
  fileName: string;
  sizeMb: number;
  version: string;
  sha256: string | null;
  /** Só VALID libera o Próximo da etapa 3 (Tela 08, RN-01). */
  status: BuildStatus;
  error: string | null;
  /** "Compatível com MAC / Windows" (Figma `319:8624`). */
  platforms: string[];
  plugin: {
    detected: boolean;
    enabled: boolean;
    sdkVersion: string | null;
    triggers: PluginDetection[];
    heatmaps: PluginDetection[];
  };
  createdAt: string;
}

/** Ajuste das plataformas em que a build roda. */
export interface UpdateBuildPayload {
  platforms: string[];
}

/** "Configurar gatilhos" e "Remover Plug-in". */
export interface UpdatePluginPayload {
  enabled: boolean;
  items?: { id: string; enabled: boolean; selectedMetrics: string[]; amount?: number | null }[];
}

/**
 * Manifesto que o SDK do Orbit Plug-in grava dentro da build, entre os
 * marcadores `<<ORBITPLAY_PLUGIN>>` e `<</ORBITPLAY_PLUGIN>>`. É o que a API
 * procura para dizer se a build tem o plug-in.
 */
export interface PluginManifest {
  sdkVersion: string;
  triggers: { name: string; varType: string; kind: string; metrics?: string[]; amountEditable?: boolean }[];
  heatmaps: { name: string; varType: string; kind: string; metrics?: string[] }[];
}

/** O que o app do tester precisa para baixar e conferir a build (Tela 16). */
export interface BuildDownloadInfo {
  testId: string;
  fileName: string;
  sizeMb: number;
  version: string;
  /** Para comparar com a cópia local antes de iniciar (Tela 16, RN-05). */
  sha256: string | null;
  /** Relativo a VITE_API_URL. Aceita `Range`, então o download pode ser retomado (Tela 16, RN-04). */
  downloadPath: string;
}
