import type { Metadata } from 'next';
import { CheckF, OsForm, TextF } from '@/components/os/fields';
import { Disclosure, Section, TD, TH, TableShell } from '@/components/os/bits';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { savePart } from '@/lib/os/actions/registry';
import { formatCents } from '@/lib/os/money';
import { pageCtx } from '@/lib/os/page';

export const metadata: Metadata = { title: 'Peças' };
type Row = { id: string; code: string; name: string; unit: string; reference_price_cents: number; active: boolean };
const price = (c: number) => String(c / 100).replace('.', ',');

export default async function PartsPage() {
  const c = await pageCtx(['owner', 'manager']);
  const { data } = await c.ctx.supabase.from('part_catalog').select('id, code, name, unit, reference_price_cents, active').eq('organization_id', c.org).order('active', { ascending: false }).order('name');
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader title="Catálogo de peças" description="Peças usadas nos atendimentos. É um catálogo simples: o sistema registra o USO nas ordens, mas não controla saldo de estoque nem compras." />
      <div className="mb-5"><Disclosure summary="Cadastrar peça" tone="primary">
        <OsForm action={savePart} submit="Cadastrar peça" reset className="grid gap-4 sm:grid-cols-4">
          <>
            <TextF name="code" label="Código" required max={40} /><TextF name="name" label="Nome da peça" required max={120} span /><TextF name="unit" label="Unidade" def="un" required max={16} />
            <TextF name="price" label="Preço de referência (R$)" required inputMode="decimal" placeholder="0,00" />
          </>
        </OsForm>
      </Disclosure></div>
      <Section title={`Peças (${rows.length})`}>
        <TableShell caption="Peças" empty={rows.length === 0} emptyText="Nenhuma peça cadastrada ainda.">
          <thead><tr><th className={TH}>Código</th><th className={TH}>Peça</th><th className={TH}>Unidade</th><th className={TH}>Preço de referência</th><th className={TH}>Situação</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border"><td className={TD}>{r.code}</td><td className={TD}>{r.name}</td><td className={TD}>{r.unit}</td><td className={TD}>{formatCents(r.reference_price_cents)}</td><td className={TD}>{r.active ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</td></tr>)}</tbody>
        </TableShell>
        <div className="mt-3 grid gap-3">
          {rows.map((r) => (
            <Disclosure key={r.id} summary={`Editar: ${r.code} — ${r.name}`}>
              <OsForm action={savePart} submit="Salvar peça" reset={false} className="grid gap-4 sm:grid-cols-4">
                <>
                  <input type="hidden" name="id" value={r.id} />
                  <TextF name="code" label="Código" def={r.code} required max={40} /><TextF name="name" label="Nome da peça" def={r.name} required max={120} span /><TextF name="unit" label="Unidade" def={r.unit} required max={16} />
                  <TextF name="price" label="Preço de referência (R$)" def={price(r.reference_price_cents)} required inputMode="decimal" /><CheckF name="active" label="Ativa" def={r.active} />
                </>
              </OsForm>
            </Disclosure>
          ))}
        </div>
      </Section>
    </>
  );
}
