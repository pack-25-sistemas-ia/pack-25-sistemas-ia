import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requireContext, type Context } from '@/lib/auth/session';
import { nowMs } from '@/lib/time';
import { instantToLocal } from './time';
import type { Profile } from './status';

export type OsSettings = {
  public_display_name: string | null; logo_path: string | null; primary_color: string; timezone: string; order_prefix: string; quote_validity_days: number;
  default_quote_terms: string | null; link_ttl_days: number; attachment_max_size_bytes: number; retention_policy_text: string | null;
};
export const DEFAULT_SETTINGS: OsSettings = {
  public_display_name: null, logo_path: null, primary_color: '#2563eb', timezone: 'America/Sao_Paulo', order_prefix: 'OS', quote_validity_days: 15, default_quote_terms: null,
  link_ttl_days: 30, attachment_max_size_bytes: 5 * 1024 * 1024, retention_policy_text: null,
};
export const SETTINGS_COLUMNS = 'public_display_name, logo_path, primary_color, timezone, order_prefix, quote_validity_days, default_quote_terms, link_ttl_days, attachment_max_size_bytes, retention_policy_text';

export type Access = { profile: Profile | null; userId: string | null };

/** Perfil do usuário na empresa ativa (uma ida ao banco por requisição). */
export const loadAccess = cache(async (org: string): Promise<Access> => {
  const ctx = await requireContext();
  const { data } = await ctx.supabase.rpc('os_my_context', { p_org: org });
  const d = (data ?? {}) as { profile?: Profile | null; user_id?: string | null };
  return { profile: d.profile ?? null, userId: d.user_id ?? null };
});

/** Contexto comum das páginas: sessão (já com MFA/papel), perfil, políticas, fuso e «hoje» no fuso da empresa. */
export async function pageCtx(allow?: readonly Profile[]) {
  const ctx = await requireContext();
  const org = ctx.membership.organization_id;
  const access = await loadAccess(org);
  if (allow && (!access.profile || !allow.includes(access.profile))) notFound();
  const { data } = await ctx.supabase.from('os_settings').select(SETTINGS_COLUMNS).eq('organization_id', org).maybeSingle();
  const settings: OsSettings = (data as OsSettings | null) ?? DEFAULT_SETTINGS;
  const now = nowMs();
  const today = instantToLocal(now, settings.timezone).date;
  return {
    ctx, org, settings, tz: settings.timezone, today, now, profile: access.profile, userId: access.userId ?? ctx.user.id,
    isStaff: access.profile !== null, isManager: access.profile === 'owner' || access.profile === 'manager', isOwner: access.profile === 'owner', isTechnician: access.profile === 'technician',
  };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;
export type { Context };

export const numberText = (prefix: string, n: number | string): string => `${prefix}-${String(n).padStart(5, '0')}`;
