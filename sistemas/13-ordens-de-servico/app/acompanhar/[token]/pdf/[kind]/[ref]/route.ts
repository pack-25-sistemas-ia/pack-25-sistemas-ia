import { NextResponse } from 'next/server';
import { isInvalidLink, limited, publicClient, requesterSource } from '@/lib/os/public-db';
import { isDocKind, logPdfFailure, pdfFilename, pdfResponse, renderDoc } from '@/lib/os/pdf/render';
import type { Doc } from '@/lib/os/pdf/document';
import { isTokenShape } from '@/lib/os/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PDF do CLIENTE pelo link: o banco valida o token e devolve SÓ dados do documento do cliente (snapshots da época; sem notas internas, custos ou CPF/CNPJ).
export async function GET(_req: Request, ctx: { params: Promise<{ token: string; kind: string; ref: string }> }) {
  const { token, kind, ref: rawRef } = await ctx.params;
  const ref = Number(rawRef);
  if (!isTokenShape(token) || !isDocKind(kind) || !Number.isInteger(ref) || ref < 0 || ref > 10000) return new NextResponse('Documento não encontrado', { status: 404 });
  let source: string;
  try { source = (await requesterSource()).source; } catch { return new NextResponse('Indisponível', { status: 503 }); }
  const rl = limited('file', source);
  if (!rl.allowed) return new NextResponse('Muitas consultas. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data, error } = await publicClient().rpc('os_public_document', { p_token: token, p_source: source, p_kind: kind, p_ref: ref });
  if (error || !data || isInvalidLink(data)) return new NextResponse('Documento não encontrado', { status: 404 });
  const doc = data as Doc;
  try {
    return pdfResponse(await renderDoc(doc), pdfFilename(doc, ref));
  } catch (e) {
    logPdfFailure(e);
    return new NextResponse('Não foi possível gerar o PDF agora', { status: 502 });
  }
}
