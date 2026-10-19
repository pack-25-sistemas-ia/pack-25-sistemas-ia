import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateOnly, FilterForm, FInput, Pagination, ProjectStatusPill } from '@/components/pj/bits';
import { listProjects, projectFiltersFrom } from '@/lib/pj/data';
import { pageCtx, projectKey } from '@/lib/pj/page';
import type { SearchParams } from '@/lib/pj/query';

export const metadata: Metadata = { title: 'Projetos arquivados' };

export default async function ArchivedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const f = projectFiltersFrom(sp);
  const { rows, total } = await listProjects(c, f, { archived: true });
  return (
    <>
      <PageHeader title="Arquivados" description="Projetos concluídos ou cancelados e arquivados: ficam somente para consulta e saem das listas padrão. O histórico é preservado." />
      <FilterForm clear="/arquivados"><FInput name="q" label="Buscar (número ou nome)" sp={sp} /></FilterForm>
      {rows.length === 0 ? <EmptyState title="Nenhum projeto arquivado." description="Quando um projeto concluído ou cancelado for arquivado, ele aparece aqui." /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted">{projectKey(c.settings.project_prefix, p.project_number)}</p>
              <Link href={`/projetos/${p.id}`} className="mt-0.5 block text-base font-semibold hover:underline">{p.name}</Link>
              <div className="mt-2"><ProjectStatusPill status={p.status} archived /></div>
              <p className="mt-3 text-xs text-muted">Período: <DateOnly value={p.start_date} /> a <DateOnly value={p.due_date} /></p>
            </li>
          ))}
        </ul>
      )}
      <Pagination base="/arquivados" sp={sp} page={f.page} total={total} size={12} />
    </>
  );
}
