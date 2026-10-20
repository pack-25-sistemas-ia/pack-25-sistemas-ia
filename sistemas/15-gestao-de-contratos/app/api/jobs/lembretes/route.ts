import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getPublicEnv } from '@/lib/env';
import { logEvent } from '@/lib/log';

export const dynamic = 'force-dynamic';

// Agendador de lembretes (ver docs/REMINDERS.md). Um agendador externo (Vercel Cron, GitHub Actions, cron do servidor…) chama este endpoint com
//   POST /api/jobs/lembretes   Authorization: Bearer <token da empresa>
// O token é gerado em «Configurações» e só o HASH fica no banco. A chamada é IDEMPOTENTE (repetir não duplica notificações), o banco limita a taxa e a resposta traz só contagens.
// Nunca usa sessão de usuário nem service_role: a função do banco confere o token.
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer ([0-9a-f]{64})$/.exec(auth)?.[1];
  if (!token) return NextResponse.json({ error: 'Token ausente ou inválido.' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const env = getPublicEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('ct_run_reminders', { p_token: token });
  if (error) {
    const invalid = error.code === '28000';
    logEvent(invalid ? 'warn' : 'error', 'ct_job_rejected', { code: error.code ?? 'unknown' });
    return NextResponse.json({ error: invalid ? 'Token ausente ou inválido.' : 'Não foi possível processar agora.' }, { status: invalid ? 401 : error.code === '54000' ? 429 : 502, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
