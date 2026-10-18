import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FlashHost } from '@/components/os/flash';
import { PublicCompletionForm, PublicQuoteForm } from '@/components/os/public-forms';
import { formatCents, formatQuantity, milliFromNumeric } from '@/lib/os/money';
import { isInvalidLink, limited, publicClient, requesterSource } from '@/lib/os/public-db';
import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status } from '@/lib/os/status';
import { isTokenShape } from '@/lib/os/token';
import { formatInstant } from '@/lib/os/time';
import { themeParam } from '@/lib/theme';
import { safePrimary } from '@/lib/utils';

// Página do CLIENTE: acompanhar a PRÓPRIA ordem pelo link secreto. Sem login e sem navegação para outras ordens ou clientes.
// Cabeçalhos (next.config.ts): Referrer-Policy no-referrer, noindex, no-store. Nenhum script de terceiros. O token é tratado como credencial: nunca vai para logs.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Acompanhamento do serviço', robots: { index: false, follow: false }, referrer: 'no-referrer' };

type Dto = {
  company: { name: string | null; primary_color: string; logo_path: string | null; timezone: string };
  order: { number_text: string; subject: string; status: Status; priority: Priority; scheduled_start_at: string | null; scheduled_end_at: string | null; started_at: string | null; completed_at: string | null; closed_at: string | null; created_at: string; quote_mode: 'required' | 'authorized'; completion_version: number };
  customer: { name: string; address: Record<string, string> | null; equipment: Record<string, string> | null };
  quote: null | {
    id: string; version_number: number; status: 'published' | 'approved' | 'rejected'; subtotal_cents: number; discount_cents: number; total_cents: number; valid_until: string; expired: boolean; terms: string | null; notes: string | null;
    items: Array<{ kind: 'service' | 'part'; description: string; unit: string; quantity: string | number; unit_price_cents: number; line_total_cents: number }>;
    decision: null | { decision: 'approved' | 'rejected'; decided_at: string; declared_name: string; channel: string }; text_to_accept: string | null; text_to_reject: string | null;
  };
  updates: Array<{ id: string; body: string; created_at: string }>;
  files: Array<{ id: string; category: string; name: string; content_type: string; size_bytes: number }>;
  completion: null | {
    version: number; summary: string; completed_at: string; current: boolean; parts: Array<{ description: string; unit: string; quantity: string | number }>; checklist: Array<{ group: string; label: string; not_applicable: boolean; answer: unknown }>;
    acceptance: { decision: 'pending' | 'accepted' | 'contested'; decided_at?: string; declared_name?: string; channel?: string } | null; can_decide: boolean; text_to_accept: string; text_to_contest: string;
  };
  expires_at: string;
};
const FRIENDLY: Record<Status, string> = {
  draft: 'Em preparação', open: 'Recebida — aguardando agendamento', scheduled: 'Atendimento agendado', in_progress: 'Serviço em execução', paused: 'Execução pausada temporariamente',
  completed: 'Serviço concluído — aguardando o seu aceite', closed: 'Ordem encerrada', cancelled: 'Ordem cancelada',
};
const CAT: Record<string, string> = { before: 'Antes', during: 'Durante', after: 'Depois', document: 'Documento' };
const addr = (a: Record<string, string> | null) => (a ? `${a.street ?? ''}${a.number ? `, ${a.number}` : ''}${a.complement ? ` — ${a.complement}` : ''} · ${a.district ? `${a.district}, ` : ''}${a.city ?? ''}/${a.state ?? ''}` : null);
const eq = (e: Record<string, string> | null) => (e ? [e.kind, e.brand, e.model].filter(Boolean).join(' · ') : null);
const ans = (a: unknown, na: boolean) => (na ? 'Não se aplica' : a === true ? 'Sim' : a === false ? 'Não' : a === null || a === undefined ? '—' : String(a));

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isTokenShape(token)) notFound();
  let source: string;
  try { source = (await requesterSource()).source; } catch {
    return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-xl font-semibold">Link temporariamente indisponível</h1><p className="mt-2 text-sm text-muted">Fale com a empresa para receber o acompanhamento por outro meio.</p></main>;
  }
  const rl = limited('view', source);
  if (!rl.allowed) return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-xl font-semibold">Muitas consultas em pouco tempo</h1><p className="mt-2 text-sm text-muted">Aguarde alguns minutos e abra o link de novo.</p></main>;
  const { data, error } = await publicClient().rpc('os_public_view', { p_token: token, p_source: source });
  if (error) {
    if (error.code === '54000') return <main className="mx-auto max-w-xl px-4 py-12"><h1 className="text-xl font-semibold">Muitas tentativas</h1><p className="mt-2 text-sm text-muted">Aguarde alguns minutos e tente de novo.</p></main>;
    notFound();
  }
  if (!data || isInvalidLink(data)) notFound(); // inválido, expirado ou revogado: a resposta é sempre a mesma
  const d = data as Dto;
  const tz = d.company.timezone;
  const dt = (v: string | null | undefined) => (v ? formatInstant(Date.parse(v), tz) : '—');
  const base = `/acompanhar/${token}`;
  const q = d.quote;

  return (
    <>
      <link rel="stylesheet" href={`/theme.css?c=${themeParam(safePrimary(d.company.primary_color))}`} precedence="theme" />
      <FlashHost />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
        <header className="mb-5 flex items-center gap-3">
          {d.company.logo_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${base}/logo`} alt="" width={40} height={40} className="size-10 shrink-0 rounded object-contain" />
          ) : null}
          <p className="text-base font-semibold">{d.company.name ?? 'Ordem de serviço'}</p>
        </header>
        <h1 className="text-2xl font-semibold">Acompanhamento — {d.order.number_text}</h1>
        <p className="mt-1 text-base">{d.order.subject}</p>
        <p role="status" className="mt-3 rounded-lg border border-border bg-card p-4 text-base font-medium">{FRIENDLY[d.order.status]}</p>

        <section aria-labelledby="resumo" className="mt-5 rounded-lg border border-border bg-card p-4">
          <h2 id="resumo" className="text-lg font-semibold">Resumo</h2>
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Cliente</dt><dd>{d.customer.name}</dd></div>
            <div><dt className="text-xs text-muted">Situação</dt><dd>{STATUS_LABEL[d.order.status]} · prioridade {PRIORITY_LABEL[d.order.priority].toLowerCase()}</dd></div>
            {addr(d.customer.address) ? <div className="sm:col-span-2"><dt className="text-xs text-muted">Local do atendimento</dt><dd>{addr(d.customer.address)}</dd></div> : null}
            {eq(d.customer.equipment) ? <div className="sm:col-span-2"><dt className="text-xs text-muted">Equipamento</dt><dd>{eq(d.customer.equipment)}</dd></div> : null}
            <div><dt className="text-xs text-muted">Aberta em</dt><dd>{dt(d.order.created_at)}</dd></div>
            <div><dt className="text-xs text-muted">Janela prevista</dt><dd>{d.order.scheduled_start_at ? `${dt(d.order.scheduled_start_at)} até ${dt(d.order.scheduled_end_at).split(' às ')[1] ?? ''}` : 'A combinar'}</dd></div>
            {d.order.completed_at ? <div><dt className="text-xs text-muted">Concluída em</dt><dd>{dt(d.order.completed_at)}</dd></div> : null}
          </dl>
        </section>

        {q ? (
          <section aria-labelledby="orcamento" className="mt-5 rounded-lg border border-border bg-card p-4">
            <h2 id="orcamento" className="text-lg font-semibold">Orçamento — versão {q.version_number}</h2>
            <p className="mt-1 text-sm text-muted">{q.status === 'approved' ? 'Aprovado' : q.status === 'rejected' ? 'Recusado' : q.expired ? 'Expirado' : 'Aguardando a sua decisão'} · válido até {dt(q.valid_until)}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[28rem] border-collapse text-sm">
                <caption className="sr-only">Itens do orçamento</caption>
                <thead><tr className="border-b border-border text-left text-xs text-muted"><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Qtd.</th><th className="py-1 pr-2 text-right">Unitário</th><th className="py-1 text-right">Total</th></tr></thead>
                <tbody>{q.items.map((it, i) => <tr key={i} className="border-b border-border"><td className="py-1 pr-2">{it.description}</td><td className="py-1 pr-2 whitespace-nowrap">{formatQuantity(milliFromNumeric(it.quantity))} {it.unit}</td><td className="py-1 pr-2 text-right tabular-nums">{formatCents(it.unit_price_cents)}</td><td className="py-1 text-right tabular-nums">{formatCents(it.line_total_cents)}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-right text-sm">Subtotal {formatCents(q.subtotal_cents)}{q.discount_cents ? ` · Desconto ${formatCents(q.discount_cents)}` : ''}</p>
            <p className="text-right text-lg font-semibold">Total {formatCents(q.total_cents)}</p>
            {q.terms ? <p className="mt-2 whitespace-pre-wrap text-xs text-muted">Condições: {q.terms}</p> : null}
            {q.decision ? (
              <p className="mt-3 rounded-md border border-border p-3 text-sm"><strong>{q.decision.decision === 'approved' ? 'Aprovado' : 'Recusado'}</strong> por {q.decision.declared_name} em {dt(q.decision.decided_at)}{q.decision.channel === 'staff_manual' ? ' (registro feito pela empresa)' : ''}.</p>
            ) : q.text_to_accept && q.text_to_reject ? (
              <div className="mt-4"><h3 className="mb-2 text-base font-semibold">Sua decisão</h3><PublicQuoteForm token={token} quoteId={q.id} textAccept={q.text_to_accept} textReject={q.text_to_reject} /></div>
            ) : q.status === 'published' ? <p className="mt-3 rounded-md border border-warning p-3 text-sm">Esta versão do orçamento expirou. Peça uma nova versão à empresa.</p> : null}
            <p className="mt-3 text-sm"><a className="underline underline-offset-2" href={`${base}/pdf/quote/${q.version_number}`}>Baixar o orçamento em PDF</a></p>
          </section>
        ) : null}

        {d.updates.length ? (
          <section aria-labelledby="atualizacoes" className="mt-5 rounded-lg border border-border bg-card p-4">
            <h2 id="atualizacoes" className="text-lg font-semibold">Atualizações da empresa</h2>
            <ol className="mt-2 grid gap-3">{d.updates.map((u) => <li key={u.id} className="border-l-2 border-primary pl-3"><p className="text-xs text-muted">{dt(u.created_at)}</p><p className="whitespace-pre-wrap text-sm">{u.body}</p></li>)}</ol>
          </section>
        ) : null}

        {d.files.length ? (
          <section aria-labelledby="arquivos" className="mt-5 rounded-lg border border-border bg-card p-4">
            <h2 id="arquivos" className="text-lg font-semibold">Fotos e documentos compartilhados</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {d.files.map((f) => (
                <li key={f.id} className="rounded-md border border-border p-2 text-sm">
                  {f.content_type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={`${base}/arquivo/${f.id}`}><img src={`${base}/arquivo/${f.id}`} alt={f.name} loading="lazy" className="mb-2 h-36 w-full rounded object-cover" /></a>
                  ) : null}
                  <a className="break-words underline underline-offset-2" href={`${base}/arquivo/${f.id}?download=1`}>{f.name}</a>
                  <p className="text-xs text-muted">{CAT[f.category] ?? f.category}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {d.completion ? (
          <section aria-labelledby="conclusao" className="mt-5 rounded-lg border border-border bg-card p-4">
            <h2 id="conclusao" className="text-lg font-semibold">Conclusão do serviço — versão {d.completion.version}{d.completion.current ? '' : ' (substituída)'}</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{d.completion.summary}</p>
            <p className="mt-1 text-xs text-muted">Concluída em {dt(d.completion.completed_at)}.</p>
            {d.completion.parts.length ? <p className="mt-2 text-sm"><strong>Peças utilizadas:</strong> {d.completion.parts.map((p) => `${p.description} (${formatQuantity(milliFromNumeric(p.quantity))} ${p.unit})`).join('; ')}</p> : null}
            {d.completion.checklist.length ? (
              <details className="mt-2 text-sm"><summary className="cursor-pointer font-medium">Verificações realizadas ({d.completion.checklist.length})</summary>
                <ul className="mt-2 grid gap-1">{d.completion.checklist.map((c, i) => <li key={i} className="flex justify-between gap-3 border-b border-border py-1"><span>{c.label}</span><span className="text-muted">{ans(c.answer, c.not_applicable)}</span></li>)}</ul>
              </details>
            ) : null}
            {d.completion.acceptance && d.completion.acceptance.decision !== 'pending' ? (
              <p className="mt-3 rounded-md border border-border p-3 text-sm"><strong>{d.completion.acceptance.decision === 'accepted' ? 'Conclusão aceita' : 'Conclusão contestada'}</strong> por {d.completion.acceptance.declared_name} em {dt(d.completion.acceptance.decided_at)}{d.completion.acceptance.channel === 'staff_manual' ? ' (registro feito pela empresa)' : ''}.</p>
            ) : null}
            {d.completion.can_decide ? (
              <div className="mt-4"><h3 className="mb-2 text-base font-semibold">O serviço ficou como combinado?</h3><PublicCompletionForm token={token} version={d.completion.version} textAccept={d.completion.text_to_accept} textContest={d.completion.text_to_contest} /></div>
            ) : null}
            <p className="mt-3 text-sm"><a className="underline underline-offset-2" href={`${base}/pdf/completion/${d.completion.version}`}>Baixar o relatório de conclusão em PDF</a></p>
          </section>
        ) : null}

        <p className="mt-6 text-sm"><a className="underline underline-offset-2" href={`${base}/pdf/summary/0`}>Baixar o resumo da ordem em PDF</a></p>
        <p className="mt-4 rounded-md bg-black/5 p-3 text-xs text-muted dark:bg-white/5">Este link é pessoal: guarde-o como uma senha e não o compartilhe. Ele expira em {dt(d.expires_at)}. O aceite e a aprovação feitos aqui são <strong>manifestações simples registradas pelo link</strong>, com seu nome, data e hora; não equivalem a assinatura digital certificada nem verificam sua identidade.</p>
      </main>
    </>
  );
}
