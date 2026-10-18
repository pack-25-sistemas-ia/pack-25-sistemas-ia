import type { Metadata } from 'next';
import Link from 'next/link';
import { OsForm, SelectF, TextF, AreaF } from '@/components/os/fields';
import { Disclosure, FInput, FilterForm, FSelect, Pagination, Section, TD, TH, TableShell } from '@/components/os/bits';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { saveCustomer } from '@/lib/os/actions/registry';
import { pageCtx } from '@/lib/os/page';
import { PAGE_SIZE, one, pageFrom, safeSearch, type SearchParams } from '@/lib/os/query';

export const metadata: Metadata = { title: 'Clientes' };
type Row = { id: string; name: string; kind: string; email: string | null; phone: string | null; active: boolean };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const page = pageFrom(one(sp.page));
  const q = safeSearch(one(sp.q));
  const status = one(sp.status);
  let query = c.ctx.supabase.from('customers').select('id, name, kind, email, phone, active', { count: 'exact' }).eq('organization_id', c.org).order('name');
  if (q) query = query.ilike('name', `%${q}%`);
  if (status === 'inactive') query = query.eq('active', false); else if (status !== 'all') query = query.eq('active', true);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader title="Clientes" description="Pessoas e empresas atendidas. CPF/CNPJ e observações internas ficam em área restrita à gestão e nunca vão para o técnico, para o cliente nem para PDFs." />
      <div className="mb-5"><Disclosure summary="Cadastrar novo cliente" tone="primary">
        <OsForm action={saveCustomer} submit="Cadastrar cliente" reset className="grid gap-4 sm:grid-cols-4">
          <>
            <TextF name="name" label="Nome ou razão social" required max={160} span />
            <SelectF name="kind" label="Tipo" required def="person" opts={[{ value: 'person', label: 'Pessoa física' }, { value: 'company', label: 'Empresa' }]} />
            <TextF name="document" label="CPF ou CNPJ (opcional)" max={20} inputMode="numeric" hint="Os dígitos verificadores são conferidos." />
            <TextF name="phone" label="Telefone" max={20} inputMode="tel" />
            <TextF name="email" label="E-mail" type="email" max={200} span />
            <AreaF name="internal_notes" label="Observações internas (só a gestão vê)" max={2000} />
          </>
        </OsForm>
      </Disclosure></div>
      <FilterForm clear="/clientes">
        <FInput name="q" label="Buscar pelo nome" sp={sp} />
        <FSelect name="status" label="Situação" sp={sp} placeholder="Ativos" opts={[{ value: 'inactive', label: 'Inativos' }, { value: 'all', label: 'Todos' }]} />
      </FilterForm>
      <Section title={`Clientes${count !== null ? ` (${count})` : ''}`}>
        <TableShell caption="Clientes" empty={rows.length === 0} emptyText="Nenhum cliente encontrado.">
          <thead><tr><th className={TH}>Nome</th><th className={TH}>Tipo</th><th className={TH}>Telefone</th><th className={TH}>E-mail</th><th className={TH}>Situação</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border"><td className={TD}><Link className="font-medium underline underline-offset-2" href={`/clientes/${r.id}`}>{r.name}</Link></td><td className={TD}>{r.kind === 'company' ? 'Empresa' : 'Pessoa física'}</td><td className={TD}>{r.phone ?? '—'}</td><td className={TD}>{r.email ?? '—'}</td><td className={TD}>{r.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td></tr>)}</tbody>
        </TableShell>
        <Pagination base="/clientes" sp={sp} page={page} total={count ?? 0} />
      </Section>
    </>
  );
}
