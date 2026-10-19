import { EmptyState } from '@/components/ui/primitives';
import { FilterForm, FInput, Kpi, Section, TD, TH, TableShell } from './bits';
import type { Dashboard } from '@/lib/pj/data';
import { DEFINITIONS, percentText } from '@/lib/pj/indicators';
import { PRIORITIES, PRIORITY_LABEL, SEMANTICS, SEMANTIC_LABEL, PROJECT_STATUS_LABEL } from '@/lib/pj/status';
import { formatDateBR } from '@/lib/pj/time';

/** Painel operacional: todos os números vêm do banco e respeitam o acesso. Período, fuso e definições aparecem na tela; nada de «produtividade» ou pontuação. */
export function DashboardView({ dash, base, from, to, today }: { dash: Dashboard | null; base: string; from: string; to: string; today: string }) {
  if (!dash) return <EmptyState title="Não foi possível calcular o painel agora." description="Tente novamente em instantes. O período máximo é de 366 dias." />;
  return (
    <>
      <FilterForm action={base} clear={base}>
        <FInput name="from" label="De" type="date" sp={{ from }} />
        <FInput name="to" label="Até" type="date" sp={{ to }} />
      </FilterForm>
      <p className="mb-5 text-xs text-muted">Período: {formatDateBR(dash.period.from)} a {formatDateBR(dash.period.to)} · base temporal: fuso {dash.period.timezone} (hoje é {formatDateBR(today)}). «Abertas», «atrasadas», «bloqueadas» e «sem responsável» são a situação de AGORA; «concluídas» cobre o período.</p>

      <Section title="Situação atual">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Projetos ativos" value={dash.active_projects} definition={DEFINITIONS.activeProjects} />
          <Kpi label="Tarefas abertas" value={dash.open_tasks} definition={DEFINITIONS.open} />
          <Kpi label="Atrasadas" value={dash.overdue} tone={dash.overdue > 0 ? 'danger' : 'neutral'} definition={DEFINITIONS.overdue} />
          <Kpi label="Bloqueadas" value={dash.blocked} tone={dash.blocked > 0 ? 'warning' : 'neutral'} definition={DEFINITIONS.blocked} />
          <Kpi label="Sem responsável" value={dash.unassigned} definition={DEFINITIONS.unassigned} />
        </div>
      </Section>
      <Section title="No período">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Concluídas no período" value={dash.completed_in_period} tone="success" definition={DEFINITIONS.completedInPeriod} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Por etapa" description="Tarefas não arquivadas, por tipo de etapa.">
          <TableShell caption="Distribuição por etapa">
            <thead><tr className="border-b border-border"><th className={TH} scope="col">Etapa</th><th className={TH} scope="col">Tarefas</th></tr></thead>
            <tbody>{SEMANTICS.map((s) => <tr key={s} className="border-b border-border last:border-0"><td className={TD}>{SEMANTIC_LABEL[s]}</td><td className={TD}>{dash.by_stage[s]}</td></tr>)}</tbody>
          </TableShell>
        </Section>
        <Section title="Por prioridade" description="Somente tarefas abertas.">
          <TableShell caption="Distribuição por prioridade">
            <thead><tr className="border-b border-border"><th className={TH} scope="col">Prioridade</th><th className={TH} scope="col">Tarefas abertas</th></tr></thead>
            <tbody>{[...PRIORITIES].reverse().map((p) => <tr key={p} className="border-b border-border last:border-0"><td className={TD}>{PRIORITY_LABEL[p]}</td><td className={TD}>{dash.by_priority[p]}</td></tr>)}</tbody>
          </TableShell>
        </Section>
      </div>

      <Section title="Carga aberta por responsável" description={DEFINITIONS.load}>
        <TableShell caption="Carga aberta por responsável" empty={dash.load.length === 0} emptyText="Sem tarefas abertas.">
          <thead><tr className="border-b border-border"><th className={TH} scope="col">Responsável</th><th className={TH} scope="col">Abertas</th><th className={TH} scope="col">Atrasadas</th><th className={TH} scope="col">Bloqueadas</th></tr></thead>
          <tbody>{dash.load.map((l) => <tr key={l.user_id ?? 'none'} className="border-b border-border last:border-0"><td className={TD}>{l.user_id ? l.name ?? 'Pessoa' : 'Sem responsável'}</td><td className={TD}>{l.open}</td><td className={TD}>{l.overdue}</td><td className={TD}>{l.blocked}</td></tr>)}</tbody>
        </TableShell>
      </Section>

      <Section title="Progresso por projeto" description={DEFINITIONS.progress}>
        <TableShell caption="Progresso por projeto" empty={dash.progress.length === 0} emptyText="Nenhum projeto.">
          <thead><tr className="border-b border-border"><th className={TH} scope="col">Projeto</th><th className={TH} scope="col">Status</th><th className={TH} scope="col">Concluídas / total</th><th className={TH} scope="col">Progresso</th></tr></thead>
          <tbody>{dash.progress.map((p) => (
            <tr key={p.project_id} className="border-b border-border last:border-0"><td className={TD}>{p.name}</td><td className={TD}>{PROJECT_STATUS_LABEL[p.status]}</td><td className={TD}>{p.total === 0 ? '—' : `${p.done} / ${p.total}`}</td><td className={TD}>{percentText(p.done, p.total)}</td></tr>
          ))}</tbody>
        </TableShell>
      </Section>
    </>
  );
}
