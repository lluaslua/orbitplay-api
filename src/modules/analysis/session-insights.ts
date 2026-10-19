import { clock } from '../../common/utils/dates';
import type { InsightTone } from '../../contracts';

/** Um insight tirado da sessão, antes de virar linha de `Insight`. */
export interface SessionInsightDraft {
  title: string;
  category: string;
  categoryTone: InsightTone;
  text: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  atSecond: number | null;
}

export interface SessionFactsForInsights {
  durationSeconds: number;
  estimatedMinutes: number;
  overallRating: number | null;
  events: { type: string; label: string; detail: string | null; atSecond: number }[];
  transcript: { at: string; text: string }[];
}

/** No máximo tantos por sessão, para a grade não virar ruído. */
const LIMITE = 6;

/** Palavras da fala que puxam uma categoria — as do Figma: "Travou tudo aqui", "difícil demais"... */
const FALAS: { termos: RegExp; title: string; category: string; tone: InsightTone; severity: SessionInsightDraft['severity'] }[] = [
  { termos: /travou|congel|bug|sumiu|invis[ií]vel|crash|fechou sozinho/i, title: 'Possível bug', category: 'Bugs & Acessibilidade', tone: 'ruby', severity: 'HIGH' },
  { termos: /dif[ií]cil demais|injusto|frustr|n[aã]o consegui/i, title: 'Dificuldade', category: 'Diversão', tone: 'amber', severity: 'MEDIUM' },
  { termos: /cansad|long[ao] demais|chato|entediad/i, title: 'Ritmo', category: 'Ritmo', tone: 'sapphire', severity: 'MEDIUM' },
  { termos: /n[aã]o entendi|confus|intuitiv|n[aã]o sabia/i, title: 'Clareza', category: 'UX & UI', tone: 'sapphire', severity: 'MEDIUM' },
  { termos: /divertid|muito bo[ma]|incr[ií]vel|adorei|absurd/i, title: 'Pico de engajamento', category: 'Diversão', tone: 'emerald', severity: 'LOW' },
  { termos: /som|[aá]udio|m[uú]sica/i, title: 'Áudio', category: 'Narrativa & Social', tone: 'amethyst', severity: 'LOW' },
];

/** "05:15" ou "1:02:03" em segundos; texto que não é tempo vira `null`. */
export function parseClock(texto: string): number | null {
  const partes = texto.trim().split(':').map(Number);
  if (partes.length < 2 || partes.some((n) => !Number.isFinite(n))) return null;
  return partes.reduce((total, parte) => total * 60 + parte, 0);
}

/**
 * Análise local e sem custo: lê eventos, nota e transcrição e devolve os
 * insights da sessão. É a peça que um LLM substitui depois, com a mesma saída.
 */
export function insightsFromSession(fatos: SessionFactsForInsights): SessionInsightDraft[] {
  const saida: SessionInsightDraft[] = [];

  const bugs = fatos.events.filter((e) => e.type === 'BUG');
  if (bugs.length) {
    const primeiro = bugs[0];
    saida.push({
      title: bugs.length > 1 ? `${bugs.length} bugs reportados` : 'Bug reportado',
      category: 'Bugs & Acessibilidade',
      categoryTone: 'ruby',
      text: `Primeiro em ${clock(primeiro.atSecond)}: ${primeiro.detail ?? primeiro.label}.`,
      severity: bugs.length > 2 ? 'HIGH' : 'MEDIUM',
      confidence: 0.9,
      atSecond: primeiro.atSecond,
    });
  }

  const desistiu = fatos.events.find((e) => e.type === 'RAGE_QUIT');
  if (desistiu) {
    saida.push({
      title: 'Abandono',
      category: 'Diversão',
      categoryTone: 'amber',
      text: `O jogador desistiu em ${clock(desistiu.atSecond)}${desistiu.detail ? ` — ${desistiu.detail}` : ''}.`,
      severity: 'HIGH',
      confidence: 0.85,
      atSecond: desistiu.atSecond,
    });
  }

  const mortes = new Map<string, number[]>();
  fatos.events.filter((e) => e.type === 'DEATH').forEach((e) => mortes.set(e.label, [...(mortes.get(e.label) ?? []), e.atSecond]));
  for (const [lugar, momentos] of mortes) {
    if (momentos.length < 3) continue;
    saida.push({
      title: 'Mortes repetidas',
      category: 'Level Design',
      categoryTone: 'amber',
      text: `${momentos.length} mortes em "${lugar}" — possível ponto de atrito ou pico de dificuldade.`,
      severity: momentos.length >= 6 ? 'HIGH' : 'MEDIUM',
      confidence: 0.8,
      atSecond: momentos[0],
    });
  }

  if (fatos.overallRating !== null && fatos.overallRating <= 2) {
    saida.push({
      title: 'Nota geral baixa',
      category: 'Diversão',
      categoryTone: 'ruby',
      text: `Avaliação geral ${fatos.overallRating.toFixed(1).replace('.', ',')} de 5.`,
      severity: 'MEDIUM',
      confidence: 0.75,
      atSecond: null,
    });
  }

  const estimado = fatos.estimatedMinutes * 60;
  if (estimado > 0 && fatos.durationSeconds > estimado * 1.5) {
    saida.push({
      title: 'Sessão longa',
      category: 'Ritmo',
      categoryTone: 'sapphire',
      text: `A sessão durou ${Math.round((fatos.durationSeconds / estimado - 1) * 100)}% mais que o estimado — atenção à fadiga.`,
      severity: 'LOW',
      confidence: 0.6,
      atSecond: null,
    });
  }

  for (const fala of fatos.transcript) {
    const regra = FALAS.find((r) => r.termos.test(fala.text));
    if (!regra) continue;
    const at = parseClock(fala.at);
    saida.push({
      title: regra.title,
      category: regra.category,
      categoryTone: regra.tone,
      text: `“${fala.text.length > 140 ? `${fala.text.slice(0, 137)}...` : fala.text}”`,
      severity: regra.severity,
      confidence: 0.55,
      atSecond: at,
    });
  }

  return saida.slice(0, LIMITE);
}
