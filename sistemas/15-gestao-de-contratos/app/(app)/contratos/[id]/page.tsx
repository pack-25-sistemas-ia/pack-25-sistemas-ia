import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Tabs } from '@/components/ct/bits';
import { ChangesTab, ContractHeader, DeadlinesTab, DocumentsTab, HistoryTab, PartiesTab, SummaryTab, ValuesTab, type ViewProps } from '@/components/ct/contract-view';
import { listCounterparties, listMembers, loadContract } from '@/lib/ct/data';
import { pageCtx } from '@/lib/ct/page';
import { one, type SearchParams } from '@/lib/ct/query';
import { availableActions } from '@/lib/ct/status';

export const metadata: Metadata = { title: 'Contrato' };

const TABS = [
  { key: 'resumo', label: 'Resumo' }, { key: 'partes', label: 'Partes' }, { key: 'documentos', label: 'Documentos' }, { key: 'aditivos', label: 'Aditivos e renovações' },
  { key: 'valores', label: 'Valores e reajustes' }, { key: 'prazos', label: 'Prazos e obrigações' }, { key: 'historico', label: 'Histórico' },
] as const;

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const c = await pageCtx();
  const d = await loadContract(c, id);
  if (!d || !d.role) notFound();
  const tab = TABS.find((t) => t.key === one(sp.aba))?.key ?? 'resumo';
  const acts = availableActions({ role: d.role, lifecycle: d.contract.lifecycle_status, archived: !!d.contract.archived_at });
  const [members, parties] = await Promise.all([d.role === 'manager' ? listMembers(c) : Promise.resolve([]), tab === 'partes' && acts.includes('party') ? listCounterparties(c) : Promise.resolve([])]);
  const names = new Map(d.people.map((p) => [p.user_id, p.name]));
  const who = (uid: string | null | undefined) => (uid ? names.get(uid) ?? 'Pessoa' : '—');
  const v: ViewProps = { d, c, members, parties, acts, who };
  return (
    <>
      <ContractHeader d={d} c={c} />
      <Tabs current={tab} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/contratos/${id}${t.key === 'resumo' ? '' : `?aba=${t.key}`}` }))} />
      {tab === 'resumo' ? <SummaryTab {...v} /> : null}
      {tab === 'partes' ? <PartiesTab {...v} /> : null}
      {tab === 'documentos' ? <DocumentsTab {...v} /> : null}
      {tab === 'aditivos' ? <ChangesTab {...v} /> : null}
      {tab === 'valores' ? <ValuesTab {...v} /> : null}
      {tab === 'prazos' ? <DeadlinesTab {...v} /> : null}
      {tab === 'historico' ? <HistoryTab {...v} /> : null}
    </>
  );
}
