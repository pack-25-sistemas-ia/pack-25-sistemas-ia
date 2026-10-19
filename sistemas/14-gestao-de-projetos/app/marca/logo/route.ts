import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { getPublicEnv } from '@/lib/env';

// Serve o logotipo da empresa a partir do Storage pelo próprio domínio (a CSP só permite imagens do próprio site e o caminho, que contém o id da empresa, nunca chega ao navegador).
// Só imagens raster conferidas no envio; exige sessão (o logotipo aparece apenas dentro do sistema).
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function GET() {
  const r = await resolveContext();
  if (r.kind !== 'ok') return new NextResponse(null, { status: 404 });
  const { supabase, membership } = r.ctx;
  const { data } = await supabase.from('pj_settings').select('logo_path').eq('organization_id', membership.organization_id).maybeSingle();
  const path = (data as { logo_path: string | null } | null)?.logo_path;
  if (!path || !/^[0-9a-f-]{36}\/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$/.test(path)) return new NextResponse(null, { status: 404 });
  const res = await fetch(`${getPublicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/os-logos/${path}`, { cache: 'no-store' });
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  if (!res.ok || !ALLOWED.has(type)) return new NextResponse(null, { status: 404 });
  return new NextResponse(res.body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } });
}
