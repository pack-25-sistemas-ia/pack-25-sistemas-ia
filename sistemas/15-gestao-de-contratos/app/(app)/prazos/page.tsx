import type { Metadata } from 'next';
import Link from 'next/link';
import { DateOnly, DeadlinePill, FSelect, FilterForm, Section, TD, TH, TableShell, Tabs } from '@/components/ct/bits';
import { PageHeader } from '@/components/ui/primitives';
import { deadlineFiltersFrom, loadDeadlines, peopleNames, type DeadlineItem } from '@/lib/ct/data';
import { MONTHS, monthGrid, relativeLabel, shiftMonth } from '@/lib/ct/dates';
import { contractKey } from '@/lib/ct/keys';
import { pageCtx } from '@/lib/ct/page';
import { one, withParams, type SearchParams } from '@/lib/ct/query';
import { DEADLINE_LABEL, DUE_BUCKET_LABEL, dueBucket, type DueBucket } from '@/lib/ct/status';
import { addDays } from '@/lib/ct/time';

export const metadata: Metadata = { title: 'Prazos e calendário' };
const KINDS = Object.entries(DEADLINE_LABEL).map(([value, label]) => ({ value, label }));
const ORDER: DueBucket[] = ['overdue', 'today', 'next7', 'next30', 'next90', 'later'];

export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const f = deadlineFiltersFrom(sp);
  const calendar = one(sp.vista) === 'calendario';
  const m = /^(\d{4})-(\d{2})$/.exec(one(sp.mes) ?? '');
  const year = m ? Number(m[1]) : Number(c.today.slice(0, 4)); const month = m ? Number(m[2]) : Number(c.today.slice(5, 7));
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = addDays(shiftMonth(year, month, 1).year + '-' + String(shiftMonth(year, month, 1).month).padStart(2, '0') + '-01', -1);
  const [items, names] = await Promise.all([
    loadDeadlines(c, calendar ? monthStart : addDays(c.today, -60), calendar ? monthEnd : addDays(c.today, 180), f), peopleNames(c)]);
  const who = Object.entries(names).map(([id, name]) => ({ value: id, label: name }));
  const prev = shiftMonth(year, month, -1); const next = shiftMonth(year, month, 1);
  const ym = (x: { year: number; month: number }) => `${x.year}-${String(x.month).padStart(2, '0')}`;
  const link = (d: DeadlineItem) => `/contratos/${d.contractId}?aba=prazos`;
  const label = (d: DeadlineItem) => `${contractKey(c.settings.contract_prefix, d.contractNumber)} · ${d.title || d.contractTitle}`;
  const byDay = new Map<string, DeadlineItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const grouped = ORDER.map((b) => ({ b, rows: items.filter((i) => dueBucket(i.date, c.today) === b) })).filter((g) => g.rows.length);
  return (
    <>
      <PageHeader title="Prazos e calendário" description="Fim de vigência, prazos de aviso, reajustes previstos e obrigações pendentes. Os prazos aparecem aqui mesmo que o agendador de lembretes não esteja configurado.">
        <a href={`/api/exportar/contratos?tipo=prazos&${new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === 'string' && ['kind', 'responsible', 'contract'].includes(k)) as Array<[string, string]>).toString()}`}
          className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5">Exportar CSV</a>
      </PageHeader>
      <Tabs current={calendar ? 'cal' : 'lista'} items={[{ key: 'lista', label: 'Lista', href: withParams('/prazos', sp, { vista: null, mes: null }) }, { key: 'cal', label: 'Calendário', href: withParams('/prazos', sp, { vista: 'calendario' }) }]} />
      <FilterForm clear={calendar ? '/prazos?vista=calendario' : '/prazos'}>
        {calendar ? <input type="hidden" name="vista" value="calendario" /> : null}
        <FSelect name="kind" label="Tipo" sp={sp} opts={KINDS} />
        <FSelect name="responsible" label="Responsável" sp={sp} opts={who} />
      </FilterForm>

      {!calendar ? (
        items.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum prazo no período (60 dias atrás até 180 dias à frente).</p> : (
          grouped.map((g) => (
            <Section key={g.b} title={DUE_BUCKET_LABEL[g.b]}>
              <TableShell caption={DUE_BUCKET_LABEL[g.b]}>
                <thead><tr><th className={TH}>Data</th><th className={TH}>Tipo</th><th className={TH}>Contrato</th><th className={TH}>Responsável</th></tr></thead>
                <tbody className="divide-y divide-border">{g.rows.map((i) => (
                  <tr key={i.kind + i.key}><td className={TD}><DateOnly value={i.date} /> <span className="text-xs text-muted">({relativeLabel(i.date, c.today)})</span></td><td className={TD}><DeadlinePill kind={i.kind} /></td>
                    <td className={TD}><Link className="underline underline-offset-2" href={link(i)}>{label(i)}</Link></td><td className={TD}>{i.responsible ? names[i.responsible] ?? 'Pessoa' : 'Sem responsável'}</td></tr>))}</tbody>
              </TableShell>
            </Section>
          ))
        )
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <Link className="rounded-md border border-border px-3 py-1.5 text-sm" href={withParams('/prazos', sp, { vista: 'calendario', mes: ym(prev) })}>← {MONTHS[prev.month - 1]}</Link>
            <h2 className="text-lg font-semibold capitalize">{MONTHS[month - 1]} de {year}</h2>
            <Link className="rounded-md border border-border px-3 py-1.5 text-sm" href={withParams('/prazos', sp, { vista: 'calendario', mes: ym(next) })}>{MONTHS[next.month - 1]} →</Link>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed border-collapse text-sm"><caption className="sr-only">Calendário de prazos</caption>
              <thead><tr>{['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((d) => <th key={d} className="border border-border bg-card px-2 py-1 text-xs uppercase text-muted">{d}</th>)}</tr></thead>
              <tbody>{monthGrid(year, month).map((w, i) => (
                <tr key={i}>{w.map((day, j) => (
                  <td key={j} className={`h-28 border border-border p-1 align-top ${day === c.today ? 'bg-primary/10' : ''}`}>
                    {day ? <><span className="text-xs text-muted">{Number(day.slice(8))}</span>
                      <ul className="mt-1 grid gap-1">{(byDay.get(day) ?? []).slice(0, 3).map((it) => <li key={it.kind + it.key}><Link href={link(it)} className="block truncate rounded border border-border px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/5" title={`${DEADLINE_LABEL[it.kind]}: ${label(it)}`}>{DEADLINE_LABEL[it.kind]} · {contractKey(c.settings.contract_prefix, it.contractNumber)}</Link></li>)}
                        {(byDay.get(day)?.length ?? 0) > 3 ? <li className="text-xs text-muted">+{(byDay.get(day)?.length ?? 0) - 3} mais</li> : null}</ul></> : null}
                  </td>))}</tr>))}</tbody>
            </table>
          </div>
          <div className="md:hidden">
            {items.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum prazo neste mês.</p> : (
              <ul className="grid gap-2">{items.map((i) => <li key={i.kind + i.key} className="rounded-lg border border-border bg-card p-3 text-sm"><p><DateOnly value={i.date} /> <DeadlinePill kind={i.kind} /></p><Link className="underline underline-offset-2" href={link(i)}>{label(i)}</Link></li>)}</ul>
            )}
          </div>
          {items.length === 0 ? <p className="mt-3 hidden text-sm text-muted md:block">Nenhum prazo neste mês.</p> : null}
        </>
      )}
    </>
  );
}
