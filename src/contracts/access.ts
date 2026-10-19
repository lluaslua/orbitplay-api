import type { UserStatus } from './auth';

/** Contratos da tela "Gerenciamento de acessos" — `GET /studio/access` e as ações dos modais. */
export interface AccessPermissions {
  /** Coluna "Criar/Editar usuário". */
  manageUsers: boolean;
  /** Coluna "Excluir usuário". */
  deleteUsers: boolean;
}

export interface AccessUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  status: UserStatus;
  /** Dono do estúdio: ganha a tag "ADM" e não pode ser removido. */
  admin: boolean;
  /** Nomes dos grupos, na ordem em que a tabela os lista. */
  groups: string[];
  lastAccessAt: string | null;
  permissions: AccessPermissions;
}

export interface AccessGroupMember {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface AccessGroup {
  id: string;
  name: string;
  /** Grupo sem participantes fica INACTIVE. */
  status: 'ACTIVE' | 'INACTIVE';
  members: AccessGroupMember[];
}

export interface AccessSummary {
  activeUsers: number;
  groups: number;
  pendingInvites: number;
  admins: number;
}

export interface AccessOverview {
  summary: AccessSummary;
  users: AccessUser[];
  groups: AccessGroup[];
}

export interface AccessUserPatch {
  status?: 'ACTIVE' | 'INACTIVE';
  permissions?: Partial<AccessPermissions>;
}

export interface AccessGroupPatch {
  name?: string;
  memberIds?: string[];
}
