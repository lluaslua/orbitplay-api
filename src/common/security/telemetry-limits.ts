import { UnprocessableEntityException } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

/** Teto de eventos (telemetria + eventos do app) por participação: sessão longa, com folga. */
export const MAX_EVENTS_PER_PARTICIPATION = 50_000;
/** Folga de relógio entre o jogo e a API, em segundos. */
const FOLGA_SEGUNDOS = 120;
/** Nenhuma sessão passa de 24 h. */
export const MAX_SESSION_SECONDS = 24 * 3600;
/** Tamanho máximo do JSON `payload` de um evento, em caracteres. */
export const MAX_EVENT_PAYLOAD_CHARS = 2000;

export function rejected(message: string) {
  return new UnprocessableEntityException({ message, code: ErrorCode.TELEMETRY_REJECTED });
}

/**
 * Um evento não pode acontecer depois de agora: `atSecond` tem de caber no tempo
 * que a participação realmente existe. O cliente do tester é não confiável,
 * então a API só aceita o que é fisicamente possível, e na cota.
 */
export function assertPlausibleEvents(
  eventos: { atSecond: number; payload?: unknown }[],
  startedAt: Date,
  jaGravados: number,
): void {
  if (jaGravados + eventos.length > MAX_EVENTS_PER_PARTICIPATION) throw rejected('Limite de eventos desta sessão atingido.');
  const limite = Math.min(MAX_SESSION_SECONDS, Math.floor((Date.now() - startedAt.getTime()) / 1000) + FOLGA_SEGUNDOS);
  for (const evento of eventos) {
    if (evento.atSecond > limite) throw rejected('Evento com tempo de sessão impossível.');
    if (evento.payload !== undefined && JSON.stringify(evento.payload).length > MAX_EVENT_PAYLOAD_CHARS) {
      throw rejected('Dados do evento grandes demais.');
    }
  }
}
