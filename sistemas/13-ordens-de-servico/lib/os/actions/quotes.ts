'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { computeQuote, QuoteError } from '../quote';
import { parseMoney, parseQuantity } from '../money';
import { dateStr, optText, optUuid, text, uuid, version } from '../validation';

// Orçamento versionado. O navegador envia linhas; o servidor interpreta valores (pt-BR), recusa o que for inválido e o BANCO recalcula todos os totais (nunca confiamos em totais do navegador).
const refresh = (order: string) => bust(`/ordens/${order}`, '/ordens', '/dashboard');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const orderOnly = z.object({ order: uuid() });
export async function newQuoteDraft(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(orderOnly, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'newQuoteDraft', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_quote_new_draft', { p_org: org, p_order: p.data.order });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return { ...succeed('Rascunho de orçamento criado. Edite os itens e publique quando estiver pronto.'), redirectTo: `/ordens/${p.data.order}?tab=orcamento#rascunho` };
  });
}

const saveSchema = z.object({
  order: uuid(), quote: uuid(), expected: version, rows: z.coerce.number().int().min(1).max(200),
  discount: z.string().trim().optional(), valid_date: dateStr('Validade').optional().or(z.literal('')), terms: optText(2000, 'Condições'), notes: optText(1000, 'Observações'),
});
export async function saveQuoteDraft(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(saveSchema, values, values);
  if (!p.ok) return p.state;
  const d = p.data;
  const errors: Record<string, string[]> = {};
  const rows: Array<{ kind: 'service' | 'part'; ref?: string; description: string; unit: string; qty: bigint; price: bigint; n: number }> = [];
  const pending: Array<{ n: number; kind: 'service' | 'part'; ref: string; description: string; unit: string; qty: string; price: string }> = [];
  for (let n = 1; n <= d.rows; n++) {
    const ref = (values[`i${n}_ref`] ?? '').trim();
    const description = (values[`i${n}_desc`] ?? '').trim();
    const unit = (values[`i${n}_unit`] ?? '').trim();
    const qty = (values[`i${n}_qty`] ?? '').trim();
    const price = (values[`i${n}_price`] ?? '').trim();
    if (!ref && !description && !qty && !price) continue;
    const kind: 'service' | 'part' = ref.startsWith('p:') ? 'part' : ref.startsWith('s:') ? 'service' : (values[`i${n}_kind`] ?? 'service') === 'part' ? 'part' : 'service';
    pending.push({ n, kind, ref, description, unit, qty, price });
  }
  if (pending.length === 0) return fail('Adicione ao menos um item ao orçamento.', undefined, values);
  return guarded('manager', 'saveQuoteDraft', async ({ ctx, org }) => {
    for (const r of pending) {
      let { description, unit, price } = r;
      let refId: string | undefined;
      if (r.ref) {
        refId = r.ref.replace(/^[sp]:/, '');
        if (!UUID.test(refId)) { errors[`i${r.n}_ref`] = ['Item do catálogo inválido.']; continue; }
        const table = r.kind === 'service' ? 'service_catalog' : 'part_catalog';
        const { data: cat } = await ctx.supabase.from(table).select('name, unit, reference_price_cents').eq('id', refId).maybeSingle();
        if (!cat) { errors[`i${r.n}_ref`] = ['Item do catálogo não encontrado.']; continue; }
        const c = cat as unknown as { name: string; unit: string; reference_price_cents: number };
        description ||= c.name;
        unit ||= c.unit;
        if (!price) price = String(c.reference_price_cents / 100).replace('.', ',');
      }
      if (description.length < 2 || description.length > 200) { errors[`i${r.n}_desc`] = ['Descreva o item (2 a 200 caracteres).']; continue; }
      if (!unit) unit = 'un';
      if (unit.length > 16) { errors[`i${r.n}_unit`] = ['Unidade longa demais (máx. 16).']; continue; }
      const q = parseQuantity(r.qty);
      if (q === null) { errors[`i${r.n}_qty`] = ['Quantidade maior que zero, com até 3 casas (ex.: 1,5).']; continue; }
      const pr = parseMoney(price);
      if (pr === null) { errors[`i${r.n}_price`] = ['Preço inválido (ex.: 150,00).']; continue; }
      rows.push({ kind: r.kind, ref: refId, description, unit, qty: q, price: pr, n: r.n });
    }
    if (Object.keys(errors).length) return fail('Revise os itens destacados.', errors, values);
    const discount = d.discount ? parseMoney(d.discount) : 0n;
    if (discount === null) return fail('Desconto inválido.', { discount: ['Informe um valor válido (ex.: 50,00).'] }, values);
    try { computeQuote(rows.map((r) => ({ quantityMilli: r.qty, unitPriceCents: r.price })), discount); } catch (e) {
      if (e instanceof QuoteError) return fail(e.message, e.message.includes('desconto') ? { discount: [e.message] } : undefined, values);
      throw e;
    }
    const items = rows.map((r) => ({
      kind: r.kind, service_id: r.kind === 'service' ? r.ref : undefined, part_id: r.kind === 'part' ? r.ref : undefined,
      description: r.description, unit: r.unit, quantity: Number(r.qty) / 1000, unit_price_cents: Number(r.price),
    }));
    const { data, error } = await ctx.supabase.rpc('os_quote_save_draft', { p_org: org, p_quote: d.quote, p_expected: d.expected, p: { items, discount_cents: Number(discount), valid_date: d.valid_date || undefined, terms: d.terms ?? null, notes: d.notes ?? null } });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    const t = data as { total_cents: number };
    return succeed(`Rascunho salvo. Total recalculado pelo sistema: R$ ${(t.total_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`);
  });
}

const publishSchema = z.object({ order: uuid(), quote: uuid(), expected: version });
export async function publishQuote(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(publishSchema, formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'publishQuote', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_quote_publish', { p_org: org, p_quote: p.data.quote, p_expected: p.data.expected });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Orçamento publicado. O conteúdo foi congelado; qualquer alteração cria uma nova versão.');
  });
}

const manualSchema = z.object({
  order: uuid(), quote: uuid(), decision: z.enum(['approved', 'rejected'], { message: 'Escolha aprovar ou recusar.' }), declared_name: text(2, 120, 'Nome de quem decidiu'),
  justification: text(10, 500, 'Justificativa'), note: optText(1000, 'Observação'), evidence: optUuid,
});
export async function decideQuoteManual(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(manualSchema, values, values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('manager', 'decideQuoteManual', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_quote_decide_manual', { p_org: org, p_quote: d.quote, p_decision: d.decision, p_declared_name: d.declared_name, p_justification: d.justification, p_note: d.note ?? null, p_evidence: d.evidence ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    return succeed(`Decisão registrada manualmente pela equipe (${d.decision === 'approved' ? 'aprovado' : 'recusado'}). Ela aparece como registro manual, não como ação do cliente.`);
  });
}
