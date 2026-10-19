import type { HeatmapCell, HeatmapExport } from '../../contracts';

export interface PositionEvent {
  type: string;
  payload: unknown;
}

interface Ponto {
  x: number;
  y: number;
  z: number;
}

function pontoDe(payload: unknown): Ponto | null {
  if (!payload || typeof payload !== 'object') return null;
  const { x, y, z } = payload as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  return { x, y, z: typeof z === 'number' ? z : 0 };
}

/**
 * Junta as posições (POSITION) e as mortes (DEATH) do mapa numa grade de
 * células — o "Collect scene GRID Global position" das notas do Figma — e leva
 * a menor célula a 0,0,0 ("Move to 0,0,0").
 */
export function buildHeatmap(map: string, eventos: PositionEvent[], cellSize: number, sessions: number): HeatmapExport {
  const celulas = new Map<string, { i: number; j: number; k: number; samples: number; deaths: number }>();
  let totalSamples = 0;
  let totalDeaths = 0;

  for (const evento of eventos) {
    const ponto = pontoDe(evento.payload);
    if (!ponto) continue;
    const i = Math.floor(ponto.x / cellSize);
    const j = Math.floor(ponto.y / cellSize);
    const k = Math.floor(ponto.z / cellSize);
    const chave = `${i}:${j}:${k}`;
    const celula = celulas.get(chave) ?? { i, j, k, samples: 0, deaths: 0 };
    if (evento.type === 'DEATH') {
      celula.deaths += 1;
      totalDeaths += 1;
    } else {
      celula.samples += 1;
      totalSamples += 1;
    }
    celulas.set(chave, celula);
  }

  const lista = [...celulas.values()];
  const minimo = (eixo: 'i' | 'j' | 'k') => (lista.length ? Math.min(...lista.map((c) => c[eixo])) : 0);
  const [mi, mj, mk] = [minimo('i'), minimo('j'), minimo('k')];
  const maior = Math.max(1, ...lista.map((c) => c.samples + c.deaths));

  const cells: HeatmapCell[] = lista
    .map((c) => ({
      x: arredonda((c.i - mi + 0.5) * cellSize),
      y: arredonda((c.j - mj + 0.5) * cellSize),
      z: arredonda((c.k - mk + 0.5) * cellSize),
      samples: c.samples,
      deaths: c.deaths,
      density: arredonda((c.samples + c.deaths) / maior),
    }))
    .sort((a, b) => b.density - a.density);

  return {
    map,
    cellSize,
    sessions,
    totalSamples,
    totalDeaths,
    origin: { x: mi * cellSize, y: mj * cellSize, z: mk * cellSize },
    cells,
  };
}

/**
 * O mapa em Wavefront .OBJ para abrir na Unity ("Exportar .OBJ para ver na
 * unity"): um cubo por célula, maior onde há mais gente ("Set sphere size").
 * As mortes vão num objeto separado, para dar para pintar de outra cor.
 */
export function heatmapToObj(heatmap: HeatmapExport): string {
  const linhas = [
    `# OrbitPlay heatmap — ${heatmap.map}`,
    `# ${heatmap.sessions} sessões, ${heatmap.totalSamples} posições, ${heatmap.totalDeaths} mortes, célula ${heatmap.cellSize}`,
    `# origem original: ${heatmap.origin.x} ${heatmap.origin.y} ${heatmap.origin.z}`,
  ];
  let vertices = 0;

  const cubo = (centro: { x: number; y: number; z: number }, lado: number) => {
    const m = lado / 2;
    for (const dx of [-m, m]) for (const dy of [-m, m]) for (const dz of [-m, m]) {
      linhas.push(`v ${arredonda(centro.x + dx)} ${arredonda(centro.y + dy)} ${arredonda(centro.z + dz)}`);
    }
    // Vértices na ordem (x,y,z) = --- --+ -+- -++ +-- +-+ ++- +++; faces com índice a partir de 1.
    const v = (n: number) => vertices + n;
    linhas.push(
      `f ${v(1)} ${v(3)} ${v(4)} ${v(2)}`,
      `f ${v(5)} ${v(6)} ${v(8)} ${v(7)}`,
      `f ${v(1)} ${v(2)} ${v(6)} ${v(5)}`,
      `f ${v(3)} ${v(7)} ${v(8)} ${v(4)}`,
      `f ${v(1)} ${v(5)} ${v(7)} ${v(3)}`,
      `f ${v(2)} ${v(4)} ${v(8)} ${v(6)}`,
    );
    vertices += 8;
  };

  linhas.push('o densidade');
  for (const celula of heatmap.cells.filter((c) => c.samples > 0)) {
    cubo(celula, heatmap.cellSize * (0.2 + 0.8 * celula.density));
  }

  const comMorte = heatmap.cells.filter((c) => c.deaths > 0);
  if (comMorte.length) {
    const maisMortes = Math.max(...comMorte.map((c) => c.deaths));
    linhas.push('o mortes');
    for (const celula of comMorte) cubo(celula, heatmap.cellSize * (0.2 + 0.6 * (celula.deaths / maisMortes)));
  }

  return `${linhas.join('\n')}\n`;
}

function arredonda(valor: number): number {
  return Math.round(valor * 1000) / 1000;
}
