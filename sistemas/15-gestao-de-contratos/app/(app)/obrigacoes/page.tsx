import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DateOnly, Pagination, TD, TH, TableShell, Tabs } from '@/components/ct/bits';
import { ActionButton } from '@/components/ct/fields';
import { cancelObligation, completeObligation } from '@/lib/ct/actions/contracts';
import { loadObligations, peopleNames } from '@/lib/ct/data';
import { contractKey } from '@/lib/ct/keys';
import { pageCtx } from '@/lib/ct/page';
import { OBLIGATION_STATUS_LABEL } from '@/lib/ct/present';
import { one, pageFrom, type SearchParams } from '@/lib/ct/query';

export const metadata: Metadata = { title: 'Obrigações' };
const STATUSES = ['pending', 'completed', 'cancelled'] as const;

export default async function ObligationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const status = STATUSES.find((s) => s === one(sp.status)) ?? 'pending';
  const page = pageFrom(one(sp.page));
  const [list, names] = await Promise.all([loadObligations(c, status, page), peopleNames(c)]);
  return (
    <>
      <PageHeader title="Obrigações" description="Tarefas administrativas simples ligadas a contratos (sem recorrência automática). Crie e gerencie dentro do contrato, na aba «Prazos e obrigações»." />
      <Tabs current={status} items={STATUSES.map((s) => ({ key: s, label: s === 'pending' ? 'Pendentes' : s === 'completed' ? 'Concluídas' : 'Canceladas', href: `/obrigacoes?status=${s}` }))} />
      <TableShell caption="Obrigações" empty={list.rows.length === 0} emptyText="Nenhuma obrigação nesta situação.">
        <thead><tr><th className={TH}>Obrigação</th><th className={TH}>Contrato</th><th className={TH}>Data</th><th className={TH}>Responsável</th><th className={TH} /></tr></thead>
        <tbody className="divide-y divide-border">
          {list.rows.map((o) => (
            <tr key={o.id}>
              <td className={TD}>{o.title}</td>
              <td className={TD}><Link className="underline underline-offset-2" href={`/contratos/${o.contract_id}?aba=prazos`}>{contractKey(c.settings.contract_prefix, o.contractNumber)} · {o.contractTitle}</Link></td>
              <td className={TD}><DateOnly value={o.due_date} /> {o.status === 'pending' && o.due_date < c.today ? <Badge tone="danger">Atrasada</Badge> : null}</td>
              <td className={TD}>{o.responsible_user_id ? names[o.responsible_user_id] ?? 'Pessoa' : '—'}</td>
              <td className={TD}>{o.status === 'pending' && !c.isViewer ? (
                <span className="flex flex-wrap gap-2">
                  <ActionButton action={completeObligation} fields={{ id: o.id, version: String(o.version) }} label="Concluir" variant="primary" />
                  <ActionButton action={cancelObligation} fields={{ id: o.id, version: String(o.version), reason: 'Cancelada pela equipe' }} label="Cancelar" confirm="Cancelar esta obrigação?" />
                </span>) : <span className="text-xs text-muted">{OBLIGATION_STATUS_LABEL[o.status]}</span>}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination base="/obrigacoes" sp={sp} page={page} total={list.total} />
    </>
  );
}
