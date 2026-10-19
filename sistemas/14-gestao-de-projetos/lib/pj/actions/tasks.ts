'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustAll, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { prepareFiles } from '../attachments';
import { parseChecklistLines } from '../checklist';
import { flag, idem, optDate, optText, optUuid, orderedDates, priority, text, uuid, version } from '../validation';

const dateOrder = (v: { start_date?: string; due_date?: string }, ctx: z.RefinementCtx) => {
  const o = orderedDates(v.start_date, v.due_date, 'due_date');
  if (!o.ok) ctx.addIssue({ code: 'custom', path: [o.field], message: o.message });
};

const warn = (w: unknown): string => (Array.isArray(w) && w.length ? ` Aviso: ${w.join(' ')}` : '');

// ---------------------------------------------------------------------------- criar e editar
const createSchema = z.object({
  idem, project: uuid(), title: text(2, 200, 'Título'), description: optText(8000, 'Descrição'), priority, assignee: optUuid, column: optUuid, start_date: optDate('Início'), due_date: optDate('Vencimento'),
  checklist: optText(10000, 'Checklist'),
}).superRefine(dateOrder);
export async function createTask(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const labels = fd.getAll('label_ids').filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
  const p = parse(createSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'createTask', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('pj_create_task', { p_org: org, p_project: d.project, p_idem: d.idem, p: {
      title: d.title, description: d.description ?? null, priority: d.priority, assignee_user_id: d.assignee ?? null, column_id: d.column ?? null, start_date: d.start_date ?? null, due_date: d.due_date ?? null,
      label_ids: labels, checklist: parseChecklistLines(d.checklist ?? '') } });
    if (error) return fail(dbMessage(error), error.message.includes('responsável') ? { assignee: [dbMessage(error)] } : undefined, values);
    bustAll();
    const r = data as { id: string; task_number: number; warnings?: string[] };
    return { ...succeed(`Tarefa criada.${warn(r.warnings)}`), id: r.id };
  });
}

const updateSchema = z.object({ task: uuid(), version, title: text(2, 200, 'Título'), description: optText(8000, 'Descrição'), priority, start_date: optDate('Início'), due_date: optDate('Vencimento') }).superRefine(dateOrder);
export async function updateTask(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(updateSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'updateTask', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('pj_update_task', { p_org: org, p_task: d.task, p_expected: d.version, p: { title: d.title, description: d.description ?? null, priority: d.priority, start_date: d.start_date ?? null, due_date: d.due_date ?? null } });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed(`Tarefa atualizada.${warn((data as { warnings?: string[] }).warnings)}`);
  });
}

export async function assignTask(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ task: uuid(), version, assignee: optUuid }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'assignTask', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_assign_task', { p_org: org, p_task: p.data.task, p_expected: p.data.version, p_user: p.data.assignee ?? null });
    if (error) return fail(dbMessage(error), { assignee: [dbMessage(error)] }, values);
    bustAll();
    return succeed(p.data.assignee ? 'Responsável definido.' : 'Responsável removido.');
  });
}

// ---------------------------------------------------------------------------- mover (menu acessível e arrastar usam a MESMA intenção)
export type MoveIntent = { task: string; column: string; before: string | null; board: number | null };
export type MoveResult = { ok: boolean; message: string; board?: number; conflict?: boolean };
const UUID = z.string().uuid();
export async function moveTaskIntent(intent: MoveIntent): Promise<MoveResult> {
  const p = z.object({ task: UUID, column: UUID, before: UUID.nullable(), board: z.number().int().min(1).max(1_000_000).nullable() }).safeParse(intent);
  if (!p.success) return { ok: false, message: 'Movimentação inválida.' };
  const r = await guarded('member', 'moveTask', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('pj_move_task', { p_org: org, p_task: p.data.task, p_to_column: p.data.column, p_before_task: p.data.before, p_board_version: p.data.board });
    if (error) return { ...fail(dbMessage(error)), conflict: error.code === '40001' } as ActionState;
    bustAll();
    const d = data as { board_version: number; changed: boolean; completed?: boolean; reopened?: boolean };
    return { ...succeed(!d.changed ? 'A tarefa já estava nessa posição.' : d.completed ? 'Tarefa concluída.' : d.reopened ? 'Tarefa reaberta.' : 'Tarefa movida.'), board: d.board_version } as ActionState;
  });
  const x = r as ActionState & { board?: number; conflict?: boolean };
  return { ok: !!x.ok, message: x.message ?? '', board: x.board, conflict: x.conflict };
}
/** Formulário «Mover para…» (sem arrastar): etapa de destino e posição (início ou fim). */
export async function moveTask(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ task: uuid(), column: uuid('Escolha a etapa de destino.'), board: z.coerce.number().int().min(1).optional(), where: z.enum(['start', 'end']).default('end'), first: optUuid }), values, values);
  if (!p.ok) return p.state;
  const r = await moveTaskIntent({ task: p.data.task, column: p.data.column, before: p.data.where === 'start' ? p.data.first ?? null : null, board: p.data.board ?? null });
  return r.ok ? succeed(r.message) : fail(r.message, undefined, values);
}

// ---------------------------------------------------------------------------- impedimento e arquivamento
export async function setBlocked(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ task: uuid(), version, reason: optText(500, 'Motivo') }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'setBlocked', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_set_blocked', { p_org: org, p_task: p.data.task, p_expected: p.data.version, p_reason: p.data.reason ?? null });
    if (error) return fail(dbMessage(error), { reason: [dbMessage(error)] }, values);
    bustAll();
    return succeed(p.data.reason ? 'Impedimento registrado. A tarefa continua na mesma etapa.' : 'Impedimento removido.');
  });
}

export async function archiveTask(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ task: uuid(), version, reason: optText(500, 'Motivo') }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'archiveTask', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_archive_task', { p_org: org, p_task: p.data.task, p_expected: p.data.version, p_reason: p.data.reason ?? null });
    if (error) return fail(dbMessage(error), { reason: [dbMessage(error)] }, values);
    bustAll();
    return { ...succeed('Tarefa arquivada. O histórico foi preservado.'), redirectTo: '/tarefas' } as SaveResult;
  });
}

// ---------------------------------------------------------------------------- etiquetas e checklist
export async function setTaskLabels(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ task: uuid() }), values, values);
  if (!p.ok) return p.state;
  const labels = fd.getAll('label_ids').filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
  return guarded('member', 'setTaskLabels', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_set_task_labels', { p_org: org, p_task: p.data.task, p_label_ids: labels });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed('Etiquetas atualizadas.');
  });
}

export async function addChecklistItem(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ task: uuid(), title: text(1, 200, 'Item'), required: flag }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'addChecklistItem', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_add_checklist_item', { p_org: org, p_task: p.data.task, p_title: p.data.title, p_required: p.data.required });
    if (error) return fail(dbMessage(error), { title: [dbMessage(error)] }, values);
    bustAll();
    return succeed('Item adicionado ao checklist.');
  });
}

export async function toggleChecklistItem(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ item: uuid(), done: z.enum(['1', '0']) }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'toggleChecklistItem', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_toggle_checklist_item', { p_org: org, p_item: p.data.item, p_done: p.data.done === '1' });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed(p.data.done === '1' ? 'Item concluído.' : 'Item reaberto.');
  });
}

export async function removeChecklistItem(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ item: uuid() }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'removeChecklistItem', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_remove_checklist_item', { p_org: org, p_item: p.data.item });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed('Item removido do checklist.');
  });
}

// ---------------------------------------------------------------------------- comentários e anexos
export async function addComment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ idem, task: uuid(), body: text(1, 4000, 'Comentário') }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'addComment', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_add_comment', { p_org: org, p_task: p.data.task, p_idem: p.data.idem, p_body: p.data.body });
    if (error) return fail(dbMessage(error), { body: [dbMessage(error)] }, values);
    bustAll();
    return succeed('Comentário publicado.');
  });
}

export async function uploadAttachments(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ idem, task: uuid() }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'uploadAttachments', async ({ ctx, org }) => {
    const { data: s } = await ctx.supabase.from('pj_settings').select('attachment_max_size_bytes').eq('organization_id', org).maybeSingle();
    const max = (s as { attachment_max_size_bytes: number } | null)?.attachment_max_size_bytes ?? 5 * 1024 * 1024;
    const prep = await prepareFiles(fd, { org, task: p.data.task, idem: p.data.idem, maxBytes: max });
    if (!prep.ok) return fail(prep.error, { file: [prep.error] });
    if (!prep.files.length) return fail('Escolha ao menos um arquivo.', { file: ['Escolha ao menos um arquivo.'] });
    const uploaded: string[] = [];
    for (const f of prep.files) {
      const up = await ctx.supabase.storage.from('pj-files').upload(f.path, f.bytes, { contentType: f.mime, upsert: true });
      if (up.error) {
        if (uploaded.length) await ctx.supabase.storage.from('pj-files').remove(uploaded);
        return fail(up.error.message.toLowerCase().includes('row-level') ? 'Você não tem permissão para anexar nesta tarefa.' : 'Não foi possível enviar o arquivo. Tente novamente.');
      }
      uploaded.push(f.path);
    }
    const { data, error } = await ctx.supabase.rpc('pj_add_attachments', { p_org: org, p_task: p.data.task, p_idem: p.data.idem, p_files: prep.files.map((f) => ({ path: f.path, mime: f.mime, size: f.size, filename: f.filename, sha256: f.sha256 })) });
    if (error) {
      await ctx.supabase.storage.from('pj-files').remove(uploaded);
      return fail(dbMessage(error), { file: [dbMessage(error)] });
    }
    bustAll();
    return succeed(`${data as number} arquivo(s) anexado(s).`);
  });
}

// ---------------------------------------------------------------------------- notificações
export async function markNotificationRead(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(z.object({ id: uuid() }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('member', 'markNotificationRead', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_mark_notification_read', { p_org: org, p_id: p.data.id });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed();
  });
}
export async function markAllNotificationsRead(): Promise<SaveResult> {
  return guarded('member', 'markAllNotificationsRead', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_mark_all_notifications_read', { p_org: org });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed('Notificações marcadas como lidas.');
  });
}
