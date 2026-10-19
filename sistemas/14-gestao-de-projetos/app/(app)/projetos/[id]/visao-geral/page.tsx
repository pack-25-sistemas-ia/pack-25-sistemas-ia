import type { Metadata } from 'next';
import { ProjectShell } from '@/components/pj/project-shell';
import { DashboardView } from '@/components/pj/dashboard-view';
import { loadDashboard, loadProject } from '@/lib/pj/data';
import { pageCtx } from '@/lib/pj/page';
import { addDays } from '@/lib/pj/time';
import { defaultPeriod } from '@/lib/pj/indicators';
import { isDate } from '@/lib/pj/time';
import { one, type SearchParams } from '@/lib/pj/query';

export const metadata: Metadata = { title: 'Visão geral do projeto' };

export default async function ProjectOverviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await pageCtx();
  const view = await loadProject(c, id);
  const def = defaultPeriod(c.today, addDays);
  const from = one(sp.from) && isDate(one(sp.from)!) ? one(sp.from)! : def.from;
  const to = one(sp.to) && isDate(one(sp.to)!) ? one(sp.to)! : def.to;
  const dash = await loadDashboard(c, from, to, id);
  return (
    <ProjectShell c={c} view={view} current="visao-geral">
      <DashboardView dash={dash} base={`/projetos/${id}/visao-geral`} from={from} to={to} today={c.today} />
    </ProjectShell>
  );
}
