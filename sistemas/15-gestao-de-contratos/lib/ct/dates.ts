// Datas de contrato: tudo em «AAAA-MM-DD» (sem hora, sem fuso). Mesmas regras do banco (ct_add_months, ct_notice_deadline).
import { addDays, daysBetween, isDate, weekdayOf } from './time';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** Soma meses limitando ao último dia válido: 31/01 + 1 mês = 28/02 (ou 29/02 em ano bissexto). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12); const nm = (total % 12 + 12) % 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDayOf(ny, nm)))}`;
}

/** Prazo de aviso = data de referência − dias corridos (sem feriados, sem interpretar cláusulas). */
export const noticeDeadline = (reference: string, days: number): string => addDays(reference, -days);

/** Referência do aviso: a informada ou, no prazo determinado, o fim da vigência. Indeterminado sem referência → null (a pessoa precisa informar). */
export function noticeReference(c: { end: string | null; indefinite: boolean }, explicit: string | null): string | null {
  return explicit ?? (c.indefinite ? null : c.end);
}

/** «Hoje até hoje + n», ambos incluídos. */
export const withinDays = (date: string, today: string, n: number): boolean => date >= today && date <= addDays(today, n);

/** Dias que faltam (negativo = já passou). */
export const daysUntil = (date: string, today: string): number => daysBetween(today, date);

export function relativeLabel(date: string, today: string): string {
  const d = daysUntil(date, today);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d === -1) return 'ontem';
  return d > 0 ? `em ${d} dias` : `há ${-d} dias`;
}

/** Grade do mês para o calendário (semanas de domingo a sábado). Células fora do mês vêm como null. */
export function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const first = `${year}-${pad(month)}-01`;
  const lead = weekdayOf(first);
  const total = lastDayOf(year, month);
  const cells: Array<string | null> = [...Array.from({ length: lead }, () => null), ...Array.from({ length: total }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const t = year * 12 + (month - 1) + delta;
  return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 + 1 };
}
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] as const;
export { isDate };
