// Limites exatos e casos de borda das regras do sistema (dinheiro, prazos, arquivos, token, documentos, janelas). Complementa os demais testes de unidade.
import { describe, expect, it } from 'vitest';
import { HARD_MAX_BYTES, MAX_FILES, prepareFiles, readOrientation, safeFilename, sanitizeJpeg, sniff, storagePath } from '@/lib/os/attachments';
import { formatDuration } from '@/lib/os/indicators';
import { quoteDecidable } from '@/lib/os/quote';
import { isLate } from '@/lib/os/status';
import { sourceKey, tokenHash } from '@/lib/os/token';
import { moneyField, validDocument, windowToInstants } from '@/lib/os/validation';

const bytes = (...p: number[]) => Uint8Array.from(p);
const pad = (head: number[], n: number) => { const b = new Uint8Array(n); b.set(head); return b; };

describe('prazos: no instante exato já passou', () => {
  it('orçamento expira exatamente na validade', () => {
    const t = Date.parse('2026-03-10T12:00:00Z');
    expect(quoteDecidable({ status: 'published', validUntil: new Date(t + 1).toISOString() }, t).ok).toBe(true);
    expect(quoteDecidable({ status: 'published', validUntil: new Date(t).toISOString() }, t).ok).toBe(false);
  });
  it('atraso só depois do fim da janela', () => {
    const t = Date.parse('2026-03-10T12:00:00Z');
    expect(isLate({ status: 'scheduled', scheduledEndAt: new Date(t).toISOString() }, t)).toBe(false);
    expect(isLate({ status: 'scheduled', scheduledEndAt: new Date(t - 1).toISOString() }, t)).toBe(true);
  });
});

describe('formatação de duração', () => {
  it('não arredonda dias antes da hora', () => {
    expect(formatDuration(86399)).toBe('23 h 59 min');
    expect(formatDuration(86400)).toBe('1 d');
    expect(formatDuration(90000)).toBe('1 d 1 h');
  });
  it('valores não finitos viram «Sem dados»', () => {
    expect(formatDuration(Number.NaN)).toBe('Sem dados');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('Sem dados');
  });
});

describe('tipo de arquivo pelos bytes', () => {
  it('PDF exige «%PDF-»', () => {
    expect(sniff(pad([0x25, 0x50, 0x44, 0x46, 0x2d], 20))?.ext).toBe('pdf');
    expect(sniff(pad([0x25, 0x50, 0x44, 0x46, 0x31], 20))).toBeNull();
  });
  it('WebP exige RIFF + WEBP', () => {
    const ok = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 30);
    const bad = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20], 30); // RIFF/AVI
    expect(sniff(ok)?.ext).toBe('webp');
    expect(sniff(bad)).toBeNull();
  });
});

describe('nome e caminho de arquivo', () => {
  it('nome limitado a 180 caracteres', () => {
    expect(safeFilename('a'.repeat(500))).toHaveLength(180);
  });
  it('o caminho depende do conteúdo', () => {
    const a = storagePath('org', 'ord', 'idem', 0, bytes(1, 2, 3), 'png');
    const b = storagePath('org', 'ord', 'idem', 0, bytes(1, 2, 4), 'png');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^org\/ord\/[0-9a-f]{32}\.png$/);
  });
});

describe('envio de arquivos: limites', () => {
  const fd = (n: number, size: number, type = 'application/octet-stream') => {
    const f = new FormData();
    for (let i = 0; i < n; i++) f.append('file', new File([new Uint8Array(size)], `a${i}.bin`, { type }));
    return f;
  };
  const ctx = { org: 'o', order: 'p', idem: 'i' };
  it('no máximo %d arquivos por vez', async () => {
    const r = await prepareFiles(fd(MAX_FILES + 1, 10), { ...ctx, maxBytes: 1000 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('no máximo');
  });
  it('acima do tamanho da empresa é recusado antes de ler o tipo', async () => {
    const r = await prepareFiles(fd(1, 200), { ...ctx, maxBytes: 100 });
    expect(!r.ok && r.error).toContain('tamanho máximo');
  });
  it('o teto de segurança vale mesmo se a empresa configurar mais', async () => {
    const r = await prepareFiles(fd(1, HARD_MAX_BYTES + 1), { ...ctx, maxBytes: HARD_MAX_BYTES * 5 });
    expect(!r.ok && r.error).toContain('tamanho máximo');
  });
});

describe('JPEG e orientação malformados', () => {
  it('segmento que declara mais bytes do que o arquivo tem é recusado', () => {
    const j = bytes(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x50, 1, 2, 3, 4);
    expect(sanitizeJpeg(j)).toBeNull();
  });
  it('bloco TIFF curto não quebra nem inventa orientação', () => {
    expect(readOrientation(bytes(0x49, 0x49, 0x2a, 0))).toBeNull();
    expect(readOrientation(new Uint8Array(0))).toBeNull();
  });
});

describe('token', () => {
  it('hash é o sha256 do texto inteiro', () => {
    expect(tokenHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('origem depende do sal', () => {
    expect(sourceKey('1.2.3.4', 'a'.repeat(32))).not.toBe(sourceKey('1.2.3.4', 'b'.repeat(32)));
    expect(sourceKey('1.2.3.4', 'a'.repeat(32))).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('CPF e CNPJ', () => {
  it('aceita documentos válidos, com ou sem máscara', () => {
    expect(validDocument('529.982.247-25')).toBe('52998224725');
    expect(validDocument('11.222.333/0001-81')).toBe('11222333000181');
    expect(validDocument('')).toBe('');
  });
  it('confere os DOIS dígitos verificadores', () => {
    expect(validDocument('52998224726')).toBeNull(); // só o segundo dígito errado
    expect(validDocument('52998224715')).toBeNull(); // só o primeiro dígito errado
    expect(validDocument('11222333000182')).toBeNull();
    expect(validDocument('11222333000171')).toBeNull();
  });
  it('recusa sequências repetidas que passariam na conta', () => {
    expect(validDocument('00000000000')).toBeNull();
    expect(validDocument('00000000000000')).toBeNull();
    expect(validDocument('1234567')).toBeNull();
  });
});

describe('janela de atendimento', () => {
  const tz = 'America/Sao_Paulo';
  it('converte do fuso da empresa para instantes UTC', () => {
    const r = windowToInstants({ date: '2026-03-10', start: '09:00', end: '12:00' }, tz);
    expect(r).toEqual({ ok: true, startsAt: '2026-03-10T12:00:00.000Z', endsAt: '2026-03-10T15:00:00.000Z' });
  });
  it('fim igual ou anterior ao início é recusado', () => {
    for (const end of ['09:00', '08:00']) {
      const r = windowToInstants({ date: '2026-03-10', start: '09:00', end }, tz);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.field).toBe('sched_end');
    }
  });
  it('24:00 só vale como fim', () => {
    const bad = windowToInstants({ date: '2026-03-10', start: '24:00', end: '24:00' }, tz);
    expect(!bad.ok && bad.field).toBe('sched_start');
    expect(windowToInstants({ date: '2026-03-10', start: '20:00', end: '24:00' }, tz).ok).toBe(true);
  });
  it('campos ausentes apontam o campo certo', () => {
    expect(windowToInstants({}, tz)).toMatchObject({ ok: false, field: 'sched_date' });
    expect(windowToInstants({ date: '2026-03-10' }, tz)).toMatchObject({ ok: false, field: 'sched_start' });
    expect(windowToInstants({ date: '2026-03-10', start: '09:00' }, tz)).toMatchObject({ ok: false, field: 'sched_end' });
  });
});

describe('campo de dinheiro do formulário', () => {
  it('converte para centavos e recusa valor inválido com a mensagem do campo', () => {
    expect(moneyField('Preço').parse(' 1.234,56 ')).toBe(123456n);
    const r = moneyField('Preço').safeParse('abc');
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues[0]!.message).toContain('Preço');
  });
});
