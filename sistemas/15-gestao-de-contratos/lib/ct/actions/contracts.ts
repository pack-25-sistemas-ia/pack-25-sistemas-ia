'use server';

import { z } from 'zod';
import { type ActionState } from '@/lib/actions/result';
import { runRpc, type SaveResult } from '../action-kit';
import { billingBasis, accessRole, dateStr, flag, idem, optDate, optText, optUuid, personType, text, uuid, version } from '../validation';
import { parseMoney } from '../money';

// Toda ação: sessão + MFA + perfil mínimo + limite de taxa (action-kit); o banco autoriza de novo pelo papel NO CONTRATO e pela versão lida.
const optInt = (label: string, min: number, max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.coerce.number({ message: `${label}: informe um número.` }).int(`${label}: use um número inteiro.`).min(min, `${label}: mínimo ${min}.`).max(max, `${label}: máximo ${max}.`).optional());
const money = (label: string) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().transform((s, ctx) => { const c = parseMoney(s); if (c === null) { ctx.addIssue({ code: 'custom', message: `${label}: use um valor como 1.234,56.` }); return z.NEVER; } return c; }).optional());

// ---------------------------------------------------------------------------- partes e categorias
const cpSchema = z.object({ idem, id: optUuid, version: z.coerce.number().int().min(0).optional().catch(undefined), person_type: personType, name: text(2, 160, 'Nome'), document_number: optText(30, 'CPF/CNPJ'), email: optText(200, 'E-mail'), phone: optText(40, 'Telefone'), address: optText(400, 'Endereço') });
export async function saveCounterparty(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, cpSchema, 'manager', 'saveCounterparty', (d, { ctx, org }) => ctx.supabase.rpc('ct_save_counterparty', { p_org: org, p_id: d.id ?? null, p_expected: d.id ? (d.version ?? null) : null, p_idem: d.idem,
    p: { person_type: d.person_type, name: d.name, document_number: d.document_number ?? null, email: d.email ?? null, phone: d.phone ?? null, address: d.address ?? null } }),
    (_data, d) => (d.id ? 'Parte atualizada.' : 'Parte cadastrada.'));
}
export async function setCounterpartyActive(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ id: uuid(), active: z.enum(['1', '0']) }), 'manager', 'setCounterpartyActive', (d, { ctx, org }) => ctx.supabase.rpc('ct_set_counterparty_active', { p_org: org, p_id: d.id, p_active: d.active === '1' }),
    (_x, d) => (d.active === '1' ? 'Parte reativada.' : 'Parte inativada. Ela continua nos contratos em que já estava.'));
}
export async function saveCategory(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ id: optUuid, name: text(2, 80, 'Nome da categoria'), active: flag.optional() }), 'manager', 'saveCategory', (d, { ctx, org }) => ctx.supabase.rpc('ct_save_category', { p_org: org, p_id: d.id ?? null, p_name: d.name, p_active: d.id ? (d.active ?? false) : true }),
    (_x, d) => (d.id ? 'Categoria atualizada.' : 'Categoria criada.'));
}

// ---------------------------------------------------------------------------- contrato
const createSchema = z.object({
  idem, title: text(2, 200, 'Título'), description: optText(4000, 'Descrição'), category_id: optUuid, start_date: dateStr('Início da vigência'), term: z.enum(['fixed', 'indefinite'], { message: 'Escolha o tipo de prazo.' }),
  end_date: optDate('Fim da vigência'), responsible_user_id: optUuid, notice_days: optInt('Dias de aviso', 0, 3650), notice_reference_date: optDate('Referência do aviso'), renewal_mode: z.enum(['none', 'manual']).default('none'),
  party_id: uuid('Escolha a parte do contrato.'), party_role: text(2, 120, 'Papel da parte'), value: money('Valor'), billing_basis: z.preprocess((v) => (v === '' ? undefined : v), billingBasis.optional()),
  adj_frequency: optInt('Frequência do reajuste', 1, 120), adj_next: optDate('Próximo reajuste'), adj_label: optText(80, 'Referência do reajuste'),
}).superRefine((v, ctx) => {
  if (v.term === 'fixed' && !v.end_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'Informe o fim da vigência ou escolha prazo indeterminado.' });
  if (v.term === 'indefinite' && v.end_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'Prazo indeterminado não tem data de fim.' });
  if (v.end_date && v.end_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'O fim não pode ser anterior ao início.' });
  if (v.term === 'indefinite' && v.notice_days !== undefined && !v.notice_reference_date) ctx.addIssue({ code: 'custom', path: ['notice_reference_date'], message: 'Prazo indeterminado com aviso exige a data de referência.' });
  if (v.value !== undefined && !v.billing_basis) ctx.addIssue({ code: 'custom', path: ['billing_basis'], message: 'Informe a periodicidade do valor.' });
  if ((v.adj_frequency === undefined) !== (v.adj_next === undefined)) ctx.addIssue({ code: 'custom', path: ['adj_next'], message: 'Para a regra de reajuste, informe a frequência e a próxima data.' });
});
export async function createContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, createSchema, 'manager', 'createContract', (d, { ctx, org }) => ctx.supabase.rpc('ct_create_contract', { p_org: org, p_idem: d.idem, p: {
    title: d.title, description: d.description ?? null, category_id: d.category_id ?? null, start_date: d.start_date, end_date: d.end_date ?? null, indefinite_term: d.term === 'indefinite',
    responsible_user_id: d.responsible_user_id ?? null, notice_days: d.notice_days ?? null, notice_reference_date: d.notice_reference_date ?? null, renewal_mode: d.renewal_mode,
    parties: [{ counterparty_id: d.party_id, role_description: d.party_role }],
    value: d.value !== undefined ? { amount_cents: d.value, billing_basis: d.billing_basis } : null,
    adjustment_rule: d.adj_frequency !== undefined ? { frequency_months: d.adj_frequency, next_adjustment_date: d.adj_next, reference_label: d.adj_label ?? null } : null } }),
    (data) => { const id = (data as { id: string }).id; return { ok: true, message: 'Contrato criado como rascunho. Confira as informações e ative quando estiver pronto.', id, redirectTo: `/contratos/${id}` }; });
}

const updateSchema = z.object({ contract: uuid(), version, title: text(2, 200, 'Título'), description: optText(4000, 'Descrição'), category_id: optUuid, renewal_mode: z.enum(['none', 'manual']).optional(),
  start_date: optDate('Início da vigência'), end_date: optDate('Fim da vigência'), term: z.enum(['fixed', 'indefinite']).optional() });
export async function updateContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, updateSchema, 'member', 'updateContract', (d, { ctx, org }) => ctx.supabase.rpc('ct_update_contract', { p_org: org, p_contract: d.contract, p_expected: d.version, p: {
    title: d.title, description: d.description ?? null, category_id: d.category_id ?? null,
    ...(d.renewal_mode ? { renewal_mode: d.renewal_mode } : {}), ...(d.start_date ? { start_date: d.start_date } : {}), ...(d.term ? { indefinite_term: d.term === 'indefinite', end_date: d.term === 'indefinite' ? null : (d.end_date ?? null) } : {}) } }),
    'Contrato atualizado.');
}

const noticeSchema = z.object({ contract: uuid(), version, notice_days: optInt('Dias de aviso', 0, 3650), notice_reference_date: optDate('Referência'), manual_deadline: optDate('Prazo ajustado'), justification: optText(500, 'Justificativa') });
export async function setNotice(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, noticeSchema, 'member', 'setNotice', (d, { ctx, org }) => ctx.supabase.rpc('ct_set_notice', { p_org: org, p_contract: d.contract, p_expected: d.version, p: {
    notice_days: d.notice_days ?? null, notice_reference_date: d.notice_reference_date ?? null, manual_deadline: d.manual_deadline ?? null, justification: d.justification ?? null } }),
    (_x, d) => (d.notice_days === undefined ? 'Prazo de aviso removido.' : d.manual_deadline ? 'Prazo de aviso ajustado manualmente (fica marcado como ajustado).' : 'Prazo de aviso calculado: referência menos os dias.'));
}

export async function setResponsible(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version, user: optUuid }), 'manager', 'setResponsible', (d, { ctx, org }) => ctx.supabase.rpc('ct_set_responsible', { p_org: org, p_contract: d.contract, p_expected: d.version, p_user: d.user ?? null }),
    (_x, d) => (d.user ? 'Responsável definido. A pessoa foi avisada.' : 'Contrato sem responsável.'));
}

const accessSchema = z.object({ contract: uuid(), user: uuid('Escolha a pessoa.'), role: z.preprocess((v) => (v === '' ? undefined : v), accessRole.optional()), action: z.enum(['unassign', 'transfer']).optional().catch(undefined), transfer_to: optUuid });
export async function setAccess(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, accessSchema, 'manager', 'setAccess', (d, { ctx, org }) => ctx.supabase.rpc('ct_set_access', { p_org: org, p_contract: d.contract, p_user: d.user, p_role: d.role ?? null, p_obligation_action: d.action ?? null, p_transfer_to: d.transfer_to ?? null }),
    (_x, d) => (d.role ? 'Acesso salvo.' : 'Acesso removido. A pessoa deixa de ver o contrato imediatamente.'));
}

export async function addParty(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), counterparty: uuid('Escolha a parte.'), role_description: text(2, 120, 'Papel da parte') }), 'manager', 'addParty',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_add_party', { p_org: org, p_contract: d.contract, p_counterparty: d.counterparty, p_role_description: d.role_description }), 'Parte adicionada ao contrato.');
}
export async function removeParty(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), counterparty: uuid() }), 'manager', 'removeParty', (d, { ctx, org }) => ctx.supabase.rpc('ct_remove_party', { p_org: org, p_contract: d.contract, p_counterparty: d.counterparty }), 'Parte removida do contrato.');
}

// ---------------------------------------------------------------------------- ciclo de vida
export async function activateContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version }), 'manager', 'activateContract', (d, { ctx, org }) => ctx.supabase.rpc('ct_activate_contract', { p_org: org, p_contract: d.contract, p_expected: d.version }),
    'Contrato ativado. É um registro administrativo: o sistema não atesta assinatura nem validade jurídica.');
}
export async function terminateContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version, ended_on: dateStr('Data da rescisão'), reason: text(5, 500, 'Motivo') }), 'manager', 'terminateContract',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_terminate_contract', { p_org: org, p_contract: d.contract, p_expected: d.version, p_ended_on: d.ended_on, p_reason: d.reason }), 'Contrato rescindido e somente para consulta. O histórico foi preservado.');
}
export async function closeContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version, reason: text(5, 500, 'Motivo') }), 'manager', 'closeContract',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_close_contract', { p_org: org, p_contract: d.contract, p_expected: d.version, p_reason: d.reason }), 'Contrato encerrado e somente para consulta.');
}
export async function reopenContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version, reason: text(5, 500, 'Justificativa') }), 'manager', 'reopenContract',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_reopen_contract', { p_org: org, p_contract: d.contract, p_expected: d.version, p_reason: d.reason }), 'Contrato reaberto (a justificativa ficou no histórico).');
}
export async function archiveContract(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version, archive: z.enum(['1', '0']) }), 'manager', 'archiveContract',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_archive_contract', { p_org: org, p_contract: d.contract, p_expected: d.version, p_archive: d.archive === '1' }),
    (_x, d) => (d.archive === '1' ? 'Contrato arquivado. Documentos e histórico foram preservados.' : 'Contrato desarquivado.'));
}
export async function deleteDraft(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ contract: uuid(), version }), 'manager', 'deleteDraft', (d, { ctx, org }) => ctx.supabase.rpc('ct_delete_draft', { p_org: org, p_contract: d.contract, p_expected: d.version }),
    () => ({ ok: true, message: 'Rascunho excluído.', redirectTo: '/contratos' }));
}

// ---------------------------------------------------------------------------- obrigações
const oblSchema = z.object({ contract: uuid(), id: optUuid, version: z.coerce.number().int().min(0).optional().catch(undefined), title: text(2, 200, 'Título'), description: optText(2000, 'Descrição'), responsible_user_id: optUuid, due_date: dateStr('Data') });
export async function saveObligation(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, oblSchema, 'member', 'saveObligation', (d, { ctx, org }) => ctx.supabase.rpc('ct_save_obligation', { p_org: org, p_contract: d.contract, p_id: d.id ?? null, p_expected: d.id ? (d.version ?? null) : null,
    p: { title: d.title, description: d.description ?? null, responsible_user_id: d.responsible_user_id ?? null, due_date: d.due_date } }), (_x, d) => (d.id ? 'Obrigação atualizada.' : 'Obrigação criada.'));
}
export async function completeObligation(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ id: uuid(), version, note: optText(500, 'Nota de conclusão') }), 'member', 'completeObligation',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_complete_obligation', { p_org: org, p_obligation: d.id, p_expected: d.version, p_note: d.note ?? null }), 'Obrigação concluída.');
}
export async function cancelObligation(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ id: uuid(), version, reason: text(3, 500, 'Motivo') }), 'member', 'cancelObligation',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_cancel_obligation', { p_org: org, p_obligation: d.id, p_expected: d.version, p_reason: d.reason }), 'Obrigação cancelada.');
}

// ---------------------------------------------------------------------------- notificações
export async function markNotificationRead(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ id: uuid() }), 'member', 'markNotificationRead', (d, { ctx, org }) => ctx.supabase.rpc('ct_mark_notification_read', { p_org: org, p_id: d.id }), 'Marcada como lida.');
}
export async function markAllNotificationsRead(_prev: ActionState, _fd: FormData): Promise<SaveResult> {
  return runRpc(_fd, z.object({}), 'member', 'markAllNotificationsRead', (_d, { ctx, org }) => ctx.supabase.rpc('ct_mark_all_notifications_read', { p_org: org }), (n) => `${Number(n ?? 0)} notificação(ões) marcada(s) como lida(s).`);
}
