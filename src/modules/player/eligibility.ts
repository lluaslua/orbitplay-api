import type { PlayerProfile, Playtest } from '@prisma/client';

export function ageOf(birthDate: Date | null, agora = new Date()): number | null {
  if (!birthDate) return null;
  let idade = agora.getFullYear() - birthDate.getFullYear();
  const aindaNaoFez =
    agora.getMonth() < birthDate.getMonth() ||
    (agora.getMonth() === birthDate.getMonth() && agora.getDate() < birthDate.getDate());
  if (aindaNaoFez) idade -= 1;
  return idade;
}

/**
 * O perfil cabe no público do teste (Handoff, Tela 14 RN-01): localização,
 * idade, tipo de jogador e arquétipo. Sem data de nascimento a idade não barra
 * — contas antigas não informaram.
 */
export function isEligible(
  teste: Pick<Playtest, 'locations' | 'minAge' | 'maxAge' | 'playerType' | 'archetype'>,
  perfil: Pick<PlayerProfile, 'location' | 'birthDate' | 'playerType' | 'archetype'>,
): boolean {
  const lugar = teste.locations.includes('GLOBAL') || teste.locations.includes(perfil.location);
  const idade = ageOf(perfil.birthDate);
  const faixa = idade === null || (idade >= teste.minAge && idade <= teste.maxAge);
  const tipo = teste.playerType === 'ALL' || teste.playerType === perfil.playerType;
  const arquetipo = teste.archetype === 'ALL' || teste.archetype === perfil.archetype;
  return lugar && faixa && tipo && arquetipo;
}
