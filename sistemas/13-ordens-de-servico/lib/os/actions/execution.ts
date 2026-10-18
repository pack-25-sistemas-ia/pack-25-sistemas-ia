'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { prepareFiles, type Prepared } from '../attachments';
import { bust, dbMessage, formObject, guarded, parse, type ActionCtx, type SaveResult } from '../action-kit';
import { parseMoney, parseQuantity } from '../money';
import { idem, optText, optUuid, text, uuid } from '../validation';

const BUCKET = 'os-files';
const refresh = (order: string) => bust(`/ordens/${order}`, '/minhas-ordens', '/dashboard');

/** Envia os arquivos ao Storage privado (com a sessão do próprio usuário; a política do bucket confere a empresa e a ordem). Reenvio do mesmo conteúdo reaproveita o arquivo. */
async function upload(a: ActionCtx, files: Prepared[]): Promise<{ ok: true; created: string[] } | { ok: false; error: string }> {
  const created: string[] = [];
  for (const f of files) {
    const r = await a.ctx.supabase.storage.from(BUCKET).upload(f.path, f.bytes, { contentType: f.mime, upsert: false });
    if (r.error) {
      const dup = /already exists|duplicate|409/i.test(`${r.error.message} ${(r.error as { statusCode?: string }).statusCode ?? ''}`);
      if (!dup) {
        if (created.length) await a.ctx.supabase.storage.from(BUCKET).remove(created);
        logEvent('error', 'os_upload_failed', { name: r.error.name });
        return { ok: false, error: 'Não foi possível enviar os arquivos. Tente novamente.' };
      }
    } else created.push(f.path);
  }
  return { ok: true, created };
}
async function discard(a: ActionCtx, created: string[]) {
  if (created.length) await a.ctx.supabase.storage.from(BUCKET).remove(created).catch(() => undefined);
}
const filesJson = (files: Prepared[], category: string, visibility: string) => files.map((f) => ({ path: f.path, filename: f.filename, mime: f.mime, size: f.size, sha256: f.sha256, category: f.mime === 'application/pdf' ? 'document' : category, visibility }));

// ---------------------------------------------------------------------------- checklist
const answerSchema = z.object({ order: uuid(), item: uuid(), note: optText(500, 'Justificativa') });
export async function answerChecklist(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(answerSchema, values, values);
  if (!p.ok) return p.state;
  const na = values.not_applicable === 'on' || values.not_applicable === '1';
  const body: Record<string, unknown> = { note: p.data.note };
  if (na) body.not_applicable = true;
  else if (values.boolean === 'yes' || values.boolean === 'no') body.boolean = values.boolean === 'yes';
  else if (values.text !== undefined && values.text.trim() !== '') body.text = values.text;
  else if (values.number !== undefined && values.number.trim() !== '') {
    const n = Number(values.number.trim().replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return fail('Informe um número válido.', { number: ['Informe um número válido (ex.: 12,5).'] }, values);
    body.number = n;
  } else if (values.option) body.option = values.option;
  return guarded('staff', 'answerChecklist', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_answer_checklist', { p_org: org, p_order: p.data.order, p_item: p.data.item, p: body });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed('Resposta registrada.');
  });
}

export async function applyTemplate(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(z.object({ order: uuid(), version: z.coerce.number().int().min(0), template: uuid('Escolha um modelo.') }), values, values);
  if (!p.ok) return p.state;
  return guarded('manager', 'applyTemplate', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_apply_checklist_template', { p_org: org, p_order: p.data.order, p_version: p.data.version, p_template: p.data.template });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(p.data.order);
    return succeed(`Modelo aplicado (${(data as { items: number }).items} itens copiados para esta ordem).`);
  });
}

// ---------------------------------------------------------------------------- peças utilizadas
const usageSchema = z.object({ idem, order: uuid(), part_id: optUuid, description: optText(200, 'Descrição'), unit: optText(16, 'Unidade'), quantity: z.string().trim() });
export async function addPartUsage(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(usageSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  const q = parseQuantity(d.quantity);
  if (q === null) return fail('Quantidade inválida.', { quantity: ['Informe uma quantidade maior que zero, com até 3 casas (ex.: 1,5).'] }, values);
  if (!d.part_id && (!d.description || d.description.length < 2)) return fail('Escolha uma peça do catálogo ou descreva a peça.', { description: ['Escolha uma peça ou descreva (mín. 2 caracteres).'] }, values);
  return guarded('staff', 'addPartUsage', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_add_part_usage', { p_org: org, p_order: d.order, p_idem: d.idem, p: { part_id: d.part_id, description: d.description, unit: d.unit, quantity: Number(q) / 1000 } });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    return succeed('Uso de peça registrado.');
  });
}

const correctSchema = z.object({ idem, order: uuid(), usage: uuid(), kind: z.enum(['reversal', 'adjustment'], { message: 'Escolha estorno ou ajuste.' }), quantity: z.string().trim(), reason: text(3, 300, 'Motivo da correção') });
export async function correctPartUsage(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(correctSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  const neg = d.kind === 'adjustment' && d.quantity.trim().startsWith('-');
  const q = parseQuantity(d.quantity.replace(/^-/, ''));
  if (q === null) return fail('Quantidade inválida.', { quantity: ['Informe uma quantidade maior que zero, com até 3 casas.'] }, values);
  return guarded('staff', 'correctPartUsage', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_correct_part_usage', { p_org: org, p_order: d.order, p_idem: d.idem, p_usage: d.usage, p_kind: d.kind, p_quantity: (neg ? -1 : 1) * (Number(q) / 1000), p_reason: d.reason });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    return succeed(d.kind === 'reversal' ? 'Estorno registrado (o registro original foi preservado).' : 'Ajuste registrado (o registro original foi preservado).');
  });
}

// ---------------------------------------------------------------------------- custos internos (só a gestão)
const costSchema = z.object({ idem, order: uuid(), category: z.enum(['labor', 'part', 'travel', 'other'], { message: 'Escolha a categoria.' }), description: text(2, 200, 'Descrição'), amount: z.string().trim(), corrects_cost_id: optUuid });
export async function addCost(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(costSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  const neg = d.amount.trim().startsWith('-');
  const cents = parseMoney(d.amount.replace(/^-/, ''));
  if (cents === null || cents === 0n) return fail('Valor inválido.', { amount: ['Informe um valor válido (ex.: 180,00).'] }, values);
  if (neg && !d.corrects_cost_id) return fail('Valores negativos só corrigem um custo anterior.', { corrects_cost_id: ['Escolha o custo que está sendo corrigido.'] }, values);
  return guarded('manager', 'addCost', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_add_cost', { p_org: org, p_order: d.order, p_idem: d.idem, p: { category: d.category, description: d.description, amount_cents: (neg ? -1 : 1) * Number(cents), corrects_cost_id: d.corrects_cost_id } });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    return succeed('Custo interno registrado. Ele nunca aparece para o técnico, para o cliente nem em PDF.');
  });
}

// ---------------------------------------------------------------------------- notas e arquivos
const updateSchema = z.object({ idem, order: uuid(), visibility: z.enum(['internal', 'customer'], { message: 'Escolha para quem a nota é visível.' }), body: text(1, 4000, 'Nota'), category: z.enum(['before', 'during', 'after', 'document']).optional() });
export async function addUpdate(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(updateSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('staff', 'addUpdate', async (a) => {
    const { data: st } = await a.ctx.supabase.from('os_settings').select('attachment_max_size_bytes').eq('organization_id', a.org).maybeSingle();
    const prepared = await prepareFiles(fd, { org: a.org, order: d.order, idem: d.idem, maxBytes: (st as { attachment_max_size_bytes?: number } | null)?.attachment_max_size_bytes ?? 5 * 1024 * 1024 });
    if (!prepared.ok) return fail(prepared.error, { file: [prepared.error] }, values);
    let created: string[] = [];
    if (prepared.files.length) {
      const up = await upload(a, prepared.files);
      if (!up.ok) return fail(up.error, undefined, values);
      created = up.created;
    }
    const { error } = await a.ctx.supabase.rpc('os_add_update', { p_org: a.org, p_order: d.order, p_idem: d.idem, p_visibility: d.visibility, p_body: d.body, p_attachments: prepared.files.length ? filesJson(prepared.files, d.category ?? 'during', d.visibility) : null });
    if (error) { await discard(a, created); return fail(dbMessage(error), undefined, values); }
    refresh(d.order);
    return succeed(d.visibility === 'customer' ? 'Atualização registrada e compartilhada com o cliente.' : 'Nota interna registrada.');
  });
}

const filesSchema = z.object({ idem, order: uuid(), item: optUuid, category: z.enum(['before', 'during', 'after', 'document'], { message: 'Escolha a categoria.' }), visibility: z.enum(['internal', 'customer']).default('internal') });
export async function addFiles(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(filesSchema, formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('staff', 'addFiles', async (a) => {
    const { data: st } = await a.ctx.supabase.from('os_settings').select('attachment_max_size_bytes').eq('organization_id', a.org).maybeSingle();
    const prepared = await prepareFiles(fd, { org: a.org, order: d.order, idem: d.idem, maxBytes: (st as { attachment_max_size_bytes?: number } | null)?.attachment_max_size_bytes ?? 5 * 1024 * 1024 });
    if (!prepared.ok) return fail(prepared.error, { file: [prepared.error] }, values);
    if (prepared.files.length === 0) return fail('Selecione ao menos um arquivo.', { file: ['Selecione ao menos um arquivo.'] }, values);
    // só a gestão compartilha com o cliente; para o técnico o arquivo nasce interno
    const visibility = a.access.profile === 'technician' ? 'internal' : d.visibility;
    const up = await upload(a, prepared.files);
    if (!up.ok) return fail(up.error, undefined, values);
    const { error } = await a.ctx.supabase.rpc('os_add_files', { p_org: a.org, p_order: d.order, p_idem: d.idem, p_item: d.item ?? null, p_attachments: filesJson(prepared.files, d.category, visibility) });
    if (error) { await discard(a, up.created); return fail(dbMessage(error), undefined, values); }
    refresh(d.order);
    return succeed(`${prepared.files.length} arquivo(s) adicionado(s).`);
  });
}

export async function setAttachmentVisibility(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(z.object({ order: uuid(), attachment: uuid(), visibility: z.enum(['internal', 'customer']) }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'setAttachmentVisibility', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_set_attachment_visibility', { p_org: org, p_attachment: p.data.attachment, p_visibility: p.data.visibility });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed(p.data.visibility === 'customer' ? 'Arquivo compartilhado com o cliente.' : 'Arquivo ocultado do cliente.');
  });
}

/** Remove uploads ÓRFÃOS (enviados mas nunca vinculados a uma ordem, com mais de 2 h). A lista vem do banco; a política do Storage só permite apagar órfãos. */
export async function cleanupOrphans(): Promise<ActionState> {
  return guarded('manager', 'cleanupOrphans', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_orphan_uploads', { p_org: org });
    if (error) return fail(dbMessage(error));
    const paths = (data ?? []) as string[];
    if (paths.length === 0) return succeed('Nenhum upload órfão encontrado.');
    const r = await ctx.supabase.storage.from(BUCKET).remove(paths);
    if (r.error) return fail('Não foi possível remover os arquivos órfãos agora. Tente novamente.');
    return succeed(`${paths.length} upload(s) órfão(s) removido(s).`);
  });
}
