'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustAll, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { hexColor, idem, optDate, optText, optUuid, orderedDates, projectRole, projectStatus, semantic, text, uuid, version } from '../validation';

// Toda ação: sessão + MFA + perfil mínimo + limite de taxa (action-kit); o banco autoriza de novo pelo papel NO PROJETO e pela versão lida.
const dateOrder = (v: { start_date?: string; due_date?: string }, ctx: z.RefinementCtx) => {
  const o = orderedDates(v.start_date, v.due_date, 'due_date');
  if (!o.ok) ctx.addIssue({ code: 'custom', path: [o.field], message: o.message });
};

// ---------------------------------------------------------------------------- projeto
const createSchema = z.object({
  idem, name: text(2, 120, 'Nome do projeto'), description: optText(4000, 'Descrição'), start_date: optDate('Início'), due_date: optDate('Entrega'),
  status: z.enum(['planned', 'active'], { message: 'Escolha como o projeto começa.' }),
}).superRefine(dateOrder);
export async function createProject(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(createSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'createProject', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('pj_create_project', { p_org: org, p_idem: d.idem, p: { name: d.name, description: d.description ?? null, start_date: d.start_date ?? null, due_date: d.due_date ?? null, status: d.status } });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return { ...succeed('Projeto criado. Adicione os participantes e comece pelas tarefas.'), id: (data as { id: string }).id, redirectTo: `/projetos/${(data as { id: string }).id}` };
  });
}

const updateSchema = z.object({ project: uuid(), version, name: text(2, 120, 'Nome do projeto'), description: optText(4000, 'Descrição'), start_date: optDate('Início'), due_date: optDate('Entrega') }).superRefine(dateOrder);
export async function updateProject(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(updateSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'updateProject', async ({ ctx, org }) => {
    const d = p.data;
    const { error } = await ctx.supabase.rpc('pj_update_project', { p_org: org, p_project: d.project, p_expected: d.version, p: { name: d.name, description: d.description ?? null, start_date: d.start_date ?? null, due_date: d.due_date ?? null } });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed('Projeto atualizado.');
  });
}

const statusSchema = z.object({ project: uuid(), version, status: projectStatus, reason: optText(500, 'Motivo') });
export async function setProjectStatus(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(statusSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'setProjectStatus', async ({ ctx, org }) => {
    const d = p.data;
    const { error } = await ctx.supabase.rpc('pj_set_project_status', { p_org: org, p_project: d.project, p_expected: d.version, p_status: d.status, p_reason: d.reason ?? null });
    if (error) return fail(dbMessage(error), error.message.includes('motivo') ? { reason: [dbMessage(error)] } : undefined, values);
    bustAll();
    const msg: Record<string, string> = { active: 'Projeto ativo.', paused: 'Projeto pausado: movimentações de execução ficam bloqueadas até retomar.', completed: 'Projeto concluído e somente para consulta.', cancelled: 'Projeto cancelado.', planned: 'Projeto planejado.' };
    return succeed(msg[d.status]);
  });
}

const archiveSchema = z.object({ project: uuid(), version, archive: z.enum(['1', '0']), reason: optText(500, 'Motivo') });
export async function archiveProject(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(archiveSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'archiveProject', async ({ ctx, org }) => {
    const d = p.data;
    const { error } = await ctx.supabase.rpc('pj_archive_project', { p_org: org, p_project: d.project, p_expected: d.version, p_archive: d.archive === '1', p_reason: d.reason ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed(d.archive === '1' ? 'Projeto arquivado. O histórico foi preservado.' : 'Projeto desarquivado.');
  });
}

// ---------------------------------------------------------------------------- participantes
export async function addMember(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), user: uuid('Escolha uma pessoa.'), role: projectRole }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'addMember', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_add_member', { p_org: org, p_project: p.data.project, p_user: p.data.user, p_role: p.data.role });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed('Participante adicionado.');
  });
}

const treatSchema = { task_action: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['unassign', 'transfer']).optional()), transfer_to: optUuid };
export async function setMemberRole(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), user: uuid(), role: projectRole, ...treatSchema }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'setMemberRole', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('pj_set_member_role', { p_org: org, p_project: d.project, p_user: d.user, p_role: d.role, p_task_action: d.task_action ?? null, p_transfer_to: d.transfer_to ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed((data as number) > 0 ? `Papel alterado; ${data} tarefa(s) tratada(s).` : 'Papel alterado.');
  });
}

export async function removeMember(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), user: uuid(), ...treatSchema }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'removeMember', async ({ ctx, org }) => {
    const d = p.data;
    const { data, error } = await ctx.supabase.rpc('pj_remove_member', { p_org: org, p_project: d.project, p_user: d.user, p_task_action: d.task_action ?? null, p_transfer_to: d.transfer_to ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed((data as number) > 0 ? `Participante removido; ${data} tarefa(s) tratada(s). O acesso foi revogado agora.` : 'Participante removido. O acesso foi revogado agora.');
  });
}

// ---------------------------------------------------------------------------- etapas do quadro
const boardV = z.coerce.number().int().min(1).max(1_000_000);
export async function addColumn(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), board: boardV, name: text(1, 40, 'Nome da etapa'), semantic }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'addColumn', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_add_column', { p_org: org, p_project: p.data.project, p_expected_board: p.data.board, p_name: p.data.name, p_semantic: p.data.semantic });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed('Etapa criada no fim do quadro.');
  });
}

export async function renameColumn(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), column: uuid(), name: text(1, 40, 'Nome da etapa') }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'renameColumn', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_rename_column', { p_org: org, p_project: p.data.project, p_column: p.data.column, p_name: p.data.name });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed('Etapa renomeada (o tipo da etapa não muda).');
  });
}

/** Sobe ou desce uma etapa trocando com a vizinha: ordem persistida no banco, sem arrastar. */
export async function moveColumn(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), board: boardV, column: uuid(), dir: z.enum(['up', 'down']) }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'moveColumn', async ({ ctx, org }) => {
    const { data } = await ctx.supabase.from('project_columns').select('id').eq('project_id', p.data.project).order('position');
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    const i = ids.indexOf(p.data.column);
    const j = p.data.dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return fail('A etapa já está na ponta do quadro.');
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const { error } = await ctx.supabase.rpc('pj_reorder_columns', { p_org: org, p_project: p.data.project, p_expected_board: p.data.board, p_ids: ids });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed('Ordem das etapas atualizada.');
  });
}

export async function deleteColumn(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), board: boardV, column: uuid(), move_to: optUuid }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'deleteColumn', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_delete_column', { p_org: org, p_project: p.data.project, p_expected_board: p.data.board, p_column: p.data.column, p_move_to: p.data.move_to ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    bustAll();
    return succeed('Etapa excluída; as tarefas foram realocadas.');
  });
}

// ---------------------------------------------------------------------------- etiquetas
export async function saveLabel(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), label: optUuid, name: text(1, 30, 'Nome da etiqueta'), color: hexColor }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'saveLabel', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_save_label', { p_org: org, p_project: p.data.project, p_id: p.data.label ?? null, p_name: p.data.name, p_color: p.data.color.toLowerCase() });
    if (error) return fail(dbMessage(error, 'Já existe uma etiqueta com esse nome neste projeto.'), undefined, values);
    bustAll();
    return succeed('Etiqueta salva.');
  });
}
export async function deleteLabel(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ project: uuid(), label: uuid() }), values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'deleteLabel', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('pj_delete_label', { p_org: org, p_project: p.data.project, p_label: p.data.label });
    if (error) return fail(dbMessage(error));
    bustAll();
    return succeed('Etiqueta removida das tarefas e do projeto.');
  });
}
