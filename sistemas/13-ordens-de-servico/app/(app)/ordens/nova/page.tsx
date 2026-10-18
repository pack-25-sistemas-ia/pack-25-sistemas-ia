import type { Metadata } from 'next';
import Link from 'next/link';
import { AreaF, CheckF, OsForm, SelectF, TextF } from '@/components/os/fields';
import { Section } from '@/components/os/bits';
import { Card, PageHeader } from '@/components/ui/primitives';
import { loadPeople, technicians } from '@/lib/os/data';
import { pageCtx } from '@/lib/os/page';
import { one, safeSearch, uuidOrNull, type SearchParams } from '@/lib/os/query';
import { PRIORITIES, PRIORITY_LABEL } from '@/lib/os/status';
import { openOrder } from '@/lib/os/actions/orders';

export const metadata: Metadata = { title: 'Nova ordem de serviço' };

type Cust = { id: string; name: string; phone: string | null };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager']);
  const sp = await searchParams;
  const customerId = uuidOrNull(one(sp.customer));
  const s = c.ctx.supabase;

  // Etapa 1: escolher o cliente (poucos campos por etapa; funciona sem JavaScript).
  if (!customerId) {
    const q = safeSearch(one(sp.q));
    let query = s.from('customers').select('id, name, phone').eq('organization_id', c.org).eq('active', true).order('name').limit(20);
    if (q) query = query.ilike('name', `%${q}%`);
    const { data } = await query;
    const list = (data ?? []) as Cust[];
    return (
      <>
        <PageHeader title="Nova ordem de serviço" description="Etapa 1 de 2 — escolha o cliente." />
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-60 flex-col gap-1 text-sm font-medium">Buscar cliente pelo nome
            <input name="q" defaultValue={q ?? ''} className="min-h-11 rounded-md border border-border bg-card px-3 text-sm font-normal" placeholder="Digite parte do nome" />
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Buscar</button>
        </form>
        {list.length === 0 ? (
          <Card><p className="text-sm">Nenhum cliente ativo encontrado. <Link className="underline" href="/clientes">Cadastre o cliente</Link> e volte aqui.</p></Card>
        ) : (
          <ul className="grid gap-2" aria-label="Clientes">
            {list.map((r) => (
              <li key={r.id}><Link href={`/ordens/nova?customer=${r.id}`} className="flex min-h-12 items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm hover:border-primary"><span className="font-medium">{r.name}</span><span className="text-muted">{r.phone ?? 'sem telefone'}</span></Link></li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-sm text-muted">O cliente não está na lista? <Link className="underline" href="/clientes">Cadastrar novo cliente</Link>.</p>
      </>
    );
  }

  // Etapa 2: dados da ordem
  const [{ data: cust }, { data: addrs }, { data: eqs }, { data: conts }, { data: tpls }, people] = await Promise.all([
    s.from('customers').select('id, name, phone').eq('id', customerId).eq('organization_id', c.org).maybeSingle(),
    s.from('customer_addresses').select('id, label, street, number, city, state, is_default').eq('customer_id', customerId).eq('active', true).order('is_default', { ascending: false }).order('label'),
    s.from('equipment').select('id, kind, brand, model, serial_number').eq('customer_id', customerId).eq('active', true).order('kind'),
    s.from('customer_contacts').select('id, name, phone, is_primary').eq('customer_id', customerId).eq('active', true).order('is_primary', { ascending: false }),
    s.from('checklist_templates').select('id, name').eq('organization_id', c.org).eq('active', true).order('name'),
    loadPeople(c),
  ]);
  if (!cust) return <PageHeader title="Nova ordem de serviço" description="Cliente não encontrado ou sem acesso."><Link className="underline" href="/ordens/nova">Escolher outro cliente</Link></PageHeader>;
  const customer = cust as Cust;
  const addresses = (addrs ?? []) as Array<{ id: string; label: string; street: string; number: string | null; city: string; state: string; is_default: boolean }>;
  const equipment = (eqs ?? []) as Array<{ id: string; kind: string; brand: string | null; model: string | null; serial_number: string | null }>;
  const contacts = (conts ?? []) as Array<{ id: string; name: string; phone: string | null; is_primary: boolean }>;
  const templates = (tpls ?? []) as Array<{ id: string; name: string }>;
  const techs = technicians(people);

  return (
    <>
      <PageHeader title="Nova ordem de serviço" description={`Etapa 2 de 2 — dados do atendimento para ${customer.name}.`}>
        <Link href="/ordens/nova" className="text-sm underline underline-offset-2">Trocar cliente</Link>
      </PageHeader>
      <OsForm action={openOrder} submit="Abrir ordem" pending="Abrindo…" reset={false}>
        <>
          <input type="hidden" name="customer_id" value={customer.id} />
          <div className="sm:col-span-4"><Section title="Solicitação"><div className="grid gap-4 sm:grid-cols-4">
            <TextF name="subject" label="Assunto" required max={160} span hint="Resumo curto do que foi pedido." />
            <SelectF name="priority" label="Prioridade" def="normal" opts={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
            <AreaF name="problem_description" label="Descrição da solicitação" max={4000} hint="O que o cliente relatou, em palavras simples." />
          </div></Section></div>
          <div className="sm:col-span-4"><Section title="Local e equipamento"><div className="grid gap-4 sm:grid-cols-4">
            <SelectF name="address_id" label="Local do atendimento" span def={addresses.find((a) => a.is_default)?.id ?? addresses[0]?.id ?? ''} placeholder={addresses.length ? 'Sem endereço' : 'Nenhum endereço cadastrado'}
              opts={addresses.map((a) => ({ value: a.id, label: `${a.label} — ${a.street}${a.number ? `, ${a.number}` : ''} · ${a.city}/${a.state}` }))} hint={addresses.length ? undefined : 'Cadastre o endereço na ficha do cliente.'} />
            <SelectF name="equipment_id" label="Equipamento (opcional)" span placeholder="Nenhum" opts={equipment.map((e) => ({ value: e.id, label: [e.kind, e.brand, e.model].filter(Boolean).join(' · ') + (e.serial_number ? ` (série ${e.serial_number})` : '') }))} />
            <SelectF name="contact_id" label="Contato no local (opcional)" span placeholder="Nenhum" opts={contacts.map((k) => ({ value: k.id, label: `${k.name}${k.phone ? ` — ${k.phone}` : ''}` }))} />
          </div></Section></div>
          <div className="sm:col-span-4"><Section title="Responsável e janela (opcional)" description="Com técnico e janela informados, a ordem já nasce «Agendada». A agenda é um alerta de sobreposição, não um bloqueio."><div className="grid gap-4 sm:grid-cols-4">
            <SelectF name="technician_id" label="Técnico responsável" span placeholder="Definir depois" opts={techs.map((t) => ({ value: t.user_id, label: t.name }))} />
            <TextF name="sched_date" label="Data" type="date" />
            <TextF name="sched_start" label="Início" type="time" />
            <TextF name="sched_end" label="Fim" type="time" />
          </div></Section></div>
          <div className="sm:col-span-4"><Section title="Checklist e orçamento"><div className="grid gap-4 sm:grid-cols-4">
            <fieldset className="sm:col-span-4"><legend className="mb-1 text-sm font-medium">Modelos de checklist (opcional)</legend>
              {templates.length === 0 ? <p className="text-sm text-muted">Nenhum modelo ativo. <Link className="underline" href="/modelos-checklist">Criar modelo</Link>.</p> : (
                <div className="flex flex-wrap gap-4">{templates.map((t) => <label key={t.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="template_ids" value={t.id} className="size-4" /> {t.name}</label>)}</div>
              )}
            </fieldset>
            <SelectF name="quote_mode" label="Autorização da execução" span def="required" opts={[{ value: 'required', label: 'Exige orçamento aprovado pelo cliente' }, { value: 'authorized', label: 'Executar sem orçamento (justificativa obrigatória)' }]} />
            <AreaF name="authorization_justification" label="Justificativa (só para execução sem orçamento)" max={1000} hint="Fica registrada com o seu nome e a data. Mínimo de 10 caracteres." />
            <CheckF name="as_draft" label="Salvar como rascunho (ainda não abrir)" />
          </div></Section></div>
        </>
      </OsForm>
      <p className="mt-3 text-xs text-muted">O número da ordem é gerado pelo sistema, sem repetição, mesmo com várias pessoas abrindo ao mesmo tempo.</p>
    </>
  );
}
