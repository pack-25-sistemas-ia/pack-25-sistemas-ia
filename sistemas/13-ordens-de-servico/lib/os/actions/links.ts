'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { getPublicEnv } from '@/lib/env';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { newToken, tokenHash } from '../token';
import { optText, text, uuid, version } from '../validation';

const refresh = (order: string) => bust(`/ordens/${order}`, '/ordens', '/dashboard');

/**
 * Gera o link de acompanhamento. O token (256 bits) é criado AQUI; o banco recebe só o sha256. O link completo aparece UMA vez, na resposta desta ação:
 * quem perder precisa gerar outro (o anterior é revogado). Nada disso vai para logs.
 */
export async function createLink(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(z.object({ order: uuid() }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'createLink', async ({ ctx, org }) => {
    const token = newToken();
    const { data, error } = await ctx.supabase.rpc('os_create_link', { p_org: org, p_order: p.data.order, p_token_hash: tokenHash(token) });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    const exp = (data as { expires_at: string }).expires_at;
    return { ...succeed('Link gerado. Copie agora: por segurança ele não será exibido de novo (o sistema guarda só um resumo irreversível).'), link: `${getPublicEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/acompanhar/${token}`, id: exp };
  });
}

export async function revokeLink(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const p = parse(z.object({ order: uuid() }), formObject(fd));
  if (!p.ok) return p.state;
  return guarded('manager', 'revokeLink', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_revoke_link', { p_org: org, p_order: p.data.order });
    if (error) return fail(dbMessage(error));
    refresh(p.data.order);
    return succeed('Link revogado. Quem tiver o endereço antigo não consegue mais abrir a página.');
  });
}

const manualCompletion = z.object({
  order: uuid(), version, decision: z.enum(['accepted', 'contested'], { message: 'Escolha aceitar ou contestar.' }), declared_name: text(2, 120, 'Nome de quem respondeu'),
  justification: text(10, 500, 'Justificativa'), note: optText(1000, 'Observação'),
});
/** Aceite/contestação registrados pela equipe (ex.: o cliente aceitou presencialmente). Aparece como registro manual, com operador e justificativa. */
export async function decideCompletionManual(_p: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(manualCompletion, values, values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('manager', 'decideCompletionManual', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_completion_decide_manual', { p_org: org, p_order: d.order, p_version: d.version, p_decision: d.decision, p_declared_name: d.declared_name, p_justification: d.justification, p_note: d.note ?? null });
    if (error) return fail(dbMessage(error), undefined, values);
    refresh(d.order);
    return succeed(d.decision === 'accepted' ? 'Aceite registrado manualmente pela equipe. Agora a ordem pode ser encerrada.' : 'Contestação registrada. Reabra a ordem para corrigir o serviço.');
  });
}
