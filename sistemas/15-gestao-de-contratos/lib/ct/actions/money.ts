'use server';

import { z } from 'zod';
import { type ActionState } from '@/lib/actions/result';
import { runRpc, type SaveResult } from '../action-kit';
import { billingBasis, dateStr, optText, optUuid, text, uuid, version, flag } from '../validation';
import { parseMoney, parsePercentScaled } from '../money';

// Valores, aditivos, renovação e reajustes. Nada aqui gera cobrança. O banco confere papel, estado, cronologia e a base do reajuste.
const moneyReq = (label: string) => z.string().transform((s, ctx) => { const c = parseMoney(s); if (c === null) { ctx.addIssue({ code: 'custom', message: `${label}: use um valor como 1.234,56.` }); return z.NEVER; } return c; });
const moneyOpt = (label: string) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), moneyReq(label).optional());
const percent = z.string().transform((s, ctx) => { const p = parsePercentScaled(s); if (p === null) { ctx.addIssue({ code: 'custom', message: 'Percentual: use um número como 5,5 (até 4 casas decimais).' }); return z.NEVER; } return p; });
const pctParam = (scaled: bigint): string => `${scaled < 0n ? '-' : ''}${(scaled < 0n ? -scaled : scaled) / 10_000n}.${((scaled < 0n ? -scaled : scaled) % 10_000n).toString().padStart(4, '0')}`;

export async function setInitialValue(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version, amount: moneyReq('Valor'), basis: billingBasis }), 'manager', 'setInitialValue',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_set_initial_value', { p_org: org, p_contract: d.contract, p_expected: d.version, p_amount_cents: d.amount, p_basis: d.basis }), 'Valor cadastrado. Ele não gera cobrança: é só o registro do contrato.');
}

const changeSchema = z.object({ contract: uuid(), version, change_type: z.enum(['amendment', 'correction'], { message: 'Escolha aditivo ou correção.' }), effective_date: dateStr('Data de efeito'), description: text(2, 2000, 'Descrição'),
  document_version_id: optUuid, amount: moneyOpt('Novo valor'), basis: z.preprocess((v) => (v === '' ? undefined : v), billingBasis.optional()) })
  .superRefine((v, ctx) => { if (v.amount !== undefined && !v.basis) ctx.addIssue({ code: 'custom', path: ['basis'], message: 'Informe a periodicidade do novo valor.' }); });
export async function registerChange(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, changeSchema, 'manager', 'registerChange', (d, { ctx, org }) => ctx.supabase.rpc('ct_register_change', { p_org: org, p_contract: d.contract, p_expected: d.version, p: {
    change_type: d.change_type, effective_date: d.effective_date, description: d.description, document_version_id: d.document_version_id ?? null,
    new_value: d.amount !== undefined ? { amount_cents: d.amount, billing_basis: d.basis } : null } }),
    (_x, d) => (d.change_type === 'amendment' ? 'Aditivo registrado.' : 'Correção registrada.'));
}

const renewSchema = z.object({ contract: uuid(), version, mode: z.enum(['date', 'indefinite'], { message: 'Escolha como renovar.' }), new_end: z.preprocess((v) => (v === '' ? undefined : v), dateStr('Nova data de fim').optional()), effective: z.preprocess((v) => (v === '' ? undefined : v), dateStr('Data da renovação').optional()),
  reason: text(5, 500, 'Justificativa'), document_version_id: optUuid })
  .superRefine((v, ctx) => { if (v.mode === 'date' && !v.new_end) ctx.addIssue({ code: 'custom', path: ['new_end'], message: 'Informe a nova data de fim.' }); });
export async function renewContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, renewSchema, 'manager', 'renewContract', (d, { ctx, org }) => ctx.supabase.rpc('ct_renew_contract', { p_org: org, p_contract: d.contract, p_expected: d.version, p_new_end: d.mode === 'date' ? d.new_end : null,
    p_indefinite: d.mode === 'indefinite', p_effective: d.effective ?? null, p_reason: d.reason, p_document_version: d.document_version_id ?? null }),
    (_x, d) => (d.mode === 'indefinite' ? 'Renovado por prazo indeterminado. O prazo de aviso foi removido: informe de novo, com a data de referência.' : 'Contrato renovado. Os prazos e lembretes foram recalculados.'));
}

const ruleSchema = z.object({ contract: uuid(), frequency: z.coerce.number({ message: 'Frequência: informe um número.' }).int().min(1, 'Mínimo 1 mês.').max(120, 'Máximo 120 meses.'), next: dateStr('Próximo reajuste'), label: optText(80, 'Referência'), active: flag.optional() });
export async function saveAdjustmentRule(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, ruleSchema, 'manager', 'saveAdjustmentRule', (d, { ctx, org }) => ctx.supabase.rpc('ct_set_adjustment_rule', { p_org: org, p_contract: d.contract, p_frequency: d.frequency, p_next: d.next, p_label: d.label ?? null, p_active: d.active ?? true }),
    'Regra de reajuste salva. A data aparece nos prazos; nenhum índice é consultado automaticamente.');
}

const simSchema = z.object({ contract: uuid(), effective: dateStr('Data de efeito'), percentage: percent, label: optText(80, 'Referência'), period: optText(60, 'Período de referência'), note: optText(500, 'Fonte ou observação'), justification: optText(500, 'Justificativa') })
  .superRefine((v, ctx) => { if (v.percentage < 0n && (!v.justification || v.justification.length < 5)) ctx.addIssue({ code: 'custom', path: ['justification'], message: 'Percentual negativo exige justificativa (mínimo 5 caracteres).' }); });
export async function simulateAdjustment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, simSchema, 'manager', 'simulateAdjustment', (d, { ctx, org }) => ctx.supabase.rpc('ct_simulate_adjustment', { p_org: org, p_contract: d.contract, p_effective: d.effective, p_pct: pctParam(d.percentage),
    p_label: d.label ?? null, p_period: d.period ?? null, p_note: d.note ?? null, p_justification: d.justification ?? null }),
    'Simulação registrada. O contrato NÃO foi alterado: confira a prévia e confirme a aplicação.');
}
export async function applyAdjustment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ adjustment: uuid(), confirm: z.literal('on', { message: 'Marque a confirmação para aplicar o reajuste.' }) }), 'manager', 'applyAdjustment',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_apply_adjustment', { p_org: org, p_adjustment: d.adjustment }), 'Reajuste aplicado: nasceu uma nova versão de valor e o histórico anterior foi preservado.');
}
export async function cancelAdjustment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ adjustment: uuid() }), 'manager', 'cancelAdjustment', (d, { ctx, org }) => ctx.supabase.rpc('ct_cancel_adjustment', { p_org: org, p_adjustment: d.adjustment }), 'Simulação cancelada.');
}
