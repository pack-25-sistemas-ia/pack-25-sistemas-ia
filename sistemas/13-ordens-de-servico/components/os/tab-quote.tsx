import type { ReactNode } from 'react';
import { ActionButton, AreaF, CellF, CellSelect, OsForm, SelectF, TextF } from './fields';
import { DateTimeLocal, Disclosure, Section, TD, TH, TableShell } from './bits';
import type { TabProps } from './tab-summary';
import { Alert, Badge, Card } from '@/components/ui/primitives';
import { addCost } from '@/lib/os/actions/execution';
import { decideQuoteManual, newQuoteDraft, publishQuote, saveQuoteDraft } from '@/lib/os/actions/quotes';
import type { QuoteItem, QuoteVersion } from '@/lib/os/data';
import { formatCents, formatQuantity, milliFromNumeric } from '@/lib/os/money';
import { QUOTE_STATUS_LABEL } from '@/lib/os/quote';
import { COST_CATEGORY_LABEL, isManager } from '@/lib/os/status';
import { instantToLocal } from '@/lib/os/time';
import { addDays } from '@/lib/os/time';

type Props = TabProps & { services: Array<{ id: string; name: string; unit: string; reference_price_cents: number }>; parts: Array<{ id: string; code: string; name: string; unit: string; reference_price_cents: number }>; extraRows: number };

const TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = { draft: 'neutral', published: 'warning', approved: 'success', rejected: 'danger', superseded: 'neutral' };
const price = (c: number) => String(c / 100).replace('.', ',');

function ItemsTable({ items, caption }: { items: QuoteItem[]; caption: string }) {
  return (
    <TableShell caption={caption} empty={items.length === 0} emptyText="Sem itens.">
      <thead><tr><th className={TH}>Tipo</th><th className={TH}>Descrição</th><th className={TH}>Qtd.</th><th className={TH}>Preço unit.</th><th className={TH}>Total</th></tr></thead>
      <tbody>{items.map((i) => <tr key={i.id} className="border-t border-border"><td className={TD}>{i.kind === 'service' ? 'Serviço' : 'Peça'}</td><td className={TD}>{i.description}</td><td className={TD}>{formatQuantity(milliFromNumeric(i.quantity))} {i.unit}</td><td className={TD}>{formatCents(i.unit_price_cents)}</td><td className={TD}>{formatCents(i.line_total_cents)}</td></tr>)}</tbody>
    </TableShell>
  );
}

export function QuoteTab({ c, d, actions, services, parts, extraRows, me }: Props): ReactNode {
  const o = d.order;
  const mgr = isManager(c.profile);
  const draft = d.quotes.find((q) => q.status === 'draft');
  const published = d.quotes.find((q) => q.status === 'published');
  const baseline = d.quotes.find((q) => q.status === 'approved');
  const canQuote = actions.includes('quote');
  const itemsOf = (q: QuoteVersion) => d.items.filter((i) => i.quote_version_id === q.id);
  const decisionOf = (q: QuoteVersion) => d.decisions.find((x) => x.quote_version_id === q.id);
  const refOptions = [...services.map((s) => ({ value: `s:${s.id}`, label: `Serviço — ${s.name}` })), ...parts.map((p) => ({ value: `p:${p.id}`, label: `Peça — ${p.code} ${p.name}` }))];
  const draftItems = draft ? itemsOf(draft) : [];
  const rows = Math.min(200, Math.max(draftItems.length, 0) + extraRows);
  const validDefault = draft?.valid_until ? instantToLocal(Date.parse(draft.valid_until), c.tz).date : addDays(c.today, c.settings.quote_validity_days);

  return (
    <>
      <Section title="Situação do orçamento" description="Estados separados: operacional da ordem, orçamento e aceite final. Cada versão publicada é congelada; alterar depois cria uma nova versão.">
        <Card>
          {o.quote_mode === 'authorized' ? <Alert tone="info">Esta ordem tem <strong>execução autorizada sem orçamento</strong>. Ainda é possível criar um orçamento (ex.: cobrança adicional), mas ele não bloqueia a execução.</Alert> : null}
          {baseline ? <p className="text-sm">Orçamento aprovado vigente: <strong>versão {baseline.version_number}</strong> — {formatCents(baseline.total_cents)}.</p> : <p className="text-sm text-muted">Nenhuma versão aprovada ainda.</p>}
          {published ? <p className="mt-2 text-sm"><Badge tone="warning">Pendente</Badge> A versão {published.version_number} ({formatCents(published.total_cents)}) aguarda a decisão do cliente. Enquanto estiver pendente, a execução não pode ser iniciada nem retomada{o.quote_mode === 'authorized' ? ' (exceto nesta ordem, que tem execução autorizada)' : ''}.</p> : null}
          {canQuote && !draft ? <div className="mt-3"><ActionButton action={newQuoteDraft} fields={{ order: o.id }} label={d.quotes.length ? 'Criar nova versão (cópia da última)' : 'Criar orçamento'} variant="primary" pending="Criando…" /></div> : null}
        </Card>
      </Section>

      {draft && canQuote ? (
        <Section title={`Rascunho — versão ${draft.version_number}`} description="Os totais são SEMPRE recalculados pelo sistema ao salvar (nunca confiamos no navegador). Total da linha = quantidade × preço, arredondado a centavos (meio para cima). Linhas em branco são ignoradas.">
          <div id="rascunho" />
          <Card>
            <OsForm action={saveQuoteDraft} submit="Salvar rascunho" pending="Salvando…" reset={false} className="grid gap-4 sm:grid-cols-4">
              <>
                <input type="hidden" name="order" value={o.id} /><input type="hidden" name="quote" value={draft.id} /><input type="hidden" name="expected" value={String(draft.version)} /><input type="hidden" name="rows" value={String(rows)} />
                <div className="sm:col-span-4 overflow-x-auto">
                  <table className="w-full min-w-[56rem] border-collapse text-sm">
                    <caption className="sr-only">Itens do orçamento</caption>
                    <thead><tr><th className={TH}>Catálogo</th><th className={TH}>Descrição</th><th className={TH}>Un.</th><th className={TH}>Quantidade</th><th className={TH}>Preço unit. (R$)</th><th className={TH}>Total</th></tr></thead>
                    <tbody>
                      {Array.from({ length: rows }, (_, k) => {
                        const n = k + 1; const it = draftItems[k];
                        const ref = it ? (it.kind === 'service' ? (it.service_id ? `s:${it.service_id}` : '') : it.part_id ? `p:${it.part_id}` : '') : '';
                        return (
                          <tr key={n} className="border-t border-border align-top">
                            <td className="min-w-48 px-1 py-1"><input type="hidden" name={`i${n}_kind`} value={it?.kind ?? 'service'} /><CellSelect name={`i${n}_ref`} label={`Item ${n}: catálogo`} def={ref} placeholder="Item avulso" opts={refOptions} /></td>
                            <td className="min-w-56 px-1 py-1"><CellF name={`i${n}_desc`} label={`Item ${n}: descrição`} def={it?.description} max={200} placeholder="Descrição" /></td>
                            <td className="w-20 px-1 py-1"><CellF name={`i${n}_unit`} label={`Item ${n}: unidade`} def={it?.unit} max={16} placeholder="un" /></td>
                            <td className="w-28 px-1 py-1"><CellF name={`i${n}_qty`} label={`Item ${n}: quantidade`} def={it ? formatQuantity(milliFromNumeric(it.quantity)) : ''} inputMode="decimal" placeholder="1" /></td>
                            <td className="w-32 px-1 py-1"><CellF name={`i${n}_price`} label={`Item ${n}: preço unitário`} def={it ? price(it.unit_price_cents) : ''} inputMode="decimal" placeholder="0,00" /></td>
                            <td className="whitespace-nowrap px-2 py-2 text-sm tabular-nums">{it ? formatCents(it.line_total_cents) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="sm:col-span-4 text-xs text-muted">Escolher um item do catálogo preenche descrição, unidade e preço de referência quando estes campos ficam em branco. Mais linhas aparecem depois de salvar.</p>
                <TextF name="discount" label="Desconto fixo (R$)" def={price(draft.discount_cents)} inputMode="decimal" hint="Nunca maior que o subtotal." />
                <TextF name="valid_date" label="Válido até" type="date" def={validDefault} />
                <AreaF name="terms" label="Condições (aparecem no orçamento do cliente)" def={draft.terms_snapshot ?? c.settings.default_quote_terms} max={2000} />
                <AreaF name="notes" label="Observações" def={draft.notes} max={1000} />
              </>
            </OsForm>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <p className="text-sm">Subtotal salvo: <strong>{formatCents(draft.subtotal_cents)}</strong> · Desconto: {formatCents(draft.discount_cents)} · Total: <strong>{formatCents(draft.total_cents)}</strong></p>
              {draftItems.length ? <ActionButton action={publishQuote} fields={{ order: o.id, quote: draft.id, expected: String(draft.version) }} label="Publicar orçamento" variant="primary" confirm="Publicar congela o conteúdo desta versão. Continuar?" pending="Publicando…" /> : <span className="text-xs text-muted">Salve ao menos um item para poder publicar.</span>}
            </div>
          </Card>
        </Section>
      ) : null}

      <Section title="Versões do orçamento" description="Histórico completo. Versões antigas continuam disponíveis; a decisão sempre se refere a uma versão específica.">
        {d.quotes.filter((q) => q.status !== 'draft').length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhuma versão publicada ainda.</p> : (
          <div className="grid gap-4">
            {d.quotes.filter((q) => q.status !== 'draft').map((q) => {
              const dec = decisionOf(q);
              return (
                <Card key={q.id} title={`Versão ${q.version_number} — ${QUOTE_STATUS_LABEL[q.status]}`}>
                  <p className="mb-3 flex flex-wrap items-center gap-2 text-sm"><Badge tone={TONE[q.status]}>{QUOTE_STATUS_LABEL[q.status]}</Badge>
                    Publicada em {q.published_at ? <DateTimeLocal value={q.published_at} tz={c.tz} /> : '—'} · válida até {q.valid_until ? <DateTimeLocal value={q.valid_until} tz={c.tz} /> : '—'}</p>
                  <ItemsTable items={itemsOf(q)} caption={`Itens da versão ${q.version_number}`} />
                  <p className="mt-3 text-sm">Subtotal {formatCents(q.subtotal_cents)} · Desconto {formatCents(q.discount_cents)} · <strong>Total {formatCents(q.total_cents)}</strong></p>
                  {q.terms_snapshot ? <p className="mt-2 whitespace-pre-wrap text-xs text-muted">Condições: {q.terms_snapshot}</p> : null}
                  {dec ? (
                    <p className="mt-3 rounded-md border border-border p-3 text-sm">
                      <strong>{dec.decision === 'approved' ? 'Aprovado' : 'Recusado'}</strong> por <strong>{dec.declared_name}</strong> em <DateTimeLocal value={dec.decided_at} tz={c.tz} /> —{' '}
                      {dec.channel === 'customer_link' ? 'pelo link do cliente (aceite simples, sem verificação certificada de identidade)' : <>registro <strong>MANUAL</strong> da equipe feito por {dec.operator_user_id ? (dec.operator_user_id === me ? 'você' : d.names[dec.operator_user_id] ?? 'gestão') : 'gestão'} (não é ação autenticada do cliente). Justificativa: {dec.justification}</>}
                      {dec.note ? <>. Observação: {dec.note}</> : null}
                      <span className="mt-1 block text-xs text-muted">Texto aceito: {dec.accepted_text}</span>
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm"><a className="underline underline-offset-2" href={`/api/pdf/${o.id}/quote/${q.version_number}`}>Baixar PDF desta versão</a></p>
                  {mgr && q.status === 'published' ? (
                    <div className="mt-3"><Disclosure summary="Registrar a decisão do cliente manualmente (ex.: aprovou por telefone)">
                      <OsForm action={decideQuoteManual} submit="Registrar decisão" reset={false} className="grid gap-4 sm:grid-cols-2">
                        <>
                          <input type="hidden" name="order" value={o.id} /><input type="hidden" name="quote" value={q.id} />
                          <SelectF name="decision" label="Decisão" required def="approved" opts={[{ value: 'approved', label: 'Cliente aprovou' }, { value: 'rejected', label: 'Cliente recusou' }]} />
                          <TextF name="declared_name" label="Nome de quem decidiu" required max={120} />
                          <TextF name="justification" label="Justificativa do registro manual" required max={500} span hint="Como e quando o cliente decidiu (mín. 10 caracteres). Aparece como registro manual, não como ação do cliente." />
                          <TextF name="note" label="Observação (opcional)" max={1000} span />
                        </>
                      </OsForm>
                    </Disclosure></div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {mgr ? (
        <Section title="Custos internos" description="Visíveis só para a gestão. Nunca aparecem para o técnico, para o cliente nem em PDF. Correções entram como lançamentos negativos que referenciam o custo original.">
          <Card>
            <TableShell caption="Custos internos da ordem" empty={d.costs.length === 0} emptyText="Nenhum custo interno registrado.">
              <thead><tr><th className={TH}>Categoria</th><th className={TH}>Descrição</th><th className={TH}>Valor</th><th className={TH}>Registrado por</th><th className={TH}>Quando</th></tr></thead>
              <tbody>{d.costs.map((k) => <tr key={k.id} className="border-t border-border"><td className={TD}>{COST_CATEGORY_LABEL[k.category]}</td><td className={TD}>{k.description}{k.corrects_cost_id ? <> <Badge tone="warning">correção</Badge></> : null}</td><td className={TD}>{formatCents(k.amount_cents)}</td><td className={TD}>{k.recorded_by ? (k.recorded_by === me ? 'Você' : d.names[k.recorded_by] ?? '—') : '—'}</td><td className={TD}><DateTimeLocal value={k.recorded_at} tz={c.tz} /></td></tr>)}</tbody>
            </TableShell>
            <p className="mt-2 text-sm">Total registrado: <strong>{formatCents(d.costs.reduce((s, k) => s + k.amount_cents, 0))}</strong> <span className="text-xs text-muted">(custo interno, não é o valor cobrado)</span></p>
            {o.execution_status !== 'closed' && o.execution_status !== 'cancelled' ? (
              <div className="mt-4"><Disclosure summary="Registrar custo interno">
                <OsForm action={addCost} submit="Registrar custo" reset className="grid gap-4 sm:grid-cols-4">
                  <>
                    <input type="hidden" name="order" value={o.id} />
                    <SelectF name="category" label="Categoria" required opts={Object.entries(COST_CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} placeholder="Escolha" />
                    <TextF name="description" label="Descrição" required max={200} span />
                    <TextF name="amount" label="Valor (R$)" required inputMode="decimal" hint="Para corrigir, use «-» e escolha o custo ao lado." />
                    <SelectF name="corrects_cost_id" label="Corrige o custo (opcional)" span placeholder="Não é correção" opts={d.costs.filter((k) => k.amount_cents > 0).map((k) => ({ value: k.id, label: `${k.description} — ${formatCents(k.amount_cents)}` }))} />
                  </>
                </OsForm>
              </Disclosure></div>
            ) : null}
          </Card>
        </Section>
      ) : null}
    </>
  );
}
