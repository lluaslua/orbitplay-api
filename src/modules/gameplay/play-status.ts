import type { Participation } from '@prisma/client';
import type { PlayRules } from '../../common/settings/settings.defaults';
import type { PlayOutcome, PlayStatus } from '../../contracts';

/** Folga para a latência entre a batida do app e o relógio do servidor. */
const FOLGA_SEGUNDOS = 5;

/** O app bate a cada 30s: sem batida há mais que isso, o jogo não está aberto. */
const ABERTO_SEM_BATIDA_SEGUNDOS = 90;

type Jogo = Pick<Participation, 'launchCount' | 'activeSeconds' | 'lastHeartbeatAt' | 'lastExitCode'>;

/**
 * Como foi o jogo (Tela 17). O mínimo para avaliar nunca passa do tempo do
 * teste: num teste de 1 minuto, jogar 1 minuto basta.
 */
export function playStatus(jogo: Jogo, estimatedMinutes: number, regras: PlayRules, agora = new Date()): PlayStatus {
  const targetSeconds = Math.round(estimatedMinutes * 60 * regras.targetShare);
  const minSeconds = Math.min(regras.minSeconds, targetSeconds);
  return {
    outcome: playOutcome(jogo, minSeconds, targetSeconds),
    launches: jogo.launchCount,
    activeSeconds: jogo.activeSeconds,
    minSeconds,
    targetSeconds,
    playing: !!jogo.lastHeartbeatAt && agora.getTime() - jogo.lastHeartbeatAt.getTime() < ABERTO_SEM_BATIDA_SEGUNDOS * 1000,
    lastExitCode: jogo.lastExitCode,
  };
}

function playOutcome(jogo: Jogo, minSeconds: number, targetSeconds: number): PlayOutcome {
  if (jogo.launchCount === 0) return 'NOT_OPENED';
  if (jogo.activeSeconds >= targetSeconds) return 'COMPLETE';
  if (jogo.activeSeconds >= minSeconds) return 'PARTIAL';
  // Fechou cedo: com código de erro foi o jogo que caiu, não o jogador que desistiu.
  return jogo.lastExitCode ? 'CRASHED' : 'QUICK_EXIT';
}

/** Abriu e fechou (ou nem abriu): a avaliação ainda não abre. Teste sem build não tem jogo. */
export function blocksForm(status: PlayStatus | null): boolean {
  return status?.outcome === 'NOT_OPENED' || status?.outcome === 'QUICK_EXIT';
}

/**
 * Quanto da batida conta: o que o app diz ter jogado, nunca mais que o tempo
 * desde a batida anterior — assim o app não inventa 25 minutos em um. Sem
 * batida anterior (o jogo não foi aberto), nada conta.
 */
export function creditedSeconds(informados: number, ultimaBatida: Date | null, agora = new Date()): number {
  if (!ultimaBatida) return 0;
  const decorridos = Math.floor((agora.getTime() - ultimaBatida.getTime()) / 1000);
  return Math.max(0, Math.min(informados, decorridos + FOLGA_SEGUNDOS));
}
