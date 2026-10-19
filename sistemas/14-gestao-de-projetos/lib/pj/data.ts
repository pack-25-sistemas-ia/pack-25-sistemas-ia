import 'server-only';
import { notFound } from 'next/navigation';
import type { PageCtx } from './page';
import { PAGE_SIZE, isUuid, one, pageFrom, safeSearch, type SearchParams } from './query';
import { addDays, isDate } from './time';
import { effectiveRole, isPriority, isProjectStatus, isSemantic, type OrgProfile, type Priority, type ProjectRole, type ProjectStatus, type Semantic } from './status';

// Leituras (sempre com a sessão do usuário: o RLS decide o que cada pessoa enxerga). Filtros vêm da URL e são validados; paginação e filtros ficam no SERVIDOR.
export type ProjectRow = {
  id: string; project_number: number; name: string; description: string | null; status: ProjectStatus; start_date: string | null; due_date: string | null; completed_at: string | null;
  archived_at: string | null; created_by: string | null; version: number; board_version: number; created_at: string; updated_at: string;
};
export const PROJECT_COLUMNS = 'id, project_number, name, description, status, start_date, due_date, completed_at, archived_at, created_by, version, board_version, created_at, updated_at';
export type ColumnRow = { id: string; project_id: string; name: string; semantic_status: Semantic; position: number };
export type LabelRow = { id: string; project_id: string; name: string; color: string };
export type MemberRow = { project_id: string; user_id: string; project_role: ProjectRole; created_at: string };
export type TaskRow = {
  id: string; project_id: string; task_number: number; column_id: string; title: string; description: string | null; priority: Priority; assignee_user_id: string | null; start_date: string | null; due_date: string | null;
  completed_at: string | null; blocked_at: string | null; blocked_reason: string | null; position: number; archived_at: string | null; version: number; created_by: string | null; created_at: string; updated_at: string;
};
export const TASK_COLUMNS = 'id, project_id, task_number, column_id, title, description, priority, assignee_user_id, start_date, due_date, completed_at, blocked_at, blocked_reason, position, archived_at, version, created_by, created_at, updated_at';
export type ChecklistRow = { id: string; task_id: string; title: string; required: boolean; completed_at: string | null; completed_by: string | null; position: number };
export type CommentRow = { id: string; task_id: string; author_user_id: string | null; body: string; created_at: string };
export type AttachmentRow = { id: string; task_id: string; original_filename: string; mime_type: string; size_bytes: number; uploaded_by: string | null; created_at: string };
export type EventRow = { id: number; event_type: string; actor_kind: string; actor_user_id: string | null; data: Record<string, unknown>; created_at: string; task_id?: string };
export type NotificationRow = { id: string; kind: string; project_id: string; task_id: string | null; actor_user_id: string | null; created_at: string; read_at: string | null };
export type PersonName = { user_id: string; name: string; project_role: ProjectRole | null; assignable: boolean; member: boolean };

export type ProjectView = {
  project: ProjectRow; columns: ColumnRow[]; labels: LabelRow[]; members: MemberRow[]; role: ProjectRole | null; people: PersonName[];
};

/** Projeto + etapas + etiquetas + participantes + papel do usuário + nomes. 404 se o usuário não enxerga (a mesma resposta para «não existe»). */
export async function loadProject(c: PageCtx, id: string): Promise<ProjectView> {
  if (!isUuid(id)) notFound();
  const sb = c.ctx.supabase;
  const { data: p } = await sb.from('projects').select(PROJECT_COLUMNS).eq('organization_id', c.org).eq('id', id).maybeSingle();
  if (!p) notFound();
  const [cols, labels, members, people] = await Promise.all([
    sb.from('project_columns').select('id, project_id, name, semantic_status, position').eq('project_id', id).order('position'),
    sb.from('project_labels').select('id, project_id, name, color').eq('project_id', id).order('name'),
    sb.from('project_members').select('project_id, user_id, project_role, created_at').eq('project_id', id).order('created_at'),
    sb.rpc('pj_project_people', { p_org: c.org, p_project: id }),
  ]);
  const memberRows = (members.data ?? []) as MemberRow[];
  const mine = memberRows.find((m) => m.user_id === c.userId)?.project_role ?? null;
  return {
    project: p as ProjectRow, columns: (cols.data ?? []) as ColumnRow[], labels: (labels.data ?? []) as LabelRow[], members: memberRows,
    role: effectiveRole(c.profile as OrgProfile | null, mine), people: (people.data ?? []) as PersonName[],
  };
}

export const nameOf = (people: PersonName[], id: string | null | undefined): string => (id ? people.find((p) => p.user_id === id)?.name ?? 'Pessoa' : '—');

export type TaskWithLabels = TaskRow & { task_labels: Array<{ label_id: string }> };
export type CardData = TaskWithLabels & { checklist: { done: number; total: number; requiredPending: number } };
const BOARD_LIMIT = 600;

export type BoardFilters = { assignee?: string; priority?: Priority; label?: string; q?: string; late?: boolean; blocked?: boolean; due?: 'overdue' | 'today' | 'week' };
export function boardFiltersFrom(sp: SearchParams): BoardFilters {
  const f: BoardFilters = {};
  const a = one(sp.assignee);
  if (a === 'none' || a === 'me' || isUuid(a)) f.assignee = a;
  const pr = one(sp.priority);
  if (isPriority(pr)) f.priority = pr;
  const l = one(sp.label);
  if (isUuid(l)) f.label = l;
  f.q = safeSearch(one(sp.q)) ?? undefined;
  if (one(sp.late) === '1') f.late = true;
  if (one(sp.blocked) === '1') f.blocked = true;
  return f;
}
export const hasBoardFilters = (f: BoardFilters): boolean => Object.values(f).some((v) => v !== undefined && v !== false);

const NUMBER_RE = /^(?:[A-Za-z0-9]{1,6}-\d{1,6}-)?#?(\d{1,9})$/;

/** Tarefas do quadro/lista de UM projeto, com etiquetas e resumo do checklist. Filtros no servidor; limite de segurança de tarefas por tela. */
export async function loadProjectTasks(c: PageCtx, projectId: string, f: BoardFilters, includeArchived = false): Promise<{ tasks: CardData[]; truncated: boolean }> {
  const sb = c.ctx.supabase;
  let q = sb.from('tasks').select(`${TASK_COLUMNS}, task_labels(label_id)`).eq('organization_id', c.org).eq('project_id', projectId);
  if (!includeArchived) q = q.is('archived_at', null);
  if (f.assignee === 'me') q = q.eq('assignee_user_id', c.userId);
  else if (f.assignee === 'none') q = q.is('assignee_user_id', null);
  else if (f.assignee) q = q.eq('assignee_user_id', f.assignee);
  if (f.priority) q = q.eq('priority', f.priority);
  if (f.blocked) q = q.not('blocked_at', 'is', null);
  if (f.late) q = q.lt('due_date', c.today);
  if (f.q) {
    const m = NUMBER_RE.exec(f.q.replace(/\s/g, ''));
    q = m ? q.eq('task_number', Number(m[1])) : q.ilike('title', `%${f.q}%`);
  }
  const { data } = await q.order('position').limit(BOARD_LIMIT + 1);
  let tasks = (data ?? []) as unknown as TaskWithLabels[];
  const truncated = tasks.length > BOARD_LIMIT;
  tasks = tasks.slice(0, BOARD_LIMIT);
  if (f.label) tasks = tasks.filter((t) => t.task_labels.some((l) => l.label_id === f.label));
  if (f.late) {
    const { data: cols } = await sb.from('project_columns').select('id, semantic_status').eq('project_id', projectId);
    const done = new Set(((cols ?? []) as Array<{ id: string; semantic_status: Semantic }>).filter((x) => x.semantic_status === 'done').map((x) => x.id));
    tasks = tasks.filter((t) => !done.has(t.column_id));
  }
  const ids = tasks.map((t) => t.id);
  const sums = new Map<string, { done: number; total: number; requiredPending: number }>();
  if (ids.length) {
    const { data: items } = await sb.from('task_checklist_items').select('task_id, required, completed_at').in('task_id', ids);
    for (const it of (items ?? []) as Array<{ task_id: string; required: boolean; completed_at: string | null }>) {
      const s = sums.get(it.task_id) ?? { done: 0, total: 0, requiredPending: 0 };
      s.total++;
      if (it.completed_at) s.done++; else if (it.required) s.requiredPending++;
      sums.set(it.task_id, s);
    }
  }
  return { tasks: tasks.map((t) => ({ ...t, checklist: sums.get(t.id) ?? { done: 0, total: 0, requiredPending: 0 } })), truncated };
}

// ---------------------------------------------------------------------------- lista global (Todas as tarefas)
export type GlobalTask = TaskRow & {
  projects: { name: string; project_number: number; status: ProjectStatus; archived_at: string | null } | { name: string; project_number: number; status: ProjectStatus; archived_at: string | null }[] | null;
  project_columns: { name: string; semantic_status: Semantic } | { name: string; semantic_status: Semantic }[] | null;
};
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
export const globalProject = (t: GlobalTask) => first(t.projects);
export const globalColumn = (t: GlobalTask) => first(t.project_columns);

export type TaskFilters = {
  project?: string; stage?: Semantic; assignee?: string; priority?: Priority; label?: string; q?: string; from?: string; to?: string; late?: boolean; blocked?: boolean; unassigned?: boolean;
  archived?: boolean; sort: 'due' | 'priority' | 'updated' | 'created'; page: number;
};
export function taskFiltersFrom(sp: SearchParams, defaults: Partial<TaskFilters> = {}): TaskFilters {
  const f: TaskFilters = { sort: 'due', page: pageFrom(one(sp.page)), ...defaults };
  const pj = one(sp.project);
  if (isUuid(pj)) f.project = pj;
  const st = one(sp.stage);
  if (isSemantic(st)) f.stage = st;
  const a = one(sp.assignee);
  if (a === 'none' || a === 'me' || isUuid(a)) f.assignee = a;
  const pr = one(sp.priority);
  if (isPriority(pr)) f.priority = pr;
  const l = one(sp.label);
  if (isUuid(l)) f.label = l;
  f.q = safeSearch(one(sp.q)) ?? undefined;
  const from = one(sp.from); const to = one(sp.to);
  if (from && isDate(from)) f.from = from;
  if (to && isDate(to)) f.to = to;
  if (one(sp.late) === '1') f.late = true;
  if (one(sp.blocked) === '1') f.blocked = true;
  if (one(sp.unassigned) === '1') f.unassigned = true;
  if (one(sp.archived) === '1') f.archived = true;
  const s = one(sp.sort);
  if (s === 'due' || s === 'priority' || s === 'updated' || s === 'created') f.sort = s;
  return f;
}

/** Consulta de tarefas autorizadas com filtros, ordenação e paginação NO SERVIDOR (o RLS limita aos projetos do usuário). */
export function taskQuery(c: PageCtx, f: TaskFilters, opts: { count?: boolean; stageInner?: boolean } = {}) {
  const inner = opts.stageInner || !!f.stage || !!f.late;
  const sel = `${TASK_COLUMNS}, projects(name, project_number, status, archived_at), ${inner ? 'project_columns!inner(name, semantic_status)' : 'project_columns(name, semantic_status)'}${f.label ? ', task_labels!inner(label_id)' : ''}`;
  let q = c.ctx.supabase.from('tasks').select(sel, opts.count ? { count: 'exact' } : undefined).eq('organization_id', c.org);
  if (!f.archived) q = q.is('archived_at', null);
  if (f.project) q = q.eq('project_id', f.project);
  if (f.stage) q = q.eq('project_columns.semantic_status', f.stage);
  if (f.assignee === 'me') q = q.eq('assignee_user_id', c.userId);
  else if (f.assignee === 'none' || f.unassigned) q = q.is('assignee_user_id', null);
  else if (f.assignee) q = q.eq('assignee_user_id', f.assignee);
  if (f.priority) q = q.eq('priority', f.priority);
  if (f.label) q = q.eq('task_labels.label_id', f.label);
  if (f.blocked) q = q.not('blocked_at', 'is', null);
  if (f.from) q = q.gte('due_date', f.from);
  if (f.to) q = q.lte('due_date', f.to);
  if (f.late) q = q.lt('due_date', c.today).neq('project_columns.semantic_status', 'done');
  if (f.q) {
    const m = NUMBER_RE.exec(f.q.replace(/\s/g, ''));
    q = m ? q.eq('task_number', Number(m[1])) : q.ilike('title', `%${f.q}%`);
  }
  return q;
}

export async function listTasks(c: PageCtx, f: TaskFilters, pageSize = PAGE_SIZE): Promise<{ rows: GlobalTask[]; total: number }> {
  let q = taskQuery(c, f, { count: true });
  if (f.sort === 'due') q = q.order('due_date', { ascending: true, nullsFirst: false }).order('priority_rank', { ascending: false });
  else if (f.sort === 'priority') q = q.order('priority_rank', { ascending: false }).order('due_date', { ascending: true, nullsFirst: false });
  else if (f.sort === 'updated') q = q.order('updated_at', { ascending: false });
  else q = q.order('created_at', { ascending: false });
  const from = (f.page - 1) * pageSize;
  const { data, count } = await q.order('id').range(from, from + pageSize - 1);
  return { rows: (data ?? []) as unknown as GlobalTask[], total: count ?? 0 };
}

/** Minhas tarefas: abertas e atribuídas ao usuário (agrupadas por data na página). */
export async function loadMyOpenTasks(c: PageCtx, limit = 400): Promise<GlobalTask[]> {
  const { data } = await c.ctx.supabase.from('tasks').select(`${TASK_COLUMNS}, projects(name, project_number, status, archived_at), project_columns!inner(name, semantic_status)`)
    .eq('organization_id', c.org).eq('assignee_user_id', c.userId).is('archived_at', null).neq('project_columns.semantic_status', 'done')
    .order('due_date', { ascending: true, nullsFirst: false }).order('priority_rank', { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as GlobalTask[]).filter((t) => { const p = globalProject(t); return p && p.status !== 'cancelled' && !p.archived_at; });
}

// ---------------------------------------------------------------------------- tarefa individual
export type TaskDetail = {
  task: TaskRow; project: ProjectView; column: ColumnRow | null; labelIds: string[]; checklist: ChecklistRow[]; comments: CommentRow[]; attachments: AttachmentRow[]; events: EventRow[];
};
export async function loadTask(c: PageCtx, id: string): Promise<TaskDetail> {
  if (!isUuid(id)) notFound();
  const sb = c.ctx.supabase;
  const { data: t } = await sb.from('tasks').select(TASK_COLUMNS).eq('organization_id', c.org).eq('id', id).maybeSingle();
  if (!t) notFound();
  const project = await loadProject(c, (t as TaskRow).project_id);
  const [labels, items, comments, atts, events] = await Promise.all([
    sb.from('task_labels').select('label_id').eq('task_id', id),
    sb.from('task_checklist_items').select('id, task_id, title, required, completed_at, completed_by, position').eq('task_id', id).order('position'),
    sb.from('task_comments').select('id, task_id, author_user_id, body, created_at').eq('task_id', id).order('created_at').limit(300),
    sb.from('task_attachments').select('id, task_id, original_filename, mime_type, size_bytes, uploaded_by, created_at').eq('task_id', id).order('created_at'),
    sb.from('task_events').select('id, event_type, actor_kind, actor_user_id, data, created_at').eq('task_id', id).order('id', { ascending: false }).limit(100),
  ]);
  return {
    task: t as TaskRow, project, column: project.columns.find((x) => x.id === (t as TaskRow).column_id) ?? null,
    labelIds: ((labels.data ?? []) as Array<{ label_id: string }>).map((l) => l.label_id), checklist: (items.data ?? []) as ChecklistRow[], comments: (comments.data ?? []) as CommentRow[],
    attachments: (atts.data ?? []) as AttachmentRow[], events: (events.data ?? []) as EventRow[],
  };
}

// ---------------------------------------------------------------------------- listas de projetos
export type ProjectProgress = { project_id: string; name: string; status: ProjectStatus; total: number; done: number; percent: number | null };
export type Dashboard = {
  period: { from: string; to: string; timezone: string; today: string };
  active_projects: number; open_tasks: number; overdue: number; blocked: number; unassigned: number; completed_in_period: number;
  by_stage: Record<Semantic, number>; by_priority: Record<Priority, number>;
  load: Array<{ user_id: string | null; name: string | null; open: number; overdue: number; blocked: number }>;
  progress: ProjectProgress[];
};
export async function loadDashboard(c: PageCtx, from: string, to: string, project?: string): Promise<Dashboard | null> {
  const { data, error } = await c.ctx.supabase.rpc('pj_dashboard', { p_org: c.org, p_from: from, p_to: to, p_project: project ?? null });
  return error ? null : (data as Dashboard);
}

export type ProjectFilters = { q?: string; status?: ProjectStatus; page: number };
export function projectFiltersFrom(sp: SearchParams): ProjectFilters {
  const f: ProjectFilters = { page: pageFrom(one(sp.page)) };
  f.q = safeSearch(one(sp.q)) ?? undefined;
  const st = one(sp.status);
  if (isProjectStatus(st)) f.status = st;
  return f;
}
export async function listProjects(c: PageCtx, f: ProjectFilters, opts: { archived: boolean; mine?: boolean }, pageSize = 12): Promise<{ rows: ProjectRow[]; total: number }> {
  let q = c.ctx.supabase.from('projects').select(PROJECT_COLUMNS, { count: 'exact' }).eq('organization_id', c.org);
  q = opts.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  if (f.status) q = q.eq('status', f.status);
  if (f.q) {
    const m = /^[A-Za-z0-9]{0,6}-?0*(\d{1,6})$/.exec(f.q.replace(/\s/g, ''));
    q = m ? q.eq('project_number', Number(m[1])) : q.ilike('name', `%${f.q}%`);
  }
  if (opts.mine && c.isManager) {
    const { data: mem } = await c.ctx.supabase.from('project_members').select('project_id').eq('user_id', c.userId);
    const ids = ((mem ?? []) as Array<{ project_id: string }>).map((m) => m.project_id);
    if (!ids.length) return { rows: [], total: 0 };
    q = q.in('id', ids);
  }
  const from = (f.page - 1) * pageSize;
  const { data, count } = await q.order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
  return { rows: (data ?? []) as ProjectRow[], total: count ?? 0 };
}

// ---------------------------------------------------------------------------- notificações e atividade
export async function loadNotifications(c: PageCtx, limit = 60): Promise<{ rows: NotificationRow[]; tasks: Map<string, { title: string; task_number: number; project_id: string }>; projects: Map<string, { name: string; project_number: number }>; names: Record<string, string> }> {
  const sb = c.ctx.supabase;
  const { data } = await sb.from('notifications').select('id, kind, project_id, task_id, actor_user_id, created_at, read_at').eq('user_id', c.userId).order('created_at', { ascending: false }).limit(limit);
  const rows = (data ?? []) as NotificationRow[];
  const tids = [...new Set(rows.map((r) => r.task_id).filter((x): x is string => !!x))];
  const pids = [...new Set(rows.map((r) => r.project_id))];
  const [t, p, n] = await Promise.all([
    tids.length ? sb.from('tasks').select('id, title, task_number, project_id').in('id', tids) : Promise.resolve({ data: [] }),
    pids.length ? sb.from('projects').select('id, name, project_number').in('id', pids) : Promise.resolve({ data: [] }),
    sb.rpc('pj_people_names', { p_org: c.org }),
  ]);
  return {
    rows,
    tasks: new Map(((t.data ?? []) as Array<{ id: string; title: string; task_number: number; project_id: string }>).map((x) => [x.id, x])),
    projects: new Map(((p.data ?? []) as Array<{ id: string; name: string; project_number: number }>).map((x) => [x.id, x])),
    names: ((n.data ?? {}) as Record<string, string>),
  };
}

export async function loadActivity(c: PageCtx, projectId: string, page: number, pageSize = 40): Promise<{ events: Array<EventRow & { scope: 'project' | 'task' }>; taskTitles: Map<string, { title: string; task_number: number }>; total: number }> {
  const sb = c.ctx.supabase;
  const [pe, te] = await Promise.all([
    sb.from('project_events').select('id, event_type, actor_kind, actor_user_id, data, created_at', { count: 'exact' }).eq('project_id', projectId).order('created_at', { ascending: false }).limit(300),
    sb.from('task_events').select('id, task_id, event_type, actor_kind, actor_user_id, data, created_at', { count: 'exact' }).eq('project_id', projectId).order('created_at', { ascending: false }).limit(300),
  ]);
  const all = [
    ...((pe.data ?? []) as EventRow[]).map((e) => ({ ...e, scope: 'project' as const })),
    ...((te.data ?? []) as EventRow[]).map((e) => ({ ...e, scope: 'task' as const })),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const from = (page - 1) * pageSize;
  const events = all.slice(from, from + pageSize);
  const tids = [...new Set(events.map((e) => e.task_id).filter((x): x is string => !!x))];
  const { data } = tids.length ? await sb.from('tasks').select('id, title, task_number').in('id', tids) : { data: [] };
  return { events, taskTitles: new Map(((data ?? []) as Array<{ id: string; title: string; task_number: number }>).map((x) => [x.id, x])), total: all.length };
}

export const plus7 = (today: string): string => addDays(today, 7);
