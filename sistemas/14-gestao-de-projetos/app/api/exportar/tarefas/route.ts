import { NextResponse } from 'next/server';
import { resolveContext } from '@/lib/auth/session';
import { logEvent } from '@/lib/log';
import { rateLimit } from '@/lib/security/rate-limit';
import { toCsv, type Col } from '@/lib/pj/csv';
import { globalColumn, globalProject, taskFiltersFrom, taskQuery, type GlobalTask } from '@/lib/pj/data';
import { DEFAULT_SETTINGS, SETTINGS_COLUMNS, loadAccess, taskKey, type PageCtx, type PjSettings } from '@/lib/pj/page';
import type { SearchParams } from '@/lib/pj/query';
import { PRIORITY_LABEL, PROJECT_STATUS_LABEL, SEMANTIC_LABEL } from '@/lib/pj/status';
import { instantToLocal } from '@/lib/pj/time';
import { nowMs } from '@/lib/time';

export const dynamic = 'force-dynamic';

// Exportação CSV das tarefas: respeita os filtros da tela e o acesso do usuário (RLS: só tarefas de projetos que ele enxerga), usa a sessão dele e neutraliza fórmulas de planilha.
// A exportação entra na auditoria com a QUANTIDADE de linhas (nunca o conteúdo). Limite de 10.000 linhas por arquivo.
const COLS: Col[] = [
  { key: 'tarefa', label: 'Tarefa', kind: 'text' }, { key: 'titulo', label: 'Título', kind: 'text' }, { key: 'projeto', label: 'Projeto', kind: 'text' }, { key: 'status_projeto', label: 'Status do projeto', kind: 'text' },
  { key: 'etapa', label: 'Etapa', kind: 'text' }, { key: 'tipo_etapa', label: 'Tipo da etapa', kind: 'text' }, { key: 'prioridade', label: 'Prioridade', kind: 'text' }, { key: 'responsavel', label: 'Responsável', kind: 'text' },
  { key: 'inicio', label: 'Início', kind: 'text' }, { key: 'vencimento', label: 'Vencimento', kind: 'text' }, { key: 'bloqueada', label: 'Bloqueada', kind: 'text' }, { key: 'motivo_bloqueio', label: 'Motivo do bloqueio', kind: 'text' },
  { key: 'arquivada', label: 'Arquivada', kind: 'text' }, { key: 'concluida', label: 'Concluída em', kind: 'text' }, { key: 'criada', label: 'Criada em', kind: 'text' },
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
  const rl = rateLimit(`pj-export:${user.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return new NextResponse('Muitas exportações. Aguarde um instante.', { status: 429, headers: { 'retry-after': String(rl.retryAfterSeconds) } });
  const { data: st } = await supabase.from('pj_settings').select(SETTINGS_COLUMNS).eq('organization_id', org).maybeSingle();
  const settings = (st as PjSettings | null) ?? DEFAULT_SETTINGS;
  const now = nowMs();
  const sp: SearchParams = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = taskFiltersFrom(sp);
  const ctx = { ctx: r.ctx, org, settings, tz: settings.timezone, today: instantToLocal(now, settings.timezone).date, now, profile: access.profile, userId: user.id } as unknown as PageCtx;
  const { data: names } = await supabase.rpc('pj_people_names', { p_org: org });
  const nm = (names ?? {}) as Record<string, string>;
  const rows: Array<Record<string, string | number>> = [];
  for (let page = 1; rows.length < MAX_ROWS; page++) {
    const from = (page - 1) * 500;
    const { data } = await taskQuery(ctx, f).order('created_at', { ascending: false }).order('id').range(from, from + 499);
    const chunk = (data ?? []) as unknown as GlobalTask[];
    for (const t of chunk) {
      const p = globalProject(t); const col = globalColumn(t);
      rows.push({
        tarefa: p ? taskKey(settings.project_prefix, p.project_number, t.task_number) : `#${t.task_number}`, titulo: t.title, projeto: p?.name ?? '', status_projeto: p ? PROJECT_STATUS_LABEL[p.status] : '',
        etapa: col?.name ?? '', tipo_etapa: col ? SEMANTIC_LABEL[col.semantic_status] : '', prioridade: PRIORITY_LABEL[t.priority] ?? t.priority, responsavel: t.assignee_user_id ? nm[t.assignee_user_id] ?? 'Pessoa' : '',
        inicio: br(t.start_date), vencimento: br(t.due_date), bloqueada: t.blocked_at ? 'Sim' : 'Não', motivo_bloqueio: t.blocked_reason ?? '', arquivada: t.archived_at ? 'Sim' : 'Não',
        concluida: t.completed_at ? instantToLocal(Date.parse(t.completed_at), settings.timezone).date.split('-').reverse().join('/') : '', criada: instantToLocal(Date.parse(t.created_at), settings.timezone).date.split('-').reverse().join('/'),
      });
    }
    if (chunk.length < 500) break;
  }
  const out = rows.slice(0, MAX_ROWS);
  const audit = await supabase.rpc('pj_audit_export', { p_org: org, p_kind: 'tarefas', p_rows: out.length });
  if (audit.error) logEvent('error', 'pj_export_audit_failed', { code: audit.error.code });
  return new NextResponse(toCsv(COLS, out), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="tarefas.csv"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
}
