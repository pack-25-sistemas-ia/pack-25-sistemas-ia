import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/os/fields';
import { PriorityPill, StatusPill, Tabs } from '@/components/os/bits';
import { EvidenceTab } from '@/components/os/tab-evidence';
import { ExecutionTab } from '@/components/os/tab-execution';
import { HistoryTab } from '@/components/os/tab-history';
import { QuoteTab } from '@/components/os/tab-quote';
import { SummaryTab } from '@/components/os/tab-summary';
import { Alert, Badge } from '@/components/ui/primitives';
import { loadOrder, loadPeople } from '@/lib/os/data';
import { closeOrder, confirmDraft, resumeOrder, startOrder } from '@/lib/os/actions/orders';
import { numberText, pageCtx } from '@/lib/os/page';
import { one, uuidOrNull, type SearchParams } from '@/lib/os/query';
import { acceptanceState, availableActions, isLate, isManager, QUOTE_MODE_LABEL } from '@/lib/os/status';
import { formatInstant } from '@/lib/os/time';

export const metadata: Metadata = { title: 'Ordem de serviço' };
const TABS = ['resumo', 'execucao', 'orcamento', 'evidencias', 'historico'] as const;
type TabKey = (typeof TABS)[number];

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager', 'technician']);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const d = await loadOrder(c, id);
  if (!d) notFound();
  const sp = await searchParams;
  const q = one(sp.tab);
  const tab: TabKey = (TABS as readonly string[]).includes(q ?? '') ? (q as TabKey) : 'resumo';
  const o = d.order;
  const mgr = isManager(c.profile);
  const s = c.ctx.supabase;
  const people = await loadPeople(c);
  const me = c.userId;
  const actions = availableActions({ status: o.execution_status, profile: c.profile!, assignedToMe: o.assigned_technician_user_id === me });
  const props = { c, d, people, actions, me };
  const snap = d.snapshots[0];
  const late = isLate({ status: o.execution_status, scheduledEndAt: o.scheduled_end_at }, c.now);
  const acc = acceptanceState({ completionVersion: o.completion_version }, d.acceptances.map((a) => ({ completionVersion: a.completion_version, decision: a.decision })));
  const v = String(o.version);

  // dados auxiliares por aba (só o que a aba usa)
  const [customerBits, partsRes, servicesRes, templatesRes] = await Promise.all([
    tab === 'resumo' && mgr
      ? Promise.all([
          s.from('customer_addresses').select('id, label, street, number, city, state').eq('customer_id', o.customer_id).eq('active', true).order('label'),
          s.from('equipment').select('id, kind, brand, model').eq('customer_id', o.customer_id).eq('active', true).order('kind'),
          s.from('customer_contacts').select('id, name, phone').eq('customer_id', o.customer_id).eq('active', true).order('name'),
        ])
      : Promise.resolve(null),
    tab === 'execucao' || tab === 'orcamento' ? s.from('part_catalog').select('id, code, name, unit, reference_price_cents').eq('organization_id', c.org).eq('active', true).order('name') : Promise.resolve({ data: [] }),
    tab === 'orcamento' && mgr ? s.from('service_catalog').select('id, name, unit, reference_price_cents').eq('organization_id', c.org).eq('active', true).order('name') : Promise.resolve({ data: [] }),
    tab === 'execucao' && mgr ? s.from('checklist_templates').select('id, name').eq('organization_id', c.org).eq('active', true).order('name') : Promise.resolve({ data: [] }),
  ]);
  const customer = {
    addresses: ((customerBits?.[0].data ?? []) as Array<{ id: string; label: string; street: string; number: string | null; city: string; state: string }>),
    equipment: ((customerBits?.[1].data ?? []) as Array<{ id: string; kind: string; brand: string | null; model: string | null }>),
    contacts: ((customerBits?.[2].data ?? []) as Array<{ id: string; name: string; phone: string | null }>),
  };
  const extraRows = Math.min(40, Math.max(1, Number(one(sp.rows) ?? 4) || 4));

  // próximo passo contextual (uma ação principal por vez)
  let next: React.ReactNode = null;
  const st = o.execution_status;
  const tabLink = (t: TabKey, label: string) => <Link href={`/ordens/${o.id}?tab=${t}`} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">{label}</Link>;
  if (st === 'draft' && mgr) next = <ActionButton action={confirmDraft} fields={{ order: o.id, version: v }} label="Confirmar rascunho" variant="primary" />;
  else if ((st === 'open' || st === 'scheduled') && actions.includes('start')) {
    next = d.ready.exec_block ? <><span className="text-sm">{d.ready.exec_block}</span>{mgr ? tabLink('orcamento', 'Ir para o orçamento') : null}</> : <ActionButton action={startOrder} fields={{ order: o.id, version: v }} label="Iniciar execução" variant="primary" pending="Iniciando…" />;
  } else if (st === 'paused' && actions.includes('resume')) next = d.ready.exec_block ? <span className="text-sm">{d.ready.exec_block}</span> : <ActionButton action={resumeOrder} fields={{ order: o.id, version: v }} label="Retomar execução" variant="primary" pending="Retomando…" />;
  else if (st === 'in_progress' && actions.includes('complete')) next = tabLink('execucao', 'Checklist e conclusão');
  else if (st === 'completed' && mgr) next = acc === 'accepted' ? <ActionButton action={closeOrder} fields={{ order: o.id, version: v }} label="Encerrar ordem" variant="primary" pending="Encerrando…" /> : <><span className="text-sm">{acc === 'contested' ? 'Conclusão contestada pelo cliente: reabra para corrigir.' : 'Aguardando o aceite do cliente.'}</span>{tabLink('execucao', 'Ver conclusão e aceite')}</>;
  else if (st === 'completed') next = <span className="text-sm">Aguardando o aceite do cliente.</span>;

  return (
    <>
      <header className="mb-5 rounded-lg border border-border bg-card p-4 lg:sticky lg:top-0 lg:z-20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Link href={c.isTechnician ? '/minhas-ordens' : '/ordens'} className="underline underline-offset-2">{c.isTechnician ? 'Minhas ordens' : 'Ordens de serviço'}</Link> / <span>{numberText(c.settings.order_prefix, o.order_number)}</span>
            </p>
            <h1 className="mt-1 break-words text-xl font-semibold sm:text-2xl">{numberText(c.settings.order_prefix, o.order_number)} — {o.subject}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill status={st} /><PriorityPill priority={o.priority} />
              {late ? <Badge tone="danger">Atrasada (previsão)</Badge> : null}
              {o.completion_version > 0 ? <Badge tone={acc === 'accepted' ? 'success' : acc === 'contested' ? 'danger' : 'warning'}>{acc === 'accepted' ? `Conclusão v${o.completion_version} aceita` : acc === 'contested' ? `Conclusão v${o.completion_version} contestada` : `Conclusão v${o.completion_version}: aguardando aceite`}</Badge> : null}
              <Badge tone="neutral">{QUOTE_MODE_LABEL[o.quote_mode]}</Badge>
            </p>
            <p className="mt-2 text-sm text-muted">
              {snap?.customer_name ?? '—'}{snap?.customer_phone ? ` · ${snap.customer_phone}` : ''}
              {o.assigned_technician_user_id ? ` · Responsável: ${o.assigned_technician_user_id === me ? 'você' : d.names[o.assigned_technician_user_id] ?? 'técnico'}` : ' · Sem responsável'}
              {o.scheduled_start_at ? ` · ${formatInstant(Date.parse(o.scheduled_start_at), c.tz)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">{next}
            <a className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium" href={`/api/pdf/${o.id}/summary/0`}>PDF do resumo</a>
            {d.completions.length ? <a className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium" href={`/api/pdf/${o.id}/completion/${d.completions[0]!.completion_version}`}>PDF da conclusão</a> : null}
          </div>
        </div>
        {st === 'in_progress' && d.ready.checklist_problems.length === 0 && d.checklist.length > 0 ? null : null}
      </header>

      {d.ready.divergence && d.ready.divergence.some((x) => x.relevant) && (st === 'in_progress' || st === 'paused') ? <div className="mb-4"><Alert tone="warning">Há peças usadas acima do orçamento aprovado. Veja a aba «Execução» e, se houver cobrança adicional, a gestão cria uma nova versão do orçamento.</Alert></div> : null}

      <Tabs current={tab} items={[
        { key: 'resumo', label: 'Resumo', href: `/ordens/${o.id}` },
        { key: 'execucao', label: 'Execução', href: `/ordens/${o.id}?tab=execucao` },
        { key: 'orcamento', label: 'Orçamento', href: `/ordens/${o.id}?tab=orcamento` },
        { key: 'evidencias', label: 'Evidências e notas', href: `/ordens/${o.id}?tab=evidencias` },
        { key: 'historico', label: 'Histórico', href: `/ordens/${o.id}?tab=historico` },
      ]} />

      {tab === 'resumo' ? <SummaryTab {...props} customer={customer} /> : null}
      {tab === 'execucao' ? <ExecutionTab {...props} parts={((partsRes.data ?? []) as Array<{ id: string; code: string; name: string; unit: string }>)} templates={(templatesRes.data ?? []) as Array<{ id: string; name: string }>} /> : null}
      {tab === 'orcamento' ? <QuoteTab {...props} services={(servicesRes.data ?? []) as Array<{ id: string; name: string; unit: string; reference_price_cents: number }>} parts={(partsRes.data ?? []) as Array<{ id: string; code: string; name: string; unit: string; reference_price_cents: number }>} extraRows={extraRows} /> : null}
      {tab === 'evidencias' ? <EvidenceTab {...props} /> : null}
      {tab === 'historico' ? <HistoryTab {...props} /> : null}
    </>
  );
}
