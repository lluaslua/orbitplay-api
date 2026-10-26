import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';
import type { ChatMessage } from '../../contracts';

/** O que o servidor empurra para quem está com a conversa aberta. */
export type CommunityEvent =
  | { type: 'message.created'; gameId: string; message: ChatMessage }
  | { type: 'message.deleted'; gameId: string; channelId: string; messageId: string };

/**
 * Quem está ouvindo o chat de cada jogo. Só guarda as conexões e repassa os
 * eventos; quem autentica e abre o socket é o `CommunitySocketServer`.
 *
 * `own`, `reacted` e `online` dependem de quem vê, então a mensagem vai neutra
 * (`own: false`, `reacted: false`) e o app acerta o `own` pelo id do autor.
 */
@Injectable()
export class CommunityHub {
  private readonly rooms = new Map<string, Set<WebSocket>>();

  join(gameId: string, socket: WebSocket): void {
    const room = this.rooms.get(gameId) ?? new Set<WebSocket>();
    room.add(socket);
    this.rooms.set(gameId, room);
    socket.once('close', () => {
      room.delete(socket);
      if (!room.size) this.rooms.delete(gameId);
    });
  }

  publish(event: CommunityEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of this.rooms.get(event.gameId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}
