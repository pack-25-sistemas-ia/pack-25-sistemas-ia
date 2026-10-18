import type { Metadata } from 'next';
import { AreaF, CheckF, OsForm, TextF } from '@/components/os/fields';
import { Disclosure, Section, TD, TH, TableShell } from '@/components/os/bits';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { saveService } from '@/lib/os/actions/registry';
import { formatCents } from '@/lib/os/money';
import { pageCtx } from '@/lib/os/page';

export const metadata: Metadata = { title: 'Serviços' };
type Row = { id: string; name: string; description: string | null; unit: string; reference_price_cents: number; active: boolean };
const price = (c: number) => String(c / 100).replace('.', ',');

export default async function ServicesPage() {
  const c = await pageCtx(['owner', 'manager']);
  const { data } = await c.ctx.supabase.from('service_catalog').select('id, name, description, unit, reference_price_cents, active').eq('organization_id', c.org).order('active', { ascending: false }).order('name');
  const rows = (data ?? []) as Row[];
  return (
    <>
      <PageHeader title="Catálogo de serviços" description="Serviços que a empresa executa. O preço é de REFERÊNCIA: cada orçamento guarda o próprio preço e não muda se o catálogo mudar depois." />
      <div className="mb-5"><Disclosure summary="Cadastrar serviço" tone="primary">
        <OsForm action={saveService} submit="Cadastrar serviço" reset className="grid gap-4 sm:grid-cols-4">
          <>
            <TextF name="name" label="Nome do serviço" required max={120} span /><TextF name="unit" label="Unidade" def="un" required max={16} /><TextF name="price" label="Preço de referência (R$)" required inputMode="decimal" placeholder="0,00" />
            <AreaF name="description" label="Descrição (opcional)" max={500} />
          </>
        </OsForm>
      </Disclosure></div>
      <Section title={`Serviços (${rows.length})`}>
        <TableShell caption="Serviços" empty={rows.length === 0} emptyText="Nenhum serviço cadastrado ainda.">
          <thead><tr><th className={TH}>Serviço</th><th className={TH}>Unidade</th><th className={TH}>Preço de referência</th><th className={TH}>Situação</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border"><td className={TD}>{r.name}{r.description ? <span className="block text-xs text-muted">{r.description}</span> : null}</td><td className={TD}>{r.unit}</td><td className={TD}>{formatCents(r.reference_price_cents)}</td><td className={TD}>{r.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td></tr>)}</tbody>
        </TableShell>
        <div className="mt-3 grid gap-3">
          {rows.map((r) => (
            <Disclosure key={r.id} summary={`Editar: ${r.name}`}>
              <OsForm action={saveService} submit="Salvar serviço" reset={false} className="grid gap-4 sm:grid-cols-4">
                <>
                  <input type="hidden" name="id" value={r.id} />
                  <TextF name="name" label="Nome do serviço" def={r.name} required max={120} span /><TextF name="unit" label="Unidade" def={r.unit} required max={16} /><TextF name="price" label="Preço de referência (R$)" def={price(r.reference_price_cents)} required inputMode="decimal" />
                  <AreaF name="description" label="Descrição" def={r.description} max={500} /><CheckF name="active" label="Ativo" def={r.active} />
                </>
              </OsForm>
            </Disclosure>
          ))}
        </div>
      </Section>
    </>
  );
}
