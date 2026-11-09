import { compare, getRounds, hash } from 'bcryptjs';

/** Custo do bcrypt: 12 por padrão (`BCRYPT_COST`, de 10 a 15). Hashes mais fracos são refeitos no próximo login. */
export function bcryptCost(): number {
  const valor = Number(process.env.BCRYPT_COST ?? 12);
  return Number.isFinite(valor) ? Math.min(15, Math.max(10, Math.trunc(valor))) : 12;
}

/** Hash de uma senha qualquer, para a comparação levar o mesmo tempo quando o e-mail não existe. */
const HASH_FALSO = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.hnbeXa4H0R3XuW8b8zqqzH2Hq6ce';

export function hashPassword(senha: string): Promise<string> {
  return hash(senha, bcryptCost());
}

/** Compara mesmo sem conta: não dá para descobrir e-mails pelo tempo de resposta. */
export function verifyPassword(senha: string, hashGuardado: string | null | undefined): Promise<boolean> {
  return compare(senha, hashGuardado ?? HASH_FALSO).catch(() => false);
}

/** Hash feito com custo menor que o atual — vale refazer quando a senha acabou de ser conferida. */
export function needsRehash(hashGuardado: string): boolean {
  try {
    return getRounds(hashGuardado) < bcryptCost();
  } catch {
    return false;
  }
}

/** Senha que nunca confere — conta convidada que ainda não definiu a sua. */
export const UNUSABLE_PASSWORD_HASH = '!';
