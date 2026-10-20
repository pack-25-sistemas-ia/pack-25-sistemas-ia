import type { Metadata } from 'next';
import Link from 'next/link';
import { DateOnly, LifecyclePill, Pagination } from '@/components/ct/bits';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { contractFiltersFrom, listContracts } from '@/lib/ct/data';
import { contractKey } from '@/lib/ct/keys';
import { pageCtx } from '@/lib/ct/page';
import type { SearchParams } from '@/lib/ct/query';

export const metadata: Metadata = { title: 'Contratos arquivados' };

export default async function ArchivedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const f = contractFiltersFrom(sp, true);
  const { rows, total } = await listContracts(c, f);
  return (
    <>
      <PageHeader title="Arquivados" description="Contratos rescindidos ou encerrados e arquivados: ficam somente para consulta, com documentos e histórico preservados, e saem das listas padrão." />
      {rows.length === 0 ? <EmptyState title="Nenhum contrato arquivado." description="Quando um contrato rescindido ou encerrado for arquivado, ele aparece aqui." /> : (
        <ul className="grid gap-2" aria-label="Contratos arquivados">
          {rows.map((k) => (
            <li key={k.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-xs text-muted">{contractKey(c.settings.contract_prefix, k.contract_number)}</p>
              <Link href={`/contratos/${k.id}`} className="block text-base font-semibold hover:underline">{k.title}</Link>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><LifecyclePill status={k.lifecycle_status} archived /> {k.ended_on ? <>em <DateOnly value={k.ended_on} /></> : null}</p>
            </li>
          ))}
        </ul>
      )}
      <Pagination base="/arquivados" sp={sp} page={f.page} total={total} />
    </>
  );
}
