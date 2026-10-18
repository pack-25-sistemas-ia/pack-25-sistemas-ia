import { NextResponse } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { logEvent } from '@/lib/log';
import { isInvalidLink, limited, publicClient, requesterSource } from '@/lib/os/public-db';
import { uuidOrNull } from '@/lib/os/query';
import { isTokenShape } from '@/lib/os/token';

export const dynamic = 'force-dynamic';

// Arquivo COMPARTILHADO com o cliente. (1) o banco valida o token e confirma que o arquivo é desta ordem e está marcado para o cliente (os_public_file);
// (2) buscamos os bytes no Storage como `anon`, repassando o token no cabeçalho x-os-token — a política do Storage só libera arquivos compartilhados da ordem do token.
// Nenhuma chave privilegiada é usada. A resposta sai pelo nosso domínio, sem Referer, com CSP restritiva e nosniff.
const INLINE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function GET(req: Request, ctx: { params: Promise<{ token: string; id: string }> }) {
  const { token, id: rawId } = await ctx.params;
  const id = uuidOrNull(rawId);
  if (!isTokenShape(token) || !id) return new NextResponse('Arquivo não encontrado', { status: 404 });
  let source: string;
  try { source = (await requesterSource()).source; } catch { return new NextResponse('Indisponível', { status: 503 }); }
  const rl = limited('file', source);
  if (!rl.allowed) return new NextResponse('Muitas consultas. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data, error } = await publicClient().rpc('os_public_file', { p_token: token, p_source: source, p_attachment: id });
  if (error || !data || isInvalidLink(data)) return new NextResponse('Arquivo não encontrado', { status: 404 });
  const info = data as { path: string; content_type: string; name: string };
  const env = getPublicEnv();
  const upstream = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/os-files/${info.path.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`, 'x-os-token': token },
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) {
    logEvent('error', 'os_public_file_failed', { status: upstream.status });
    return new NextResponse('Não foi possível abrir o arquivo agora', { status: 502 });
  }
  const inline = INLINE.has(info.content_type) && new URL(req.url).searchParams.get('download') !== '1';
  return new NextResponse(upstream.body, {
    headers: {
      'content-type': info.content_type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${info.name.replace(/[^A-Za-z0-9._ -]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; sandbox",
    },
  });
}
