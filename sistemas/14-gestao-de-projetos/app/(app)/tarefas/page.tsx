import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { Pagination } from '@/components/pj/bits';
import { TaskFilters } from '@/components/pj/task-filters';
import { TaskTable } from '@/components/pj/task-table';
import { listProjects, listTasks, taskFiltersFrom } from '@/lib/pj/data';
import { pageCtx, projectKey } from '@/lib/pj/page';
import type { SearchParams } from '@/lib/pj/query';

export const metadata: Metadata = { title: 'Todas as tarefas' };

export default async function AllTasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const f = taskFiltersFrom(sp);
  const [{ rows, total }, projects, names] = await Promise.all([
    listTasks(c, f),
    listProjects(c, { page: 1 }, { archived: false }, 100),
    c.ctx.supabase.rpc('pj_people_names', { p_org: c.org }),
  ]);
  const nameMap = (names.data ?? {}) as Record<string, string>;
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' && v ? [[k, v] as [string, string]] : []))).toString();
  return (
    <>
      <PageHeader title="Todas as tarefas" description="Somente tarefas de projetos que você pode acessar. Filtros, ordenação e páginas são aplicados no servidor." />
      <TaskFilters sp={sp} clear="/tarefas" projects={projects.rows.map((p) => ({ value: p.id, label: `${projectKey(c.settings.project_prefix, p.project_number)} · ${p.name}` }))}
        people={Object.entries(nameMap).map(([value, label]) => ({ value, label }))} />
      <TaskTable rows={rows} prefix={c.settings.project_prefix} today={c.today} names={nameMap} />
      <Pagination base="/tarefas" sp={sp} page={f.page} total={total} />
      <p className="mt-3 text-sm"><Link className="underline underline-offset-2" href={`/api/exportar/tarefas${qs ? `?${qs}` : ''}`}>Exportar CSV desta lista (respeita filtros e acesso)</Link></p>
    </>
  );
}
