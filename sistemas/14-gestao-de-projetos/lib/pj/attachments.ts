// Anexos da tarefa: o servidor decide tipo, tamanho, caminho e conteúdo. A extensão e o Content-Type enviados pelo navegador NÃO são confiados: o tipo é conferido pelos BYTES.
// Allowlist: JPEG, PNG, WebP (imagens), PDF e texto simples (TXT/CSV, só UTF-8 sem caracteres de controle). Não aceita SVG, HTML, executáveis, planilhas/documentos de escritório nem arquivos arbitrários. Não há antivírus: o sistema não afirma o contrário.
// Metadados sensíveis das FOTOS (EXIF com GPS, data/hora, modelo do aparelho; XMP; comentários) são removidos antes de guardar. Mantém-se apenas a ORIENTAÇÃO,
// para a foto não aparecer deitada. PDFs não são alterados (podem conter metadados do autor). Imagem malformada é RECUSADA (nunca guardada sem limpeza).
import { createHash } from 'node:crypto';

export const MAX_FILES = 5;
export const HARD_MAX_BYTES = 10 * 1024 * 1024; // teto de segurança (o bucket e o banco repetem)
export type Kind = { ext: 'jpg' | 'png' | 'webp' | 'pdf' | 'txt' | 'csv'; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'text/plain' | 'text/csv' };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

export function sniff(b: Uint8Array): Kind | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && b.length > 33) return { ext: 'png', mime: 'image/png' };
  if (startsWith(b, [0xff, 0xd8, 0xff]) && b.length > 4) return { ext: 'jpg', mime: 'image/jpeg' };
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8) && b.length > 20) return { ext: 'webp', mime: 'image/webp' };
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) && b.length > 8) return { ext: 'pdf', mime: 'application/pdf' };
  return null;
}

/**
 * Texto simples: UTF-8 válido, sem NUL nem caracteres de controle (exceto tabulação e quebras de linha), até 2 MB. «.csv» no nome → text/csv; qualquer outro → text/plain.
 * O tipo NÃO vem do navegador; o texto é entregue sempre como download (attachment) com nosniff e CSP restritiva, então nunca é interpretado como HTML.
 */
export function sniffText(b: Uint8Array, filename: string): Kind | null {
  if (b.length === 0 || b.length > 2 * 1024 * 1024) return null;
  for (const v of b) if (v === 0 || (v < 32 && v !== 9 && v !== 10 && v !== 13) || v === 127) return null;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }
  return /.csv$/i.test(filename.trim()) ? { ext: 'csv', mime: 'text/csv' } : { ext: 'txt', mime: 'text/plain' };
}

export const safeFilename = (name: string): string => (name.replace(/[\\/\x00-\x1f"]/g, '_').trim().slice(0, 180) || 'arquivo');

// ---------------------------------------------------------------------------- orientação EXIF (a única informação preservada)
const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/** Lê a orientação (1–8) de um bloco TIFF/EXIF; null se ausente, inválida ou malformada. */
export function readOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 14) return null;
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (dv.getUint16(2, le) !== 42) return null;
  const ifd = dv.getUint32(4, le);
  if (ifd < 8 || ifd + 2 > tiff.length) return null;
  const n = dv.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > tiff.length) return null;
    if (dv.getUint16(at, le) === 0x0112 && dv.getUint16(at + 2, le) === 3) {
      const v = dv.getUint16(at + 8, le);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** Bloco TIFF mínimo (big-endian) contendo SÓ a orientação. */
export function minimalTiff(orientation: number): Uint8Array {
  const b = new Uint8Array(26);
  const dv = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x4d; dv.setUint16(2, 42); dv.setUint32(4, 8);
  dv.setUint16(8, 1); // uma entrada
  dv.setUint16(10, 0x0112); dv.setUint16(12, 3); dv.setUint32(14, 1); dv.setUint16(18, orientation);
  dv.setUint32(22, 0); // sem próximo IFD
  return b;
}

// ---------------------------------------------------------------------------- JPEG
export function sanitizeJpeg(b: Uint8Array): Uint8Array | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const kept: Uint8Array[] = [];
  let orientation: number | null = null;
  let i = 2;
  let sos = false;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++;
    const marker = b[i++];
    if (marker === undefined) return null;
    if (marker === 0xd9) { kept.push(Uint8Array.of(0xff, 0xd9)); i = b.length; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { kept.push(Uint8Array.of(0xff, marker)); continue; }
    if (marker === 0xda) { kept.push(b.subarray(i - 2)); sos = true; i = b.length; break; }
    if (i + 2 > b.length) return null;
    const len = (b[i]! << 8) | b[i + 1]!;
    if (len < 2 || i + len > b.length) return null;
    const seg = b.subarray(i - 2, i + len);
    const body = b.subarray(i + 2, i + len);
    if (marker === 0xe0) kept.push(seg); // JFIF
    else if (marker === 0xe1) { if (ascii(body, 0, 6) === 'Exif\0\0') orientation ??= readOrientation(body.subarray(6)); } // EXIF/XMP: descartado
    else if (marker === 0xe2) { if (ascii(body, 0, 11) === 'ICC_PROFILE') kept.push(seg); } // perfil de cor é mantido; MPF e outros APP2 saem
    else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) { /* APP3–APP15 (inclui IPTC/Photoshop) e comentários: descartados */ }
    else kept.push(seg);
    i += len;
  }
  if (!sos) return null;
  const head: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  if (orientation && orientation !== 1) {
    const tiff = minimalTiff(orientation);
    const len = 2 + 6 + tiff.length;
    head.push(Uint8Array.of(0xff, 0xe1, len >> 8, len & 255), new TextEncoder().encode('Exif\0\0'), tiff);
  }
  return concat([...head, ...kept]);
}

// ---------------------------------------------------------------------------- PNG
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
export function sanitizePng(b: Uint8Array): Uint8Array | null {
  if (b.length < 33 || !startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  let first = true;
  while (i + 12 <= b.length) {
    const len = dv.getUint32(i);
    const type = ascii(b, i + 4, 4);
    const total = 12 + len;
    if (len > 0x7fffffff || i + total > b.length) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    if (!PNG_DROP.has(type)) kept.push(b.subarray(i, i + total));
    i += total;
    if (type === 'IEND') return concat(kept);
  }
  return null; // sem IEND: arquivo truncado/malformado
}

// ---------------------------------------------------------------------------- WebP
export function sanitizeWebp(b: Uint8Array): Uint8Array | null {
  if (b.length < 20 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffSize = dv.getUint32(4, true);
  if (riffSize + 8 > b.length || riffSize < 12) return null;
  const end = riffSize + 8;
  const chunks: Array<{ id: string; data: Uint8Array }> = [];
  let orientation: number | null = null;
  let i = 12;
  while (i + 8 <= end) {
    const id = ascii(b, i, 4);
    const size = dv.getUint32(i + 4, true);
    if (i + 8 + size > end) return null;
    const data = b.subarray(i + 8, i + 8 + size);
    if (id === 'EXIF') {
      const tiff = ascii(data, 0, 6) === 'Exif\0\0' ? data.subarray(6) : data;
      orientation ??= readOrientation(tiff);
    } else if (id !== 'XMP ') chunks.push({ id, data });
    i += 8 + size + (size % 2);
  }
  if (!chunks.some((c) => c.id === 'VP8 ' || c.id === 'VP8L' || c.id === 'VP8X')) return null;
  const vp8x = chunks.find((c) => c.id === 'VP8X');
  const keepOrientation = !!vp8x && !!orientation && orientation !== 1;
  if (vp8x) {
    if (vp8x.data.length < 10) return null;
    const flags = Uint8Array.from(vp8x.data);
    flags[0] = (flags[0]! & ~0x0c) | (keepOrientation ? 0x08 : 0); // bit 0x08 = EXIF, 0x04 = XMP
    vp8x.data = flags;
  }
  if (keepOrientation) chunks.push({ id: 'EXIF', data: minimalTiff(orientation!) });
  const body = chunks.map((c) => {
    const pad = c.data.length % 2;
    const out = new Uint8Array(8 + c.data.length + pad);
    out.set(new TextEncoder().encode(c.id), 0);
    new DataView(out.buffer).setUint32(4, c.data.length, true);
    out.set(c.data, 8);
    return out;
  });
  const total = 4 + body.reduce((n, c) => n + c.length, 0);
  const head = new Uint8Array(12);
  head.set(new TextEncoder().encode('RIFF'), 0);
  new DataView(head.buffer).setUint32(4, total, true);
  head.set(new TextEncoder().encode('WEBP'), 8);
  return concat([head, ...body]);
}

/** Remove metadados sensíveis. null = arquivo malformado (deve ser recusado). PDFs passam sem alteração. */
export function sanitize(kind: Kind, bytes: Uint8Array): Uint8Array | null {
  switch (kind.ext) {
    case 'jpg': return sanitizeJpeg(bytes);
    case 'png': return sanitizePng(bytes);
    case 'webp': return sanitizeWebp(bytes);
    default: return bytes;
  }
}

/** Caminho gerado pelo servidor e DETERMINÍSTICO (idem + posição + conteúdo): reenviar o mesmo envio reaproveita o mesmo arquivo em vez de criar órfãos. */
export function storagePath(org: string, task: string, idem: string, index: number, bytes: Uint8Array, ext: string): string {
  const h = createHash('sha256').update(`${idem}:${index}:`).update(bytes).digest('hex').slice(0, 32);
  return `${org}/${task}/${h}.${ext}`;
}

export type Prepared = { path: string; filename: string; mime: string; size: number; sha256: string; bytes: Uint8Array };

/** Lê e valida os arquivos do formulário. Devolve a lista pronta para enviar ou uma mensagem de erro amigável. */
export async function prepareFiles(fd: FormData, ctx: { org: string; task: string; idem: string; maxBytes: number; field?: string }): Promise<{ ok: true; files: Prepared[] } | { ok: false; error: string }> {
  const raw = fd.getAll(ctx.field ?? 'file').filter((f): f is File => f instanceof File && f.size > 0);
  if (raw.length > MAX_FILES) return { ok: false, error: `Envie no máximo ${MAX_FILES} arquivos por vez.` };
  const max = Math.min(ctx.maxBytes, HARD_MAX_BYTES);
  const files: Prepared[] = [];
  for (const [i, f] of raw.entries()) {
    if (f.size > max) return { ok: false, error: `«${safeFilename(f.name)}» passa do tamanho máximo (${Math.max(1, Math.floor(max / 1024 / 1024))} MB).` };
    const original = new Uint8Array(await f.arrayBuffer());
    const kind = sniff(original) ?? sniffText(original, f.name);
    if (!kind) return { ok: false, error: `«${safeFilename(f.name)}»: tipo de arquivo não permitido. Envie imagem (JPEG, PNG, WebP), PDF ou texto (TXT, CSV).` };
    const bytes = sanitize(kind, original);
    if (!bytes) return { ok: false, error: `«${safeFilename(f.name)}» parece danificado e não pôde ser processado com segurança.` };
    if (bytes.length > max) return { ok: false, error: `«${safeFilename(f.name)}» passa do tamanho máximo.` };
    files.push({ path: storagePath(ctx.org, ctx.task, ctx.idem, i, bytes, kind.ext), filename: safeFilename(f.name), mime: kind.mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), bytes });
  }
  return { ok: true, files };
}
