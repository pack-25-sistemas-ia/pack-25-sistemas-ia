'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { logEvent } from '@/lib/log';
import { dbMessage, formObject, parse } from '../action-kit';
import { isInvalidLink, limited, publicClient, requesterSource } from '../public-db';
import { TOKEN_RE } from '../token';
import { optText, text, uuid } from '../validation';

// Decisões do CLIENTE pelo link (sem sessão). Falam com o banco como `anon`, que só alcança funções os_public_*; o banco revalida token, versão vigente e limites.
// O texto aceito é montado NO BANCO; o navegador só diz «aprovar/recusar» e informa o nome. O token nunca é registrado em log.
const base = z.object({ token: z.string().regex(TOKEN_RE, 'Link inválido.'), name: text(2, 120, 'Seu nome'), note: optText(1000, 'Observação'), confirm: z.literal('on', { message: 'Marque a confirmação para continuar.' }) });

async function guard(token: string): Promise<{ ok: true; source: string; userAgent: string } | { ok: false; state: ActionState }> {
  let who;
  try { who = await requesterSource(); } catch (e) {
    logEvent('error', 'os_public_misconfigured', { name: e instanceof Error ? e.name : 'unknown' });
    return { ok: false, state: fail('Este link está temporariamente indisponível. Fale com a empresa.') };
  }
  const rl = limited('decide', who.source);
  if (!rl.allowed) return { ok: false, state: fail(`Muitas tentativas em pouco tempo. Aguarde ${Math.ceil(rl.retryAfterSeconds / 60)} min e tente de novo.`) };
  void token;
  return { ok: true, source: who.source, userAgent: who.userAgent };
}

export async function publicQuoteDecide(_prev: ActionState, fd: FormData): Promise<ActionState & { redirectTo?: string }> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(base.extend({ quote: uuid(), decision: z.enum(['approved', 'rejected']) }), formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  const g = await guard(d.token);
  if (!g.ok) return g.state;
  const { data, error } = await publicClient().rpc('os_public_quote_decide', { p_token: d.token, p_source: g.source, p_quote: d.quote, p_decision: d.decision, p_name: d.name, p_note: d.note ?? null, p_evidence: { user_agent: g.userAgent } });
  if (error) return fail(dbMessage(error), undefined, values);
  if (isInvalidLink(data)) return fail('Este link é inválido ou expirou. Peça um novo à empresa.');
  revalidatePath(`/acompanhar/${d.token}`);
  return succeed(d.decision === 'approved' ? 'Orçamento aprovado. Obrigado! A empresa foi avisada.' : 'Orçamento recusado. A empresa vai entrar em contato.');
}

export async function publicCompletionDecide(_prev: ActionState, fd: FormData): Promise<ActionState & { redirectTo?: string }> {
  const values = formObject(fd);
  delete values.idem;
  const p = parse(base.extend({ completion: z.coerce.number().int().min(1).max(1000), decision: z.enum(['accepted', 'contested']) }), formObject(fd), values);
  if (!p.ok) return p.state;
  const d = p.data;
  if (d.decision === 'contested' && (d.note ?? '').length < 5) return fail('Conte o que precisa ser revisto.', { note: ['Conte o que precisa ser revisto (mínimo 5 caracteres).'] }, values);
  const g = await guard(d.token);
  if (!g.ok) return g.state;
  const { data, error } = await publicClient().rpc('os_public_completion_decide', { p_token: d.token, p_source: g.source, p_completion_version: d.completion, p_decision: d.decision, p_name: d.name, p_note: d.note ?? null, p_evidence: { user_agent: g.userAgent } });
  if (error) return fail(dbMessage(error), undefined, values);
  if (isInvalidLink(data)) return fail('Este link é inválido ou expirou. Peça um novo à empresa.');
  revalidatePath(`/acompanhar/${d.token}`);
  return succeed(d.decision === 'accepted' ? 'Conclusão aceita. Obrigado!' : 'Contestação enviada. A empresa vai revisar o serviço.');
}
