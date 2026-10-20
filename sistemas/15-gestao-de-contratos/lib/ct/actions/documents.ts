'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bustAll, dbMessage, formObject, guarded, parse, runRpc, type SaveResult } from '../action-kit';
import { prepareFiles } from '../attachments';
import { docType, idem, text, uuid } from '../validation';

// Documentos: o servidor decide tipo (pelos BYTES), tamanho e caminho; o arquivo vai para o bucket privado e o banco registra a versão. Nova versão nunca sobrescreve a anterior.
async function maxBytes(ctx: { supabase: import('@supabase/supabase-js').SupabaseClient }, org: string): Promise<number> {
  const { data } = await ctx.supabase.from('ct_settings').select('attachment_max_size_bytes').eq('organization_id', org).maybeSingle();
  return (data as { attachment_max_size_bytes: number } | null)?.attachment_max_size_bytes ?? 10 * 1024 * 1024;
}

async function storeAndRegister(fd: FormData, contract: string, idemKey: string, a: Parameters<Parameters<typeof guarded>[2]>[0], register: (file: { path: string; mime: string; size: number; filename: string; sha256: string }) => PromiseLike<{ data?: unknown; error: { code?: string; message?: string } | null }>, okMsg: string): Promise<SaveResult> {
  const prep = await prepareFiles(fd, { org: a.org, contract, idem: idemKey, maxBytes: await maxBytes(a.ctx, a.org), field: 'file' });
  if (!prep.ok) return fail(prep.error, { file: [prep.error] });
  if (prep.files.length !== 1) return fail('Envie exatamente um arquivo.', { file: ['Envie exatamente um arquivo.'] });
  const f = prep.files[0]!;
  // sem upsert: a política do Storage só permite INSERIR. O caminho é determinístico (chave + conteúdo): reenviar o mesmo envio encontra o arquivo já gravado, o que é sucesso.
  const up = await a.ctx.supabase.storage.from('ct-files').upload(f.path, f.bytes, { contentType: f.mime, upsert: false });
  const exists = !!up.error && /already exists|duplicate|resource already/i.test(up.error.message);
  if (up.error && !exists) return fail(up.error.message.toLowerCase().includes('row-level') ? 'Você não tem permissão para anexar neste contrato.' : 'Não foi possível enviar o arquivo. Tente novamente.');
  const r = await register({ path: f.path, mime: f.mime, size: f.size, filename: f.filename, sha256: f.sha256 });
  if (r.error) {
    await a.ctx.supabase.storage.from('ct-files').remove([f.path]);
    return fail(dbMessage(r.error), { file: [dbMessage(r.error)] });
  }
  bustAll();
  return succeed(okMsg);
}

const addSchema = z.object({ idem, contract: uuid(), title: text(2, 160, 'Título do documento'), type: docType });
export async function uploadDocument(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(addSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'uploadDocument', (a) => storeAndRegister(fd, p.data.contract, p.data.idem, a,
    (file) => a.ctx.supabase.rpc('ct_add_document', { p_org: a.org, p_contract: p.data.contract, p_idem: p.data.idem, p_title: p.data.title, p_type: p.data.type, p_file: file }), 'Documento adicionado (versão 1).'));
}

const verSchema = z.object({ idem, contract: uuid(), document: uuid() });
export async function uploadDocumentVersion(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(verSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('member', 'uploadDocumentVersion', (a) => storeAndRegister(fd, p.data.contract, p.data.idem, a,
    (file) => a.ctx.supabase.rpc('ct_add_document_version', { p_org: a.org, p_document: p.data.document, p_idem: p.data.idem, p_file: file }), 'Nova versão adicionada. A anterior continua preservada.'));
}

export async function setCurrentVersion(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  return runRpc(fd, z.object({ document: uuid(), version_id: uuid() }), 'member', 'setCurrentVersion',
    (d, { ctx, org }) => ctx.supabase.rpc('ct_set_current_version', { p_org: org, p_document: d.document, p_version: d.version_id }), 'Versão atual definida.');
}
