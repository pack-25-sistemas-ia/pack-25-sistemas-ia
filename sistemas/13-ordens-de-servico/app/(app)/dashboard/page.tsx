import type { Metadata } from 'next';
import Link from 'next/link';
import { FInput, FilterForm, Kpi, Section, TD, TH, TableShell } from '@/components/os/bits';
import { Card, PageHeader } from '@/components/ui/primitives';
import { pageCtx } from '@/lib/os/page';
import { DEFINITIONS, formatDuration } from '@/lib/os/indicators';
import { formatCents } from '@/lib/os/money';
import { one, isIsoDate, type SearchParams } from '@/lib/os/query';
import { addDays, formatDateBR } from '@/lib/os/time';

export const metadata: Metadata = { title: 'Painel' };

type Dash = {
  period: { from: string; to: string; timezone: string }; profile: string; by_status: Record<string, number>; backlog: number; open: number; scheduled: number; in_progress: number; paused: number;
  awaiting_acceptance: number; closed_in_period: number; cancelled_in_period: number; unassigned: number; late: number; opened_in_period: number; completed_in_period: number; rework_in_period: number;
  cycle: { count: number; avg_seconds: number | null; median_seconds: number | null; basis: string };
  by_technician: Array<{ user_id: string; name: string; backlog: number; in_progress: number; completed_in_period: number }>;
  by_service: Array<{ service: string; orders: number }>;
  approved_value: { count: number; total_cents: number; basis: string } | null;
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx();
  const sp = await searchParams;
  if (!c.profile) {
    return (
      <>
        <PageHeader title="Painel" description={`Visão geral de ${c.ctx.membership.name}.`} />
        <Card><p className="text-sm">Seu acesso a esta empresa é de leitura do núcleo (equipe, privacidade). As <strong>ordens de serviço</strong> são operadas por proprietários, gestores e técnicos. Peça ao proprietário um papel operacional em «Pessoas e acessos».</p></Card>
      </>
    );
  }
  const fromQ = one(sp.from); const toQ = one(sp.to);
  const to = isIsoDate(toQ) ? toQ : c.today;
  const from = isIsoDate(fromQ) ? fromQ : addDays(to, -29);
  const { data, error } = await c.ctx.supabase.rpc('os_dashboard', { p_org: c.org, p_from: from, p_to: to });
  const d = (data ?? null) as Dash | null;
  const total = d ? Object.values(d.by_status).reduce((a, b) => a + b, 0) : 0;

  return (
    <>
      <PageHeader title="Painel" description={c.isTechnician ? 'Resumo das ordens atribuídas a você.' : `Visão geral de ${c.ctx.membership.name}. Números calculados do banco de dados, sem valores de exemplo.`} />
      <FilterForm clear="/dashboard">
        <FInput name="from" label="De" type="date" sp={{ from }} />
        <FInput name="to" label="Até" type="date" sp={{ to }} />
      </FilterForm>
      {error || !d ? <p role="alert" className="text-sm text-danger">Não foi possível carregar o painel agora. Verifique o período e tente de novo.</p> : (
        <>
          <p className="mb-4 text-xs text-muted">Período: {formatDateBR(d.period.from)} a {formatDateBR(d.period.to)} · base temporal: fuso {d.period.timezone}. «Backlog», «aguardando aceite» e «atrasadas» são a situação de AGORA; os demais cobrem o período.</p>
          {total === 0 ? <Card><p className="text-sm">Sem dados: ainda não há ordens de serviço{c.isTechnician ? ' atribuídas a você' : ''}. {c.isManager ? <>Comece em <Link className="underline" href="/ordens/nova">Nova ordem</Link>.</> : null}</p></Card> : null}
          <Section title="Situação atual">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Backlog" value={d.backlog} definition={DEFINITIONS.backlog} />
              <Kpi label="Abertas" value={d.open} />
              <Kpi label="Agendadas" value={d.scheduled} />
              <Kpi label="Em execução" value={d.in_progress} tone="success" />
              <Kpi label="Pausadas" value={d.paused} tone={d.paused ? 'warning' : 'neutral'} />
              <Kpi label="Concluídas aguardando aceite" value={d.awaiting_acceptance} tone={d.awaiting_acceptance ? 'warning' : 'neutral'} definition={DEFINITIONS.awaiting} />
              <Kpi label="Não atribuídas" value={d.unassigned} tone={d.unassigned ? 'warning' : 'neutral'} definition={DEFINITIONS.unassigned} />
              <Kpi label="Atrasadas (previsão)" value={d.late} tone={d.late ? 'danger' : 'neutral'} definition={DEFINITIONS.late} />
            </div>
          </Section>
          <Section title="No período">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Abertas no período" value={d.opened_in_period} />
              <Kpi label="Concluídas no período" value={d.completed_in_period} />
              <Kpi label="Encerradas no período" value={d.closed_in_period} />
              <Kpi label="Canceladas no período" value={d.cancelled_in_period} />
              <Kpi label="Tempo de ciclo (média)" value={d.cycle.count ? formatDuration(d.cycle.avg_seconds) : 'Sem dados'} definition={`${DEFINITIONS.cycle} Base: ${d.cycle.count} ordem(ns).`} />
              <Kpi label="Tempo de ciclo (mediana)" value={d.cycle.count ? formatDuration(d.cycle.median_seconds) : 'Sem dados'} />
              <Kpi label="Retrabalho (reaberturas)" value={d.rework_in_period} definition={DEFINITIONS.rework} />
              {d.approved_value ? <Kpi label="Valor de orçamentos aprovados" value={d.approved_value.count ? formatCents(d.approved_value.total_cents) : 'Sem dados'} definition={`${DEFINITIONS.approved} ${d.approved_value.count} ordem(ns).`} /> : null}
            </div>
          </Section>
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Por técnico" description="Situação atual do backlog e conclusões no período.">
              <TableShell caption="Distribuição por técnico" empty={d.by_technician.length === 0} emptyText="Sem dados: nenhuma ordem atribuída.">
                <thead><tr><th className={TH}>Técnico</th><th className={TH}>Backlog</th><th className={TH}>Em execução</th><th className={TH}>Concluídas no período</th></tr></thead>
                <tbody>{d.by_technician.map((t) => <tr key={t.user_id} className="border-t border-border"><td className={TD}>{t.name}</td><td className={TD}>{t.backlog}</td><td className={TD}>{t.in_progress}</td><td className={TD}>{t.completed_in_period}</td></tr>)}</tbody>
              </TableShell>
            </Section>
            <Section title="Por serviço" description="Ordens abertas no período, pelo serviço do orçamento vigente (ordens sem orçamento não entram).">
              <TableShell caption="Distribuição por serviço" empty={d.by_service.length === 0} emptyText="Sem dados: nenhum serviço orçado no período.">
                <thead><tr><th className={TH}>Serviço</th><th className={TH}>Ordens</th></tr></thead>
                <tbody>{d.by_service.map((s) => <tr key={s.service} className="border-t border-border"><td className={TD}>{s.service}</td><td className={TD}>{s.orders}</td></tr>)}</tbody>
              </TableShell>
            </Section>
          </div>
        </>
      )}
    </>
  );
}
