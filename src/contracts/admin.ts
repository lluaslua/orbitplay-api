/**
 * Central de gerenciamento de usuários — Handoff, Tela 20 (sem frame no Figma
 * ainda). Exclusiva de OWNER e ADMIN.
 */
import type { StudioPermission, UserRole, UserStatus } from './auth';
import type { WithdrawalInfo } from './wallet';

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** PENDING é convite ainda não aceito. */
  status: UserStatus;
  avatarUrl?: string;
  studio: { id: string; name: string; permission: StudioPermission } | null;
  createdAt: string;
}

/** A conta nasce PENDING e recebe o link para definir a senha — a senha nunca passa por aqui. */
export interface CreateUserPayload {
  name: string;
  email: string;
  role: UserRole;
  studioId?: string;
  studioPermission?: StudioPermission;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  studioId?: string | null;
  studioPermission?: StudioPermission | null;
}

/** Desativação lógica: a conta some do acesso, o histórico fica (RN-06). */
export interface UpdateUserStatusPayload {
  status: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateUserRolePayload {
  role: UserRole;
}

export interface AuditLogEntry {
  id: string;
  actor: { id: string; name: string };
  action: string;
  targetType: string;
  targetId: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface StudioSummary {
  id: string;
  name: string;
  cnpj: string | null;
  website: string | null;
  members: number;
  games: number;
  createdAt: string;
}

export interface CreateStudioPayload {
  name: string;
  cnpj?: string;
  website?: string;
}

export interface AdminWithdrawalRow extends WithdrawalInfo {
  player: { id: string; name: string; email: string };
}

export interface ProcessWithdrawalPayload {
  status: 'PAID' | 'REJECTED';
  note?: string;
}
