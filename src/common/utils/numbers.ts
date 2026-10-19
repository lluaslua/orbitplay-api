export function round(value: number, casas = 1): number {
  const fator = 10 ** casas;
  return Math.round(value * fator) / fator;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function average(values: number[]): number {
  return values.length ? values.reduce((soma, v) => soma + v, 0) / values.length : 0;
}

/** Divisão que devolve 0 em vez de NaN quando não há total. */
export function ratio(parte: number, total: number): number {
  return total ? parte / total : 0;
}

export function sum(values: number[]): number {
  return values.reduce((soma, v) => soma + v, 0);
}
