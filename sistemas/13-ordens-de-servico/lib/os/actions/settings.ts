'use server';

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { sanitize, sniff } from '../attachments';
import { isValidTimeZone } from '../time';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { flag, optText, uuid } from '../validation';

const int = (min: number, max: number, label: string) => z.coerce.number({ message: `${label}: informe um número.` }).int(`${label}: use um número inteiro.`).min(min, `${label}: mínimo ${min}.`).max(max, `${label}: máximo ${max}.`);

/** Marca: nome exibido e cor principal (mantidos em sincronia com a «Identidade visual» do Core, que alimenta o tema do painel). */
const brandSchema = z.object({
  display_name: z.string().trim().min(2, 'Informe ao menos 2 caracteres.').max(80, 'Nome longo demais (máx. 80).'),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #RRGGBB).'),
});
export async function saveBrand(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(brandSchema, values, values);
  if (!p.ok) return p.state;
  return guarded('owner', 'saveBrand', async ({ ctx, org }) => {
    const d = p.data;
    const { error } = await ctx.supabase.rpc('os_save_settings', { p_org: org, p: { public_display_name: d.display_name, primary_color: d.primary_color.toLowerCase() } });
    if (error) return fail(dbMessage(error), undefined, values);
    const { data: cur } = await ctx.supabase.from('organization_settings').select('theme').eq('organization_id', org).maybeSingle();
    const theme = { ...((cur?.theme as Record<string, unknown> | undefined) ?? {}), primary: d.primary_color.toLowerCase() };
    const r = await ctx.supabase.from('organization_settings').update({ display_name: d.display_name, theme }).eq('organization_id', org).select('organization_id');
    if (r.error || !r.data?.length) return fail('Não foi possível aplicar a marca ao painel. Tente novamente.', undefined, values);
    bust('/', '/configuracoes', '/settings');
    return succeed('Marca salva.');
  });
}

const rulesSchema = z.object({
  timezone: z.string().trim().min(3).max(60).refine(isValidTimeZone, 'Fuso horário inválido (ex.: America/Sao_Paulo).'),
  order_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, 'Prefixo: de 1 a 6 letras ou números.'),
  quote_validity_days: int(1, 365, 'Validade do orçamento'),
  link_ttl_days: int(1, 180, 'Validade do link'),
  attachment_max_mb: z.coerce.number({ message: 'Tamanho máximo dos arquivos: informe um número.' }).min(0.01, 'Mínimo 0,01 MB.').max(10, 'Máximo 10 MB.'),
  default_quote_terms: optText(2000, 'Condições padrão'),
  retention_policy_text: optText(1000, 'Política de retenção'),
});
export async function saveRules(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(rulesSchema, { ...values, attachment_max_mb: (values.attachment_max_mb ?? '').replace(',', '.') }, values);
  if (!p.ok) return p.state;
  return guarded('owner', 'saveRules', async ({ ctx, org }) => {
    const d = p.data;
    const { error } = await ctx.supabase.rpc('os_save_settings', { p_org: org, p: {
      timezone: d.timezone, order_prefix: d.order_prefix, quote_validity_days: d.quote_validity_days, link_ttl_days: d.link_ttl_days, attachment_max_size_bytes: Math.round(d.attachment_max_mb * 1024 * 1024),
      default_quote_terms: d.default_quote_terms ?? null, retention_policy_text: d.retention_policy_text ?? null } });
    if (error) return fail(dbMessage(error), undefined, values);
    bust('/configuracoes', '/ordens', '/dashboard');
    return succeed('Regras salvas. Valem para novas ações; orçamentos já publicados e links já gerados mantêm as regras em que foram criados.');
  });
}

// ---- logotipo (imagem raster, até 512 KB; metadados removidos)
const MAX_LOGO = 512 * 1024;
export async function uploadLogo(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const file = fd.get('logo');
  if (!(file instanceof File) || file.size === 0) return fail('Escolha uma imagem PNG, JPG ou WebP.', { logo: ['Escolha uma imagem.'] });
  if (file.size > MAX_LOGO) return fail('A imagem deve ter no máximo 512 KB.', { logo: ['Imagem grande demais (máx. 512 KB).'] });
  const raw = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(raw);
  if (!kind || kind.ext === 'pdf') return fail('Formato não aceito. Use PNG, JPG ou WebP.', { logo: ['Formato não aceito (use PNG, JPG ou WebP).'] });
  const bytes = sanitize(kind, raw);
  if (!bytes) return fail('A imagem parece danificada.', { logo: ['Imagem danificada.'] });
  return guarded('owner', 'uploadLogo', async ({ ctx, org }) => {
    const { data: cur } = await ctx.supabase.from('os_settings').select('logo_path').eq('organization_id', org).maybeSingle();
    const path = `${org}/logo-${randomBytes(8).toString('hex')}.${kind.ext}`;
    const up = await ctx.supabase.storage.from('os-logos').upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) return fail('Não foi possível enviar o logotipo. Tente novamente.');
    const { error } = await ctx.supabase.rpc('os_set_logo', { p_org: org, p_path: path });
    if (error) return fail(dbMessage(error));
    const old = (cur as { logo_path: string | null } | null)?.logo_path;
    if (old) await ctx.supabase.storage.from('os-logos').remove([old]);
    bust('/', '/configuracoes');
    return succeed('Logotipo atualizado.');
  });
}

export async function removeLogo(): Promise<SaveResult> {
  return guarded('owner', 'removeLogo', async ({ ctx, org }) => {
    const { data: cur } = await ctx.supabase.from('os_settings').select('logo_path').eq('organization_id', org).maybeSingle();
    const { error } = await ctx.supabase.rpc('os_set_logo', { p_org: org, p_path: null });
    if (error) return fail(dbMessage(error));
    const old = (cur as { logo_path: string | null } | null)?.logo_path;
    if (old) await ctx.supabase.storage.from('os-logos').remove([old]);
    bust('/', '/configuracoes');
    return succeed('Logotipo removido.');
  });
}

// ---- técnicos: desativar/reativar (ordens abertas dele voltam à fila)
export async function setTechnicianActive(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(z.object({ user: uuid(), active: flag }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'setTechnicianActive', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_set_technician_active', { p_org: org, p_user: p.data.user, p_active: p.data.active });
    if (error) return fail(dbMessage(error));
    bust('/configuracoes', '/ordens', '/minhas-ordens', '/agenda');
    const n = (data as { orders_released?: number } | null)?.orders_released ?? 0;
    return succeed(p.data.active ? 'Acesso reativado.' : `Acesso desativado. ${n} ordem(ns) voltou(aram) à fila (agendadas ficam abertas; em execução ficam pausadas).`);
  });
}
