import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/primitives';
import { PAGE_SIZE, one, withParams, type SearchParams } from '@/lib/ct/query';
import { DEADLINE_LABEL, DEADLINE_TONE, LIFECYCLE_LABEL, LIFECYCLE_TONE, SITUATION_LABEL, SITUATION_TONE, type DeadlineKind, type Lifecycle, type Situation } from '@/lib/ct/status';
import { formatDateBR, formatInstant } from '@/lib/ct/time';
import { cn } from '@/lib/utils';

export type Opt = { value: string; label: string };

/** Data e hora SEMPRE no fuso da empresa (nunca no do navegador ou do servidor). */
export function DateTimeLocal({ value, tz }: { value: string | null | undefined; tz: string }) {
  if (!value) return <span>—</span>;
  return <span className="tabular-nums whitespace-nowrap">{formatInstant(Date.parse(value), tz)}</span>;
}

/** Data de planejamento («AAAA-MM-DD», sem fuso): exibida como dd/mm/aaaa, sem conversão. */
export function DateOnly({ value }: { value: string | null | undefined }) {
  if (!value) return <span>—</span>;
  return <span className="tabular-nums whitespace-nowrap">{formatDateBR(value)}</span>;
}

export function LifecyclePill({ status, archived }: { status: string; archived?: boolean }) {
  const s = status as Lifecycle;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={LIFECYCLE_TONE[s] ?? 'neutral'}>{LIFECYCLE_LABEL[s] ?? status}</Badge>
      {archived ? <Badge tone="neutral">Arquivado</Badge> : null}
    </span>
  );
}

/** Situação temporal derivada das datas (não depende de job): texto E cor, nunca só cor. */
export function SituationPill({ situation }: { situation: Situation }) {
  return <Badge tone={SITUATION_TONE[situation] ?? 'neutral'}>{SITUATION_LABEL[situation]}</Badge>;
}

/** Distingue fim de vigência, prazo de aviso, reajuste previsto e obrigação: sempre com o nome por extenso. */
export function DeadlinePill({ kind }: { kind: DeadlineKind }) {
  return <Badge tone={DEADLINE_TONE[kind] ?? 'neutral'}>{DEADLINE_LABEL[kind]}</Badge>;
}

/** Iniciais num círculo discreto (nunca a única forma de identificar a pessoa: o nome sempre aparece em texto). */
export function Avatar({ name }: { name: string }) {
  const initials = name.split(/s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  return <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-foreground">{initials}</span>;
}

/** Cartão de indicador: valor, rótulo e a definição (visível, não só tooltip). */
export function Kpi({ label, value, tone, definition }: { label: string; value: ReactNode; tone?: 'neutral' | 'danger' | 'success' | 'warning'; definition?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning')}>{value}</p>
      {definition ? <p className="mt-2 text-xs leading-snug text-muted">{definition}</p> : null}
    </Card>
  );
}

export function Tabs({ items, current }: { items: Array<{ href: string; label: string; key: string }>; current: string }) {
  return (
    <nav aria-label="Seções" className="mb-5 flex flex-wrap gap-1 border-b border-border">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? 'page' : undefined}
          className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', i.key === current ? 'border-primary text-foreground' : 'border-transparent text-muted hover:text-foreground')}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ base, sp, page, total, size = PAGE_SIZE }: { base: string; sp: SearchParams; page: number; total: number; size?: number }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <p className="mt-3 text-xs text-muted">{total} registro(s)</p>;
  const link = (p: number) => withParams(base, sp, { page: p === 1 ? null : String(p) });
  return (
    <nav aria-label="Paginação" className="mt-3 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{total} registro(s) · página {page} de {pages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className="rounded-md border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5" href={link(page - 1)}>Anterior</Link> : null}
        {page < pages ? <Link className="rounded-md border border-border px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5" href={link(page + 1)}>Próxima</Link> : null}
      </span>
    </nav>
  );
}

export function Section({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Painel recolhível sem JavaScript (details/summary): usado para formulários secundários. */
export function Disclosure({ summary, children, open = false, tone = 'secondary' }: { summary: string; children: ReactNode; open?: boolean; tone?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <details open={open} className="group rounded-lg border border-border bg-card">
      <summary className={cn('flex min-h-10 cursor-pointer list-none items-center rounded-lg px-4 text-sm font-medium', tone === 'primary' && 'bg-primary text-primary-foreground', tone === 'danger' && 'text-danger')}>{summary}</summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

export const TH = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted';
export const TD = 'px-3 py-2 align-top text-sm';

export function TableShell({ caption, children, empty, emptyText }: { caption: string; children: ReactNode; empty?: boolean; emptyText?: string }) {
  if (empty) return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{emptyText ?? 'Nenhum registro encontrado.'}</p>;
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** Filtros por URL (GET): funcionam sem JavaScript e a página fica compartilhável. */
export function FilterForm({ children, action, clear }: { children: ReactNode; action?: string; clear: string }) {
  return (
    <form method="get" action={action} className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
      {children}
      <div className="flex items-center gap-3">
        <button type="submit" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">Filtrar</button>
        <Link href={clear} className="text-sm text-muted underline underline-offset-2">Limpar</Link>
      </div>
    </form>
  );
}
export function FSelect({ name, label, opts, sp, placeholder = 'Todos' }: { name: string; label: string; opts: Opt[]; sp: SearchParams; placeholder?: string }) {
  const cur = one(sp[name]) ?? '';
  return (
    <label className="flex min-w-36 flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select name={name} defaultValue={cur} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm font-normal text-foreground">
        <option value="">{placeholder}</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
export function FInput({ name, label, sp, type = 'text', placeholder }: { name: string; label: string; sp: SearchParams; type?: string; placeholder?: string }) {
  return (
    <label className="flex min-w-36 flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input name={name} type={type} defaultValue={one(sp[name]) ?? ''} placeholder={placeholder} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm font-normal text-foreground" />
    </label>
  );
}

export function DefinitionList({ items, compact = false }: { items: Array<[string, ReactNode]>; compact?: boolean }) {
  return (
    <dl className={compact ? 'grid grid-cols-2 gap-x-4 gap-y-2' : 'grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3'}>
      {items.map(([k, v]) => (
        <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-sm">{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

