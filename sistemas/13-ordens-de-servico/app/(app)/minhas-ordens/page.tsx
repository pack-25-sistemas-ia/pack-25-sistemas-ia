import type { Metadata } from 'next';
import { Section } from '@/components/os/bits';
import { OrderList } from '@/components/os/order-list';
import { PageHeader } from '@/components/ui/primitives';
import { listOrders, type OrderRow } from '@/lib/os/data';
import { pageCtx } from '@/lib/os/page';

export const metadata: Metadata = { title: 'Minhas ordens' };

export default async function MyOrdersPage() {
  const c = await pageCtx(['owner', 'manager', 'technician']);
  const { rows } = await listOrders(c, { mine: true, page: 1 }, 200);
  const by = (...st: string[]) => rows.filter((r: OrderRow) => st.includes(r.execution_status));
  const groups: Array<{ title: string; list: OrderRow[]; empty: string }> = [
    { title: 'Em execução', list: by('in_progress'), empty: 'Nenhuma ordem em execução.' },
    { title: 'Pausadas', list: by('paused'), empty: 'Nenhuma ordem pausada.' },
    { title: 'Agendadas e abertas', list: by('scheduled', 'open'), empty: 'Nenhuma ordem aguardando início.' },
    { title: 'Concluídas, aguardando aceite do cliente', list: by('completed'), empty: 'Nenhuma ordem aguardando aceite.' },
  ];
  const done = by('closed', 'cancelled').slice(0, 10);
  const names = { [c.userId]: 'Você' };
  return (
    <>
      <PageHeader title="Minhas ordens" description="As ordens atribuídas a você, da execução ao aceite. Abra uma ordem para iniciar, responder o checklist, registrar peças e fotos e concluir." />
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted">Nenhuma ordem atribuída a você no momento.</p> : null}
      {groups.map((g) => g.list.length ? (
        <Section key={g.title} title={`${g.title} (${g.list.length})`}>
          <OrderList rows={g.list} prefix={c.settings.order_prefix} tz={c.tz} now={c.now} names={names} me={c.userId} caption={g.title} emptyText={g.empty} />
        </Section>
      ) : null)}
      {done.length ? (
        <Section title="Encerradas e canceladas (últimas 10)">
          <OrderList rows={done} prefix={c.settings.order_prefix} tz={c.tz} now={c.now} names={names} me={c.userId} caption="Encerradas e canceladas" />
        </Section>
      ) : null}
    </>
  );
}
