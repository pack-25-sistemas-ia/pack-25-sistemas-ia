import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/primitives';
import { DashboardView } from '@/components/pj/dashboard-view';
import { loadDashboard } from '@/lib/pj/data';
import { defaultPeriod } from '@/lib/pj/indicators';
import { pageCtx } from '@/lib/pj/page';
import { one, type SearchParams } from '@/lib/pj/query';
import { addDays, isDate } from '@/lib/pj/time';

export const metadata: Metadata = { title: 'Painel' };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const def = defaultPeriod(c.today, addDays);
  const f = one(sp.from); const t = one(sp.to);
  const from = f && isDate(f) ? f : def.from;
  const to = t && isDate(t) ? t : def.to;
  const dash = await loadDashboard(c, from, to);
  return (
    <>
      <PageHeader title="Painel" description={`Visão geral de ${c.ctx.membership.name}. Números calculados do banco, somente dos projetos que você pode acessar.`} />
      <DashboardView dash={dash} base="/dashboard" from={from} to={to} today={c.today} />
    </>
  );
}
