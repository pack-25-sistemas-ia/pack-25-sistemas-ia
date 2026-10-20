// Regras de domínio em TypeScript (espelho das regras do banco): papéis, ciclo de vida, vigência inclusiva, datas, dinheiro exato, lembretes e conteúdo.
import { describe, expect, it } from 'vitest';
import { DOCX_MIME, isDocx, prepareFiles, sniff } from '@/lib/ct/attachments';
import { csvText, toCsv } from '@/lib/ct/csv';
import { addMonths, daysUntil, monthGrid, noticeDeadline, noticeReference, relativeLabel, shiftMonth, withinDays } from '@/lib/ct/dates';
import { contractKey } from '@/lib/ct/keys';
import { applyPercentage, checkAdjustment, formatBRL, formatPercent, needsJustification, parseMoney, parsePercentScaled } from '@/lib/ct/money';
import { describeEvent } from '@/lib/ct/present';
import { dedupeKey, planReminders } from '@/lib/ct/reminders';
import { allowedAccessRoles, availableActions, canArchive, canEditRole, canManageRole, canTransition, dueBucket, effectiveRole, isAssignable, isOpenForEdit, situationOf } from '@/lib/ct/status';

describe('papéis e permissões', () => {
  it('gestão vê tudo; colaborador só com vínculo; «Leitor» da empresa nunca passa de leitor', () => {
    expect(effectiveRole('owner', null)).toBe('manager');
    expect(effectiveRole('manager', null)).toBe('manager');
    expect(effectiveRole('collaborator', null)).toBeNull();
    expect(effectiveRole('collaborator', 'editor')).toBe('editor');
    expect(effectiveRole('collaborator', 'reader')).toBe('reader');
    expect(effectiveRole('viewer', 'editor')).toBe('reader');
    expect(effectiveRole('viewer', null)).toBeNull();
    expect(effectiveRole(null, 'editor')).toBeNull();
  });
  it('quem edita, quem gerencia e quem pode ser responsável', () => {
    expect(canEditRole('manager') && canEditRole('editor')).toBe(true);
    expect(canEditRole('reader') || canEditRole(null)).toBe(false);
    expect(canManageRole('manager')).toBe(true);
    expect(canManageRole('editor') || canManageRole('reader')).toBe(false);
    expect(isAssignable('manager') && isAssignable('editor')).toBe(true);
    expect(isAssignable('reader') || isAssignable(null)).toBe(false);
    expect(allowedAccessRoles('viewer')).toEqual(['reader']);
    expect(allowedAccessRoles('collaborator')).toEqual(['editor', 'reader']);
    expect(allowedAccessRoles('owner')).toEqual([]);
  });
});

describe('ciclo de vida', () => {
  it('transições permitidas', () => {
    expect(canTransition('draft', 'active')).toBe(true);
    expect(canTransition('draft', 'terminated')).toBe(false);
    expect(canTransition('active', 'terminated') && canTransition('active', 'closed')).toBe(true);
    expect(canTransition('active', 'draft')).toBe(false);
    expect(canTransition('terminated', 'active') && canTransition('closed', 'active')).toBe(true);
    expect(canTransition('terminated', 'closed')).toBe(false);
  });
  it('arquivar só rescindido/encerrado; editar só rascunho/ativo não arquivado', () => {
    expect(canArchive({ lifecycle: 'terminated', archived: false })).toBe(true);
    expect(canArchive({ lifecycle: 'closed', archived: false })).toBe(true);
    expect(canArchive({ lifecycle: 'active', archived: false })).toBe(false);
    expect(canArchive({ lifecycle: 'closed', archived: true })).toBe(false);
    expect(isOpenForEdit({ lifecycle: 'draft', archived: false }) && isOpenForEdit({ lifecycle: 'active', archived: false })).toBe(true);
    expect(isOpenForEdit({ lifecycle: 'terminated', archived: false }) || isOpenForEdit({ lifecycle: 'active', archived: true })).toBe(false);
  });
  it('ações disponíveis por papel e estado', () => {
    const mgr = availableActions({ role: 'manager', lifecycle: 'active', archived: false });
    expect(mgr).toEqual(expect.arrayContaining(['edit', 'notice', 'document', 'obligation', 'renew', 'amend', 'adjust', 'terminate', 'close', 'access', 'party', 'responsible']));
    expect(mgr).not.toContain('activate');
    expect(availableActions({ role: 'manager', lifecycle: 'draft', archived: false })).toEqual(expect.arrayContaining(['activate', 'delete']));
    const ed = availableActions({ role: 'editor', lifecycle: 'active', archived: false });
    expect(ed).toEqual(expect.arrayContaining(['edit', 'notice', 'document', 'obligation']));
    expect(ed).not.toEqual(expect.arrayContaining(['renew']));
    expect(ed.some((a) => ['terminate', 'adjust', 'renew', 'access', 'archive'].includes(a))).toBe(false);
    expect(availableActions({ role: 'reader', lifecycle: 'active', archived: false })).toEqual([]);
    expect(availableActions({ role: null, lifecycle: 'active', archived: false })).toEqual([]);
    const done = availableActions({ role: 'manager', lifecycle: 'terminated', archived: false });
    expect(done).toEqual(expect.arrayContaining(['reopen', 'archive', 'document']));
    expect(done).not.toContain('edit');
    expect(availableActions({ role: 'manager', lifecycle: 'closed', archived: true })).toEqual(expect.arrayContaining(['unarchive']));
    expect(availableActions({ role: 'manager', lifecycle: 'closed', archived: true })).not.toContain('document');
  });
});

describe('situação temporal (datas inclusivas)', () => {
  const c = { start: '2026-03-01', end: '2026-06-30', indefinite: false };
  it('a iniciar, vigente, próximo do fim, fim atingido', () => {
    expect(situationOf(c, '2026-02-28', 60)).toBe('upcoming');
    expect(situationOf(c, '2026-03-01', 60)).toBe('current');
  });
  it('limites: faltam exatamente N dias = próximo do fim; N+1 = vigente; último dia = ainda vigente', () => {
    expect(situationOf(c, '2026-05-01', 60)).toBe('near_end'); // 60 dias
    expect(situationOf(c, '2026-04-30', 60)).toBe('current'); // 61 dias
    expect(situationOf(c, '2026-06-30', 60)).toBe('near_end'); // último dia da vigência
    expect(situationOf(c, '2026-07-01', 60)).toBe('ended');
  });
  it('prazo indeterminado', () => {
    expect(situationOf({ start: '2026-03-01', end: null, indefinite: true }, '2030-01-01', 60)).toBe('indefinite');
    expect(situationOf({ start: '2026-03-01', end: null, indefinite: true }, '2026-01-01', 60)).toBe('upcoming');
  });
  it('faixas de prazo', () => {
    expect(dueBucket('2026-03-09', '2026-03-10')).toBe('overdue');
    expect(dueBucket('2026-03-10', '2026-03-10')).toBe('today');
    expect(dueBucket('2026-03-17', '2026-03-10')).toBe('next7');
    expect(dueBucket('2026-03-18', '2026-03-10')).toBe('next30');
    expect(dueBucket('2026-04-09', '2026-03-10')).toBe('next30');
    expect(dueBucket('2026-04-10', '2026-03-10')).toBe('next90');
    expect(dueBucket('2026-06-08', '2026-03-10')).toBe('next90');
    expect(dueBucket('2026-06-09', '2026-03-10')).toBe('later');
  });
});

describe('datas', () => {
  it('soma de meses limita ao último dia válido (fim de mês e ano bissexto)', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(addMonths('2026-10-15', 3)).toBe('2027-01-15');
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28');
    expect(addMonths('2026-05-31', 12)).toBe('2027-05-31');
  });
  it('prazo de aviso: referência − dias corridos', () => {
    expect(noticeDeadline('2026-06-30', 30)).toBe('2026-05-31');
    expect(noticeDeadline('2024-03-01', 1)).toBe('2024-02-29');
    expect(noticeDeadline('2026-01-10', 15)).toBe('2025-12-26');
    expect(noticeReference({ end: '2026-06-30', indefinite: false }, null)).toBe('2026-06-30');
    expect(noticeReference({ end: '2026-06-30', indefinite: false }, '2026-05-01')).toBe('2026-05-01');
    expect(noticeReference({ end: null, indefinite: true }, null)).toBeNull();
    expect(noticeReference({ end: null, indefinite: true }, '2026-09-01')).toBe('2026-09-01');
  });
  it('intervalos inclusivos e rótulos relativos', () => {
    expect(withinDays('2026-03-10', '2026-03-10', 30)).toBe(true);
    expect(withinDays('2026-04-09', '2026-03-10', 30)).toBe(true);
    expect(withinDays('2026-04-10', '2026-03-10', 30)).toBe(false);
    expect(withinDays('2026-03-09', '2026-03-10', 30)).toBe(false);
    expect(daysUntil('2026-03-13', '2026-03-10')).toBe(3);
    expect(daysUntil('2026-03-07', '2026-03-10')).toBe(-3);
    expect(relativeLabel('2026-03-10', '2026-03-10')).toBe('hoje');
    expect(relativeLabel('2026-03-11', '2026-03-10')).toBe('amanhã');
    expect(relativeLabel('2026-03-09', '2026-03-10')).toBe('ontem');
    expect(relativeLabel('2026-03-15', '2026-03-10')).toBe('em 5 dias');
    expect(relativeLabel('2026-03-05', '2026-03-10')).toBe('há 5 dias');
  });
  it('grade do calendário', () => {
    const g = monthGrid(2026, 2); // fevereiro de 2026 começa num domingo e tem 28 dias
    expect(g).toHaveLength(4);
    expect(g[0]![0]).toBe('2026-02-01');
    expect(g[3]![6]).toBe('2026-02-28');
    const m = monthGrid(2026, 10); // outubro de 2026 começa numa quinta
    expect(m[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(m[0]![4]).toBe('2026-10-01');
    expect(m.flat().filter(Boolean)).toHaveLength(31);
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
  it('chave legível do contrato', () => { expect(contractKey('CTR', 7)).toBe('CTR-0007'); expect(contractKey('ABC', 12345)).toBe('ABC-12345'); });
});

describe('dinheiro e reajuste exatos', () => {
  it('leitura e formatação em centavos', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1234.56')).toBe(123456);
    expect(parseMoney('R$ 10')).toBe(1000);
    expect(parseMoney('0,5')).toBe(50);
    expect(parseMoney('1.234')).toBe(123400);
    expect(parseMoney('12,345')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('1000000000000,00')).toBeNull();
    expect(parseMoney('999999999999,99')).toBe(99_999_999_999_999);
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(100000000)).toBe('R$ 1.000.000,00');
  });
  it('percentual com decimal exato', () => {
    expect(parsePercentScaled('5,5')).toBe(55_000n);
    expect(parsePercentScaled('-3,3333')).toBe(-33_333n);
    expect(parsePercentScaled('10%')).toBe(100_000n);
    expect(parsePercentScaled('1,23456')).toBeNull();
    expect(parsePercentScaled('x')).toBeNull();
    expect(formatPercent(55_000n)).toBe('5,5%');
    expect(formatPercent(-33_333n)).toBe('-3,3333%');
    expect(formatPercent(0n)).toBe('0%');
  });
  it('reajuste: novo = base × (1 + pct/100), meio para cima (longe de zero)', () => {
    expect(applyPercentage(100000, 55_000n)).toBe(105500n);
    expect(applyPercentage(100001, 33_333n)).toBe(103334n);
    expect(applyPercentage(333, -333_333n)).toBe(222n);
    expect(applyPercentage(1, 500_000n)).toBe(2n);
    expect(applyPercentage(1, -500_000n)).toBe(1n);
    expect(applyPercentage(100000, 0n)).toBe(100000n);
    expect(applyPercentage(0, 100_000n)).toBe(0n);
  });
  it('limites e justificativa', () => {
    expect(checkAdjustment(-1_000_000n, 1000).ok).toBe(false); // −100% zeraria
    expect(checkAdjustment(10_000_001n, 1000).ok).toBe(false); // acima de 1000%
    expect(checkAdjustment(10_000_000n, 1000)).toEqual({ ok: true, next: 11000n });
    expect(checkAdjustment(-999_999n, 100000)).toEqual({ ok: true, next: 0n });
    expect(needsJustification(-1n)).toBe(true);
    expect(needsJustification(0n) || needsJustification(1n)).toBe(false);
  });
});

describe('lembretes: plano de entrega (espelho do banco)', () => {
  const base = { due: '2026-04-10', offsets: [60, 30, 15, 7], delivered: [] as number[], minSent: null as number | null };
  it('alcançou 60 e 30: envia 30, consolida 60', () => {
    expect(planReminders({ ...base, today: '2026-03-11' })).toEqual({ send: 30, consolidate: [60] });
  });
  it('alcançou só uma antecedência', () => {
    expect(planReminders({ ...base, today: '2026-02-09' })).toEqual({ send: 60, consolidate: [] });
    expect(planReminders({ ...base, today: '2026-02-08' })).toEqual({ send: null, consolidate: [] });
  });
  it('não repete o que já foi entregue e nunca volta para uma antecedência maior', () => {
    expect(planReminders({ ...base, today: '2026-03-11', delivered: [60, 30], minSent: 30 })).toEqual({ send: null, consolidate: [] });
    expect(planReminders({ ...base, today: '2026-03-27', delivered: [60, 30], minSent: 30 })).toEqual({ send: 15, consolidate: [] });
    expect(planReminders({ ...base, today: '2026-04-05', delivered: [7], minSent: 7 })).toEqual({ send: null, consolidate: [60, 30, 15] });
  });
  it('depois da data devida não notifica; no dia ainda notifica', () => {
    expect(planReminders({ ...base, today: '2026-04-11' })).toEqual({ send: null, consolidate: [] });
    expect(planReminders({ ...base, today: '2026-04-10' })).toEqual({ send: 7, consolidate: [60, 30, 15] });
    expect(planReminders({ today: '2026-04-10', due: '2026-04-10', offsets: [0], delivered: [], minSent: null })).toEqual({ send: 0, consolidate: [] });
  });
  it('chave de deduplicação inclui evento, origem, revisão, antecedência e destinatário', () => {
    expect(dedupeKey('notice', 's1', 2, 15, 'u1')).toBe('notice|s1|2|15|u1');
    expect(dedupeKey('notice', 's1', 3, 15, 'u1')).not.toBe(dedupeKey('notice', 's1', 2, 15, 'u1'));
  });
});

describe('documentos (tipo pelos bytes)', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  const zipDocx = () => { const b = new Uint8Array(400); b.set([0x50, 0x4b, 3, 4]); b.set(enc('[Content_Types].xml'), 30); b.set(enc('word/document.xml'), 120); return b; };
  it('reconhece PDF, imagens e DOCX; recusa o resto', () => {
    expect(sniff(enc('%PDF-1.7\n1 0 obj\n'))?.mime).toBe('application/pdf');
    expect(sniff(zipDocx())).toEqual({ ext: 'docx', mime: DOCX_MIME });
    expect(isDocx(zipDocx())).toBe(true);
    expect(isDocx(new Uint8Array([0x50, 0x4b, 3, 4, ...new Array(200).fill(0)]))).toBe(false);
    expect(sniff(enc('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniff(Uint8Array.of(0x4d, 0x5a, 0, 0, 0, 0))).toBeNull();
    expect(sniff(enc('texto simples'))).toBeNull();
  });
  it('envio: tipo pelos bytes, não pelo nome', async () => {
    const fd = (f: File) => { const x = new FormData(); x.append('file', f); return x; };
    const ctx = { org: 'o', contract: 'c', idem: 'i', maxBytes: 1_000_000 };
    const pdf = await prepareFiles(fd(new File(['%PDF-1.4\n%texto\n'], 'engana.docx', { type: 'application/msword' })), ctx);
    expect(pdf.ok && pdf.files[0]!.mime).toBe('application/pdf');
    expect(pdf.ok && pdf.files[0]!.path).toMatch(/^o\/c\/[0-9a-f]{32}\.pdf$/);
    const exe = await prepareFiles(fd(new File([new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0])], 'virus.pdf', { type: 'application/pdf' })), ctx);
    expect(exe.ok).toBe(false);
    const html = await prepareFiles(fd(new File(['<html></html>'], 'a.html')), ctx);
    expect(html.ok).toBe(false);
    const big = await prepareFiles(fd(new File(['%PDF-1.4\n' + 'a'.repeat(2000)], 'g.pdf')), { ...ctx, maxBytes: 1000 });
    expect(!big.ok && big.error).toContain('tamanho máximo');
  });
});

describe('CSV seguro', () => {
  it('neutraliza fórmulas e escapa', () => {
    expect(csvText('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvText('+1')).toBe("'+1"); expect(csvText('-1')).toBe("'-1"); expect(csvText('@x')).toBe("'@x");
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('linha1\nlinha2')).toBe('linha1 linha2');
    const out = toCsv([{ key: 'a', label: 'Contrato', kind: 'text' }, { key: 'n', label: 'N', kind: 'int' }], [{ a: '=1+1', n: 3.9 }, { a: null, n: '' }]);
    expect(out.startsWith('﻿Contrato;N\r\n')).toBe(true);
    expect(out).toContain("'=1+1;3");
  });
});

describe('histórico legível (sem texto livre)', () => {
  const who = (id: string | null | undefined) => (id === 'u1' ? 'Ana' : 'Pessoa');
  it('principais eventos', () => {
    expect(describeEvent('contract_terminated', { ended_on: '2026-03-01' }, who)).toBe('Contrato rescindido em 01/03/2026');
    expect(describeEvent('adjustment_applied', { from: 100000, to: 105500 }, who)).toBe('Reajuste aplicado: R$ 1.000,00 → R$ 1.055,00');
    expect(describeEvent('responsible_changed', { from: null, to: 'u1' }, who)).toBe('Responsável: ninguém → Ana');
    expect(describeEvent('contract_renewed', { indefinite: true }, who)).toBe('Contrato renovado por prazo indeterminado');
    expect(describeEvent('contract_updated', { fields: ['title', 'term'] }, who)).toBe('Dados atualizados: título, vigência');
    expect(describeEvent('notice_changed', { days: 30, adjusted: true }, who)).toBe('Prazo de aviso: 30 dias (ajustado manualmente)');
    expect(describeEvent('notice_changed', { days: null }, who)).toBe('Prazo de aviso removido');
    expect(describeEvent('document_version_added', { version_number: 2 }, who)).toBe('Nova versão do documento (v2)');
    expect(describeEvent('tipo_desconhecido', {}, who)).toBe('tipo_desconhecido');
  });
});
