import type { Metadata } from 'next';
import Link from 'next/link';
import { FInput, FilterForm, FSelect, Pagination, TD, TH, TableShell } from '@/components/os/bits';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { pageCtx } from '@/lib/os/page';
import { PAGE_SIZE, one, pageFrom, safeSearch, type SearchParams } from '@/lib/os/query';

export const metadata: Metadata = { title: 'Equipamentos' };
type Row = { id: string; kind: string; brand: string | null; model: string | null; serial_number: string | null; active: boolean; customer_id: string; customers: { name: string } | { name: string }[] | null };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const page = pageFrom(one(sp.page));
  const q = safeSearch(one(sp.q));
  let query = c.ctx.supabase.from('equipment').select('id, kind, brand, model, serial_number, active, customer_id, customers(name)', { count: 'exact' }).eq('organization_id', c.org).order('kind');
  if (q) query = query.or(`kind.ilike.%${q}%,brand.ilike.%${q}%,model.ilike.%${q}%,serial_number.ilike.%${q}%`);
  if (one(sp.status) === 'inactive') query = query.eq('active', false);
  else if (one(sp.status) !== 'all') query = query.eq('active', true);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as Row[];
  const cn = (r: Row) => (Array.isArray(r.customers) ? r.customers[0]?.name : r.customers?.name) ?? '—';
  return (
    <>
      <PageHeader title="Equipamentos" description="Equipamentos dos clientes (opcional em cada ordem). Para cadastrar ou editar, abra a ficha do cliente." />
      <FilterForm clear="/equipamentos">
        <FInput name="q" label="Buscar (tipo, marca, modelo ou série)" sp={sp} />
        <FSelect name="status" label="Situação" sp={sp} placeholder="Ativos" opts={[{ value: 'inactive', label: 'Inativos' }, { value: 'all', label: 'Todos' }]} />
      </FilterForm>
      <TableShell caption="Equipamentos" empty={rows.length === 0} emptyText="Nenhum equipamento encontrado.">
        <thead><tr><th className={TH}>Tipo</th><th className={TH}>Marca / modelo</th><th className={TH}>Série</th><th className={TH}>Cliente</th><th className={TH}>Situação</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border"><td className={TD}>{r.kind}</td><td className={TD}>{[r.brand, r.model].filter(Boolean).join(' · ') || '—'}</td><td className={TD}>{r.serial_number ?? '—'}</td><td className={TD}><Link className="underline underline-offset-2" href={`/clientes/${r.customer_id}`}>{cn(r)}</Link></td><td className={TD}>{r.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td></tr>)}</tbody>
      </TableShell>
      <Pagination base="/equipamentos" sp={sp} page={page} total={count ?? 0} />
    </>
  );
}
