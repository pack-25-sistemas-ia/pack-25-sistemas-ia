import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateOnly, FilterForm, FInput, FSelect, Pagination, ProjectStatusPill } from '@/components/pj/bits';
import { listProjects, loadDashboard, projectFiltersFrom } from '@/lib/pj/data';
import { pageCtx, projectKey } from '@/lib/pj/page';
import type { SearchParams } from '@/lib/pj/query';
import { PROJECT_STATUS_LABEL, PROJECT_STATUSES } from '@/lib/pj/status';
import { percentText } from '@/lib/pj/indicators';

export const metadata: Metadata = { title: 'Meus projetos' };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const f = projectFiltersFrom(sp);
  const [{ rows, total }, dash] = await Promise.all([listProjects(c, f, { archived: false }), loadDashboard(c, c.today, c.today)]);
  const progress = new Map((dash?.progress ?? []).map((p) => [p.project_id, p]));
  return (
    <>
      <PageHeader title="Meus projetos" description="Projetos em que você participa (a gestão enxerga todos). Os arquivados ficam em «Arquivados».">
        {c.isManager ? <Link href="/projetos/novo" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo projeto</Link> : null}
      </PageHeader>
      <FilterForm clear="/projetos">
        <FInput name="q" label="Buscar (número ou nome)" sp={sp} />
        <FSelect name="status" label="Status" sp={sp} opts={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABEL[s] }))} />
      </FilterForm>
      {rows.length === 0 ? (
        <EmptyState title={f.q || f.status ? 'Nenhum projeto com esses filtros.' : 'Você ainda não participa de nenhum projeto.'} description={c.isManager ? 'Crie o primeiro projeto para começar a organizar o trabalho da equipe.' : 'Peça a quem lidera para adicionar você a um projeto.'}>
          {c.isManager ? <Link href="/projetos/novo" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Criar projeto</Link> : null}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const pr = progress.get(p.id);
            return (
              <li key={p.id} className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs text-muted">{projectKey(c.settings.project_prefix, p.project_number)}</p>
                <Link href={`/projetos/${p.id}`} className="mt-0.5 block text-base font-semibold hover:underline">{p.name}</Link>
                <div className="mt-2"><ProjectStatusPill status={p.status} archived={p.archived_at !== null} /></div>
                <p className="mt-3 text-xs text-muted">Período: <DateOnly value={p.start_date} /> a <DateOnly value={p.due_date} /></p>
                <p className="mt-2 text-sm">Progresso: <strong>{pr ? percentText(pr.done, pr.total) : p.status === 'cancelled' ? '—' : 'Sem tarefas'}</strong>{pr && pr.total > 0 ? <span className="text-muted"> ({pr.done} de {pr.total} tarefas)</span> : null}</p>
              </li>
            );
          })}
        </ul>
      )}
      <Pagination base="/projetos" sp={sp} page={f.page} total={total} size={12} />
    </>
  );
}
