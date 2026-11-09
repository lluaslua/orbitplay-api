/**
 * O que acontece entre "Começar" e o formulário: consentimento, progresso,
 * eventos e gravação (Handoff, Telas 16 e 17) — e a aprovação do estúdio depois.
 */

/**
 * Eventos com o tempo da sessão. Os seis primeiros viram a linha do tempo do
 * relatório (`TimelineEvent`); MIC/CAM registram o que o jogador ligou ou
 * desligou (Tela 17, RN-04); TRIGGER e POSITION vêm do Orbit Plug-in.
 */
export type SessionEventType =
  | 'BUG'
  | 'DEATH'
  | 'CHECKPOINT'
  | 'RAGE_QUIT'
  | 'HIGHLIGHT'
  | 'COMMENT'
  | 'MIC_ON'
  | 'MIC_OFF'
  | 'CAM_ON'
  | 'CAM_OFF'
  | 'TRIGGER'
  | 'POSITION';

/** "Solicitar novo teste" na tela da sessão (Figma `329:9178`). */
export interface RetestPayload {
  /** Outro teste ativo do mesmo jogo. Sem ele, vai o mais recente. */
  testId?: string;
  message?: string;
}

export interface RetestInviteInfo {
  id: string;
  sessionId: string;
  testId: string;
  testTitle: string;
  playerId: string;
  message: string | null;
  createdAt: string;
}

export interface SessionEventInput {
  atSecond: number;
  type: SessionEventType;
  /** Em TRIGGER, o nome do gatilho; em POSITION, o nome do mapa. */
  label: string;
  detail?: string;
  payload?: Record<string, unknown>;
}

/** Consentimentos pedidos no tutorial, antes de a gravação começar (Tela 16 RN-02, Tela 17 RN-01). */
export interface ConsentPayload {
  recording: boolean;
  microphone: boolean;
  webcam: boolean;
}

/**
 * Como foi o jogo que o app abriu (Tela 17). Quem classifica é a API, pelo
 * tempo ativo que ela mesma somou — é o que libera ou não o formulário.
 *
 * - NOT_OPENED: o jogo nunca abriu pelo app.
 * - QUICK_EXIT: abriu e fechou antes do mínimo para avaliar.
 * - CRASHED: fechou com erro antes do mínimo; a avaliação abre e o estúdio vê o travamento.
 * - PARTIAL: jogou o mínimo para avaliar, mas não o tempo do teste.
 * - COMPLETE: jogou o tempo do teste.
 */
export type PlayOutcome = 'NOT_OPENED' | 'QUICK_EXIT' | 'CRASHED' | 'PARTIAL' | 'COMPLETE';

export interface PlayStatus {
  outcome: PlayOutcome;
  launches: number;
  activeSeconds: number;
  /** Abaixo disso o formulário não abre. */
  minSeconds: number;
  /** A partir disso o teste conta como completo. */
  targetSeconds: number;
  /** O app mandou batida há pouco: o jogo está aberto. */
  playing: boolean;
  lastExitCode: number | null;
}

/** Batida do app com o jogo aberto: os segundos de jogo ativo desde a anterior. */
export interface PlayHeartbeatPayload {
  activeSeconds: number;
}

/** O jogo fechou: os segundos ativos que faltavam mandar e o código de saída. */
export interface PlayClosePayload {
  activeSeconds: number;
  /** `null` quando o app não sabe (o jogo fechou por outro processo). */
  exitCode: number | null;
}

/** Progresso do teste em andamento, 0 a 1 — as barras das tabelas do jogador. */
export interface ProgressPayload {
  progress: number;
}

/** Aprovação do estúdio: libera ou recusa a recompensa (Tela 19, RN-01 e RN-04). */
export interface SessionValidationPayload {
  approved: boolean;
  note?: string;
}

/** "Avaliar/agradecer" na tela da sessão (Tela 12). */
export interface SessionFeedbackPayload {
  /** 1 a 5. */
  rating: number;
  message?: string;
}
