import { compare, hash } from 'bcryptjs';

const CUSTO = 10;

/** Hash de uma senha qualquer, para a comparação levar o mesmo tempo quando o e-mail não existe. */
const HASH_FALSO = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.hnbeXa4H0R3XuW8b8zqqzH2Hq6ce';

export function hashPassword(senha: string): Promise<string> {
  return hash(senha, CUSTO);
}

/** Compara mesmo sem conta: não dá para descobrir e-mails pelo tempo de resposta. */
export function verifyPassword(senha: string, hashGuardado: string | null | undefined): Promise<boolean> {
  return compare(senha, hashGuardado ?? HASH_FALSO);
}

/** Senha que nunca confere — conta convidada que ainda não definiu a sua. */
export const UNUSABLE_PASSWORD_HASH = '!';
