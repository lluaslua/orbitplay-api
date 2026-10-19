const DIA_MS = 86_400_000;

export function addDays(date: Date, dias: number): Date {
  return new Date(date.getTime() + dias * DIA_MS);
}

export function daysAgo(dias: number, agora = new Date()): Date {
  return new Date(agora.getTime() - dias * DIA_MS);
}

/** "00:21" / "1:02:03" — o formato das falas da transcrição. */
export function clock(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = Math.floor(segundos % 60);
  const dois = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
}
