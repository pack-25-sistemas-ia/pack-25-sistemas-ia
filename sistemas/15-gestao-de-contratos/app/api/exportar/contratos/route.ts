import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import { toCsv, type Col } from '@/lib/ct/csv';
import { contractFiltersFrom, currentValue, deadlineFiltersFrom, listContracts, loadDeadlines } from '@/lib/ct/data';
import { contractKey } from '@/lib/ct/keys';
import { BILLING_LABEL, formatBRL, isBillingBasis } from '@/lib/ct/money';
import { DEADLINE_LABEL, LIFECYCLE_LABEL, SITUATION_LABEL, situationOf } from '@/lib/ct/status';
import { DEFAULT_SETTINGS, SETTINGS_COLUMNS, loadAccess, type CtSettings, type PageCtx } from '@/lib/ct/page';
import type { SearchParams } from '@/lib/ct/query';
import { addDays, instantToLocal } from '@/lib/ct/time';
import { nowMs } from '@/lib/time';

export const dynamic = 'force-dynamic';

// Exportação CSV: respeita os filtros da tela e o acesso do usuário (RLS: só contratos que ele enxerga), usa a sessão dele e neutraliza fórmulas de planilha.
// NÃO inclui documentos, links de arquivo nem CPF/CNPJ. Entra na auditoria com a QUANTIDADE de linhas (nunca o conteúdo). Limite de 10.000 linhas por arquivo.
const CONTRACT_COLS: Col[] = [
  { key: 'numero', label: 'Contrato', kind: 'text' }, { key: 'titulo', label: 'Título', kind: 'text' }, { key: 'partes', label: 'Partes', kind: 'text' }, { key: 'ciclo', label: 'Status', kind: 'text' },
  { key: 'situacao', label: 'Situação da vigência', kind: 'text' }, { key: 'inicio', label: 'Início', kind: 'text' }, { key: 'fim', label: 'Fim', kind: 'text' }, { key: 'aviso', label: 'Prazo de aviso', kind: 'text' },
  { key: 'responsavel', label: 'Responsável', kind: 'text' }, { key: 'valor', label: 'Valor vigente', kind: 'text' }, { key: 'periodicidade', label: 'Periodicidade', kind: 'text' }, { key: 'arquivado', label: 'Arquivado', kind: 'text' },
];
const DEADLINE_COLS: Col[] = [
  { key: 'data', label: 'Data', kind: 'text' }, { key: 'tipo', label: 'Tipo', kind: 'text' }, { key: 'contrato', label: 'Contrato', kind: 'text' }, { key: 'titulo_contrato', label: 'Título do contrato', kind: 'text' },
  { key: 'obrigacao', label: 'Obrigação', kind: 'text' }, { key: 'responsavel', label: 'Responsável', kind: 'text' },
];
const MAX_ROWS = 10_000;
const br = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

export async function GET(req: Request) {
  const r = await resolveContext();
  if (r.kind !== 'ok') return new NextResponse(r.kind === 'forbidden' ? 'Sem permissão' : 'Não autenticado', { status: r.kind === 'forbidden' ? 403 : 401 });
  const { supabase, user, membership } = r.ctx;
  const org = membership.organization_id;
  const access = await loadAccess(org);
  if (!access.profile) return new NextResponse('Sem permissão', { status: 403 });
  const rl = rateLimit(`ct-export:${user.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitas exportações. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data: st } = await supabase.from('ct_settings').select(SETTINGS_COLUMNS).eq('organization_id', org).maybeSingle();
  const settings = (st as CtSettings | null) ?? DEFAULT_SETTINGS;
  const today = instantToLocal(nowMs(), settings.timezone).date;
  const url = new URL(req.url);
  const sp: SearchParams = Object.fromEntries(url.searchParams.entries());
  const kind = url.searchParams.get('tipo') === 'prazos' ? 'prazos' : 'contratos';
  const c = { ctx: r.ctx, org, settings, tz: settings.timezone, today, now: nowMs(), profile: access.profile, userId: user.id } as unknown as PageCtx;
  const { data: names } = await supabase.rpc('ct_people_names', { p_org: org });
  const nm = (names ?? {}) as Record<string, string>;
  let cols: Col[]; const rows: Array<Record<string, string>> = [];
  if (kind === 'contratos') {
    cols = CONTRACT_COLS;
    const base = contractFiltersFrom(sp, sp.arquivados === '1');
    for (let page = 1; rows.length < MAX_ROWS; page++) {
      const res = await listContracts(c, { ...base, page }, 500);
      for (const k of res.rows) {
        const v = currentValue(res.values.get(k.id) ?? [], today);
        rows.push({
          numero: contractKey(settings.contract_prefix, k.contract_number), titulo: k.title, partes: (res.parties.get(k.id) ?? []).join(' | '), ciclo: LIFECYCLE_LABEL[k.lifecycle_status],
          situacao: k.lifecycle_status === 'active' || k.lifecycle_status === 'draft' ? SITUATION_LABEL[situationOf({ start: k.start_date, end: k.end_date, indefinite: k.indefinite_term }, today, settings.near_end_days)] : '',
          inicio: br(k.start_date), fim: k.indefinite_term ? 'Indeterminado' : br(k.end_date), aviso: br(k.notice_deadline_date), responsavel: k.responsible_user_id ? nm[k.responsible_user_id] ?? 'Pessoa' : '',
          valor: v ? formatBRL(v.amount_cents) : 'Sem dados', periodicidade: v && isBillingBasis(v.billing_basis) ? BILLING_LABEL[v.billing_basis] : '', arquivado: k.archived_at ? 'Sim' : 'Não',
        });
      }
      if (res.rows.length < 500) break;
    }
  } else {
    cols = DEADLINE_COLS;
    const from = url.searchParams.get('de') ?? today; const to = url.searchParams.get('ate') ?? addDays(today, 90);
    for (const d of await loadDeadlines(c, from, to, deadlineFiltersFrom(sp))) {
      rows.push({ data: br(d.date), tipo: DEADLINE_LABEL[d.kind], contrato: contractKey(settings.contract_prefix, d.contractNumber), titulo_contrato: d.contractTitle, obrigacao: d.title, responsavel: d.responsible ? nm[d.responsible] ?? 'Pessoa' : '' });
      if (rows.length >= MAX_ROWS) break;
    }
  }
  const audit = await supabase.rpc('ct_audit_export', { p_org: org, p_kind: kind, p_rows: rows.length });
  if (audit.error) logEvent('warn', 'ct_export_audit_failed', { code: audit.error.code ?? 'unknown' });
  return new NextResponse(toCsv(cols, rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${kind}.csv"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
