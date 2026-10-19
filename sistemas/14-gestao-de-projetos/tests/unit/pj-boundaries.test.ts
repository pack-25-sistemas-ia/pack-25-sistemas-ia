// Limites exatos das regras de domínio e de conteúdo (cada caso existe para derrubar uma mutação específica do teste de mutação).
import { describe, expect, it } from 'vitest';
import { prepareFiles, sniff, sniffText } from '@/lib/pj/attachments';
import { parseInline, parseMarkdown, plainText, safeHref } from '@/lib/pj/markdown';
import { toCard } from '@/lib/pj/present';
import { dateWarnings, dueBucket, placeInOrder, progressPercent } from '@/lib/pj/status';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('fronteiras do domínio', () => {
  it('progresso arredonda para o inteiro mais próximo (2/3 = 67, 1/6 = 17)', () => {
    expect(progressPercent(2, 3)).toBe(67);
    expect(progressPercent(1, 6)).toBe(17);
    expect(progressPercent(1, 3)).toBe(33);
  });
  it('o oitavo dia já é «depois»; o sétimo ainda é «próximos 7 dias»', () => {
    expect(dueBucket('2026-03-17', '2026-03-10', '2026-03-17')).toBe('next7');
    expect(dueBucket('2026-03-18', '2026-03-10', '2026-03-17')).toBe('later');
  });
  it('datas iguais ao início/fim do projeto não geram aviso; um dia fora gera', () => {
    const proj = { startDate: '2026-01-10', dueDate: '2026-06-30' };
    expect(dateWarnings(proj, '2026-01-10', '2026-06-30')).toEqual([]);
    expect(dateWarnings(proj, '2026-01-09', null)).toEqual(['A data de início está fora do período do projeto.']);
    expect(dateWarnings(proj, null, '2026-07-01')).toEqual(['O vencimento está fora do período do projeto.']);
  });
  it('a tarefa nunca é posta antes de si mesma', () => {
    expect(placeInOrder(['a', 'b', 'c'], 'b', 'b')).toBeNull();
    expect(placeInOrder(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });
  it('o cartão de tarefa em etapa «Concluído» sai como concluído (e só nela)', () => {
    const mk = (semantic: 'todo' | 'done') => toCard({
      id: 't', task_number: 1, title: 'x', priority: 'normal', due_date: null, assignee_user_id: null, blocked_reason: null, task_labels: [], checklist: { done: 0, total: 0 },
      completed_at: null, archived_at: null, column_id: 'c',
    }, { key: (n) => String(n), semanticOf: () => semantic, labels: new Map(), nameOf: () => null, project: { status: 'active', archived: false }, today: '2026-03-10' });
    expect(mk('done').completed).toBe(true);
    expect(mk('todo').completed).toBe(false);
  });
});

describe('fronteiras do Markdown seguro', () => {
  it('URL com espaço, aspas ou longa demais não vira link', () => {
    expect(safeHref('http://a.com/a b')).toBeNull();
    expect(safeHref('http://a.com/"x"')).toBeNull();
    expect(safeHref('https://exemplo.com/' + 'a'.repeat(1980))).not.toBeNull();
    expect(safeHref('https://exemplo.com/' + 'a'.repeat(1981))).toBeNull();
  });
  it('URL solta gigante fica como texto', () => {
    const url = 'https://exemplo.com/' + 'a'.repeat(2100);
    const out = parseInline(url);
    expect(out).toEqual([{ t: 'text', v: url }]);
  });
  it('palavra_com_sublinhado não vira itálico', () => {
    expect(parseInline('snake_case_word')).toEqual([{ t: 'text', v: 'snake_case_word' }]);
    expect(parseInline('snake_case_ word')).toEqual([{ t: 'text', v: 'snake_case_ word' }]);
    expect(parseInline('um _itálico_ sim')[1]).toEqual({ t: 'i', c: [{ t: 'text', v: 'itálico' }] });
  });
  it('limita blocos (200) e tamanho do texto (8000)', () => {
    const many = Array.from({ length: 250 }, (_, i) => `par ${i}`).join('\n\n');
    expect(parseMarkdown(many)).toHaveLength(200);
    const long = 'x'.repeat(9000);
    expect(plainText(long)).toHaveLength(8000);
  });
});

describe('fronteiras dos anexos', () => {
  it('byte NUL reprova o texto', () => {
    expect(sniffText(Uint8Array.of(0x61, 0x00, 0x62), 'x.txt')).toBeNull();
  });
  it('arquivo que começa com assinatura PDF é PDF mesmo com nome .txt (bytes valem mais que o nome)', async () => {
    expect(sniff(enc('%PDF-1.4\n%texto\n'))?.mime).toBe('application/pdf');
    const fd = new FormData();
    fd.append('file', new File(['%PDF-1.4\n%texto\n'], 'engana.txt', { type: 'text/plain' }));
    const r = await prepareFiles(fd, { org: 'o', task: 't', idem: 'i', maxBytes: 1000 });
    expect(r.ok && r.files[0]!.mime).toBe('application/pdf');
  });
});
