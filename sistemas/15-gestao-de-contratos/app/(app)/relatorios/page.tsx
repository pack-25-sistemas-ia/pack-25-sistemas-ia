import type { Metadata } from 'next';
import { DefinitionList, Section } from '@/components/ct/bits';
import { Card, PageHeader } from '@/components/ui/primitives';
import { loadDashboard } from '@/lib/ct/data';
import { BILLING_LABEL, formatBRL, isBillingBasis } from '@/lib/ct/money';
import { pageCtx } from '@/lib/ct/page';
import { addDays } from '@/lib/ct/time';

export const metadata: Metadata = { title: 'Relatórios' };

const btn = 'inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5';

export default async function ReportsPage() {
  const c = await pageCtx();
  const d = await loadDashboard(c);
  return (
    <>
      <PageHeader title="Relatórios" description="Exportações CSV (UTF-8, separador «;», fórmulas de planilha neutralizadas) e as definições dos indicadores. Só entram contratos que você pode acessar." />
      <Section title="Exportar">
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Contratos" description="Número, título, partes, status, vigência, prazo de aviso, responsável e valor vigente. Sem documentos, links de arquivo nem CPF/CNPJ.">
            <p className="flex flex-wrap gap-2"><a className={btn} href="/api/exportar/contratos">Contratos ativos e rascunhos (CSV)</a><a className={btn} href="/api/exportar/contratos?status=active">Somente ativos (CSV)</a><a className={btn} href="/api/exportar/contratos?arquivados=1">Arquivados (CSV)</a></p>
          </Card>
          <Card title="Prazos" description="Fim de vigência, prazos de aviso, reajustes previstos e obrigações pendentes no período.">
            <p className="flex flex-wrap gap-2"><a className={btn} href={`/api/exportar/contratos?tipo=prazos&de=${c.today}&ate=${addDays(c.today, 30)}`}>Próximos 30 dias (CSV)</a><a className={btn} href={`/api/exportar/contratos?tipo=prazos&de=${c.today}&ate=${addDays(c.today, 90)}`}>Próximos 90 dias (CSV)</a></p>
          </Card>
        </div>
      </Section>
      <Section title="Valores sob contrato" description="Valor vigente hoje por periodicidade. Não são somados entre si, não são faturamento e valores desconhecidos aparecem como «Sem dados», nunca como zero.">
        {Object.keys(d.values_by_basis).length === 0 ? <p className="text-sm text-muted">Sem dados.</p> : (
          <DefinitionList items={Object.entries(d.values_by_basis).map(([k, v]) => [isBillingBasis(k) ? BILLING_LABEL[k] : k, `${formatBRL(v.amount_cents)} em ${v.contracts} contrato(s)`] as [string, string])} />
        )}
      </Section>
      <Section title="Definições">
        <ul className="grid gap-2 text-sm">
          <li><strong>Vigentes hoje:</strong> ativos que já começaram e cujo fim ainda não passou (o último dia da vigência conta como vigente) ou sem prazo.</li>
          <li><strong>Fim em N dias:</strong> fim de vigência de hoje até hoje + N, ambos os dias incluídos, no fuso {d.period.timezone}.</li>
          <li><strong>Prazo de aviso:</strong> data de referência menos os dias corridos informados (sem feriados). Perder o prazo não renova nem rescinde: o sistema só sinaliza.</li>
          <li><strong>Prazo ultrapassado:</strong> prazo de aviso anterior a hoje em contrato ainda vigente.</li>
          <li><strong>Reajuste:</strong> novo valor = valor base × (1 + percentual/100), arredondado ao centavo (meio para cima). O percentual é informado manualmente.</li>
        </ul>
      </Section>
    </>
  );
}
