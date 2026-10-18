import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { getPublicEnv } from '@/lib/env';
import { logEvent } from '@/lib/log';
import { OsPdf, type Doc } from './document';

const LOGO_RE = /^[0-9a-f-]{36}\/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$/;

/** Logotipo para o PDF (só PNG/JPG; WebP não é suportado pelo gerador). O bucket de logotipos é público por natureza. Qualquer falha = PDF sem logotipo. */
async function loadLogo(path: string | null): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  if (!path || !LOGO_RE.test(path) || path.endsWith('.webp')) return null;
  try {
    const res = await fetch(`${getPublicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/os-logos/${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (type !== 'image/png' && type !== 'image/jpeg') return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length <= 512 * 1024 ? { data: buf, format: type === 'image/png' ? 'png' : 'jpg' } : null;
  } catch {
    return null;
  }
}

export async function renderDoc(doc: Doc): Promise<Buffer> {
  const logo = await loadLogo(doc.company.logo_path);
  return renderToBuffer(OsPdf({ doc, logo }));
}

const SLUG: Record<Doc['kind'], string> = { quote: 'orcamento', summary: 'resumo', completion: 'conclusao' };
export function pdfFilename(doc: Doc, ref: number): string {
  return `${doc.order.number_text}-${SLUG[doc.kind]}${doc.kind === 'summary' ? '' : `-v${ref}`}.pdf`;
}

export function pdfResponse(bytes: Buffer, filename: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function isDocKind(v: string): v is Doc['kind'] {
  return v === 'quote' || v === 'summary' || v === 'completion';
}

export function logPdfFailure(e: unknown) {
  logEvent('error', 'os_pdf_failed', { name: e instanceof Error ? e.name : 'unknown' });
}
