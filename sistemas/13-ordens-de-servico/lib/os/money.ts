// Dinheiro e quantidades com aritmética decimal EXATA (BigInt). Nada de ponto flutuante nas contas.
//  · valores em CENTAVOS (inteiros); quantidades com até 3 casas (guardadas como «milésimos», inteiros);
//  · total da linha = quantidade × preço unitário, arredondado a centavos «meio para cima» (mesma regra do banco: round() do numeric);
//  · o servidor SEMPRE recalcula; este módulo existe para pré-visualizar na tela e para os testes do espelho TS ⇔ SQL.

export const MAX_UNIT_PRICE_CENTS = 1_000_000_000n; // R$ 10.000.000,00
export const MAX_QUANTITY_MILLI = 1_000_000_000n; // 1.000.000,000

/** «R$ 1.234,56». Aceita centavos como number, bigint ou string numérica. */
export function formatCents(value: number | bigint | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const c = typeof value === 'bigint' ? value : BigInt(String(value).split('.')[0] ?? '0');
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const reais = abs / 100n;
  const cents = abs % 100n;
  const grouped = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${grouped},${cents.toString().padStart(2, '0')}`;
}

/** «1.234,56», «1234,56», «1234.56», «10» → centavos. Rejeita lixo, negativos e mais de 2 casas decimais. */
export function parseMoney(input: string | null | undefined): bigint | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (/[^0-9.,]/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let frac = '';
  if (lastComma >= 0) {
    // vírgula decimal; pontos são milhares
    intPart = s.slice(0, lastComma).replace(/\./g, '');
    frac = s.slice(lastComma + 1);
    if (s.slice(0, lastComma).includes(',')) return null;
  } else if (lastDot >= 0 && s.length - lastDot - 1 !== 3) {
    // ponto decimal (ex.: 1234.5) quando não parece separador de milhar
    intPart = s.slice(0, lastDot).replace(/\./g, '');
    frac = s.slice(lastDot + 1);
  } else {
    intPart = s.replace(/\./g, '');
  }
  if (!/^\d+$/.test(intPart || '0') || (frac && !/^\d{1,2}$/.test(frac))) return null;
  const cents = BigInt(intPart || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  return cents <= MAX_UNIT_PRICE_CENTS ? cents : null;
}

/** «2», «1,5», «0.333» → milésimos (3 casas). Rejeita zero, negativos e mais de 3 casas. */
export function parseQuantity(input: string | null | undefined): bigint | null {
  if (input === null || input === undefined) return null;
  const s = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [i = '0', f = ''] = s.split('.');
  const milli = BigInt(i) * 1000n + BigInt((f + '000').slice(0, 3));
  return milli > 0n && milli <= MAX_QUANTITY_MILLI ? milli : null;
}

export function formatQuantity(milli: bigint | number | string): string {
  const m = BigInt(String(milli).split('.')[0] ?? '0');
  const i = m / 1000n;
  const f = (m % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return f ? `${i},${f}` : `${i}`;
}

/** Quantidade vinda do banco (numeric como texto/número, ex.: «1.005») → milésimos. */
export function milliFromNumeric(v: string | number): bigint {
  const s = typeof v === 'number' ? v.toFixed(3) : v;
  const [i = '0', f = ''] = s.split('.');
  return BigInt(i) * 1000n + BigInt((f + '000').slice(0, 3));
}

/** Total da linha em centavos: round_half_up(milésimos × preço ÷ 1000). */
export function lineTotalCents(quantityMilli: bigint, unitPriceCents: bigint): bigint {
  const prod = quantityMilli * unitPriceCents;
  return (prod + 500n) / 1000n;
}
