import type { ArchetypeId, PlayerTypeId, TestLocation } from './test';

/** OWNER e ADMIN administram a plataforma (Handoff, Tela 20) e entram por qualquer aba do login. */
export type UserRole = 'OWNER' | 'ADMIN' | 'STUDIO' | 'PLAYER';

/** As duas abas da tela de login. */
export type LoginTab = 'STUDIO' | 'PLAYER';

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING';

/** Dentro da organização: VIEW lê, EDIT mexe em jogos, testes e builds, MANAGE também paga. */
export type StudioPermission = 'MANAGE' | 'EDIT' | 'VIEW';

export interface BaseUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  avatarUrl?: string;
  /** Idioma da interface — o seletor "PT" da navbar. */
  locale: string;
  createdAt: string;
  /** Minha conta: "Notificações via E-mail". */
  emailNotifications: boolean;
  /** Minha conta: "MFA por E-mail" — o login pede o código do e-mail. */
  mfaEnabled: boolean;
}

export interface StudioProfile {
  /** A organização — é para ela que `Game.studioId` aponta. */
  studioId: string;
  permission: StudioPermission;
  organization: string;
  cnpj?: string;
  website?: string;
  totalGames: number;
  balance: number;
  /** Minha conta: dados da pessoa ("Cargo / função", nascimento e país). */
  jobTitle?: string;
  birthDate?: string;
  location?: TestLocation;
}

export interface PlayerProfile {
  level: number;
  xp: number;
  xpToNextLevel: number;
  balance: number;
  pendingBalance: number;
  completedSessions: number;
  /** "Qualidade de Feedback" no cabeçalho da home — escala de 0 a 10. */
  rating: number;
  rankPosition: number;
  badges: string[];
  /** Tag ao lado do nome, ex.: "ELITE". */
  tier: string;
  /** "Conquistas" — total acumulado, não só as desbloqueadas nesta lista. */
  achievementsCount: number;
  /** "Horas jogadas". */
  hoursPlayed: number;
  /** Elegibilidade para o público dos testes. */
  location?: TestLocation;
  playerType?: PlayerTypeId;
  archetype?: ArchetypeId;
  birthDate?: string;
  /** Já viu o tutorial do teste: o modal final mostra "Rever tutorial" (Figma `224:7540`). */
  tutorialSeen: boolean;
}

export interface StudioUser extends BaseUser {
  role: 'STUDIO';
  studio: StudioProfile;
}

export interface PlayerUser extends BaseUser {
  role: 'PLAYER';
  player: PlayerProfile;
}

export interface AdminUser extends BaseUser {
  role: 'OWNER' | 'ADMIN';
}

export type AuthUser = StudioUser | PlayerUser | AdminUser;

export interface LoginCredentials {
  email: string;
  password: string;
  role: LoginTab;
  remember?: boolean;
}

/** Login de conta com "MFA por E-mail": a senha conferiu e o código foi para o e-mail. */
export interface MfaChallenge {
  mfaRequired: true;
  email: string;
}

/** `POST /auth/login` devolve a sessão, ou o desafio do MFA quando a conta o ligou. */
export type LoginResult = AuthSession | MfaChallenge;

/** Segundo passo do login com MFA. `remember` é o "Lembrar login" do primeiro passo. */
export interface VerifyLoginPayload {
  email: string;
  code: string;
  remember?: boolean;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string;
}

/** "Criar nova conta" no login — abre o onboarding do perfil escolhido (Tela 01, RN-05). */
export interface RegisterPayload {
  role: LoginTab;
  name: string;
  email: string;
  password: string;
  /** Estúdio: nome da organização (obrigatório), CNPJ e site. */
  organization?: string;
  cnpj?: string;
  website?: string;
  /** Jogador: dados de elegibilidade para o público dos testes. */
  birthDate?: string;
  location?: TestLocation;
  playerType?: PlayerTypeId;
  archetype?: ArchetypeId;
  /** "Li e aceito os Termos de Uso e a Política de Privacidade": sem `true` não há conta. */
  acceptTerms: boolean;
  /** "Quero receber novidades, conteúdos e atualizações da OrbitPlay." */
  marketingOptIn?: boolean;
}

/**
 * Resposta do cadastro: a conta nasce PENDING e o código de 6 dígitos vai
 * para este e-mail. A sessão só sai em `POST /auth/verify-email`.
 */
export interface RegisterResult {
  email: string;
}

/** "Verifique seu e-mail": o código que chegou. Acertou, devolve a `AuthSession`. */
export interface VerifyEmailPayload {
  email: string;
  code: string;
}

/** "Reenviar código": troca o código aberto por um novo, com prazo novo. */
export interface ResendCodePayload {
  email: string;
}

/** Perfil da própria conta: nome e idioma. A foto vai por `POST /me/avatar`. */
export interface UpdateMePayload {
  name?: string;
  locale?: string;
  /** Minha conta, os dois perfis. No jogador, nascimento e país mudam a elegibilidade dos testes. */
  birthDate?: string;
  location?: TestLocation;
  emailNotifications?: boolean;
  mfaEnabled?: boolean;
  /** Só estúdio. */
  jobTitle?: string;
  /** Só estúdio com permissão MANAGE: "Nome do Estúdio" e "Site". Site vazio apaga. */
  organization?: string;
  website?: string;
}

/** Troca de senha logado: pede a atual e derruba as outras sessões. */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** Elegibilidade que o próprio jogador informa. */
export interface UpdatePlayerProfilePayload {
  location?: TestLocation;
  birthDate?: string;
}

/** Segundo passo da recuperação: o token chega pelo link do e-mail. */
export interface ResetPasswordPayload {
  token: string;
  password: string;
}
