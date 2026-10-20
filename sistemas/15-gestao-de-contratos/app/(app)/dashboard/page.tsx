import type { Metadata } from 'next';
import Link from 'next/link';
import { DeadlinePill, DefinitionList, Kpi, Section, TD, TH, TableShell, DateOnly } from '@/components/ct/bits';
import { PageHeader } from '@/components/ui/primitives';
import { loadDashboard, loadDeadlines, peopleNames } from '@/lib/ct/data';
import { relativeLabel } from '@/lib/ct/dates';
import { contractKey } from '@/lib/ct/keys';
import { BILLING_LABEL, formatBRL, isBillingBasis } from '@/lib/ct/money';
import { pageCtx } from '@/lib/ct/page';
import { addDays } from '@/lib/ct/time';

export const metadata: Metadata = { title: 'Painel de contratos' };

export default async function DashboardPage() {
  const c = await pageCtx();
  const [d, upcoming, names] = await Promise.all([loadDashboard(c), loadDeadlines(c, c.today, addDays(c.today, 30), { kind: null, responsible: null, contract: null }), peopleNames(c)]);
  const val = (n: number) => String(n);
  return (
    <>
      <PageHeader title="Painel de contratos" description={`${c.ctx.membership.name}. Números calculados do banco, somente dos contratos que você pode acessar. Datas no fuso ${d.period.timezone}; «próximos N dias» inclui hoje e o último dia.`} />

      <Section title="Vigência" description="Contratos ativos: registro administrativo, sem validação jurídica.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Contratos ativos" value={val(d.active)} definition="Em situação «ativo» (inclui os que passaram do fim sem encerramento)." />
          <Kpi label="Vigentes hoje" value={val(d.valid_today)} tone="success" definition="Ativos que já começaram e cujo fim ainda não passou (ou sem prazo)." />
          <Kpi label="Fim em até 30 dias" value={val(d.ending_30)} tone={d.ending_30 > 0 ? 'warning' : 'neutral'} definition="Fim de vigência de hoje até hoje + 30." />
          <Kpi label="Fim em até 60 / 90 dias" value={`${d.ending_60} / ${d.ending_90}`} definition="Mesma conta, com 60 e 90 dias." />
          <Kpi label="Fim de vigência atingido" value={val(d.end_reached)} tone={d.end_reached > 0 ? 'danger' : 'neutral'} definition="Ativos cujo fim já passou: o sistema só sinaliza; não renova nem rescinde sozinho." />
          <Kpi label="Avisos próximos (30 dias)" value={val(d.notice_soon)} tone={d.notice_soon > 0 ? 'warning' : 'neutral'} definition="Prazo de aviso cadastrado entre hoje e hoje + 30." />
          <Kpi label="Prazos de aviso ultrapassados" value={val(d.notice_overdue)} tone={d.notice_overdue > 0 ? 'danger' : 'neutral'} definition="Prazo de aviso anterior a hoje em contrato ainda vigente." />
          <Kpi label="Sem responsável" value={val(d.without_responsible)} tone={d.without_responsible > 0 ? 'warning' : 'neutral'} definition="Ativos sem pessoa responsável." />
        </div>
      </Section>

      <Section title="Obrigações e reajustes">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Obrigações pendentes" value={val(d.obligations_pending)} />
          <Kpi label="Obrigações atrasadas" value={val(d.obligations_overdue)} tone={d.obligations_overdue > 0 ? 'danger' : 'neutral'} definition="Pendentes com data anterior a hoje." />
          <Kpi label="Reajustes previstos (60 dias)" value={val(d.adjustments_expected)} definition="Regras de reajuste ativas com próxima data até hoje + 60 (ou já vencida)." />
          <Kpi label="Renovações (12 meses)" value={val(d.renewals_12m)} definition="Renovações registradas nos últimos 365 dias." />
        </div>
      </Section>

      <Section title="Valores sob contrato" description="Valor vigente hoje, separado por periodicidade. Mensal e anual NÃO são somados; não é faturamento nem receita recebida.">
        {Object.keys(d.values_by_basis).length === 0 ? <p className="text-sm text-muted">Sem dados.</p> : (
          <DefinitionList items={Object.entries(d.values_by_basis).map(([k, v]) => [isBillingBasis(k) ? BILLING_LABEL[k] : k, `${formatBRL(v.amount_cents)} em ${v.contracts} contrato(s)`] as [string, string])} />
        )}
        {d.without_value > 0 ? <p className="mt-2 text-sm text-muted">{d.without_value} contrato(s) ativo(s) sem valor cadastrado (não entram nas somas).</p> : null}
      </Section>

      <Section title="Próximos 30 dias" description="Fim de vigência, prazos de aviso, reajustes previstos e obrigações pendentes. Funciona mesmo sem o agendador de lembretes.">
        <TableShell caption="Prazos dos próximos 30 dias" empty={upcoming.length === 0} emptyText="Nada vence nos próximos 30 dias.">
          <thead><tr><th className={TH}>Data</th><th className={TH}>Tipo</th><th className={TH}>Contrato</th><th className={TH}>Responsável</th></tr></thead>
          <tbody className="divide-y divide-border">
            {upcoming.slice(0, 15).map((i) => (
              <tr key={i.kind + i.key}>
                <td className={TD}><DateOnly value={i.date} /> <span className="text-xs text-muted">({relativeLabel(i.date, c.today)})</span></td>
                <td className={TD}><DeadlinePill kind={i.kind} /></td>
                <td className={TD}><Link className="underline underline-offset-2" href={`/contratos/${i.contractId}?aba=prazos`}>{contractKey(c.settings.contract_prefix, i.contractNumber)} · {i.title || i.contractTitle}</Link></td>
                <td className={TD}>{i.responsible ? names[i.responsible] ?? 'Pessoa' : 'Sem responsável'}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        <p className="mt-2 text-sm"><Link className="underline underline-offset-2" href="/prazos">Ver todos os prazos e o calendário</Link></p>
      </Section>

      {d.documents_by_category.length ? (
        <Section title="Documentos por categoria">
          <DefinitionList items={d.documents_by_category.map((x) => [x.category, String(x.documents)] as [string, string])} />
        </Section>
      ) : null}
    </>
  );
}
