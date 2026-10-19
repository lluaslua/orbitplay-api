export type ReportStatus = 'PROCESSING' | 'READY' | 'EMPTY';

/**
 * Tons de `Tag` usados nos relatórios.
 *
 * O arquivo não mantém a mesma cor para a mesma categoria em telas diferentes —
 * "Bugs & Acessibilidade" é rubi no detalhamento da sessão (`329:9178`) e topázio
 * no relatório do plug-in (`427:3376`) —, então a cor vem no dado, e cada tela
 * carrega a do seu frame.
 */
export type InsightTone =
  | 'emerald'
  | 'sapphire'
  | 'amethyst'
  | 'ruby'
  | 'topaz'
  | 'amber'
  | 'jade';

export interface TimelineEvent {
  id: string;
  atSecond: number;
  type: 'BUG' | 'DEATH' | 'CHECKPOINT' | 'RAGE_QUIT' | 'HIGHLIGHT' | 'COMMENT';
  label: string;
  detail?: string;
}

export interface AiInsight {
  id: string;
  title: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  category: 'UX' | 'BALANCE' | 'PERFORMANCE' | 'BUG' | 'ENGAGEMENT';
  confidence: number;
}

export interface Session {
  id: string;
  testId: string;
  testTitle: string;
  gameId: string;
  gameName: string;
  playerId: string;
  playerName: string;
  playerLevel: number;
  durationSeconds: number;
  feedbackQuality: number;
  bugsFound: number;
  overallRating: number;
  xpEarned: number;
  rewardCents: number;
  rewardStatus: 'PENDING' | 'VALIDATED' | 'PAID' | 'REJECTED';
  recordedAt: string;
  videoUrl: string | null;
  transcript: string;
  timeline: TimelineEvent[];
  insights: AiInsight[];
  answers: { question: string; answer: string }[];
}

export interface RatingBucket {
  rating: string;
  count: number;
}

export interface EvolutionPoint {
  label: string;
  sessions: number;
  averageRating: number;
  bugs: number;
}

/**
 * Detalhamento de uma sessão — Figma `329:9178`.
 *
 * É o zoom numa linha da tabela do relatório: a gravação com a transcrição
 * anotada pela IA, a classificação do testador, as notas por critério, os
 * gatilhos de telemetria e os insights daquela sessão.
 */
export interface SessionDetail {
  id: string;
  gameId: string;
  testName: string;
  testKind: string;
  /** `aiNote` só aparece nas falas que a IA comentou. */
  transcript: { at: string; text: string; aiNote?: string }[];
  classification: {
    archetype: string;
    archetypeTone: InsightTone;
    playerType: string;
    score: number;
    funFactor: number;
    /** 0 a 1. */
    engagement: number;
    insights: number;
  };
  evaluation: {
    score: number;
    criteria: { name: string; score: number; note: string }[];
  };
  telemetry: {
    triggers: number;
    suggestions: number;
    total: number;
    events: { id: string; trigger: string; at: string; duration: string; reaction: string; insight: string }[];
  };
  insights: ReportInsight[];
}

/** Uma linha da tabela de sessões do relatório. */
export interface ReportSessionRow {
  id: string;
  date: string;
  archetype: string;
  archetypeTone: InsightTone;
  playerType: string;
  durationSeconds: number;
  aiScore: number;
  plugin: boolean;
}

/** Um card do bloco "Insights de IA". */
export interface ReportInsight {
  id: string;
  title: string;
  category: string;
  categoryTone: InsightTone;
  text: string;
  /** Sessão de onde o insight saiu, quando saiu de uma. */
  sessionId?: string | null;
  /** "Gravação - 05:15". */
  at?: string | null;
}

/**
 * Aba "Todas as Avaliações" do relatório (Figma `326:6452`): cada pergunta do
 * formulário com o resumo das respostas.
 */
export interface ReportAnswers {
  testId: string;
  totalSessions: number;
  /** "Tempo médio da avaliação", em segundos. */
  avgFormSeconds: number;
  /** "Taxa de desistência", 0 a 1: começou e não enviou. */
  dropoutRate: number;
  questions: ReportQuestionSummary[];
}

export interface ReportQuestionSummary {
  id: string;
  number: string;
  label: string;
  type: string;
  answers: number;
  /** Escalas: média e distribuição por valor (índice 0 = menor valor). */
  average?: number;
  distribution?: { label: string; count: number }[];
  /** Escolhas: quantas vezes cada opção foi marcada. */
  options?: { label: string; count: number }[];
  /** Texto: as respostas, paginadas por `?questionId=&page=`. */
  texts?: { sessionId: string; text: string; date: string }[];
  /** Total de respostas em texto, para o rodapé de paginação. */
  totalTexts?: number;
}

/**
 * Relatório de um teste — Figma `326:6452`.
 *
 * Cada campo corresponde a um bloco da tela, na ordem em que aparecem: a faixa
 * "Geral", a evolução por semana, o resumo das avaliações, a telemetria do
 * plug-in, as duas roscas de público, a tabela de sessões e os insights.
 */
export interface TestReport {
  testId: string;
  testTitle: string;
  gameId: string;
  kind: string;
  status: ReportStatus;
  description: string;

  geral: {
    totalTests: number;
    avgSessionSeconds: number;
    aiScore: number;
    testers: number;
    funFactor: number;
    bugs: number;
    /** 0 a 1. */
    retention: number;
  };

  /** Barras de "Evolução dos testes". */
  evolution: { label: string; tests: number }[];

  ratings: {
    totalQuestions: number;
    avgSeconds: number;
    /** 0 a 1. */
    dropoutRate: number;
    /** Pergunta com distribuição por nota (índice 0 = nota 1). */
    scaled: { title: string; distribution: number[]; average: number };
    /** Pergunta aberta, com algumas respostas em destaque. */
    open: { title: string; answers: number; quotes: string[] };
  };

  telemetry: {
    sessions: number;
    triggers: number;
    findings: number;
    suggestions: number;
    findingsList: string[];
    suggestionsList: string[];
  };

  /** Roscas de "Testadores & Arquétipos". */
  playerTypes: { label: string; value: number }[];
  archetypes: { label: string; value: number }[];

  sessions: ReportSessionRow[];
  totalSessions: number;

  insights: ReportInsight[];
}

/**
 * Relatório do plug-in de telemetria — Figma `427:3376`.
 *
 * Três blocos sob o cabeçalho do jogo: o heatmap de um mapa gravado, o
 * detalhamento de um gatilho e a mesma grade de insights de IA do relatório.
 * Os dois primeiros repetem a estrutura "números + seletor + duas colunas de
 * cards", então dividem o mesmo formato em `PluginBlock`.
 */
export interface PluginReport {
  testId: string;
  gameId: string;
  testName: string;
  testKind: string;

  /** Faixa de cinco números logo abaixo do cabeçalho. */
  geral: {
    sessions: number;
    heatmaps: number;
    activeTriggers: number;
    findings: number;
    suggestions: number;
  };

  heatmap: PluginBlock & {
    /** Mapa desenhado no arquivo; o seletor abre só o que existe. */
    maps: string[];
    imageUrl: string;
  };

  triggers: PluginBlock & {
    /** Gatilhos disponíveis no seletor. */
    names: string[];
    /** Os seis campos do gatilho selecionado. */
    detail: {
      name: string;
      type: string;
      typeTone: InsightTone;
      presence: string;
      activations: string;
      averageRate: string;
      averageTime: string;
    };
  };

  insights: ReportInsight[];
}

/** Os números e as duas colunas de cards que os blocos do plug-in repetem. */
export interface PluginBlock {
  registered: number;
  suggestions: number;
  selected: string;
  findings: ReportInsight[];
  aiSuggestions: ReportInsight[];
}

/** Linha do card "Benchmark de mercado" (Figma 291:1439). */
export interface BenchmarkRow {
  id: string;
  name: string;
  /** 0 a 1. */
  progress: number;
  rewardCents: number;
}

/**
 * Painel do estúdio, modelado a partir do frame "Home estúdio" (291:1257).
 *
 * Cada bloco corresponde a uma seção desenhada, na ordem em que aparece:
 * a barra de sete números, os três cards de estatística, o benchmark e a
 * tabela paginada.
 */
export interface StudioDashboard {
  /** Barra de sete números sob as boas-vindas (291:1334). */
  highlights: {
    gamesTested: number;
    testsRun: number;
    gameplayHours: number;
    averageRating: number;
    /** 0 a 1. */
    engagement: number;
    aiInsights: number;
    testsWithPlugin: number;
  };
  /** Card "Visão geral" (291:1391). */
  overview: { activeTests: number; playersPlaying: number; testsPerHour: number };
  /** Card "Fatores chave" (312:5838). */
  keyFactors: { funFactor: number; bugs: number; retention: number };
  /** Card "Plug-in telemetria" (312:5875). */
  plugin: { activePoints: number; triggers: number; aiInsights: number };
  benchmark: BenchmarkRow[];
  /**
   * Total de registros da tabela de testes, para o rodapé de paginação. As
   * linhas em si vêm de `useTests()`, não daqui — a Home e a tela de detalhes
   * do jogo mostram a mesma lista de `Playtest`, filtrada ou não por jogo.
   */
  totalTests: number;
  ratingsOverTime: { label: string; rating: number }[];
}
