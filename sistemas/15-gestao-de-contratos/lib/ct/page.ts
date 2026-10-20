import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requireContext, type Context } from '@/lib/auth/session';
import { nowMs } from '@/lib/time';
import { instantToLocal } from './time';
import type { OrgProfile } from './status';

export type CtSettings = {
  logo_path: string | null; primary_color: string; timezone: string; contract_prefix: string; near_end_days: number; attachment_max_size_bytes: number; retention_policy_text: string | null;
};
export const DEFAULT_SETTINGS: CtSettings = {
  logo_path: null, primary_color: '#1d4ed8', timezone: 'America/Sao_Paulo', contract_prefix: 'CTR', near_end_days: 60, attachment_max_size_bytes: 10 * 1024 * 1024, retention_policy_text: null,
};
export const SETTINGS_COLUMNS = 'logo_path, primary_color, timezone, contract_prefix, near_end_days, attachment_max_size_bytes, retention_policy_text';

export type Access = { profile: OrgProfile | null; userId: string | null; unread: number };

/** Perfil do usuário na empresa ativa (uma ida ao banco por requisição). */
export const loadAccess = cache(async (org: string): Promise<Access> => {
  const ctx = await requireContext();
  const { data } = await ctx.supabase.rpc('ct_my_context', { p_org: org });
  const d = (data ?? {}) as { profile?: OrgProfile | null; user_id?: string | null; unread_notifications?: number };
  return { profile: d.profile ?? null, userId: d.user_id ?? null, unread: Number(d.unread_notifications ?? 0) };
});

/** Contexto comum das páginas: sessão (já com MFA/papel), perfil, configurações, fuso e «hoje» no fuso da empresa. */
export async function pageCtx(allow?: readonly OrgProfile[]) {
  const ctx = await requireContext();
  const org = ctx.membership.organization_id;
  const access = await loadAccess(org);
  if (allow && (!access.profile || !allow.includes(access.profile))) notFound();
  const { data } = await ctx.supabase.from('ct_settings').select(SETTINGS_COLUMNS).eq('organization_id', org).maybeSingle();
  const settings: CtSettings = (data as CtSettings | null) ?? DEFAULT_SETTINGS;
  const now = nowMs();
  const today = instantToLocal(now, settings.timezone).date;
  return {
    ctx, org, settings, tz: settings.timezone, today, now, profile: access.profile, userId: access.userId ?? ctx.user.id, unread: access.unread,
    isMember: access.profile !== null, isManager: access.profile === 'owner' || access.profile === 'manager', isOwner: access.profile === 'owner', isViewer: access.profile === 'viewer',
  };
}
export type PageCtx = Awaited<ReturnType<typeof pageCtx>>;
export type { Context };

export { contractKey } from './keys';
