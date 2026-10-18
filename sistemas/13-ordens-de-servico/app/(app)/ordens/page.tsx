import type { Metadata } from 'next';
import Link from 'next/link';
import { FInput, FSelect, FilterForm, Pagination, Tabs } from '@/components/os/bits';
import { OrderBoard, OrderList } from '@/components/os/order-list';
import { PageHeader } from '@/components/ui/primitives';
import { filtersFrom, listOrders, loadPeople, technicians } from '@/lib/os/data';
import { pageCtx } from '@/lib/os/page';
import { one, withParams, type SearchParams } from '@/lib/os/query';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '@/lib/os/status';

export const metadata: Metadata = { title: 'Ordens de serviço' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const c = await pageCtx(['owner', 'manager', 'technician']);
  const sp = await searchParams;
  const view = one(sp.view) === 'board' ? 'board' : 'list';
  const f = filtersFrom(sp, c.isTechnician ? { mine: true } : {});
  const people = await loadPeople(c);
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.name]));
  // quadro: mostra o backlog + concluídas aguardando aceite, sem paginação (limite de 200 cartões)
  const board = view === 'board';
  const { rows, total } = await listOrders(c, board ? { ...f, status: f.status ?? undefined, page: 1 } : f, board ? 200 : undefined);
  const boardRows = board && !f.status ? rows.filter((r) => ['open', 'scheduled', 'in_progress', 'paused', 'completed'].includes(r.execution_status)) : rows;

  return (
    <>
      <PageHeader title="Ordens de serviço" description={c.isTechnician ? 'As ordens atribuídas a você.' : 'Todas as ordens da empresa, com filtros. Abra uma ordem para executar, orçar, anexar evidências e acompanhar o histórico.'}>
        {c.isManager ? <Link href="/ordens/nova" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Nova ordem</Link> : null}
      </PageHeader>
      <Tabs current={view} items={[{ key: 'list', label: 'Lista', href: withParams('/ordens', sp, { view: null, page: null }) }, { key: 'board', label: 'Quadro por status', href: withParams('/ordens', sp, { view: 'board', page: null }) }]} />
      <FilterForm clear="/ordens">
        {view === 'board' ? <input type="hidden" name="view" value="board" /> : null}
        <FInput name="q" label="Buscar (número, assunto ou cliente)" sp={sp} placeholder="Ex.: OS-00012" />
        <FSelect name="status" label="Status" sp={sp} opts={[{ value: 'backlog', label: 'Backlog (em andamento)' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
        {c.isManager ? <FSelect name="tech" label="Responsável" sp={sp} opts={[{ value: 'none', label: 'Sem responsável' }, ...technicians(people).map((p) => ({ value: p.user_id, label: p.name }))]} /> : null}
        <FSelect name="priority" label="Prioridade" sp={sp} opts={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <FSelect name="late" label="Atraso" sp={sp} opts={[{ value: '1', label: 'Só atrasadas (previsão)' }]} />
        <FInput name="from" label="Aberta de" type="date" sp={sp} />
        <FInput name="to" label="até" type="date" sp={sp} />
      </FilterForm>
      {board ? (
        <>
          <OrderBoard rows={boardRows} prefix={c.settings.order_prefix} tz={c.tz} now={c.now} names={names} me={c.userId} />
          {total > 200 ? <p className="mt-3 text-xs text-muted">Mostrando as 200 mais recentes de {total}. Use os filtros para refinar.</p> : null}
        </>
      ) : (
        <>
          <OrderList rows={rows} prefix={c.settings.order_prefix} tz={c.tz} now={c.now} names={names} me={c.userId} caption="Ordens de serviço" />
          <Pagination base="/ordens" sp={sp} page={f.page} total={total} />
        </>
      )}
    </>
  );
}
