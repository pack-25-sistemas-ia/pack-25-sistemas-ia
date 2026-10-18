import { describe, expect, it } from 'vitest';
import { minimalTiff, readOrientation, safeFilename, sanitize, sanitizeJpeg, sanitizePng, sanitizeWebp, sniff, storagePath } from '@/lib/os/attachments';
import { csvText, toCsv } from '@/lib/os/csv';
import { isTokenShape, newToken, sourceKey, tokenHash, linkSalt } from '@/lib/os/token';

const text = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const u32 = (n: number, le = false) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, le); return b; };
const indexOf = (hay: Uint8Array, needle: string) => Buffer.from(hay).indexOf(needle);

// JPEG sintético: SOI + JFIF + EXIF (GPS e modelo do aparelho, orientação 6) + XMP + comentário + IPTC + quantização + SOS + dados + EOI
function jpegWith(orientation: number | null) {
  const app = (marker: number, body: Uint8Array) => cat(Uint8Array.of(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255), body);
  const tiff = orientation ? minimalTiff(orientation) : text('II*\0\x08\0\0\0\0\0\0\0\0\0');
  const exif = cat(text('Exif\0\0'), tiff, text('GPS-LAT-SECRETO Modelo-Aparelho'));
  return cat(
    Uint8Array.of(0xff, 0xd8),
    app(0xe0, text('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    app(0xe1, exif),
    app(0xe1, text('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>AUTOR-SECRETO</x:xmpmeta>')),
    app(0xfe, text('COMENTARIO-SECRETO')),
    app(0xed, text('Photoshop 3.0\0IPTC-SECRETO')),
    app(0xdb, Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7)),
    Uint8Array.of(0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x11, 0x22, 0x33, 0xff, 0xd9),
  );
}

describe('arquivos: tipo pelos bytes', () => {
  it('aceita só JPEG, PNG, WebP e PDF; recusa SVG, HTML, texto e executáveis', () => {
    expect(sniff(jpegWith(null))?.ext).toBe('jpg');
    expect(sniff(cat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), new Uint8Array(40)))?.ext).toBe('png');
    expect(sniff(cat(text('RIFF'), u32(30, true), text('WEBPVP8L'), new Uint8Array(20)))?.ext).toBe('webp');
    expect(sniff(text('%PDF-1.7\n1 0 obj'))?.ext).toBe('pdf');
    expect(sniff(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniff(text('<!doctype html><html></html>'))).toBeNull();
    expect(sniff(text('MZ\x90\0 executável'))).toBeNull();
    expect(sniff(text('texto simples de nota'))).toBeNull();
    expect(sniff(new Uint8Array(0))).toBeNull();
  });
  it('nome seguro e caminho determinístico dentro da ordem', () => {
    expect(safeFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFilename('foto "a".jpg')).toBe('foto _a_.jpg');
    expect(safeFilename('   ')).toBe('arquivo');
    const a = storagePath('org', 'ord', 'idem', 0, text('x'), 'jpg');
    expect(a).toMatch(/^org\/ord\/[0-9a-f]{32}\.jpg$/);
    expect(storagePath('org', 'ord', 'idem', 0, text('x'), 'jpg')).toBe(a);
    expect(storagePath('org', 'ord', 'idem', 1, text('x'), 'jpg')).not.toBe(a);
  });
});

describe('remoção de metadados das fotos', () => {
  it('JPEG: tira EXIF (GPS, aparelho), XMP, IPTC e comentários; mantém a imagem e a orientação', () => {
    const out = sanitizeJpeg(jpegWith(6))!;
    expect(out).not.toBeNull();
    for (const secret of ['GPS-LAT-SECRETO', 'Modelo-Aparelho', 'AUTOR-SECRETO', 'COMENTARIO-SECRETO', 'IPTC-SECRETO']) expect(indexOf(out, secret), secret).toBe(-1);
    expect(indexOf(out, 'JFIF')).toBeGreaterThan(0); // JFIF e quantização preservados
    expect(Buffer.from(out).includes(Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0x11, 0x22, 0x33, 0xff, 0xd9]))).toBe(true);
    const i = indexOf(out, 'Exif');
    expect(i).toBeGreaterThan(0);
    expect(readOrientation(out.subarray(i + 6))).toBe(6); // só a orientação sobrevive
    expect(out.length).toBeLessThan(jpegWith(6).length);
  });
  it('JPEG sem orientação (ou 1) não carrega EXIF nenhum', () => {
    expect(indexOf(sanitizeJpeg(jpegWith(null))!, 'Exif')).toBe(-1);
    expect(indexOf(sanitizeJpeg(jpegWith(1))!, 'Exif')).toBe(-1);
  });
  it('JPEG malformado é recusado (nunca guardado sem limpeza)', () => {
    expect(sanitizeJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff))).toBeNull(); // segmento maior que o arquivo
    expect(sanitizeJpeg(Uint8Array.of(0xff, 0xd8, 0x12, 0x34))).toBeNull();
    expect(sanitizeJpeg(Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0, 4, 1, 2))).toBeNull(); // sem SOS
  });

  const chunk = (type: string, data: Uint8Array) => cat(u32(data.length), text(type), data, u32(0));
  const png = (...extra: Uint8Array[]) => cat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', new Uint8Array(13)), ...extra, chunk('IDAT', text('pixels')), chunk('IEND', new Uint8Array(0)));
  it('PNG: tira eXIf, texto (autor, software, GPS) e tIME; mantém IHDR/IDAT/IEND', () => {
    const out = sanitizePng(png(chunk('eXIf', text('GPS-PNG-SECRETO')), chunk('tEXt', text('Author\0AUTOR-PNG')), chunk('iTXt', text('XMP:AUTOR2')), chunk('zTXt', text('x')), chunk('tIME', new Uint8Array(7)), chunk('pHYs', new Uint8Array(9))))!;
    for (const s of ['GPS-PNG-SECRETO', 'AUTOR-PNG', 'AUTOR2', 'eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']) expect(indexOf(out, s), s).toBe(-1);
    for (const s of ['IHDR', 'IDAT', 'IEND', 'pHYs', 'pixels']) expect(indexOf(out, s), s).toBeGreaterThan(0);
  });
  it('PNG truncado ou sem IHDR é recusado', () => {
    expect(sanitizePng(png().subarray(0, 40))).toBeNull();
    expect(sanitizePng(cat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IDAT', text('x')), chunk('IEND', new Uint8Array(0))))).toBeNull();
  });

  const riff = (...chunks: Uint8Array[]) => { const body = cat(text('WEBP'), ...chunks); return cat(text('RIFF'), u32(body.length, true), body); };
  const wchunk = (id: string, data: Uint8Array) => cat(text(id), u32(data.length, true), data, data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0));
  it('WebP: tira EXIF e XMP, limpa as flags do VP8X, mantém a imagem e recalcula o tamanho', () => {
    const vp8x = Uint8Array.of(0x0c, 0, 0, 0, 9, 0, 0, 9, 0, 0); // flags EXIF+XMP
    const file = riff(wchunk('VP8X', vp8x), wchunk('VP8 ', text('imagem-webp-dados')), wchunk('EXIF', cat(text('Exif\0\0'), text('II*\0\x08\0\0\0\0\0GPS-WEBP-SECRETO'))), wchunk('XMP ', text('AUTOR-WEBP')));
    const out = sanitizeWebp(file)!;
    expect(out).not.toBeNull();
    for (const s of ['GPS-WEBP-SECRETO', 'AUTOR-WEBP', 'EXIF', 'XMP ']) expect(indexOf(out, s), s).toBe(-1);
    expect(indexOf(out, 'imagem-webp-dados')).toBeGreaterThan(0);
    expect(new DataView(out.buffer, out.byteOffset).getUint32(4, true) + 8).toBe(out.length);
    expect(out[indexOf(out, 'VP8X') + 8]! & 0x0c).toBe(0);
  });
  it('WebP: preserva a orientação como EXIF mínimo', () => {
    const vp8x = Uint8Array.of(0x08, 0, 0, 0, 9, 0, 0, 9, 0, 0);
    const out = sanitizeWebp(riff(wchunk('VP8X', vp8x), wchunk('VP8 ', text('img')), wchunk('EXIF', cat(minimalTiff(8), text('GPS-SECRETO-EXTRA')))))!;
    expect(indexOf(out, 'GPS-SECRETO-EXTRA')).toBe(-1);
    const i = indexOf(out, 'EXIF');
    expect(readOrientation(out.subarray(i + 8))).toBe(8);
    expect(out[indexOf(out, 'VP8X') + 8]! & 0x08).toBe(0x08);
  });
  it('WebP malformado é recusado; PDF passa sem alteração', () => {
    expect(sanitizeWebp(cat(text('RIFF'), u32(500, true), text('WEBPVP8 '), new Uint8Array(8)))).toBeNull();
    const pdf = text('%PDF-1.7\nconteúdo');
    expect(sanitize({ ext: 'pdf', mime: 'application/pdf' }, pdf)).toBe(pdf);
  });
});

describe('orientação EXIF', () => {
  it('lê big e little endian; ignora valores inválidos', () => {
    expect(readOrientation(minimalTiff(3))).toBe(3);
    const le = Uint8Array.of(0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0);
    expect(readOrientation(le)).toBe(6);
    const bad = Uint8Array.from(minimalTiff(3)); bad[19] = 9;
    expect(readOrientation(bad)).toBeNull();
    expect(readOrientation(new Uint8Array(4))).toBeNull();
  });
});

describe('token do link', () => {
  it('256 bits, formato fixo, hash estável e sem repetição', () => {
    const a = newToken(); const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isTokenShape(a)).toBe(true);
    expect(isTokenShape('curto')).toBe(false);
    expect(isTokenShape(a + 'x')).toBe(false);
    expect(isTokenShape(`${a.slice(0, 42)}é`)).toBe(false);
    expect(tokenHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash(a)).toBe(tokenHash(a));
    expect(tokenHash(a)).not.toBe(tokenHash(b));
    expect(tokenHash(a)).not.toContain(a.slice(0, 10));
  });
  it('origem anônima por HMAC (não é o IP) e sal obrigatório', () => {
    const salt = 'x'.repeat(40);
    expect(sourceKey('203.0.113.9', salt)).toMatch(/^[0-9a-f]{32}$/);
    expect(sourceKey('203.0.113.9', salt)).toBe(sourceKey('203.0.113.9', salt));
    expect(sourceKey('203.0.113.9', salt)).not.toBe(sourceKey('203.0.113.10', salt));
    expect(sourceKey('203.0.113.9', salt)).not.toBe(sourceKey('203.0.113.9', 'y'.repeat(40)));
    expect(() => linkSalt({})).toThrow(/OS_LINK_SALT/);
    expect(() => linkSalt({ OS_LINK_SALT: 'curto' })).toThrow();
    expect(linkSalt({ OS_LINK_SALT: salt })).toBe(salt);
  });
});

describe('CSV seguro', () => {
  it('neutraliza fórmulas, escapa aspas/ponto e vírgula e usa BOM + CRLF', () => {
    expect(csvText('=1+1')).toBe("'=1+1");
    expect(csvText('+55 11 99999')).toBe("'+55 11 99999");
    expect(csvText('-10')).toBe("'-10");
    expect(csvText('@SOMA(A1)')).toBe("'@SOMA(A1)");
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvText('linha1\nlinha2')).toBe('linha1 linha2');
    const out = toCsv([{ key: 'n', label: 'Número', kind: 'text' }, { key: 'v', label: 'Valor', kind: 'int' }], [{ n: '=cmd|calc', v: 1050 }, { n: null, v: undefined }]);
    expect(out.startsWith('﻿Número;Valor\r\n')).toBe(true);
    expect(out).toContain("'=cmd|calc;1050");
    expect(out.endsWith('\r\n')).toBe(true);
  });
});
