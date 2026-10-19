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
