import 'server-only';
import { headers } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPublicEnv } from '@/lib/env';
import { rateLimit, type RateLimitRule } from '@/lib/security/rate-limit';
import { linkSalt, sourceKey } from './token';

/** Cliente SEM sessão (papel anon). Só alcança as operações os_public_* — nunca tabelas. Nenhuma chave privilegiada existe neste sistema. */
export function publicClient(): SupabaseClient {
  const env = getPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Origem anônima do visitante (HMAC do IP; o IP puro nunca é guardado). Falha FECHADA sem OS_LINK_SALT. */
export async function requesterSource(): Promise<{ ip: string; source: string; userAgent: string }> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'desconhecido').split(',')[0]!.trim().slice(0, 64) || 'desconhecido';
  return { ip, source: sourceKey(ip, linkSalt()), userAgent: (h.get('user-agent') ?? '').slice(0, 200) };
}

export const PUBLIC_LIMITS = {
  view: { limit: 120, windowMs: 10 * 60_000 },
  decide: { limit: 20, windowMs: 10 * 60_000 },
  file: { limit: 200, windowMs: 10 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export function limited(scope: keyof typeof PUBLIC_LIMITS, key: string): { allowed: boolean; retryAfterSeconds: number } {
  return rateLimit(`os-pub:${scope}:${key}`, PUBLIC_LIMITS[scope]);
}

export type PublicError = { error: 'invalid_link' };
export const isInvalidLink = (d: unknown): d is PublicError => !!d && typeof d === 'object' && (d as { error?: string }).error === 'invalid_link';
