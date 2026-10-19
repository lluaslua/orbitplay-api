import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { PluginDetection, PluginManifest, PluginVarTone } from '../../contracts';

const INICIO = Buffer.from('<<ORBITPLAY_PLUGIN>>');
const FIM = Buffer.from('<</ORBITPLAY_PLUGIN>>');
const MAX_MANIFESTO = 64 * 1024;

export interface BuildScan {
  sha256: string;
  manifest: PluginManifest | null;
  /** Achou o marcador, mas o conteúdo não é um manifesto válido. */
  manifestError: string | null;
}

/**
 * Uma leitura só do arquivo: calcula o hash e procura o manifesto que o SDK
 * do Orbit Plug-in grava na build. O marcador pode cair na divisa entre dois
 * pedaços lidos, por isso a sobra do pedaço anterior entra na busca.
 */
export async function scanBuild(path: string): Promise<BuildScan> {
  const hash = createHash('sha256');
  let sobra = Buffer.alloc(0);
  let capturando: Buffer | null = null;
  let bruto: string | null = null;

  for await (const parte of createReadStream(path)) {
    const pedaco = parte as Buffer;
    hash.update(pedaco);
    if (bruto !== null) continue;

    if (capturando) {
      capturando = Buffer.concat([capturando, pedaco]);
    } else {
      const janela = Buffer.concat([sobra, pedaco]);
      const inicio = janela.indexOf(INICIO);
      if (inicio >= 0) capturando = Buffer.from(janela.subarray(inicio + INICIO.length));
      else sobra = Buffer.from(janela.subarray(Math.max(0, janela.length - INICIO.length + 1)));
    }

    if (capturando) {
      const fim = capturando.indexOf(FIM);
      if (fim >= 0) bruto = capturando.subarray(0, fim).toString('utf8');
      else if (capturando.length > MAX_MANIFESTO) bruto = '';
      if (bruto !== null) capturando = null;
    }
  }

  const sha256 = hash.digest('hex');
  if (bruto === null) return { sha256, manifest: null, manifestError: null };

  try {
    const json: unknown = JSON.parse(bruto);
    if (!isManifest(json)) throw new Error('formato');
    return { sha256, manifest: json, manifestError: null };
  } catch {
    return {
      sha256,
      manifest: null,
      manifestError: 'O manifesto do Orbit Plug-in está ilegível. Gere a build de novo com o SDK.',
    };
  }
}

function isManifest(valor: unknown): valor is PluginManifest {
  if (!valor || typeof valor !== 'object') return false;
  const m = valor as Record<string, unknown>;
  const itens = (lista: unknown) =>
    Array.isArray(lista) &&
    lista.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        ['name', 'varType', 'kind'].every((campo) => typeof (item as Record<string, unknown>)[campo] === 'string'),
    );
  return typeof m.sdkVersion === 'string' && itens(m.triggers) && itens(m.heatmaps);
}

/** Métricas que cada tipo de variável permite — as caixas da coluna "Ações" (Figma `319:8624`). */
function metricasPadrao(varType: string): string[] {
  if (varType.startsWith('Vector3')) return ['Média', 'Ângulo médio'];
  if (varType.startsWith('Time')) return ['Média', 'Máximo/mínimo'];
  if (varType === 'Int' || varType === 'Float') return ['Média', 'Total', 'Tempo médio'];
  return ['Total'];
}

function tomDo(varType: string): PluginVarTone {
  if (varType.startsWith('Vector3')) return 'amethyst';
  if (varType.startsWith('Time')) return 'sapphire';
  return 'emerald';
}

/** Linhas das tabelas da etapa 3, já habilitadas com todas as métricas. */
export function toDetections(
  itens: PluginManifest['triggers'] | PluginManifest['heatmaps'],
  prefixo: 'tr' | 'hm',
): PluginDetection[] {
  return itens.map((item, indice) => {
    const metrics = item.metrics?.length ? item.metrics : metricasPadrao(item.varType);
    const editavel = 'amountEditable' in item && typeof item.amountEditable === 'boolean'
      ? item.amountEditable
      : !item.varType.startsWith('Vector3');
    return {
      id: `${prefixo}-${indice + 1}`,
      varType: item.varType,
      varTone: tomDo(item.varType),
      name: item.name,
      kind: item.kind,
      amountEditable: editavel,
      metrics,
      enabled: true,
      selectedMetrics: metrics,
      amount: null,
    };
  });
}
