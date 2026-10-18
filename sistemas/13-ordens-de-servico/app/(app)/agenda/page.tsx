import type { Metadata } from 'next';
import Link from 'next/link';
import { FSelect, FilterForm } from '@/components/os/bits';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { StatusPill } from '@/components/os/bits';
import { customerName, loadPeople, ORDER_COLUMNS, technicians, type OrderRow } from '@/lib/os/data';
import { numberText, pageCtx } from '@/lib/os/page';
import { isUuid, one, withParams, type SearchParams } from '@/lib/os/query';
import { BACKLOG } from '@/lib/os/status';
import { addDays, formatDateLong, instantToLocal, isDate, localToInstant, weekStart } from '@/lib/os/time';

export const metadata: Metadata = { title: 'Agenda de atendimentos' };

/** Agenda = janelas PLANEJADAS (não é motor de reservas nem roteirização). Sobreposição do mesmo técnico aparece como alerta. */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager', 'technician']);
  const sp = await searchParams;
  const start = weekStart(isDate(one(sp.semana) ?? '') ? one(sp.semana)! : c.today);
  const end = addDays(start, 6);
  const techQ = one(sp.tech);
  const people = await loadPeople(c);
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.name]));
  const from = new Date(localToInstant(start, '00:00', c.tz)).toISOString();
  const to = new Date(localToInstant(addDays(end, 1), '00:00', c.tz)).toISOString();
  let q = c.ctx.supabase.from('service_orders').select(ORDER_COLUMNS).eq('organization_id', c.org).in('execution_status', [...BACKLOG, 'completed']).not('scheduled_start_at', 'is', null).lt('scheduled_start_at', to).gt('scheduled_end_at', from).order('scheduled_start_at').limit(300);
  if (c.isTechnician) q = q.eq('assigned_technician_user_id', c.userId);
  else if (techQ === 'none') q = q.is('assigned_technician_user_id', null);
  else if (isUuid(techQ)) q = q.eq('assigned_technician_user_id', techQ);
  const { data } = await q;
  const rows = (data ?? []) as unknown as OrderRow[];
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const dayOf = (r: OrderRow) => instantToLocal(Date.parse(r.scheduled_start_at!), c.tz).date;
  const conflict = (r: OrderRow) => rows.some((o) => o.id !== r.id && o.assigned_technician_user_id && o.assigned_technician_user_id === r.assigned_technician_user_id && Date.parse(o.scheduled_start_at!) < Date.parse(r.scheduled_end_at!) && Date.parse(o.scheduled_end_at!) > Date.parse(r.scheduled_start_at!));
  const nav = (n: number) => withParams('/agenda', sp, { semana: addDays(start, n) });

  return (
    <>
      <PageHeader title="Agenda de atendimentos" description="Janelas planejadas da semana. Para agendar, abra a ordem (aba «Resumo»). Sobreposição do mesmo técnico é um alerta, não um bloqueio." />
      <FilterForm clear="/agenda">
        {c.isManager ? <FSelect name="tech" label="Técnico" sp={sp} opts={[{ value: 'none', label: 'Sem responsável' }, ...technicians(people).map((p) => ({ value: p.user_id, label: p.name }))]} /> : null}
      </FilterForm>
      <nav aria-label="Semana" className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link className="rounded-md border border-border px-3 py-2" href={nav(-7)}>← Semana anterior</Link>
        <strong>{formatDateLong(start).split(', ')[1]} a {formatDateLong(end).split(', ')[1]}</strong>
        <Link className="rounded-md border border-border px-3 py-2" href={nav(7)}>Próxima semana →</Link>
        <Link className="underline underline-offset-2" href={withParams('/agenda', sp, { semana: null })}>Hoje</Link>
      </nav>
      <div className="grid gap-4 lg:grid-cols-7">
        {days.map((day) => {
          const list = rows.filter((r) => dayOf(r) === day);
          return (
            <section key={day} aria-labelledby={`d-${day}`} className={`rounded-lg border bg-card p-2 ${day === c.today ? 'border-primary' : 'border-border'}`}>
              <h2 id={`d-${day}`} className="mb-2 px-1 text-xs font-semibold capitalize">{formatDateLong(day)}{day === c.today ? ' · hoje' : ''}</h2>
              {list.length === 0 ? <p className="px-1 py-2 text-xs text-muted">Nada agendado.</p> : (
                <ul className="grid gap-2">
                  {list.map((r) => (
                    <li key={r.id}>
                      <Link href={`/ordens/${r.id}`} className="block rounded-md border border-border p-2 text-xs hover:border-primary">
                        <span className="block font-semibold tabular-nums">{instantToLocal(Date.parse(r.scheduled_start_at!), c.tz).time}–{instantToLocal(Date.parse(r.scheduled_end_at!), c.tz).time}</span>
                        <span className="block">{numberText(c.settings.order_prefix, r.order_number)} · {r.subject}</span>
                        <span className="block text-muted">{customerName(r)}{r.assigned_technician_user_id ? ` · ${r.assigned_technician_user_id === c.userId ? 'Você' : names[r.assigned_technician_user_id] ?? 'Técnico'}` : ' · sem responsável'}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1"><StatusPill status={r.execution_status} />{conflict(r) ? <Badge tone="warning">Sobreposição</Badge> : null}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">Ordens que começam na semana aparecem no dia do início. Horários no fuso {c.tz}.</p>
    </>
  );
}
