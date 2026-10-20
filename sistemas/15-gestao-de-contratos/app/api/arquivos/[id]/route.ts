import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import { uuidOrNull } from '@/lib/ct/query';

export const dynamic = 'force-dynamic';

// Documento do contrato (id = ID DA VERSÃO): (1) sessão + MFA; (2) o BANCO decide se o usuário pode ver o contrato dono do arquivo (ct_document_info); (3) só então geramos uma URL
// assinada CURTA (60 s) e entregamos os bytes PELO nosso domínio. O caminho do Storage nunca chega ao navegador. Imagens abrem na página; PDF e DOCX baixam.
// Nunca executamos HTML/SVG: o tipo vem do registro conferido no envio e a resposta leva CSP restritiva + nosniff. Remover o acesso ao contrato bloqueia novos downloads na hora.
const INLINE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = uuidOrNull((await ctx.params).id);
  if (!id) return new NextResponse('Arquivo não encontrado', { status: 404 });
  const r = await resolveContext();
  if (r.kind !== 'ok') return new NextResponse(r.kind === 'forbidden' ? 'Sem permissão' : 'Não autenticado', { status: r.kind === 'forbidden' ? 403 : 401 });
  const { supabase, user, membership } = r.ctx;
  const rl = rateLimit(`ct-file:${user.id}`, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitos downloads. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data, error } = await supabase.rpc('ct_document_info', { p_org: membership.organization_id, p_version: id });
  if (error || !data) return new NextResponse('Arquivo não encontrado', { status: 404 });
  const info = data as { path: string; name: string; mime: string };
  const signed = await supabase.storage.from('ct-files').createSignedUrl(info.path, 60);
  if (signed.error || !signed.data?.signedUrl) {
    logEvent('error', 'ct_signed_url_failed', { name: signed.error?.name ?? 'unknown' });
    return new NextResponse('Não foi possível abrir o arquivo agora', { status: 502 });
  }
  const upstream = await fetch(signed.data.signedUrl, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) return new NextResponse('Não foi possível abrir o arquivo agora', { status: 502 });
  const inline = INLINE.has(info.mime) && new URL(req.url).searchParams.get('download') !== '1';
  return new NextResponse(upstream.body, {
    headers: {
      'content-type': info.mime,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${info.name.replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
}
