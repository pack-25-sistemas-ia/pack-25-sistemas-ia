import { describe, expect, it } from 'vitest';
import { formatCents, formatQuantity, lineTotalCents, milliFromNumeric, parseMoney, parseQuantity } from '@/lib/os/money';
import { computeQuote, executionBlock, quoteDecidable, QuoteError } from '@/lib/os/quote';

describe('dinheiro em centavos (aritmética exata)', () => {
  it('formata em reais, com milhar e centavos', () => {
    expect(formatCents(0)).toBe('R$ 0,00');
    expect(formatCents(5)).toBe('R$ 0,05');
    expect(formatCents(123456)).toBe('R$ 1.234,56');
    expect(formatCents(100000000)).toBe('R$ 1.000.000,00');
    expect(formatCents('16334')).toBe('R$ 163,34');
    expect(formatCents(-1050)).toBe('-R$ 10,50');
    expect(formatCents(null)).toBe('—');
  });

  it('interpreta valores digitados em pt-BR e recusa lixo', () => {
    expect(parseMoney('10')).toBe(1000n);
    expect(parseMoney('10,5')).toBe(1050n);
    expect(parseMoney('10,50')).toBe(1050n);
    expect(parseMoney('1.234,56')).toBe(123456n);
    expect(parseMoney('R$ 1.234,56')).toBe(123456n);
    expect(parseMoney('1234.5')).toBe(123450n);
    expect(parseMoney('1.234')).toBe(123400n); // ponto de milhar
    expect(parseMoney('0,01')).toBe(1n);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('10,999')).toBeNull(); // 3 casas em dinheiro
    expect(parseMoney('1,2,3')).toBeNull();
    expect(parseMoney('99999999999')).toBeNull(); // acima do teto
  });

  it('quantidades com até 3 casas, em milésimos', () => {
    expect(parseQuantity('2')).toBe(2000n);
    expect(parseQuantity('1,5')).toBe(1500n);
    expect(parseQuantity('0.333')).toBe(333n);
    expect(parseQuantity('0,001')).toBe(1n);
    expect(parseQuantity('0')).toBeNull();
    expect(parseQuantity('0,0004')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
    expect(parseQuantity('1,2345')).toBeNull();
    expect(parseQuantity('2000000')).toBeNull();
    expect(formatQuantity(1005n)).toBe('1,005');
    expect(formatQuantity(2000n)).toBe('2');
    expect(milliFromNumeric('1.005')).toBe(1005n);
    expect(milliFromNumeric(0.333)).toBe(333n);
  });

  it('total da linha: meio para cima, igual ao banco (round do numeric)', () => {
    expect(lineTotalCents(2000n, 8000n)).toBe(16000n); // 2 × R$ 80,00
    expect(lineTotalCents(333n, 1000n)).toBe(333n); // 0,333 × R$ 10,00 = R$ 3,33
    expect(lineTotalCents(1005n, 100n)).toBe(101n); // 1,005 × R$ 1,00 = 1,005 → R$ 1,01
    expect(lineTotalCents(1n, 499n)).toBe(0n); // 0,499 → 0
    expect(lineTotalCents(1n, 500n)).toBe(1n); // 0,5 → 1 (meio para cima)
    expect(lineTotalCents(3000n, 333n)).toBe(999n);
    expect(lineTotalCents(1500n, 1n)).toBe(2n); // 1,5 → 2
  });
});

describe('cálculo do orçamento', () => {
  const item = (q: string, p: string) => ({ quantityMilli: parseQuantity(q)!, unitPriceCents: parseMoney(p)! });

  it('soma linhas arredondadas, aplica desconto fixo e nunca fica negativo', () => {
    const t = computeQuote([item('2', '80'), item('0,333', '10'), item('1,005', '1')], 100n);
    expect(t.lines.map((l) => l.totalCents)).toEqual([16000n, 333n, 101n]);
    expect(t.subtotalCents).toBe(16434n);
    expect(t.totalCents).toBe(16334n);
    expect(computeQuote([], 0n).totalCents).toBe(0n);
  });

  it('o arredondamento é por linha, não sobre o total', () => {
    // 3 × (0,005 × R$ 1,00): cada linha 0,005 → 1 centavo (meio para cima) = 3; somar antes daria 0,015 → 1 centavo
    const t = computeQuote([item('0,005', '1'), item('0,005', '1'), item('0,005', '1')], 0n);
    expect(t.subtotalCents).toBe(3n);
  });

  it('recusa desconto maior que o subtotal, negativo, quantidade/preço fora do limite e excesso de itens', () => {
    expect(() => computeQuote([item('1', '10')], 1001n)).toThrow(QuoteError);
    expect(() => computeQuote([item('1', '10')], -1n)).toThrow(QuoteError);
    expect(() => computeQuote([{ quantityMilli: 0n, unitPriceCents: 1n }], 0n)).toThrow(QuoteError);
    expect(() => computeQuote([{ quantityMilli: 1000n, unitPriceCents: -1n }], 0n)).toThrow(QuoteError);
    expect(() => computeQuote(Array.from({ length: 201 }, () => item('1', '1')), 0n)).toThrow(QuoteError);
    expect(computeQuote([item('1', '10')], 1000n).totalCents).toBe(0n); // desconto = subtotal é válido
  });

  it('decisão do cliente: só a versão publicada, vigente e dentro da validade', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(quoteDecidable({ status: 'published', validUntil: '2026-10-20T00:00:00Z' }, now).ok).toBe(true);
    expect(quoteDecidable({ status: 'published', validUntil: '2026-10-17T11:59:59Z' }, now).ok).toBe(false);
    expect(quoteDecidable({ status: 'superseded', validUntil: '2026-10-20T00:00:00Z' }, now).reason).toMatch(/substituída/);
    expect(quoteDecidable({ status: 'approved', validUntil: '2026-10-20T00:00:00Z' }, now).reason).toMatch(/já recebeu/);
    expect(quoteDecidable({ status: 'rejected', validUntil: '2026-10-20T00:00:00Z' }, now).ok).toBe(false);
    expect(quoteDecidable({ status: 'draft', validUntil: null }, now).reason).toMatch(/não foi publicado/);
  });

  it('início/retomada: aprovado e sem versão pendente, ou execução autorizada', () => {
    expect(executionBlock({ quoteMode: 'required' }, [])).toMatch(/exige orçamento aprovado/);
    expect(executionBlock({ quoteMode: 'required' }, [{ status: 'draft' }])).toMatch(/exige orçamento aprovado/);
    expect(executionBlock({ quoteMode: 'required' }, [{ status: 'approved' }])).toBeNull();
    expect(executionBlock({ quoteMode: 'required' }, [{ status: 'approved' }, { status: 'published' }])).toMatch(/aguardando a decisão/);
    expect(executionBlock({ quoteMode: 'required' }, [{ status: 'approved' }, { status: 'rejected' }])).toBeNull();
    expect(executionBlock({ quoteMode: 'authorized' }, [])).toBeNull();
    expect(executionBlock({ quoteMode: 'authorized' }, [{ status: 'published' }])).toBeNull();
  });
});
