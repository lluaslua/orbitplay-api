/** "R$ 1.234,56" — valores circulam em centavos. */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/** "5,0" — notas e bônus nas memórias de cálculo. */
export function formatScore(valor: number): string {
  return valor.toFixed(1).replace('.', ',');
}
