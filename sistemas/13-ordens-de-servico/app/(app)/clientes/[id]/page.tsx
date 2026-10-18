import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AreaF, CheckF, OsForm, SelectF, TextF } from '@/components/os/fields';
import { Disclosure, Section, TD, TH, TableShell } from '@/components/os/bits';
import { OrderList } from '@/components/os/order-list';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { saveAddress, saveContact, saveCustomer, saveEquipment } from '@/lib/os/actions/registry';
import { listOrders, loadPeople } from '@/lib/os/data';
import { pageCtx } from '@/lib/os/page';
import { uuidOrNull } from '@/lib/os/query';

export const metadata: Metadata = { title: 'Cliente' };
type Cust = { id: string; name: string; kind: string; email: string | null; phone: string | null; active: boolean };
type Priv = { document: string | null; internal_notes: string | null };
type Addr = { id: string; label: string; street: string; number: string | null; complement: string | null; district: string | null; city: string; state: string; postal_code: string | null; reference: string | null; is_default: boolean; active: boolean };
type Contact = { id: string; name: string; role_label: string | null; phone: string | null; email: string | null; is_primary: boolean; active: boolean };
type Equip = { id: string; kind: string; brand: string | null; model: string | null; serial_number: string | null; notes: string | null; active: boolean };

const maskDoc = (d: string | null): string => (!d ? '' : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'));

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx(['owner', 'manager']);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const s = c.ctx.supabase;
  const [{ data: cust }, { data: priv }, { data: addrs }, { data: conts }, { data: eqs }, orders, people] = await Promise.all([
    s.from('customers').select('id, name, kind, email, phone, active').eq('id', id).eq('organization_id', c.org).maybeSingle(),
    s.from('customer_private').select('document, internal_notes').eq('customer_id', id).maybeSingle(),
    s.from('customer_addresses').select('id, label, street, number, complement, district, city, state, postal_code, reference, is_default, active').eq('customer_id', id).order('is_default', { ascending: false }).order('label'),
    s.from('customer_contacts').select('id, name, role_label, phone, email, is_primary, active').eq('customer_id', id).order('is_primary', { ascending: false }).order('name'),
    s.from('equipment').select('id, kind, brand, model, serial_number, notes, active').eq('customer_id', id).order('kind'),
    listOrders(c, { customer: id, page: 1 }, 15),
    loadPeople(c),
  ]);
  if (!cust) notFound();
  const k = cust as Cust;
  const p = (priv ?? { document: null, internal_notes: null }) as Priv;
  const addresses = (addrs ?? []) as Addr[]; const contacts = (conts ?? []) as Contact[]; const equipment = (eqs ?? []) as Equip[];
  const names = Object.fromEntries(people.map((x) => [x.user_id, x.name]));

  return (
    <>
      <PageHeader title={k.name} description={`${k.kind === 'company' ? 'Empresa' : 'Pessoa física'}${k.active ? '' : ' · INATIVO'}`}>
        <Link href={`/ordens/nova?customer=${k.id}`} className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Nova ordem para este cliente</Link>
      </PageHeader>

      <Section title="Dados do cliente" description="Mudar o cadastro não altera ordens já abertas nem documentos aprovados: eles guardam os dados da época.">
        <Card>
          <OsForm action={saveCustomer} submit="Salvar cliente" reset={false} className="grid gap-4 sm:grid-cols-4">
            <>
              <input type="hidden" name="id" value={k.id} />
              <TextF name="name" label="Nome ou razão social" def={k.name} required max={160} span />
              <SelectF name="kind" label="Tipo" def={k.kind} required opts={[{ value: 'person', label: 'Pessoa física' }, { value: 'company', label: 'Empresa' }]} />
              <TextF name="document" label="CPF ou CNPJ" def={maskDoc(p.document)} max={20} inputMode="numeric" />
              <TextF name="phone" label="Telefone" def={k.phone} max={20} inputMode="tel" />
              <TextF name="email" label="E-mail" def={k.email} type="email" max={200} span />
              <AreaF name="internal_notes" label="Observações internas (só a gestão vê)" def={p.internal_notes} max={2000} />
              <CheckF name="active" label="Cliente ativo" def={k.active} />
            </>
          </OsForm>
        </Card>
      </Section>

      <Section title="Contatos">
        <TableShell caption="Contatos do cliente" empty={contacts.length === 0} emptyText="Nenhum contato cadastrado.">
          <thead><tr><th className={TH}>Nome</th><th className={TH}>Função</th><th className={TH}>Telefone</th><th className={TH}>E-mail</th><th className={TH}>Situação</th></tr></thead>
          <tbody>{contacts.map((x) => <tr key={x.id} className="border-t border-border"><td className={TD}>{x.name}{x.is_primary ? <> <Badge tone="success">principal</Badge></> : null}</td><td className={TD}>{x.role_label ?? '—'}</td><td className={TD}>{x.phone ?? '—'}</td><td className={TD}>{x.email ?? '—'}</td><td className={TD}>{x.active ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody>
        </TableShell>
        <div className="mt-3 grid gap-3">
          {contacts.map((x) => (
            <Disclosure key={x.id} summary={`Editar contato: ${x.name}`}>
              <OsForm action={saveContact} submit="Salvar contato" reset={false} className="grid gap-4 sm:grid-cols-4">
                <>
                  <input type="hidden" name="customer_id" value={k.id} /><input type="hidden" name="id" value={x.id} />
                  <TextF name="name" label="Nome" def={x.name} required max={120} span /><TextF name="role_label" label="Função" def={x.role_label} max={60} />
                  <TextF name="phone" label="Telefone" def={x.phone} max={20} /><TextF name="email" label="E-mail" def={x.email} max={200} span />
                  <CheckF name="is_primary" label="Contato principal" def={x.is_primary} /><CheckF name="active" label="Ativo" def={x.active} />
                </>
              </OsForm>
            </Disclosure>
          ))}
          <Disclosure summary="Adicionar contato">
            <OsForm action={saveContact} submit="Adicionar contato" reset className="grid gap-4 sm:grid-cols-4">
              <>
                <input type="hidden" name="customer_id" value={k.id} />
                <TextF name="name" label="Nome" required max={120} span /><TextF name="role_label" label="Função" max={60} />
                <TextF name="phone" label="Telefone" max={20} /><TextF name="email" label="E-mail" max={200} span /><CheckF name="is_primary" label="Contato principal" />
              </>
            </OsForm>
          </Disclosure>
        </div>
      </Section>

      <Section title="Endereços de atendimento">
        <TableShell caption="Endereços do cliente" empty={addresses.length === 0} emptyText="Nenhum endereço cadastrado.">
          <thead><tr><th className={TH}>Identificação</th><th className={TH}>Endereço</th><th className={TH}>Cidade/UF</th><th className={TH}>Situação</th></tr></thead>
          <tbody>{addresses.map((a) => <tr key={a.id} className="border-t border-border"><td className={TD}>{a.label}{a.is_default ? <> <Badge tone="success">padrão</Badge></> : null}</td><td className={TD}>{a.street}{a.number ? `, ${a.number}` : ''}{a.complement ? ` — ${a.complement}` : ''}{a.reference ? ` (ref.: ${a.reference})` : ''}</td><td className={TD}>{a.city}/{a.state}</td><td className={TD}>{a.active ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody>
        </TableShell>
        <div className="mt-3 grid gap-3">
          {addresses.map((a) => (
            <Disclosure key={a.id} summary={`Editar endereço: ${a.label}`}>
              <OsForm action={saveAddress} submit="Salvar endereço" reset={false} className="grid gap-4 sm:grid-cols-4">
                <>
                  <input type="hidden" name="customer_id" value={k.id} /><input type="hidden" name="id" value={a.id} />
                  <TextF name="label" label="Identificação" def={a.label} required max={60} /><TextF name="street" label="Logradouro" def={a.street} required max={160} span /><TextF name="number" label="Número" def={a.number} max={20} />
                  <TextF name="complement" label="Complemento" def={a.complement} max={80} /><TextF name="district" label="Bairro" def={a.district} max={80} /><TextF name="city" label="Cidade" def={a.city} required max={80} /><TextF name="state" label="UF" def={a.state} required max={2} />
                  <TextF name="postal_code" label="CEP" def={a.postal_code} max={9} inputMode="numeric" /><TextF name="reference" label="Referência" def={a.reference} max={200} span />
                  <CheckF name="is_default" label="Endereço padrão" def={a.is_default} /><CheckF name="active" label="Ativo" def={a.active} />
                </>
              </OsForm>
            </Disclosure>
          ))}
          <Disclosure summary="Adicionar endereço">
            <OsForm action={saveAddress} submit="Adicionar endereço" reset className="grid gap-4 sm:grid-cols-4">
              <>
                <input type="hidden" name="customer_id" value={k.id} />
                <TextF name="label" label="Identificação" required max={60} hint="Ex.: Casa, Loja, Obra" /><TextF name="street" label="Logradouro" required max={160} span /><TextF name="number" label="Número" max={20} />
                <TextF name="complement" label="Complemento" max={80} /><TextF name="district" label="Bairro" max={80} /><TextF name="city" label="Cidade" required max={80} /><TextF name="state" label="UF" required max={2} placeholder="SP" />
                <TextF name="postal_code" label="CEP" max={9} inputMode="numeric" /><TextF name="reference" label="Referência" max={200} span /><CheckF name="is_default" label="Endereço padrão" />
              </>
            </OsForm>
          </Disclosure>
        </div>
      </Section>

      <Section title="Equipamentos">
        <TableShell caption="Equipamentos do cliente" empty={equipment.length === 0} emptyText="Nenhum equipamento cadastrado (opcional).">
          <thead><tr><th className={TH}>Tipo</th><th className={TH}>Marca / modelo</th><th className={TH}>Série</th><th className={TH}>Situação</th></tr></thead>
          <tbody>{equipment.map((e) => <tr key={e.id} className="border-t border-border"><td className={TD}>{e.kind}</td><td className={TD}>{[e.brand, e.model].filter(Boolean).join(' · ') || '—'}</td><td className={TD}>{e.serial_number ?? '—'}</td><td className={TD}>{e.active ? 'Ativo' : 'Inativo'}</td></tr>)}</tbody>
        </TableShell>
        <div className="mt-3 grid gap-3">
          {equipment.map((e) => (
            <Disclosure key={e.id} summary={`Editar equipamento: ${e.kind}`}>
              <OsForm action={saveEquipment} submit="Salvar equipamento" reset={false} className="grid gap-4 sm:grid-cols-4">
                <>
                  <input type="hidden" name="customer_id" value={k.id} /><input type="hidden" name="id" value={e.id} />
                  <TextF name="kind" label="Tipo" def={e.kind} required max={80} /><TextF name="brand" label="Marca" def={e.brand} max={80} /><TextF name="model" label="Modelo" def={e.model} max={80} /><TextF name="serial_number" label="Nº de série" def={e.serial_number} max={80} />
                  <AreaF name="notes" label="Observações" def={e.notes} max={1000} /><CheckF name="active" label="Ativo" def={e.active} />
                </>
              </OsForm>
            </Disclosure>
          ))}
          <Disclosure summary="Adicionar equipamento">
            <OsForm action={saveEquipment} submit="Adicionar equipamento" reset className="grid gap-4 sm:grid-cols-4">
              <>
                <input type="hidden" name="customer_id" value={k.id} />
                <TextF name="kind" label="Tipo" required max={80} hint="Ex.: Ar-condicionado" /><TextF name="brand" label="Marca" max={80} /><TextF name="model" label="Modelo" max={80} /><TextF name="serial_number" label="Nº de série (opcional)" max={80} />
                <AreaF name="notes" label="Observações" max={1000} />
              </>
            </OsForm>
          </Disclosure>
        </div>
      </Section>

      <Section title="Ordens deste cliente" description={orders.total > 15 ? `Mostrando as 15 mais recentes de ${orders.total}.` : undefined}>
        <OrderList rows={orders.rows} prefix={c.settings.order_prefix} tz={c.tz} now={c.now} names={names} me={c.userId} caption="Ordens do cliente" emptyText="Este cliente ainda não tem ordens." />
      </Section>
    </>
  );
}
