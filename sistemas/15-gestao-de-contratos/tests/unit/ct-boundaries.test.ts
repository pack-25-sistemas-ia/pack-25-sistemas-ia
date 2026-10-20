// Fronteiras das regras de domínio (cada caso nasceu de um mutante que sobreviveu ao teste de mutação).
import { describe, expect, it } from 'vitest';
import { monthGrid, noticeReference } from '@/lib/ct/dates';
import { applyPercentage, checkAdjustment, formatBRL, MAX_CENTS, parsePercentScaled } from '@/lib/ct/money';
import { planReminders } from '@/lib/ct/reminders';
import { availableActions, canTransition, isOpenForEdit, situationOf } from '@/lib/ct/status';

describe('ciclo de vida: transições e edição', () => {
  it('só as transições permitidas', () => {
    expect(canTransition('draft', 'closed')).toBe(false);
    expect(canTransition('draft', 'terminated')).toBe(false);
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('closed', 'terminated')).toBe(false);
    expect(canTransition('terminated', 'closed')).toBe(false);
    expect(canTransition('closed', 'active')).toBe(true);
    expect(canTransition('terminated', 'active')).toBe(true);
    expect(canTransition('active', 'draft')).toBe(false);
  });
  it('encerrado, rescindido e arquivado não aceitam edição', () => {
    expect(isOpenForEdit({ lifecycle: 'closed', archived: false })).toBe(false);
    expect(isOpenForEdit({ lifecycle: 'terminated', archived: false })).toBe(false);
    expect(isOpenForEdit({ lifecycle: 'active', archived: true })).toBe(false);
    expect(isOpenForEdit({ lifecycle: 'draft', archived: false })).toBe(true);
  });
  it('ações disponíveis por estado (gestão)', () => {
    const draft = availableActions({ role: 'manager', lifecycle: 'draft', archived: false });
    expect(draft).toEqual(expect.arrayContaining(['activate', 'delete']));
    for (const a of ['terminate', 'close', 'renew', 'adjust', 'amend', 'reopen'] as const) expect(draft).not.toContain(a);
    const active = availableActions({ role: 'manager', lifecycle: 'active', archived: false });
    expect(active).toEqual(expect.arrayContaining(['terminate', 'close', 'renew', 'adjust', 'amend']));
    for (const a of ['reopen', 'activate', 'delete', 'archive'] as const) expect(active).not.toContain(a);
    const closed = availableActions({ role: 'manager', lifecycle: 'closed', archived: false });
    expect(closed).toEqual(expect.arrayContaining(['reopen', 'archive']));
    expect(closed).not.toContain('edit');
  });
});

describe('situação e aviso', () => {
  it('prazo indeterminado nunca «termina», mesmo que traga uma data de fim guardada', () => {
    expect(situationOf({ start: '2024-01-01', end: '2024-02-01', indefinite: true }, '2026-01-01', 60)).toBe('indefinite');
  });
  it('referência do aviso no prazo indeterminado só vale se for informada', () => {
    expect(noticeReference({ end: '2030-01-01', indefinite: true }, null)).toBeNull();
    expect(noticeReference({ end: '2030-01-01', indefinite: true }, '2029-06-01')).toBe('2029-06-01');
    expect(noticeReference({ end: '2030-01-01', indefinite: false }, null)).toBe('2030-01-01');
  });
});

describe('calendário', () => {
  it('toda semana tem 7 células, em meses de 28, 29, 30 e 31 dias', () => {
    for (const [y, m] of [[2026, 2], [2024, 2], [2026, 4], [2026, 5], [2026, 12], [2027, 1]] as const) {
      const g = monthGrid(y, m);
      for (const week of g) expect(week).toHaveLength(7);
      expect(g.flat().filter(Boolean)).toHaveLength(new Date(Date.UTC(y, m, 0)).getUTCDate());
    }
  });
});

describe('dinheiro e reajuste: sinais e limites', () => {
  it('valor negativo mantém o sinal', () => {
    expect(formatBRL(-123n)).toBe('-R$ 1,23');
    expect(formatBRL(-123456789n)).toBe('-R$ 1.234.567,89');
  });
  it('percentual: no máximo 4 dígitos inteiros', () => {
    expect(parsePercentScaled('9999,9999')).toBe(99_999_999n);
    expect(parsePercentScaled('10000')).toBeNull();
    expect(parsePercentScaled('-10000')).toBeNull();
  });
  it('arredondamento de valor negativo vai para longe de zero', () => {
    expect(applyPercentage(-1, 500_000n)).toBe(-2n); // -1 × 1,5 = -1,5 → -2
    expect(applyPercentage(-333, -333_333n)).toBe(-222n);
  });
  it('resultado do reajuste fora do permitido é recusado (acima do máximo e negativo)', () => {
    expect(checkAdjustment(100_000n, MAX_CENTS).ok).toBe(false); // +10% sobre o máximo passa do limite
    expect(checkAdjustment(0n, MAX_CENTS).ok).toBe(true);
    expect(checkAdjustment(100_000n, -100).ok).toBe(false); // base negativa → resultado negativo
  });
});

describe('plano de lembretes: fronteiras', () => {
  it('não reenvia a antecedência igual à menor já enviada', () => {
    expect(planReminders({ today: '2026-01-05', due: '2026-01-10', offsets: [7], delivered: [], minSent: 7 })).toEqual({ send: null, consolidate: [7] });
  });
  it('envia a mais próxima e consolida as demais', () => {
    expect(planReminders({ today: '2026-01-09', due: '2026-01-10', offsets: [7, 3, 1], delivered: [], minSent: null })).toEqual({ send: 1, consolidate: [7, 3] });
  });
  it('nada a fazer quando tudo já foi entregue', () => {
    expect(planReminders({ today: '2026-01-09', due: '2026-01-10', offsets: [7, 3, 1], delivered: [7, 3, 1], minSent: 1 })).toEqual({ send: null, consolidate: [] });
  });
});
