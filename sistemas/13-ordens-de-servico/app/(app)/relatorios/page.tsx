import type { Metadata } from 'next';
import { FInput, FSelect, Section } from '@/components/os/bits';
import { Card, PageHeader } from '@/components/ui/primitives';
import { loadPeople, technicians } from '@/lib/os/data';
import { DEFINITIONS } from '@/lib/os/indicators';
import { pageCtx } from '@/lib/os/page';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '@/lib/os/status';

export const metadata: Metadata = { title: 'Relatórios' };

export default async function ReportsPage() {
  const c = await pageCtx(['owner', 'manager']);
  const people = await loadPeople(c);
  return (
    <>
      <PageHeader title="Relatórios" description="Exportação das ordens em CSV (abre no Excel) e definição de cada indicador do painel." />
      <Section title="Exportar ordens (CSV)" description="Respeita os filtros abaixo. Células que começam com =, +, - ou @ são neutralizadas para não executarem fórmulas na planilha. Cada exportação fica registrada na auditoria (só a quantidade de linhas).">
        <Card>
          <form method="get" action="/api/exportar/ordens" className="flex flex-wrap items-end gap-3">
            <FSelect name="status" label="Status" sp={{}} opts={[{ value: 'backlog', label: 'Backlog (em andamento)' }, ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
            <FSelect name="tech" label="Responsável" sp={{}} opts={[{ value: 'none', label: 'Sem responsável' }, ...technicians(people).map((p) => ({ value: p.user_id, label: p.name }))]} />
            <FSelect name="priority" label="Prioridade" sp={{}} opts={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
            <FInput name="from" label="Aberta de" type="date" sp={{}} />
            <FInput name="to" label="até" type="date" sp={{}} />
            <button type="submit" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Baixar CSV</button>
          </form>
          <p className="mt-3 text-xs text-muted">Até 10.000 linhas por arquivo. Horários no fuso {c.tz}.</p>
        </Card>
      </Section>
      <Section title="Como cada indicador é calculado" description="Os números ficam no Painel. Nenhum indicador usa valores de exemplo: sem dados aparece «Sem dados».">
        <Card>
          <dl className="grid gap-3 text-sm">
            {Object.entries(DEFINITIONS).map(([k, v]) => <div key={k}><dt className="font-medium capitalize">{k === 'awaiting' ? 'Aguardando aceite' : k === 'late' ? 'Atrasadas' : k === 'cycle' ? 'Tempo de ciclo' : k === 'approved' ? 'Valor aprovado' : k === 'unassigned' ? 'Não atribuídas' : k === 'rework' ? 'Retrabalho' : 'Backlog'}</dt><dd className="text-muted">{v}</dd></div>)}
          </dl>
        </Card>
      </Section>
    </>
  );
}
