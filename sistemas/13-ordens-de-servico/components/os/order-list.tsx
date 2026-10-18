import Link from 'next/link';
import { DateTimeLocal, PriorityPill, StatusPill, TD, TH, TableShell } from './bits';
import { customerName, type OrderRow } from '@/lib/os/data';
import { isLate } from '@/lib/os/status';
import { numberText } from '@/lib/os/page';
import { Badge } from '@/components/ui/primitives';

type Props = { rows: OrderRow[]; prefix: string; tz: string; now: number; names: Record<string, string>; me?: string; caption: string; emptyText?: string };

const techName = (r: OrderRow, names: Record<string, string>, me?: string): string => (r.assigned_technician_user_id ? (r.assigned_technician_user_id === me ? 'Você' : names[r.assigned_technician_user_id] ?? 'Técnico') : 'Sem responsável');

/** Lista em tabela (computador) e em cartões (celular). Os dois mostram os mesmos dados; a ação principal é abrir a ordem. */
export function OrderList({ rows, prefix, tz, now, names, me, caption, emptyText }: Props) {
  if (rows.length === 0) return <TableShell caption={caption} empty emptyText={emptyText ?? 'Nenhuma ordem encontrada com estes filtros.'}>{null}</TableShell>;
  return (
    <>
      <div className="hidden md:block">
        <TableShell caption={caption}>
          <thead>
            <tr><th className={TH}>Número</th><th className={TH}>Assunto</th><th className={TH}>Cliente</th><th className={TH}>Status</th><th className={TH}>Prioridade</th><th className={TH}>Responsável</th><th className={TH}>Janela planejada</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                <td className={TD}><Link className="font-medium underline underline-offset-2" href={`/ordens/${r.id}`}>{numberText(prefix, r.order_number)}</Link></td>
                <td className={TD}>{r.subject}</td>
                <td className={TD}>{customerName(r)}</td>
                <td className={TD}><StatusPill status={r.execution_status} /> {isLate({ status: r.execution_status, scheduledEndAt: r.scheduled_end_at }, now) ? <Badge tone="danger">Atrasada</Badge> : null}</td>
                <td className={TD}><PriorityPill priority={r.priority} /></td>
                <td className={TD}>{techName(r, names, me)}</td>
                <td className={TD}>{r.scheduled_start_at ? <><DateTimeLocal value={r.scheduled_start_at} tz={tz} /></> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>
      <ul className="grid gap-3 md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/ordens/${r.id}`} className="block rounded-lg border border-border bg-card p-4 active:bg-black/5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{numberText(prefix, r.order_number)}</span>
                <StatusPill status={r.execution_status} />
                {isLate({ status: r.execution_status, scheduledEndAt: r.scheduled_end_at }, now) ? <Badge tone="danger">Atrasada</Badge> : null}
                <PriorityPill priority={r.priority} />
              </div>
              <p className="mt-2 text-base font-medium leading-snug">{r.subject}</p>
              <p className="mt-1 text-sm text-muted">{customerName(r)}</p>
              <p className="mt-1 text-xs text-muted">{techName(r, names, me)}{r.scheduled_start_at ? <> · <DateTimeLocal value={r.scheduled_start_at} tz={tz} /></> : null}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Quadro por status (sem arrastar e soltar: mudar o status é uma ação explícita na ordem, com as regras do banco). */
export function OrderBoard({ rows, prefix, tz, now, names, me }: Omit<Props, 'caption' | 'emptyText'>) {
  const cols: Array<{ status: string; title: string }> = [
    { status: 'open', title: 'Abertas' }, { status: 'scheduled', title: 'Agendadas' }, { status: 'in_progress', title: 'Em execução' }, { status: 'paused', title: 'Pausadas' }, { status: 'completed', title: 'Concluídas' },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" aria-label="Quadro de ordens por status">
      {cols.map((col) => {
        const list = rows.filter((r) => r.execution_status === col.status);
        return (
          <section key={col.status} aria-labelledby={`col-${col.status}`} className="rounded-lg border border-border bg-black/[0.02] p-2 dark:bg-white/[0.02]">
            <h3 id={`col-${col.status}`} className="mb-2 flex items-center justify-between px-2 text-sm font-semibold">{col.title}<span className="rounded-full border border-border px-2 text-xs font-normal">{list.length}</span></h3>
            <ul className="grid gap-2">
              {list.length === 0 ? <li className="px-2 py-3 text-xs text-muted">Nenhuma ordem.</li> : list.map((r) => (
                <li key={r.id}>
                  <Link href={`/ordens/${r.id}`} className="block rounded-md border border-border bg-card p-3 text-sm hover:border-primary">
                    <span className="flex flex-wrap items-center gap-1"><span className="font-semibold">{numberText(prefix, r.order_number)}</span><PriorityPill priority={r.priority} />{isLate({ status: r.execution_status, scheduledEndAt: r.scheduled_end_at }, now) ? <Badge tone="danger">Atrasada</Badge> : null}</span>
                    <span className="mt-1 block leading-snug">{r.subject}</span>
                    <span className="mt-1 block text-xs text-muted">{customerName(r)} · {techName(r, names, me)}</span>
                    {r.scheduled_start_at ? <span className="mt-1 block text-xs text-muted"><DateTimeLocal value={r.scheduled_start_at} tz={tz} /></span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
