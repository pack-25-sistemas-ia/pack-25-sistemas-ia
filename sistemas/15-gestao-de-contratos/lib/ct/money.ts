// Dinheiro em CENTAVOS (inteiro) e percentuais em decimal exato (4 casas). Nunca ponto flutuante binário para valor monetário.
// Regra de arredondamento: novo = base × (1 + pct/100), arredondado ao centavo com «meio para cima» (para longe de zero) — igual ao round() numérico do PostgreSQL.

export const BILLING_BASES = ['monthly', 'annual', 'one_time', 'reference'] as const;
export type BillingBasis = (typeof BILLING_BASES)[number];
export const BILLING_LABEL: Record<BillingBasis, string> = { monthly: 'Mensal', annual: 'Anual', one_time: 'Único', reference: 'Referência' };
export const isBillingBasis = (v: unknown): v is BillingBasis => typeof v === 'string' && (BILLING_BASES as readonly string[]).includes(v);

export const MAX_CENTS = 99_999_999_999_999n;

/** «1.234,56» ou «1234.56» ou «1234» → centavos; inválido → null. Aceita no máximo 2 casas decimais. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (s === '') return null;
  let normalized: string;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else normalized = s;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!m) return null;
  const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return cents > MAX_CENTS ? null : Number(cents);
}

export function formatBRL(cents: number | bigint): string {
  const c = BigInt(cents);
  const neg = c < 0n; const abs = neg ? -c : c;
  const reais = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${reais},${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Percentual como texto com até 4 casas → inteiro escalado por 10 000. «5,5» → 55000. Inválido → null. */
export function parsePercentScaled(input: string): bigint | null {
  const s = input.trim().replace('%', '').replace(',', '.');
  const m = /^(-?)(\d{1,4})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const scaled = BigInt(m[2]!) * 10_000n + BigInt((m[3] ?? '').padEnd(4, '0') || '0');
  return m[1] ? -scaled : scaled;
}
export function formatPercent(scaled: bigint): string {
  const neg = scaled < 0n; const abs = neg ? -scaled : scaled;
  const frac = (abs % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${(abs / 10_000n).toString()}${frac ? ',' + frac : ''}%`;
}

/** Aplica o percentual (escalado ×10 000) ao valor-base em centavos, com decimal exato e meio para cima (longe de zero). */
export function applyPercentage(baseCents: number | bigint, pctScaled: bigint): bigint {
  const num = BigInt(baseCents) * (1_000_000n + pctScaled); // base × (100 + pct) × 10 000
  const den = 1_000_000n;
  const neg = num < 0n; const abs = neg ? -num : num;
  const q = abs / den; const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

export const PCT_MIN_EXCLUSIVE = -1_000_000n; // -100%
export const PCT_MAX = 10_000_000n; // 1000%
/** Mesmos limites do banco: maior que −100% e até 1000%; negativo exige justificativa. */
export function checkAdjustment(pctScaled: bigint, baseCents: number | bigint): { ok: true; next: bigint } | { ok: false; error: string } {
  if (pctScaled <= PCT_MIN_EXCLUSIVE || pctScaled > PCT_MAX) return { ok: false, error: 'Percentual fora do permitido (maior que -100% e até 1000%).' };
  const next = applyPercentage(baseCents, pctScaled);
  if (next < 0n || next > MAX_CENTS) return { ok: false, error: 'O resultado do reajuste fica fora do permitido.' };
  return { ok: true, next };
}
export const needsJustification = (pctScaled: bigint): boolean => pctScaled < 0n;
