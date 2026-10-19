// Conteúdo digitado por pessoas: Markdown sanitizado, checklist, anexos de texto, histórico legível e CSV seguro.
import { describe, expect, it } from 'vitest';
import { parseChecklistLines } from '@/lib/pj/checklist';
import { csvText, toCsv } from '@/lib/pj/csv';
import { MAX_FILES, prepareFiles, safeFilename, sniff, sniffText, storagePath } from '@/lib/pj/attachments';
import { parseInline, parseMarkdown, plainText, safeHref } from '@/lib/pj/markdown';
import { describeEvent, toCard } from '@/lib/pj/present';
import { taskKey, projectKey } from '@/lib/pj/keys';

describe('Markdown sanitizado', () => {
  it('HTML nunca vira elemento: aparece como texto', () => {
    const b = parseMarkdown('<script>alert(1)</script> **ok** <img src=x onerror=alert(1)>');
    expect(JSON.stringify(b)).not.toContain('"t":"script"');
    const inl = (b[0] as { c: Array<{ t: string; v?: string }> }).c;
    expect(inl.some((n) => n.t === 'text' && n.v?.includes('<script>'))).toBe(true);
    expect(inl.some((n) => n.t === 'b')).toBe(true);
  });
  it('negrito, itálico, código e lista', () => {
    expect(parseInline('a **b** c')).toEqual([{ t: 'text', v: 'a ' }, { t: 'b', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }]);
    expect(parseInline('um _itálico_ aqui')[1]).toEqual({ t: 'i', c: [{ t: 'text', v: 'itálico' }] });
    expect(parseInline('use `x < y`')[1]).toEqual({ t: 'code', v: 'x < y' });
    const list = parseMarkdown('- um\n- dois\n\ntexto');
    expect(list[0]).toMatchObject({ t: 'ul' });
    expect((list[0] as { items: unknown[] }).items).toHaveLength(2);
    expect(list[1]).toMatchObject({ t: 'p' });
  });
  it('marcação sem fechamento vira texto comum (sem estourar)', () => {
    expect(parseInline('**sem fim')).toEqual([{ t: 'text', v: '**sem fim' }]);
    expect(parseInline('snake_case_nome')).toEqual([{ t: 'text', v: 'snake_case_nome' }]);
  });
  it('links: só http/https; javascript: e data: nunca viram link', () => {
    expect(safeHref('https://exemplo.com/a?b=1')).toBe('https://exemplo.com/a?b=1');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html;base64,AAAA')).toBeNull();
    expect(safeHref('https://x.com/"onclick=1')).toBeNull();
    const l = parseInline('[clique](javascript:alert(1)) e [ok](https://ex.com)');
    expect(l.filter((n) => n.t === 'a')).toHaveLength(1);
    expect(parseInline('veja https://ex.com/p.')[1]).toMatchObject({ t: 'a', href: 'https://ex.com/p' });
  });
  it('limites: texto enorme e muitos itens são cortados', () => {
    expect(parseMarkdown('a'.repeat(20000))[0]).toBeDefined();
    const many = parseMarkdown(Array.from({ length: 300 }, (_, i) => `- item ${i}`).join('\n'));
    expect((many[0] as { items: unknown[] }).items.length).toBeLessThanOrEqual(100);
  });
  it('texto puro para pré-visualização', () => {
    expect(plainText('**Oi** `x` [link](https://a.com)\n\n- um\n- dois')).toBe('Oi x link um dois');
  });
});

describe('checklist do formulário', () => {
  it('uma linha por item; «!» marca OBRIGATÓRIO; linhas vazias e itens vazios são ignorados', () => {
    expect(parseChecklistLines('! Revisar\nExportar\n\n!   \n  Enviar  ')).toEqual([
      { title: 'Revisar', required: true }, { title: 'Exportar', required: false }, { title: 'Enviar', required: false },
    ]);
  });
  it('máximo de 50 itens de 200 caracteres', () => {
    const items = parseChecklistLines(Array.from({ length: 80 }, (_, i) => `x${i}`).join('\n'));
    expect(items).toHaveLength(50);
    expect(parseChecklistLines('a'.repeat(500))[0]!.title).toHaveLength(200);
  });
});

describe('anexos de texto (TXT/CSV)', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('UTF-8 sem caracteres de controle é aceito; o nome decide CSV × TXT', () => {
    expect(sniffText(enc('a;b\n1;2\n'), 'dados.csv')).toEqual({ ext: 'csv', mime: 'text/csv' });
    expect(sniffText(enc('olá, mundo\tcom tab\r\n'), 'nota.txt')).toEqual({ ext: 'txt', mime: 'text/plain' });
    expect(sniffText(enc('texto'), 'sem-extensao')).toEqual({ ext: 'txt', mime: 'text/plain' });
  });
  it('binário, NUL, controle e UTF-8 inválido são recusados; vazio e gigante também', () => {
    expect(sniffText(Uint8Array.of(0x50, 0x4b, 3, 4, 0), 'x.txt')).toBeNull();
    expect(sniffText(Uint8Array.of(0x61, 0x1b, 0x5b, 0x31), 'x.txt')).toBeNull();
    expect(sniffText(Uint8Array.of(0xff, 0xfe, 0xfd), 'x.txt')).toBeNull();
    expect(sniffText(new Uint8Array(0), 'x.txt')).toBeNull();
    expect(sniffText(new Uint8Array(2 * 1024 * 1024 + 1).fill(97), 'x.txt')).toBeNull();
  });
  it('HTML e SVG digitados como texto continuam sendo texto simples (entregues só como download)', () => {
    expect(sniffText(enc('<html><script>alert(1)</script></html>'), 'a.html')?.mime).toBe('text/plain');
    expect(sniff(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
  it('nome seguro e caminho gerado pelo servidor', () => {
    expect(safeFilename('a/b\\c"d.txt')).toBe('a_b_c_d.txt');
    expect(storagePath('org', 'task', 'idem', 0, enc('x'), 'txt')).toMatch(/^org\/task\/[0-9a-f]{32}\.txt$/);
  });
  it('envio: tipos aceitos, limite de quantidade e de tamanho', async () => {
    const fd = (files: File[]) => { const f = new FormData(); files.forEach((x) => f.append('file', x)); return f; };
    const ctx = { org: 'o', task: 't', idem: 'i', maxBytes: 1000 };
    const ok = await prepareFiles(fd([new File(['a;b\n1;2'], 'dados.csv', { type: 'application/octet-stream' })]), ctx);
    expect(ok.ok && ok.files[0]!.mime).toBe('text/csv');
    const bad = await prepareFiles(fd([new File([new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0])], 'virus.exe')]), ctx);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('tipo de arquivo não permitido');
    const many = await prepareFiles(fd(Array.from({ length: MAX_FILES + 1 }, (_, i) => new File(['x'], `a${i}.txt`))), ctx);
    expect(!many.ok && many.error).toContain('no máximo');
    const big = await prepareFiles(fd([new File([new Uint8Array(2000).fill(97)], 'grande.txt')]), ctx);
    expect(!big.ok && big.error).toContain('tamanho máximo');
  });
});

describe('histórico legível (sem texto de comentário)', () => {
  const who = (id: string | null | undefined) => (id === 'u1' ? 'Ana' : id === 'u2' ? 'Bruno' : 'Pessoa');
  it('principais eventos', () => {
    expect(describeEvent('status_changed', { from: 'active', to: 'paused' }, who)).toBe('Status alterado de Ativo para Pausado');
    expect(describeEvent('priority_changed', { from: 'low', to: 'urgent' }, who)).toBe('Prioridade alterada de Baixa para Urgente');
    expect(describeEvent('assignee_changed', { from: 'u1', to: 'u2' }, who)).toBe('Responsável: Ana → Bruno');
    expect(describeEvent('assignee_changed', { from: 'u1', to: null }, who)).toBe('Responsável removido (era Ana)');
    expect(describeEvent('task_moved', { from: 'A fazer', to: 'Em andamento' }, who)).toBe('Movida de «A fazer» para «Em andamento»');
    expect(describeEvent('dates_changed', { from_start: null, to_start: '2026-03-10', from_due: '2026-03-01', to_due: '2026-03-20' }, who)).toContain('vencimento 01/03/2026 → 20/03/2026');
    expect(describeEvent('member_role_changed', { user_id: 'u2', from: 'editor', to: 'reader' }, who)).toBe('Bruno: papel alterado de Editor para Leitor');
    expect(describeEvent('comment_added', { comment_id: 'x' }, who)).toBe('Comentário publicado');
    expect(describeEvent('assignee_removed', { reason: 'member_removed' }, who)).toContain('deixou de ter acesso');
  });
  it('evento desconhecido aparece pelo nome técnico (nunca quebra)', () => {
    expect(describeEvent('algo_novo', {}, who)).toBe('algo_novo');
  });
});

describe('cartão do quadro', () => {
  it('monta chave, atraso, etiquetas e conclusão', () => {
    const labels = new Map([['l1', { name: 'Design', color: '#2563eb' }]]);
    const c = toCard({
      id: 't', task_number: 12, title: 'Wireframes', priority: 'high', due_date: '2026-03-01', assignee_user_id: 'u1', blocked_reason: null, task_labels: [{ label_id: 'l1' }, { label_id: 'sumiu' }],
      checklist: { done: 1, total: 2 }, completed_at: null, archived_at: null, column_id: 'c1',
    }, { key: (n) => taskKey('PRJ', 3, n), semanticOf: () => 'todo', labels, nameOf: (id) => (id ? 'Ana' : null), project: { status: 'active', archived: false }, today: '2026-03-10' });
    expect(c.key).toBe('PRJ-0003-12');
    expect(c.overdue).toBe(true);
    expect(c.labels).toEqual([{ name: 'Design', color: '#2563eb' }]);
    expect(c.assignee).toBe('Ana');
    expect(c.completed).toBe(false);
    expect(projectKey('PRJ', 7)).toBe('PRJ-0007');
  });
});

describe('CSV seguro', () => {
  it('neutraliza fórmulas de planilha e escapa aspas, ponto e vírgula e quebras', () => {
    expect(csvText('=SOMA(A1)')).toBe("'=SOMA(A1)");
    expect(csvText('+1')).toBe("'+1");
    expect(csvText('-1')).toBe("'-1");
    expect(csvText('@cmd')).toBe("'@cmd");
    expect(csvText('ok; aqui')).toBe('"ok; aqui"');
    expect(csvText('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvText('a\nb')).toBe('a b');
    const out = toCsv([{ key: 'a', label: 'Título', kind: 'text' }], [{ a: '=HYPERLINK("x")' }]);
    expect(out.startsWith('﻿Título\r\n')).toBe(true);
    expect(out).toContain('"\'=HYPERLINK(""x"")"');
  });
});
