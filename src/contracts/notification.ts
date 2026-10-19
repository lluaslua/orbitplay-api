/** O sino da navbar e o "avisaremos você" da conclusão do teste (Figma `287:4911`). */
export type NotificationType =
  | 'REWARD_RELEASED'
  | 'REWARD_REJECTED'
  | 'WITHDRAWAL_PAID'
  | 'WITHDRAWAL_REJECTED'
  | 'STUDIO_THANKS'
  | 'RETEST_INVITE'
  | 'ACHIEVEMENT_UNLOCKED'
  | 'SESSION_SUBMITTED'
  | 'TEST_PUBLISHED'
  | 'TEST_FINISHED'
  | 'REPORT_READY'
  | 'GAME_ACCESS_GRANTED'
  | 'TEAM_INVITE';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Rota do app (HashRouter), ex.: "/player/games/game-101". */
  link: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}
