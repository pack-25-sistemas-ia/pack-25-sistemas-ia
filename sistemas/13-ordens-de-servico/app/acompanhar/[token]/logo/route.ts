import { NextResponse } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { isInvalidLink, limited, publicClient, requesterSource } from '@/lib/os/public-db';
import { isTokenShape } from '@/lib/os/token';

export const dynamic = 'force-dynamic';

// Logotipo da empresa na página do cliente: o token é validado (a empresa vem da ordem do token) e só então o arquivo do bucket público de logotipos é entregue pelo nosso domínio.
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!isTokenShape(token)) return new NextResponse(null, { status: 404 });
  let source: string;
  try { source = (await requesterSource()).source; } catch { return new NextResponse(null, { status: 404 }); }
  if (!limited('file', source).allowed) return new NextResponse(null, { status: 429 });
  const { data } = await publicClient().rpc('os_public_view', { p_token: token, p_source: source });
  if (!data || isInvalidLink(data)) return new NextResponse(null, { status: 404 });
  const path = (data as { company?: { logo_path?: string | null } }).company?.logo_path;
  if (!path || !/^[0-9a-f-]{36}\/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$/.test(path)) return new NextResponse(null, { status: 404 });
  const res = await fetch(`${getPublicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/os-logos/${path}`, { cache: 'no-store' });
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!res.ok || !ALLOWED.has(type)) return new NextResponse(null, { status: 404 });
  return new NextResponse(res.body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; sandbox" } });
}
