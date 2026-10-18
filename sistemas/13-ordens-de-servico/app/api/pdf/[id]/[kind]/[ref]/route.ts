import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { rateLimit } from '@/lib/security/rate-limit';
import { uuidOrNull } from '@/lib/os/query';
import { isDocKind, logPdfFailure, pdfFilename, pdfResponse, renderDoc } from '@/lib/os/pdf/render';
import type { Doc } from '@/lib/os/pdf/document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PDF para a equipe: sessão + MFA; o BANCO decide se o usuário vê a ordem (os_document) e devolve só dados do documento do cliente (snapshots da época; sem notas internas, custos ou CPF/CNPJ).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; kind: string; ref: string }> }) {
  const p = await ctx.params;
  const id = uuidOrNull(p.id);
  const ref = Number(p.ref);
  if (!id || !isDocKind(p.kind) || !Number.isInteger(ref) || ref < 0 || ref > 10000) return new NextResponse('Documento não encontrado', { status: 404 });
  const r = await resolveContext();
  if (r.kind !== 'ok') return new NextResponse(r.kind === 'forbidden' ? 'Sem permissão' : 'Não autenticado', { status: r.kind === 'forbidden' ? 403 : 401 });
  const { supabase, user, membership } = r.ctx;
  const rl = rateLimit(`os-pdf:${user.id}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitos PDFs em pouco tempo. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data, error } = await supabase.rpc('os_document', { p_org: membership.organization_id, p_order: id, p_kind: p.kind, p_ref: ref });
  if (error || !data) return new NextResponse('Documento não encontrado', { status: 404 });
  const doc = data as Doc;
  try {
    return pdfResponse(await renderDoc(doc), pdfFilename(doc, ref));
  } catch (e) {
    logPdfFailure(e);
    return new NextResponse('Não foi possível gerar o PDF agora', { status: 502 });
  }
}
