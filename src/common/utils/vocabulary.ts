import {
  AGE_RATING_LABELS,
  DEV_STAGE_LABELS,
  ENGINE_LABELS,
  GAME_MODE_LABELS,
  GENRES,
  LANGUAGES,
  LEGACY_GENRES,
  PLATFORM_LABELS,
} from '../constants/domain.constants';

/**
 * O app guarda nos dropdowns do Novo jogo o texto que a tela mostra
 * ("Corrida", "Single Player", "Livre (L)", "Português"). A API grava e devolve
 * o código ("Racing", "SINGLE_PLAYER", "L", "pt-BR"). Estes mapas aceitam os
 * dois, sem diferenciar maiúscula, e deixam o que não conhecem como veio — o
 * `IsIn` do DTO é quem recusa valor fora da lista.
 */
type Aliases = ReadonlyMap<string, string>;

function aliases(rotulos: Record<string, string>, extras: Record<string, string> = {}): Aliases {
  const mapa = new Map<string, string>();
  for (const [codigo, rotulo] of Object.entries(rotulos)) {
    mapa.set(codigo.toLowerCase(), codigo);
    mapa.set(rotulo.toLowerCase(), codigo);
  }
  for (const [rotulo, codigo] of Object.entries(extras)) mapa.set(rotulo.toLowerCase(), codigo);
  return mapa;
}

export const GENRE_ALIASES = aliases(Object.fromEntries(GENRES.map((g) => [g, g])), LEGACY_GENRES);
export const PLATFORM_ALIASES = aliases(PLATFORM_LABELS);
export const GAME_MODE_ALIASES = aliases(GAME_MODE_LABELS);
export const ENGINE_ALIASES = aliases(ENGINE_LABELS);
export const DEV_STAGE_ALIASES = aliases(DEV_STAGE_LABELS);
export const AGE_RATING_ALIASES = aliases(AGE_RATING_LABELS);
export const LANGUAGE_ALIASES = aliases(Object.fromEntries(LANGUAGES.map((l) => [l.value, l.label])));

/** O gênero como o app mostra: os que têm nome em português usam ele ("Racing" → "Corrida"). */
const ROTULO_DO_GENERO = new Map(Object.entries(LEGACY_GENRES).map(([rotulo, codigo]) => [codigo as string, rotulo]));
export function genreLabel(codigo: string): string {
  return ROTULO_DO_GENERO.get(codigo) ?? codigo;
}

/** Um valor: texto vazio vira `null`; o resto vira código quando o mapa conhece. */
export function toCode(valor: unknown, mapa: Aliases): unknown {
  if (typeof valor !== 'string') return valor;
  const texto = valor.trim();
  if (!texto) return null;
  return mapa.get(texto.toLowerCase()) ?? texto;
}

/** Uma lista: converte cada item, tira vazios e repetidos. */
export function toCodes(lista: unknown, mapa: Aliases): unknown {
  if (!Array.isArray(lista)) return lista;
  const codigos = lista.map((valor) => toCode(valor, mapa)).filter((valor) => valor !== null && valor !== undefined);
  return [...new Set(codigos)];
}
