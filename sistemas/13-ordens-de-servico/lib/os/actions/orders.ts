'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { idem, optText, optUuid, text, uuid, version, windowToInstants } from '../validation';
import { PRIORITIES } from '../status';

// Ciclo de vida da ordem. Cada ação valida a entrada aqui e chama a função os_* — que trava a linha, confere a versão (40001 = alterada por outra pessoa), a permissão e a regra de estado.
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const conflictsNote = (c: unknown): string => {
  const n = Array.isArray(c) ? c.length : 0;
  return n > 0 ? ` Atenção: a janela se sobrepõe a ${n} outra(s) ordem(ns) deste técnico (é um alerta, não um bloqueio).` : '';
};
const refresh = (id: string) => bust(`/ordens/${id}`, '/ordens', '/minhas-ordens', '/agenda', '/dashboard');

const openSchema = z.object({
  idem, customer_id: uuid('Escolha o cliente.'), address_id: optUuid, equipment_id: optUuid, contact_id: optUuid,
  subject: text(3, 160, 'Assunto'), problem_description: text(3, 4000, 'Descrição da solicitação'), priority: z.enum(PRIORITIES, { message: 'Escolha a prioridade.' }),
  technician_id: optUuid, sched_date: z.string().optional(), sched_start: z.string().optional(), sched_end: z.string().optional(),
  quote_mode: z.enum(['required', 'authorized'], { message: 'Escolha como a execução será autorizada.' }), authorization_justification: optText(1000, 'Justificativa'),
});
export async function openOrder(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  delete values.idem; // a chave é gerada pelo hook; nunca devolvida ao formulário
  const p = parse(openSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  if (d.quote_mode === 'authorized' && (d.authorization_justification ?? '').length < 10) {
    return fail('Informe a justificativa (mínimo 10 caracteres) para executar sem orçamento.', { authorization_justification: ['Justificativa obrigatória (mínimo 10 caracteres).'] }, values);
  }
  const templateIds = fd.getAll('template_ids').filter((v): v is string => typeof v === 'string' && z.string().uuid().safeParse(v).success).slice(0, 5);
  const asDraft = values.as_draft === 'on';
  return guarded('manager', 'openOrder', async ({ ctx, org, access }) => {
    void access;
    const { data: st } = await ctx.supabase.from('os_settings').select('timezone').eq('organization_id', org).maybeSingle();
    const tz = (st as { timezone?: string } | null)?.timezone ?? 'America/Sao_Paulo';
    let win: { startsAt: string; endsAt: string } | null = null;
    if (d.sched_date || d.sched_start || d.sched_end) {
      const w = windowToInstants({ date: d.sched_date, start: d.sched_start, end: d.sched_end }, tz);
      if (!w.ok) return fail(w.message, { [w.field]: [w.message] }, values);
      win = w;
      if (!d.technician_id) return fail('Escolha o técnico para agendar a janela.', { technician_id: ['Escolha o técnico responsável.'] }, values);
    }
    const { data, error } = await ctx.supabase.rpc('os_open_order', {
      p_org: org, p_idem: d.idem,
      p: strip({ customer_id: d.customer_id, address_id: d.address_id, equipment_id: d.equipment_id, contact_id: d.contact_id, subject: d.subject, problem_description: d.problem_description, priority: d.priority,
        technician_id: d.technician_id, scheduled_start_at: win?.startsAt, scheduled_end_at: win?.endsAt, template_ids: templateIds, quote_mode: d.quote_mode, authorization_justification: d.authorization_justification, as_draft: asDraft }),
    });
    if (error) return fail(dbMessage(error), undefined, values);
    const r = data as { id: string; number_text: string; conflicts?: unknown };
    bust('/ordens', '/minhas-ordens', '/agenda', '/dashboard');
    return { ...succeed(`Ordem ${r.number_text} ${asDraft ? 'salva como rascunho' : 'aberta'}.${conflictsNote(r.conflicts)}`), id: r.id, redirectTo: `/ordens/${r.id}` };
  });
}

const updateSchema = z.object({ order: uuid(), version, subject: text(3, 160, 'Assunto'), problem_description: text(3, 4000, 'Descrição'), priority: z.enum(PRIORITIES), quote_mode: z.enum(['required', 'authorized']), authorization_justification: optText(1000, 'Justificativa') });
export async function updateOrder(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(updateSchema, values, values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('manager', 'updateOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_update_order', { p_org: org, p_order: d.order, p_version: d.version, p: strip({ subject: d.subject, problem_description: d.problem_description, priority: d.priority, quote_mode: d.quote_mode, authorization_justification: d.authorization_justification }) });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    return succeed('Dados da ordem salvos.');
  });
}

/** Ações simples sobre uma ordem (botão com campos ocultos `order` e `version`). */
const simple = z.object({ order: uuid(), version });

export async function confirmDraft(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(simple, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'confirmDraft', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_confirm_draft', { p_org: org, p_order: p.data.order, p_version: p.data.version });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Rascunho confirmado: a ordem está aberta.');
  });
}

export async function startOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(simple, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('staff', 'startOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_start', { p_org: org, p_order: p.data.order, p_version: p.data.version });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Execução iniciada.');
  });
}

export async function resumeOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(simple, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('staff', 'resumeOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_resume', { p_org: org, p_order: p.data.order, p_version: p.data.version });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Execução retomada.');
  });
}

export async function closeOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(simple, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'closeOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_close', { p_org: org, p_order: p.data.order, p_version: p.data.version });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Ordem encerrada.');
  });
}

export async function unscheduleOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(simple, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'unscheduleOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_unschedule', { p_org: org, p_order: p.data.order, p_version: p.data.version });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Agendamento desfeito.');
  });
}

const pauseSchema = simple.extend({ reason: text(3, 300, 'Motivo da pausa') });
export async function pauseOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(pauseSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('staff', 'pauseOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_pause', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed('Execução pausada.');
  });
}

const cancelSchema = simple.extend({ reason: text(5, 500, 'Motivo do cancelamento') });
export async function cancelOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(cancelSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'cancelOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_cancel', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_reason: p.data.reason });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed('Ordem cancelada. O link de acompanhamento foi revogado.');
  });
}

const reopenSchema = simple.extend({ reason: text(10, 500, 'Motivo da reabertura'), technician_id: optUuid });
export async function reopenOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(reopenSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'reopenOrder', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_reopen', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_reason: p.data.reason, p_technician: p.data.technician_id ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed('Ordem reaberta para execução. A próxima conclusão gera uma nova versão e um novo pedido de aceite.');
  });
}

const completeSchema = simple.extend({ summary: text(5, 4000, 'Resumo do serviço'), divergence_note: optText(1000, 'Justificativa da divergência') });
export async function completeOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(completeSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('staff', 'completeOrder', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_complete', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_summary: p.data.summary, p_divergence_note: p.data.divergence_note ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    const cv = (data as { completion_version?: number } | null)?.completion_version ?? 1;
    return succeed(`Serviço concluído (versão ${cv} da conclusão). Agora é preciso o aceite do cliente.`);
  });
}

const assignSchema = simple.extend({ technician_id: optUuid });
export async function assignOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(assignSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'assignOrder', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_assign', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_technician: p.data.technician_id ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed(`${p.data.technician_id ? 'Responsável atribuído.' : 'Responsável removido.'}${conflictsNote((data as { conflicts?: unknown } | null)?.conflicts)}`);
  });
}

const scheduleSchema = simple.extend({ technician_id: uuid('Escolha o técnico responsável.'), sched_date: z.string(), sched_start: z.string(), sched_end: z.string() });
export async function scheduleOrder(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(scheduleSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'scheduleOrder', async ({ ctx, org }) => {
    const { data: st } = await ctx.supabase.from('os_settings').select('timezone').eq('organization_id', org).maybeSingle();
    const tz = (st as { timezone?: string } | null)?.timezone ?? 'America/Sao_Paulo';
    const w = windowToInstants({ date: p.data.sched_date, start: p.data.sched_start, end: p.data.sched_end }, tz);
    if (!w.ok) return fail(w.message, { [w.field]: [w.message] }, values);
    const { data, error } = await ctx.supabase.rpc('os_schedule', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_technician: p.data.technician_id, p_start: w.startsAt, p_end: w.endsAt });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed(`Atendimento agendado.${conflictsNote((data as { conflicts?: unknown } | null)?.conflicts)}`);
  });
}

const snapshotSchema = simple.extend({ address_id: optUuid, equipment_id: optUuid, contact_id: optUuid, reason: text(5, 300, 'Motivo da atualização') });
export async function updateSnapshot(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(snapshotSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'updateSnapshot', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_update_snapshot', { p_org: org, p_order: p.data.order, p_version: p.data.version, p: { address_id: p.data.address_id ?? '', equipment_id: p.data.equipment_id ?? '', contact_id: p.data.contact_id ?? '', reason: p.data.reason } });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed('Cliente, local e equipamento atualizados com os dados atuais do cadastro. Documentos já aprovados mantêm os dados da época.');
  });
}
