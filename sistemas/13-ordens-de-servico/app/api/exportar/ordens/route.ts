import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import { toCsv, type Col } from '@/lib/os/csv';
import { filtersFrom, listOrders, loadPeople, customerName } from '@/lib/os/data';
import { loadAccess, numberText, SETTINGS_COLUMNS, DEFAULT_SETTINGS, type OsSettings } from '@/lib/os/page';
import type { SearchParams } from '@/lib/os/query';
import { PRIORITY_LABEL, QUOTE_MODE_LABEL, STATUS_LABEL, type Priority, type Status } from '@/lib/os/status';
import { formatInstant } from '@/lib/os/time';
import { nowMs } from '@/lib/time';

export const dynamic = 'force-dynamic';

// Exportação CSV das ordens: respeita os filtros da tela e as permissões (só a gestão exporta), usa a sessão do usuário (RLS) e neutraliza fórmulas de planilha.
// A exportação entra na auditoria com a QUANTIDADE de linhas (nunca o conteúdo). Limite de 10.000 linhas por arquivo.
const COLS: Col[] = [
  { key: 'numero', label: 'Número', kind: 'text' }, { key: 'assunto', label: 'Assunto', kind: 'text' }, { key: 'cliente', label: 'Cliente', kind: 'text' }, { key: 'status', label: 'Status', kind: 'text' },
  { key: 'prioridade', label: 'Prioridade', kind: 'text' }, { key: 'responsavel', label: 'Responsável', kind: 'text' }, { key: 'autorizacao', label: 'Autorização da execução', kind: 'text' },
  { key: 'aberta', label: 'Aberta em', kind: 'text' }, { key: 'janela_inicio', label: 'Janela início', kind: 'text' }, { key: 'janela_fim', label: 'Janela fim', kind: 'text' },
  { key: 'concluida', label: 'Concluída em', kind: 'text' }, { key: 'conclusao', label: 'Versão da conclusão', kind: 'int' },
];
const MAX_ROWS = 10_000;

export async function GET(req: Request) {
  const r = await resolveContext();
  if (r.kind !== 'ok') return new NextResponse(r.kind === 'forbidden' ? 'Sem permissão' : 'Não autenticado', { status: r.kind === 'forbidden' ? 403 : 401 });
  const { supabase, user, membership } = r.ctx;
  const access = await loadAccess(membership.organization_id);
  if (access.profile !== 'owner' && access.profile !== 'manager') return new NextResponse('Sem permissão', { status: 403 });
  const rl = rateLimit(`os-export:${user.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitas exportações. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data: st } = await supabase.from('os_settings').select(SETTINGS_COLUMNS).eq('organization_id', membership.organization_id).maybeSingle();
  const settings = (st as OsSettings | null) ?? DEFAULT_SETTINGS;
  const sp: SearchParams = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = filtersFrom(sp);
  const people = await loadPeople({ ctx: r.ctx, org: membership.organization_id, settings, tz: settings.timezone, today: '', now: nowMs(), profile: access.profile, userId: user.id, isStaff: true, isManager: true, isOwner: access.profile === 'owner', isTechnician: false });
  const names = Object.fromEntries(people.map((p) => [p.user_id, p.name]));
  const ctx = { ctx: r.ctx, org: membership.organization_id, settings, tz: settings.timezone, today: '', now: nowMs(), profile: access.profile, userId: user.id, isStaff: true, isManager: true, isOwner: access.profile === 'owner', isTechnician: false } as Parameters<typeof listOrders>[0];
  const rows: Array<Record<string, string | number>> = [];
  for (let page = 1; rows.length < MAX_ROWS; page++) {
    const { rows: chunk } = await listOrders(ctx, { ...f, page }, 500);
    for (const o of chunk) {
      rows.push({
        numero: numberText(settings.order_prefix, o.order_number), assunto: o.subject, cliente: customerName(o), status: STATUS_LABEL[o.execution_status as Status], prioridade: PRIORITY_LABEL[o.priority as Priority] ?? o.priority,
        responsavel: o.assigned_technician_user_id ? names[o.assigned_technician_user_id] ?? 'Técnico' : '', autorizacao: QUOTE_MODE_LABEL[o.quote_mode],
        aberta: formatInstant(Date.parse(o.created_at), settings.timezone), janela_inicio: o.scheduled_start_at ? formatInstant(Date.parse(o.scheduled_start_at), settings.timezone) : '', janela_fim: o.scheduled_end_at ? formatInstant(Date.parse(o.scheduled_end_at), settings.timezone) : '',
        concluida: o.completed_at ? formatInstant(Date.parse(o.completed_at), settings.timezone) : '', conclusao: o.completion_version,
      });
    }
    if (chunk.length < 500) break;
  }
  const out = rows.slice(0, MAX_ROWS);
  const audit = await supabase.rpc('os_audit_export', { p_org: membership.organization_id, p_kind: 'ordens', p_rows: out.length });
  if (audit.error) logEvent('error', 'os_export_audit_failed', { code: audit.error.code });
  return new NextResponse(toCsv(COLS, out), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ordens-de-servico.csv"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
}
