import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/pj/bits';
import { ProjectShell } from '@/components/pj/project-shell';
import { NewTaskForm, assignableOptions } from '@/components/pj/task-forms';
import { TaskFilters } from '@/components/pj/task-filters';
import { TaskTable } from '@/components/pj/task-table';
import { listTasks, loadProject, taskFiltersFrom } from '@/lib/pj/data';
import { pageCtx } from '@/lib/pj/page';
import type { SearchParams } from '@/lib/pj/query';
import { canEditRole, projectAllows } from '@/lib/pj/status';

export const metadata: Metadata = { title: 'Lista de tarefas' };

export default async function ProjectListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await pageCtx();
  const view = await loadProject(c, id);
  const f = taskFiltersFrom(sp, { project: id });
  f.project = id;
  const { rows, total } = await listTasks(c, f);
  const names = Object.fromEntries(view.people.map((p) => [p.user_id, p.name]));
  const canCreate = canEditRole(view.role) && projectAllows({ status: view.project.status, archived: view.project.archived_at !== null }, 'organize');
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' && v ? [[k, v] as [string, string]] : []))).toString();
  return (
    <ProjectShell c={c} view={view} current="lista">
      {canCreate ? <div className="mb-4"><NewTaskForm view={view} /></div> : null}
      <TaskFilters sp={sp} clear={`/projetos/${id}/lista`} showProject={false} people={assignableOptions(view)} labels={view.labels.map((l) => ({ value: l.id, label: l.name }))} />
      <TaskTable rows={rows} prefix={c.settings.project_prefix} today={c.today} names={names} showProject={false} />
      <Pagination base={`/projetos/${id}/lista`} sp={sp} page={f.page} total={total} />
      <p className="mt-3 text-sm"><Link className="underline underline-offset-2" href={`/api/exportar/tarefas?project=${id}${qs ? `&${qs}` : ''}`}>Exportar CSV desta lista (respeita filtros e acesso)</Link></p>
    </ProjectShell>
  );
}
