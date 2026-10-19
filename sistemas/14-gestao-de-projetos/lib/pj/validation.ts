// Fragmentos de validação (Zod) reutilizados pelas ações. Toda entrada é validada NO SERVIDOR; o banco valida de novo.
import { z } from 'zod';
import { isDate } from './time';
import { PRIORITIES, PROJECT_STATUSES, SEMANTICS } from './status';

export const uuid = (msg = 'Selecione uma opção.') => z.string().uuid(msg);
/** UUID opcional: campo vazio vira undefined. */
export const optUuid = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid('Valor inválido.').optional());
export const text = (min: number, max: number, label: string) => z.string().trim().min(min, min <= 1 ? `${label}: preenchimento obrigatório.` : `${label}: mínimo ${min} caracteres.`).max(max, `${label}: máximo ${max} caracteres.`);
export const optText = (max: number, label: string) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max, `${label}: máximo ${max} caracteres.`).optional());
export const flag = z.preprocess((v) => v === 'on' || v === 'true' || v === '1', z.boolean());
export const version = z.coerce.number({ message: 'Versão inválida. Recarregue a página.' }).int().min(0).max(1_000_000);
export const idem = z.string().uuid('Solicitação inválida. Recarregue a página.');

export const dateStr = (label: string) => z.string().refine(isDate, `${label}: use uma data válida.`);
/** Data opcional de planejamento («AAAA-MM-DD»): vazio vira undefined; nada de horário nem fuso. */
export const optDate = (label: string) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().refine(isDate, `${label}: use uma data válida.`).optional());

export const priority = z.enum(PRIORITIES, { message: 'Escolha uma prioridade.' });
export const semantic = z.enum(SEMANTICS, { message: 'Escolha o tipo da etapa.' });
export const projectStatus = z.enum(PROJECT_STATUSES, { message: 'Status inválido.' });
export const projectRole = z.enum(['lead', 'editor', 'reader'], { message: 'Escolha o papel no projeto.' });
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB).');

/** Início não pode ser depois do fim; mensagem no campo de fim. */
export function orderedDates(start: string | undefined, end: string | undefined, endField: string): { ok: true } | { ok: false; field: string; message: string } {
  if (start && end && start > end) return { ok: false, field: endField, message: 'A data de início não pode ser depois do fim.' };
  return { ok: true };
}
