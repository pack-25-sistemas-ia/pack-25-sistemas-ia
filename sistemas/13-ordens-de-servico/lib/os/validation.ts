// Fragmentos de validação (Zod) reutilizados pelas ações. Toda entrada é validada NO SERVIDOR; o banco valida de novo.
import { z } from 'zod';
import { isDate, isTime, localToInstant } from './time';
import { parseMoney, parseQuantity } from './money';

export const uuid = (msg = 'Selecione uma opção.') => z.string().uuid(msg);
/** UUID opcional: campo vazio vira undefined. */
export const optUuid = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid('Valor inválido.').optional());
export const text = (min: number, max: number, label: string) => z.string().trim().min(min, min <= 1 ? `${label}: preenchimento obrigatório.` : `${label}: mínimo ${min} caracteres.`).max(max, `${label}: máximo ${max} caracteres.`);
export const optText = (max: number, label: string) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max, `${label}: máximo ${max} caracteres.`).optional());
export const flag = z.preprocess((v) => v === 'on' || v === 'true' || v === '1', z.boolean());
export const version = z.coerce.number({ message: 'Versão inválida. Recarregue a página.' }).int().min(0).max(1_000_000);
export const idem = z.string().uuid('Solicitação inválida. Recarregue a página.');

export const dateStr = (label: string) => z.string().refine(isDate, `${label}: use uma data válida.`);
export const timeStr = (label: string) => z.string().refine((s) => isTime(s) && s !== '24:00', `${label}: use o formato HH:MM.`);

/** Janela de atendimento digitada no fuso da empresa (data + hora de início + hora de fim) → instantes ISO. */
export function windowToInstants(d: { date?: string; start?: string; end?: string }, tz: string): { ok: true; startsAt: string; endsAt: string } | { ok: false; field: string; message: string } {
  if (!d.date) return { ok: false, field: 'sched_date', message: 'Informe a data do atendimento.' };
  if (!d.start) return { ok: false, field: 'sched_start', message: 'Informe a hora de início.' };
  if (!d.end) return { ok: false, field: 'sched_end', message: 'Informe a hora de fim.' };
  if (!isDate(d.date)) return { ok: false, field: 'sched_date', message: 'Data inválida.' };
  if (!isTime(d.start) || d.start === '24:00') return { ok: false, field: 'sched_start', message: 'Hora inválida (HH:MM).' };
  if (!isTime(d.end)) return { ok: false, field: 'sched_end', message: 'Hora inválida (HH:MM).' };
  const a = localToInstant(d.date, d.start, tz);
  const b = localToInstant(d.date, d.end, tz);
  if (b <= a) return { ok: false, field: 'sched_end', message: 'O fim precisa ser depois do início.' };
  return { ok: true, startsAt: new Date(a).toISOString(), endsAt: new Date(b).toISOString() };
}

export const moneyField = (label: string) => z.string().trim().transform((s, ctx) => {
  const v = parseMoney(s);
  if (v === null) { ctx.addIssue({ code: 'custom', message: `${label}: informe um valor válido (ex.: 150,00).` }); return z.NEVER; }
  return v;
});
export const quantityField = (label: string) => z.string().trim().transform((s, ctx) => {
  const v = parseQuantity(s);
  if (v === null) { ctx.addIssue({ code: 'custom', message: `${label}: informe uma quantidade maior que zero, com até 3 casas (ex.: 1,5).` }); return z.NEVER; }
  return v;
});

/** Telefone: dígitos e sinais comuns, 8 a 20 caracteres (o banco repete). */
export const phone = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().regex(/^[0-9+()\s.-]{8,20}$/, 'Telefone inválido (use DDD + número).').optional());
export const email = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(200, 'E-mail longo demais.').regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'E-mail inválido.').optional());

/** CPF/CNPJ com dígitos verificadores (mesma regra do banco). Aceita máscara. */
export function validDocument(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (!/^(\d{11}|\d{14})$/.test(d) || /^(\d)\1+$/.test(d)) return null;
  const digits = d.split('').map(Number);
  const dv = (len: number, weights: number[]): number => {
    const s = digits.slice(0, len).reduce((acc, n, i) => acc + n * weights[i]!, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(9, w1) === digits[9] && dv(10, w2) === digits[10] ? d : null;
  }
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(12, w1) === digits[12] && dv(13, w2) === digits[13] ? d : null;
}
