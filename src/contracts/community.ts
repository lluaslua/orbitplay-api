/**
 * Comunidade de um jogo — a aba "Comunidade" da tela do jogo, Figma `395:2656`.
 *
 * Todo jogo que já recebeu build tem o seu chat, dividido em canais. É o mesmo
 * chat nas duas pontas: o estúdio abre pela configuração do jogo e o tester pela
 * tela de detalhes. Quem pode entrar é a API que decide.
 */

/**
 * Papel de quem fala. Define a cor do anel do avatar e a do selo: verde para
 * quem faz o jogo, vermelho para QA, roxo para o jogador ELITE.
 */
export type ChatRole = 'DEV' | 'QA' | 'ELITE';

export interface CommunityChannel {
  /** Vai na URL: "geral", "bugs"... */
  id: string;
  /** Como o canal aparece na lista e no cabeçalho: "#Geral". */
  name: string;
}

/** Quem fala, já resolvido pela API: nome, foto e papel no chat. */
export interface ChatAuthor {
  id: string;
  name: string;
  role: ChatRole;
  avatarUrl: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  author: ChatAuthor;
  /** Presença do autor. Sem ela, o avatar fica sem o ponto verde. */
  online: boolean;
  text: string;
  /** ISO 8601. A tela mostra como "30/01/2026 - 09:59". */
  sentAt: string;
  /** Escrita por quem está vendo: balão azul, alinhado à direita. */
  own: boolean;
  /** Quem está vendo reagiu. A reação é só de quem reagiu: os outros não a veem. */
  reacted: boolean;
}

export interface GameCommunity {
  gameId: string;
  channels: CommunityChannel[];
  /** Como quem está vendo aparece no chat — é o autor do balão enviado. */
  me: ChatAuthor;
}

/**
 * Por que a aba não abre o chat. Chega como `code` do erro da API.
 *
 *   COMMUNITY_NOT_OPEN    o jogo ainda não recebeu build para testar
 *   COMMUNITY_RESTRICTED  quem pediu não é o estúdio do jogo nem testou o jogo
 */
export type CommunityAccessError = 'COMMUNITY_NOT_OPEN' | 'COMMUNITY_RESTRICTED';
