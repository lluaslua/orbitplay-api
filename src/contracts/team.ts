import type { StudioPermission, UserStatus } from './auth';

/**
 * Equipe do estúdio e permissões por jogo — o passo "Permissões" do Novo jogo
 * (Figma `1187:9418`) e o modal "Adicionar membro ou grupo" (`1188:10038`).
 */

/**
 * As quatro colunas da tabela de permissões, na ordem do Figma:
 *
 *   MANAGE_ACCESS  Editar permissões/excluir projeto
 *   EDIT_INFO      Editar informações gerais
 *   MANAGE_TESTS   Criar/editar testes
 *   VIEW_REPORTS   Acessar relatórios
 */
export type GamePermission = 'MANAGE_ACCESS' | 'EDIT_INFO' | 'MANAGE_TESTS' | 'VIEW_REPORTS';

/** Membro do estúdio — a lista "Membros:" do modal e o autocomplete com @. */
export interface StudioMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  /** Permissão na organização inteira. MANAGE pode tudo em todos os jogos. */
  permission: StudioPermission;
  groups: { id: string; name: string }[];
}

/** Grupo do estúdio — "Diretores (2 perfis)". */
export interface StudioGroup {
  id: string;
  name: string;
  memberCount: number;
  members: { id: string; name: string; avatarUrl: string | null }[];
}

/** Convite de um membro novo: a conta nasce PENDING e recebe o link para criar a senha. */
export interface InviteMemberPayload {
  name: string;
  email: string;
  permission?: StudioPermission;
  groupIds?: string[];
}

export interface UpdateMemberPayload {
  permission?: StudioPermission;
  groupIds?: string[];
}

export interface GroupPayload {
  name: string;
  memberIds?: string[];
}

/**
 * `GET /studio/team` — os grupos e membros que o modal "Adicionar membro ou
 * grupo" do Novo jogo oferece (Figma `1188:10038`).
 */
export interface StudioTeamGroup {
  id: string;
  name: string;
  memberCount: number;
}

export interface StudioTeamMember {
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface StudioTeam {
  groups: StudioTeamGroup[];
  members: StudioTeamMember[];
}

/** Uma linha da tabela de permissões do jogo: um membro ou um grupo. */
export interface GameAccessEntry {
  id: string;
  kind: 'MEMBER' | 'GROUP';
  /** Id do membro ou do grupo. */
  targetId: string;
  name: string;
  avatarUrl: string | null;
  /** Só nos grupos: "(25 perfis)". */
  memberCount?: number;
  permissions: GamePermission[];
}

export interface GameAccessPayload {
  entries: { userId?: string; groupId?: string; permissions: GamePermission[] }[];
}

/** O que quem está vendo pode fazer no jogo — para o app esconder botões. */
export interface MyGameAccess {
  gameId: string;
  permissions: GamePermission[];
}
