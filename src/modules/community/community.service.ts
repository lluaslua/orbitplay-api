import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../common/constants/domain.constants';
import { ErrorCode } from '../../common/constants/error-codes';
import type { RequestUser } from '../../common/interfaces/jwt-payload.interface';
import type { ChatAuthor, ChatMessage, ChatRole, GameCommunity } from '../../contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PlayerService } from '../player/player.service';

/** Quem mandou mensagem nos últimos minutos aparece com o ponto verde. */
const ONLINE_MS = 10 * 60_000;

/** Quantas mensagens um canal devolve — as mais recentes. */
const LIMITE_MENSAGENS = 200;

const autorInclude = {
  author: { select: { id: true, name: true, role: true, avatarUrl: true, studioId: true, player: { select: { tier: true } } } },
} satisfies Prisma.ChatMessageInclude;

type Autor = Prisma.ChatMessageGetPayload<{ include: typeof autorInclude }>['author'];

/**
 * Chat da comunidade de um jogo (Figma `395:2656`). `own` e `reacted` dependem
 * de quem está vendo, por isso todo método recebe essa pessoa.
 */
@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly player: PlayerService,
  ) {}

  /**
   * A ordem das checagens é a das respostas que o app espera: jogo inexistente
   * (404), jogo sem teste publicado (404 COMMUNITY_NOT_OPEN) e quem não é do
   * estúdio dono nem testou o jogo (403 COMMUNITY_RESTRICTED).
   */
  async assertAccess(user: RequestUser, gameId: string): Promise<void> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { studioId: true } });
    if (!game) throw new NotFoundException({ message: 'Jogo não encontrado.' });

    const publicados = await this.prisma.playtest.count({ where: { gameId, status: { not: 'DRAFT' } } });
    if (!publicados) {
      throw new NotFoundException({
        message: 'A comunidade abre quando o jogo recebe a primeira build.',
        code: ErrorCode.COMMUNITY_NOT_OPEN,
      });
    }

    const permitido =
      user.role === 'OWNER' ||
      user.role === 'ADMIN' ||
      (user.role === 'STUDIO' && user.studioId === game.studioId) ||
      (user.role === 'PLAYER' && (await this.player.hasPlayedGame(user.id, gameId)));
    if (!permitido) {
      throw new ForbiddenException({
        message: 'Só o estúdio do jogo e quem já participou de um teste dele entram no chat.',
        code: ErrorCode.COMMUNITY_RESTRICTED,
      });
    }
  }

  async getCommunity(gameId: string, viewer: RequestUser): Promise<GameCommunity> {
    const [canais, conta, game] = await Promise.all([
      this.prisma.communityChannel.findMany({ orderBy: { position: 'asc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: viewer.id }, select: autorInclude.author.select }),
      this.gameOf(gameId),
    ]);
    return {
      gameId,
      channels: canais.map((c) => ({ id: c.id, name: c.name })),
      me: toAuthor(conta, game.studioId),
    };
  }

  /**
   * As mais recentes, em ordem de envio. `after` (id ou data) traz só as
   * posteriores — o polling de 5 s do app não baixa o canal inteiro de novo —, e
   * `before` pagina para trás, ao rolar o histórico.
   */
  async listMessages(
    gameId: string,
    channelId: string,
    viewer: RequestUser,
    cursor: { after?: string; before?: string } = {},
  ): Promise<ChatMessage[]> {
    await this.channelOf(channelId);
    const game = await this.gameOf(gameId);
    const [depois, antes] = await Promise.all([this.momentOf(gameId, cursor.after), this.momentOf(gameId, cursor.before)]);
    const mensagens = await this.prisma.chatMessage.findMany({
      where: {
        gameId,
        channelId,
        deletedAt: null,
        ...(depois || antes ? { sentAt: { ...(depois ? { gt: depois } : {}), ...(antes ? { lt: antes } : {}) } } : {}),
      },
      include: { ...autorInclude, reactions: { where: { userId: viewer.id }, select: { userId: true } } },
      orderBy: { sentAt: 'desc' },
      take: LIMITE_MENSAGENS,
    });

    // Presença: quem escreveu há pouco neste jogo.
    const recentes = new Set(
      mensagens.filter((m) => Date.now() - m.sentAt.getTime() < ONLINE_MS).map((m) => m.authorId),
    );
    return mensagens.reverse().map((m) => toMessage(m, viewer.id, game.studioId, recentes));
  }

  async sendMessage(gameId: string, channelId: string, author: RequestUser, rawText: string): Promise<ChatMessage> {
    const text = rawText.trim();
    if (!text) {
      throw new UnprocessableEntityException({ message: 'Escreva uma mensagem antes de enviar.', code: ErrorCode.EMPTY_MESSAGE });
    }
    if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
      throw new UnprocessableEntityException({
        message: `A mensagem passa de ${CHAT_MESSAGE_MAX_LENGTH} caracteres.`,
        code: ErrorCode.MESSAGE_TOO_LONG,
      });
    }
    await this.channelOf(channelId);
    const game = await this.gameOf(gameId);

    const mensagem = await this.prisma.chatMessage.create({
      data: { gameId, channelId, authorId: author.id, text },
      include: { ...autorInclude, reactions: { where: { userId: author.id }, select: { userId: true } } },
    });
    return toMessage(mensagem, author.id, game.studioId, new Set([author.id]));
  }

  /** Liga ou desliga a reação de quem pediu — os outros não a veem. */
  async toggleReaction(gameId: string, messageId: string, viewer: RequestUser): Promise<ChatMessage> {
    const mensagem = await this.messageOf(gameId, messageId);
    const chave = { messageId_userId: { messageId, userId: viewer.id } };
    const existente = await this.prisma.messageReaction.findUnique({ where: chave });
    if (existente) await this.prisma.messageReaction.delete({ where: chave });
    else await this.prisma.messageReaction.create({ data: { messageId, userId: viewer.id } });

    const game = await this.gameOf(gameId);
    const atualizada = await this.prisma.chatMessage.findUniqueOrThrow({
      where: { id: mensagem.id },
      include: { ...autorInclude, reactions: { where: { userId: viewer.id }, select: { userId: true } } },
    });
    return toMessage(atualizada, viewer.id, game.studioId, new Set([viewer.id]));
  }

  /**
   * Moderação (Tela 15, RN-04): o autor apaga a própria mensagem; o estúdio
   * dono (com permissão de edição) e a administração apagam qualquer uma.
   */
  async deleteMessage(gameId: string, messageId: string, user: RequestUser): Promise<{ deleted: true }> {
    const mensagem = await this.messageOf(gameId, messageId);
    const game = await this.gameOf(gameId);
    const modera =
      user.role === 'OWNER' ||
      user.role === 'ADMIN' ||
      (user.role === 'STUDIO' && user.studioId === game.studioId && user.studioPermission !== 'VIEW');
    if (mensagem.authorId !== user.id && !modera) {
      throw new ForbiddenException({ message: 'Você não pode apagar esta mensagem.' });
    }
    await this.prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  /** Cursor do chat: id de mensagem deste jogo ou data ISO. */
  private async momentOf(gameId: string, cursor: string | undefined): Promise<Date | null> {
    if (!cursor) return null;
    const mensagem = await this.prisma.chatMessage.findFirst({ where: { id: cursor, gameId }, select: { sentAt: true } });
    if (mensagem) return mensagem.sentAt;
    const data = new Date(cursor);
    return Number.isNaN(data.getTime()) ? null : data;
  }

  private async gameOf(gameId: string) {
    return this.prisma.game.findUniqueOrThrow({ where: { id: gameId }, select: { studioId: true } });
  }

  private async channelOf(channelId: string) {
    const canal = await this.prisma.communityChannel.findUnique({ where: { id: channelId } });
    if (!canal) throw new NotFoundException({ message: 'Canal não encontrado.' });
    return canal;
  }

  private async messageOf(gameId: string, messageId: string) {
    const mensagem = await this.prisma.chatMessage.findFirst({ where: { id: messageId, gameId, deletedAt: null } });
    if (!mensagem) throw new NotFoundException({ message: 'Mensagem não encontrada.' });
    return mensagem;
  }
}

/** Verde para quem faz o jogo, vermelho para QA, roxo para o jogador (Figma). */
function toAuthor(autor: Autor, studioIdDoJogo: string): ChatAuthor {
  const role: ChatRole =
    autor.role === 'PLAYER' ? (autor.player?.tier === 'QA' ? 'QA' : 'ELITE') : autor.studioId === studioIdDoJogo || autor.role !== 'STUDIO' ? 'DEV' : 'ELITE';
  return { id: autor.id, name: autor.name, role, avatarUrl: autor.avatarUrl ?? '' };
}

function toMessage(
  mensagem: Prisma.ChatMessageGetPayload<{ include: typeof autorInclude & { reactions: { select: { userId: true } } } }>,
  viewerId: string,
  studioIdDoJogo: string,
  online: Set<string>,
): ChatMessage {
  return {
    id: mensagem.id,
    channelId: mensagem.channelId,
    author: toAuthor(mensagem.author, studioIdDoJogo),
    online: online.has(mensagem.authorId) || mensagem.authorId === viewerId,
    text: mensagem.text,
    sentAt: mensagem.sentAt.toISOString(),
    own: mensagem.authorId === viewerId,
    reacted: mensagem.reactions.length > 0,
  };
}
