import type { Metadata } from 'next';
import Link from 'next/link';
import { DateOnly, FInput, FSelect, FilterForm, LifecyclePill, Pagination, SituationPill, TD, TH, TableShell } from '@/components/ct/bits';
import { PageHeader } from '@/components/ui/primitives';
import { contractFiltersFrom, currentValue, listCategories, listContracts, peopleNames } from '@/lib/ct/data';
import { contractKey } from '@/lib/ct/keys';
import { BILLING_LABEL, formatBRL, isBillingBasis } from '@/lib/ct/money';
import { pageCtx } from '@/lib/ct/page';
import type { SearchParams } from '@/lib/ct/query';
import { LIFECYCLES, LIFECYCLE_LABEL, situationOf } from '@/lib/ct/status';

export const metadata: Metadata = { title: 'Contratos' };

const TERMS = [{ value: 'ending30', label: 'Fim em até 30 dias' }, { value: 'ending60', label: 'Fim em até 60 dias' }, { value: 'ending90', label: 'Fim em até 90 dias' }, { value: 'ended', label: 'Fim de vigência atingido' }, { value: 'indefinite', label: 'Prazo indeterminado' }];

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const f = contractFiltersFrom(sp);
  const [list, cats, names] = await Promise.all([listContracts(c, f), listCategories(c), peopleNames(c)]);
  const who = Object.entries(names).map(([id, name]) => ({ value: id, label: name }));
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === 'string' && k !== 'page') as Array<[string, string]>).toString();
  return (
    <>
      <PageHeader title="Contratos" description="Registro administrativo de contratos, vigência, prazos e valores. O sistema não faz análise jurídica nem atesta assinatura.">
        {c.isManager ? <Link href="/contratos/novo" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Novo contrato</Link> : null}
        <a href={`/api/exportar/contratos?${qs}`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">Exportar CSV</a>
      </PageHeader>

      <FilterForm clear="/contratos">
        <FInput name="q" label="Buscar (título ou número)" sp={sp} />
        <FSelect name="status" label="Status" sp={sp} opts={LIFECYCLES.map((s) => ({ value: s, label: LIFECYCLE_LABEL[s] }))} />
        <FSelect name="term" label="Vigência" sp={sp} opts={TERMS} />
        <FSelect name="category" label="Categoria" sp={sp} opts={cats.map((x) => ({ value: x.id, label: x.name }))} />
        <FSelect name="responsible" label="Responsável" sp={sp} opts={who} />
      </FilterForm>

      <div className="hidden md:block">
        <TableShell caption="Contratos" empty={list.rows.length === 0} emptyText={c.isManager ? 'Nenhum contrato encontrado. Cadastre as partes e crie o primeiro contrato.' : 'Nenhum contrato encontrado. Você vê apenas os contratos a que foi vinculado.'}>
          <thead><tr><th className={TH}>Contrato</th><th className={TH}>Partes</th><th className={TH}>Status</th><th className={TH}>Vigência</th><th className={TH}>Responsável</th><th className={TH}>Valor vigente</th></tr></thead>
          <tbody className="divide-y divide-border">
            {list.rows.map((k) => {
              const v = currentValue(list.values.get(k.id) ?? [], c.today);
              const open = k.lifecycle_status === 'draft' || k.lifecycle_status === 'active';
              return (
                <tr key={k.id}>
                  <td className={TD}><span className="block text-xs text-muted">{contractKey(c.settings.contract_prefix, k.contract_number)}</span><Link className="font-medium underline-offset-2 hover:underline" href={`/contratos/${k.id}`}>{k.title}</Link></td>
                  <td className={TD}>{(list.parties.get(k.id) ?? []).join(', ') || '—'}</td>
                  <td className={TD}><span className="flex flex-wrap gap-1"><LifecyclePill status={k.lifecycle_status} archived={!!k.archived_at} />{open ? <SituationPill situation={situationOf({ start: k.start_date, end: k.end_date, indefinite: k.indefinite_term }, c.today, c.settings.near_end_days)} /> : null}</span></td>
                  <td className={TD}><DateOnly value={k.start_date} /> a {k.indefinite_term ? 'prazo indeterminado' : <DateOnly value={k.end_date} />}</td>
                  <td className={TD}>{k.responsible_user_id ? names[k.responsible_user_id] ?? 'Pessoa' : <span className="text-muted">Sem responsável</span>}</td>
                  <td className={TD}>{v ? <>{formatBRL(v.amount_cents)} <span className="text-xs text-muted">{isBillingBasis(v.billing_basis) ? BILLING_LABEL[v.billing_basis] : ''}</span></> : <span className="text-muted">Sem dados</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </div>

      <ul className="grid gap-3 md:hidden" aria-label="Contratos">
        {list.rows.length === 0 ? <li className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum contrato encontrado.</li> : null}
        {list.rows.map((k) => {
          const v = currentValue(list.values.get(k.id) ?? [], c.today);
          const open = k.lifecycle_status === 'draft' || k.lifecycle_status === 'active';
          return (
            <li key={k.id} className="rounded-lg border border-border bg-card p-3">
              <p className="text-xs text-muted">{contractKey(c.settings.contract_prefix, k.contract_number)}</p>
              <Link className="text-base font-semibold hover:underline" href={`/contratos/${k.id}`}>{k.title}</Link>
              <p className="mt-1 flex flex-wrap gap-1"><LifecyclePill status={k.lifecycle_status} archived={!!k.archived_at} />{open ? <SituationPill situation={situationOf({ start: k.start_date, end: k.end_date, indefinite: k.indefinite_term }, c.today, c.settings.near_end_days)} /> : null}</p>
              <p className="mt-2 text-sm">{(list.parties.get(k.id) ?? []).join(', ') || '—'}</p>
              <p className="text-sm text-muted">Fim: {k.indefinite_term ? 'prazo indeterminado' : <DateOnly value={k.end_date} />} · {v ? formatBRL(v.amount_cents) : 'Sem dados'}</p>
            </li>
          );
        })}
      </ul>
      <Pagination base="/contratos" sp={sp} page={f.page} total={list.total} />
    </>
  );
}
