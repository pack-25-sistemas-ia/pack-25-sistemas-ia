// Cálculo do orçamento (espelho do banco). O navegador só PRÉ-VISUALIZA; quem grava é a função os_quote_save_draft, que recalcula tudo.
import { lineTotalCents, MAX_QUANTITY_MILLI, MAX_UNIT_PRICE_CENTS } from './money';

export type QuoteInput = { quantityMilli: bigint; unitPriceCents: bigint };
export type QuoteLine = QuoteInput & { totalCents: bigint };
export type QuoteTotals = { lines: QuoteLine[]; subtotalCents: bigint; discountCents: bigint; totalCents: bigint };
export const MAX_QUOTE_ITEMS = 200;

export class QuoteError extends Error {}

export function computeQuote(items: readonly QuoteInput[], discountCents: bigint): QuoteTotals {
  if (items.length > MAX_QUOTE_ITEMS) throw new QuoteError(`O orçamento aceita até ${MAX_QUOTE_ITEMS} itens.`);
  const lines = items.map((it, i) => {
    if (it.quantityMilli <= 0n || it.quantityMilli > MAX_QUANTITY_MILLI) throw new QuoteError(`Quantidade do item ${i + 1} fora do permitido.`);
    if (it.unitPriceCents < 0n || it.unitPriceCents > MAX_UNIT_PRICE_CENTS) throw new QuoteError(`Preço do item ${i + 1} fora do permitido.`);
    return { ...it, totalCents: lineTotalCents(it.quantityMilli, it.unitPriceCents) };
  });
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0n);
  if (discountCents < 0n) throw new QuoteError('O desconto não pode ser negativo.');
  if (discountCents > subtotalCents) throw new QuoteError('O desconto não pode ser maior que o subtotal.');
  return { lines, subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

/** Texto de aceite do orçamento (o banco monta o mesmo texto; este é só para a pré-visualização da regra). */
export const QUOTE_STATUS_LABEL = { draft: 'Rascunho', published: 'Publicado (aguardando decisão)', approved: 'Aprovado', rejected: 'Recusado', superseded: 'Substituído' } as const;
export type QuoteStatus = keyof typeof QUOTE_STATUS_LABEL;

/** A versão pode receber uma decisão do cliente agora? */
export function quoteDecidable(q: { status: string; validUntil: string | Date | null }, nowMs: number): { ok: boolean; reason?: string } {
  if (q.status === 'superseded') return { ok: false, reason: 'Esta versão foi substituída por uma mais recente.' };
  if (q.status === 'approved' || q.status === 'rejected') return { ok: false, reason: 'Esta versão já recebeu uma decisão.' };
  if (q.status !== 'published') return { ok: false, reason: 'Este orçamento ainda não foi publicado.' };
  const until = q.validUntil ? new Date(q.validUntil).getTime() : 0;
  if (!(until > nowMs)) return { ok: false, reason: 'Esta versão do orçamento expirou.' };
  return { ok: true };
}

/** Regra de início/retomada: orçamento aprovado e nenhuma versão publicada pendente (ou execução autorizada pela gestão). */
export function executionBlock(order: { quoteMode: 'required' | 'authorized' }, quotes: ReadonlyArray<{ status: string }>): string | null {
  if (order.quoteMode === 'authorized') return null;
  if (quotes.some((q) => q.status === 'published')) return 'Há uma versão de orçamento publicada aguardando a decisão do cliente.';
  if (!quotes.some((q) => q.status === 'approved')) return 'Esta ordem exige orçamento aprovado antes de iniciar ou retomar a execução.';
  return null;
}
