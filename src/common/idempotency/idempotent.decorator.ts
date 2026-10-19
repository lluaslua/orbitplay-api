import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Marca uma ação crítica: com o cabeçalho `Idempotency-Key`, repetir a
 * requisição devolve a resposta da primeira em vez de executar de novo.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
