import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DateOnly, TD, TH, TableShell } from '@/components/ct/bits';
import { loadAdjustments } from '@/lib/ct/data';
import { relativeLabel } from '@/lib/ct/dates';
import { contractKey } from '@/lib/ct/keys';
import { BILLING_LABEL, formatBRL, formatPercent, isBillingBasis } from '@/lib/ct/money';
import { pageCtx } from '@/lib/ct/page';

export const metadata: Metadata = { title: 'Reajustes' };

export default async function AdjustmentsPage() {
  const c = await pageCtx();
  const rows = await loadAdjustments(c);
  return (
    <>
      <PageHeader title="Reajustes" description="Contratos com regra de reajuste ativa. O percentual é informado por você: nenhum índice é consultado automaticamente. Simular não altera o contrato; aplicar é uma confirmação explícita da gestão, na aba «Valores e reajustes» do contrato." />
      <TableShell caption="Reajustes previstos" empty={rows.length === 0} emptyText="Nenhum contrato ativo com regra de reajuste.">
        <thead><tr><th className={TH}>Contrato</th><th className={TH}>Próxima data</th><th className={TH}>Valor vigente</th><th className={TH}>Frequência</th><th className={TH}>Simulação</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.contractId}>
              <td className={TD}><Link className="underline underline-offset-2" href={`/contratos/${r.contractId}?aba=valores`}>{contractKey(c.settings.contract_prefix, r.contractNumber)} · {r.contractTitle}</Link></td>
              <td className={TD}><DateOnly value={r.next} /> <span className="text-xs text-muted">({relativeLabel(r.next, c.today)})</span> {r.next <= c.today ? <Badge tone="warning">Pronto para simular</Badge> : null}</td>
              <td className={TD + ' tabular-nums'}>{r.current ? <>{formatBRL(r.current.amount_cents)} <span className="text-xs text-muted">{isBillingBasis(r.current.billing_basis) ? BILLING_LABEL[r.current.billing_basis] : ''}</span></> : <span className="text-muted">Sem dados</span>}</td>
              <td className={TD}>a cada {r.frequency} meses{r.label ? ` · ${r.label}` : ''}</td>
              <td className={TD}>{r.open ? <>{formatPercent(BigInt(Math.round(r.open.percentage * 10_000)))} → {formatBRL(r.open.new_amount_cents)} <Badge tone="warning">Aguardando confirmação</Badge></> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
