import 'server-only';
import { addDays } from './time';
import type { PageCtx } from './page';
import { PAGE_SIZE, isIsoDate, isUuid, pageFrom, safeSearch, one, type SearchParams } from './query';
import { effectiveRole, isLifecycle, type ContractRole, type Lifecycle, type OrgProfile } from './status';

export type ContractRow = {
  id: string; contract_number: number; title: string; description: string | null; category_id: string | null; lifecycle_status: Lifecycle; responsible_user_id: string | null;
  start_date: string; end_date: string | null; indefinite_term: boolean; notice_days: number | null; notice_reference_date: string | null; notice_deadline_date: string | null;
  notice_adjusted: boolean; notice_adjust_reason: string | null; renewal_mode: 'none' | 'manual'; ended_on: string | null; end_reason: string | null; archived_at: string | null;
  version: number; created_at: string; updated_at: string;
};
export const CONTRACT_COLS = 'id, contract_number, title, description, category_id, lifecycle_status, responsible_user_id, start_date, end_date, indefinite_term, notice_days, notice_reference_date, notice_deadline_date, notice_adjusted, notice_adjust_reason, renewal_mode, ended_on, end_reason, archived_at, version, created_at, updated_at';
export type ValueRow = { id: string; amount_cents: number; billing_basis: string; effective_from: string; source_change_id: string | null; source_adjustment_id: string | null; created_at: string };
export type Names = Record<string, string>;
export type Person = { user_id: string; name: string; contract_role: ContractRole | null; assignable: boolean };

/** Valor vigente numa data: a versão com maior effective_from até a data (a lista pode vir em qualquer ordem). */
export function currentValue(values: ValueRow[], date: string): ValueRow | null {
  let best: ValueRow | null = null;
  for (const v of values) if (v.effective_from <= date && (!best || v.effective_from > best.effective_from)) best = v;
  return best;
}

// ----------------------------------------------------------------------------- listas
export type ContractFilters = { q: string | null; status: Lifecycle | null; category: string | null; responsible: string | null; term: 'ending30' | 'ending60' | 'ending90' | 'ended' | 'indefinite' | null; archived: boolean; page: number };
export function contractFiltersFrom(sp: SearchParams, archived = false): ContractFilters {
  const s = one(sp.status); const term = one(sp.term);
  return {
    q: safeSearch(one(sp.q)), status: s && isLifecycle(s) ? s : null, category: isUuid(one(sp.category)) ? one(sp.category)! : null, responsible: isUuid(one(sp.responsible)) ? one(sp.responsible)! : null,
    term: term === 'ending30' || term === 'ending60' || term === 'ending90' || term === 'ended' || term === 'indefinite' ? term : null, archived, page: pageFrom(one(sp.page)),
  };
}

export async function listContracts(c: PageCtx, f: ContractFilters, size = PAGE_SIZE): Promise<{ rows: ContractRow[]; total: number; values: Map<string, ValueRow[]>; parties: Map<string, string[]> }> {
  let q = c.ctx.supabase.from('contracts').select(CONTRACT_COLS, { count: 'exact' }).eq('organization_id', c.org);
  q = f.archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  if (f.status) q = q.eq('lifecycle_status', f.status);
  if (f.category) q = q.eq('category_id', f.category);
  if (f.responsible) q = q.eq('responsible_user_id', f.responsible);
  if (f.q) q = /^\d+$/.test(f.q) ? q.eq('contract_number', Number(f.q)) : q.ilike('title', `%${f.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
  if (f.term === 'ended') q = q.lt('end_date', c.today).eq('lifecycle_status', 'active');
  else if (f.term === 'indefinite') q = q.eq('indefinite_term', true);
  else if (f.term) q = q.gte('end_date', c.today).lte('end_date', addDays(c.today, f.term === 'ending30' ? 30 : f.term === 'ending60' ? 60 : 90));
  const from = (f.page - 1) * size;
  const { data, count } = await q.order(f.term ? 'end_date' : 'contract_number', { ascending: !!f.term, nullsFirst: false }).range(from, from + size - 1);
  const rows = (data ?? []) as unknown as ContractRow[];
  const ids = rows.map((r) => r.id);
  const values = new Map<string, ValueRow[]>(); const parties = new Map<string, string[]>();
  if (ids.length) {
    const [v, p] = await Promise.all([
      c.ctx.supabase.from('contract_value_versions').select('id, contract_id, amount_cents, billing_basis, effective_from, source_change_id, source_adjustment_id, created_at').in('contract_id', ids),
      c.ctx.supabase.from('contract_parties').select('contract_id, identity_snapshot').in('contract_id', ids),
    ]);
    for (const x of (v.data ?? []) as unknown as Array<ValueRow & { contract_id: string }>) values.set(x.contract_id, [...(values.get(x.contract_id) ?? []), x]);
    for (const x of (p.data ?? []) as unknown as Array<{ contract_id: string; identity_snapshot: { name?: string } }>) parties.set(x.contract_id, [...(parties.get(x.contract_id) ?? []), x.identity_snapshot?.name ?? '—']);
  }
  return { rows, total: count ?? 0, values, parties };
}

export async function peopleNames(c: PageCtx): Promise<Names> {
  const { data } = await c.ctx.supabase.rpc('ct_people_names', { p_org: c.org });
  return (data ?? {}) as Names;
}
export async function listCategories(c: PageCtx): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const { data } = await c.ctx.supabase.from('contract_categories').select('id, name, active').eq('organization_id', c.org).order('name');
  return (data ?? []) as Array<{ id: string; name: string; active: boolean }>;
}
export type CounterpartyRow = { id: string; person_type: 'person' | 'company'; name: string; email: string | null; phone: string | null; address: string | null; active: boolean; version: number };
export async function listCounterparties(c: PageCtx, search?: string | null, withDocs = false): Promise<Array<CounterpartyRow & { document_number?: string | null }>> {
  let q = c.ctx.supabase.from('counterparties').select('id, person_type, name, email, phone, address, active, version').eq('organization_id', c.org).order('name').limit(500);
  if (search) q = q.ilike('name', `%${search.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
  const { data } = await q;
  const rows = (data ?? []) as CounterpartyRow[];
  if (!withDocs || !rows.length) return rows;
  const d = await c.ctx.supabase.from('counterparty_documents').select('counterparty_id, document_number').in('counterparty_id', rows.map((r) => r.id));
  const map = new Map(((d.data ?? []) as Array<{ counterparty_id: string; document_number: string }>).map((x) => [x.counterparty_id, x.document_number]));
  return rows.map((r) => ({ ...r, document_number: map.get(r.id) ?? null }));
}
export async function listMembers(c: PageCtx): Promise<Array<{ user_id: string; name: string; email: string; role: string; profile: OrgProfile }>> {
  const { data } = await c.ctx.supabase.rpc('ct_people', { p_org: c.org });
  return ((data ?? []) as Array<{ user_id: string; name: string; email: string; role: string; profile: OrgProfile }>);
}

// ----------------------------------------------------------------------------- um contrato
export type ContractDetail = {
  contract: ContractRow; role: ContractRole | null; category: string | null; values: ValueRow[];
  parties: Array<{ counterparty_id: string; role_description: string; snapshot: { name?: string; person_type?: string; document_masked?: string | null }; active: boolean | null }>;
  access: Array<{ user_id: string; contract_role: 'editor' | 'reader' }>;
  documents: Array<{ id: string; title: string; document_type: string; current_version_id: string | null; created_at: string; versions: Array<{ id: string; version_number: number; original_filename: string; mime_type: string; size_bytes: number; sha256: string | null; uploaded_by: string | null; created_at: string }> }>;
  changes: Array<{ id: string; change_type: string; effective_date: string; description: string; document_version_id: string | null; before_snapshot: Record<string, unknown>; after_snapshot: Record<string, unknown>; created_by: string | null; created_at: string }>;
  rule: { frequency_months: number; next_adjustment_date: string; reference_label: string | null; active: boolean } | null;
  adjustments: Array<{ id: string; effective_date: string; percentage_decimal: number; new_amount_cents: number; base_value_version_id: string; reference_label: string | null; reference_period: string | null; source_note: string | null; justification: string | null; status: string; proposed_at: string; applied_at: string | null }>;
  obligations: Array<{ id: string; title: string; description: string | null; responsible_user_id: string | null; due_date: string; status: string; completed_at: string | null; completion_note: string | null; version: number }>;
  deadlines: Array<{ id: string; deadline_type: string; due_date: string; source_reference: string | null; revision: number; superseded_at: string | null }>;
  events: Array<{ id: number; event_type: string; actor_kind: string; actor_user_id: string | null; data: Record<string, unknown>; created_at: string }>;
  people: Person[];
};

export async function loadContract(c: PageCtx, id: string): Promise<ContractDetail | null> {
  if (!isUuid(id)) return null;
  const s = c.ctx.supabase;
  const { data: row } = await s.from('contracts').select(CONTRACT_COLS).eq('id', id).eq('organization_id', c.org).maybeSingle();
  if (!row) return null;
  const contract = row as unknown as ContractRow;
  const [cat, vals, parts, acc, docs, chg, rule, adj, obl, dl, ev, ppl] = await Promise.all([
    contract.category_id ? s.from('contract_categories').select('name').eq('id', contract.category_id).maybeSingle() : Promise.resolve({ data: null }),
    s.from('contract_value_versions').select('id, amount_cents, billing_basis, effective_from, source_change_id, source_adjustment_id, created_at').eq('contract_id', id).order('effective_from', { ascending: false }),
    s.from('contract_parties').select('counterparty_id, role_description, identity_snapshot').eq('contract_id', id).order('created_at'),
    s.from('contract_access').select('user_id, contract_role').eq('contract_id', id),
    s.from('contract_documents').select('id, title, document_type, current_version_id, created_at').eq('contract_id', id).order('created_at', { ascending: false }),
    s.from('contract_changes').select('id, change_type, effective_date, description, document_version_id, before_snapshot, after_snapshot, created_by, created_at').eq('contract_id', id).order('created_at', { ascending: false }),
    s.from('contract_adjustment_rules').select('frequency_months, next_adjustment_date, reference_label, active').eq('contract_id', id).maybeSingle(),
    s.from('contract_adjustments').select('id, effective_date, percentage_decimal, new_amount_cents, base_value_version_id, reference_label, reference_period, source_note, justification, status, proposed_at, applied_at').eq('contract_id', id).order('proposed_at', { ascending: false }),
    s.from('contract_obligations').select('id, title, description, responsible_user_id, due_date, status, completed_at, completion_note, version').eq('contract_id', id).order('due_date'),
    s.from('contract_deadlines').select('id, deadline_type, due_date, source_reference, revision, superseded_at').eq('contract_id', id).order('created_at', { ascending: false }),
    s.from('contract_events').select('id, event_type, actor_kind, actor_user_id, data, created_at').eq('contract_id', id).order('id', { ascending: false }).limit(150),
    s.rpc('ct_contract_people', { p_org: c.org, p_contract: id }),
  ]);
  const docRows = (docs.data ?? []) as Array<{ id: string; title: string; document_type: string; current_version_id: string | null; created_at: string }>;
  const versions = docRows.length ? await s.from('contract_document_versions').select('id, document_id, version_number, original_filename, mime_type, size_bytes, sha256, uploaded_by, created_at').in('document_id', docRows.map((d) => d.id)).order('version_number', { ascending: false }) : { data: [] };
  const vByDoc = new Map<string, ContractDetail['documents'][number]['versions']>();
  for (const v of (versions.data ?? []) as unknown as Array<{ document_id: string } & ContractDetail['documents'][number]['versions'][number]>) vByDoc.set(v.document_id, [...(vByDoc.get(v.document_id) ?? []), v]);
  const partRows = (parts.data ?? []) as unknown as Array<{ counterparty_id: string; role_description: string; identity_snapshot: ContractDetail['parties'][number]['snapshot'] }>;
  const cps = partRows.length ? await s.from('counterparties').select('id, active').in('id', partRows.map((p) => p.counterparty_id)) : { data: [] };
  const activeMap = new Map(((cps.data ?? []) as Array<{ id: string; active: boolean }>).map((x) => [x.id, x.active]));
  const accessRows = (acc.data ?? []) as ContractDetail['access'];
  const mine = accessRows.find((a) => a.user_id === c.userId)?.contract_role ?? null;
  return {
    contract, role: effectiveRole(c.profile, mine), category: (cat.data as { name?: string } | null)?.name ?? null, values: (vals.data ?? []) as unknown as ValueRow[],
    parties: partRows.map((p) => ({ counterparty_id: p.counterparty_id, role_description: p.role_description, snapshot: p.identity_snapshot, active: activeMap.get(p.counterparty_id) ?? null })),
    access: accessRows, documents: docRows.map((d) => ({ ...d, versions: vByDoc.get(d.id) ?? [] })),
    changes: (chg.data ?? []) as unknown as ContractDetail['changes'], rule: (rule.data as ContractDetail['rule']) ?? null, adjustments: (adj.data ?? []) as unknown as ContractDetail['adjustments'],
    obligations: (obl.data ?? []) as unknown as ContractDetail['obligations'], deadlines: (dl.data ?? []) as unknown as ContractDetail['deadlines'], events: (ev.data ?? []) as unknown as ContractDetail['events'],
    people: ((ppl.data ?? []) as Array<{ user_id: string; name: string; contract_role: ContractRole | null; assignable: boolean }>),
  };
}

// ----------------------------------------------------------------------------- prazos, obrigações, reajustes, notificações, painel
export type DeadlineItem = { key: string; kind: 'contract_end' | 'notice' | 'adjustment' | 'obligation'; date: string; title: string; contractId: string; contractNumber: number; contractTitle: string; responsible: string | null; status?: string };
export type DeadlineFilters = { kind: DeadlineItem['kind'] | null; responsible: string | null; contract: string | null };
export function deadlineFiltersFrom(sp: SearchParams): DeadlineFilters {
  const k = one(sp.kind);
  return { kind: k === 'contract_end' || k === 'notice' || k === 'adjustment' || k === 'obligation' ? k : null, responsible: isUuid(one(sp.responsible)) ? one(sp.responsible)! : null, contract: isUuid(one(sp.contract)) ? one(sp.contract)! : null };
}

/** Prazos correntes dos contratos ativos e rascunhos + obrigações pendentes, no intervalo [from, to] (inclusivo). Funciona SEM o agendador. */
export async function loadDeadlines(c: PageCtx, from: string, to: string, f: DeadlineFilters): Promise<DeadlineItem[]> {
  const s = c.ctx.supabase;
  const [d, o] = await Promise.all([
    s.from('contract_deadlines').select('id, deadline_type, due_date, contract_id').eq('organization_id', c.org).is('superseded_at', null).gte('due_date', from).lte('due_date', to).limit(2000),
    s.from('contract_obligations').select('id, title, due_date, contract_id, responsible_user_id, status').eq('organization_id', c.org).eq('status', 'pending').gte('due_date', from).lte('due_date', to).limit(2000),
  ]);
  const dl = (d.data ?? []) as Array<{ id: string; deadline_type: DeadlineItem['kind']; due_date: string; contract_id: string }>;
  const ob = (o.data ?? []) as Array<{ id: string; title: string; due_date: string; contract_id: string; responsible_user_id: string | null; status: string }>;
  const ids = [...new Set([...dl.map((x) => x.contract_id), ...ob.map((x) => x.contract_id)])];
  const cs = ids.length ? await s.from('contracts').select('id, contract_number, title, responsible_user_id, lifecycle_status, archived_at').in('id', ids) : { data: [] };
  const cmap = new Map(((cs.data ?? []) as Array<{ id: string; contract_number: number; title: string; responsible_user_id: string | null; lifecycle_status: string; archived_at: string | null }>).map((x) => [x.id, x]));
  const items: DeadlineItem[] = [];
  for (const x of dl) { const k = cmap.get(x.contract_id); if (k && !k.archived_at) items.push({ key: x.id, kind: x.deadline_type, date: x.due_date, title: '', contractId: x.contract_id, contractNumber: k.contract_number, contractTitle: k.title, responsible: k.responsible_user_id }); }
  for (const x of ob) { const k = cmap.get(x.contract_id); if (k && !k.archived_at) items.push({ key: x.id, kind: 'obligation', date: x.due_date, title: x.title, contractId: x.contract_id, contractNumber: k.contract_number, contractTitle: k.title, responsible: x.responsible_user_id ?? k.responsible_user_id, status: x.status }); }
  return items.filter((i) => (!f.kind || i.kind === f.kind) && (!f.responsible || i.responsible === f.responsible) && (!f.contract || i.contractId === f.contract)).sort((a, b) => a.date.localeCompare(b.date) || a.contractNumber - b.contractNumber);
}

export type ObligationItem = { id: string; title: string; due_date: string; status: string; responsible_user_id: string | null; contract_id: string; contractNumber: number; contractTitle: string; completed_at: string | null; version: number };
export async function loadObligations(c: PageCtx, status: 'pending' | 'completed' | 'cancelled' | null, page: number): Promise<{ rows: ObligationItem[]; total: number }> {
  let q = c.ctx.supabase.from('contract_obligations').select('id, title, due_date, status, responsible_user_id, contract_id, completed_at, version', { count: 'exact' }).eq('organization_id', c.org);
  if (status) q = q.eq('status', status);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await q.order('due_date', { ascending: status !== 'completed' }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as Array<Omit<ObligationItem, 'contractNumber' | 'contractTitle'>>;
  const ids = [...new Set(rows.map((r) => r.contract_id))];
  const cs = ids.length ? await c.ctx.supabase.from('contracts').select('id, contract_number, title').in('id', ids) : { data: [] };
  const map = new Map(((cs.data ?? []) as Array<{ id: string; contract_number: number; title: string }>).map((x) => [x.id, x]));
  return { rows: rows.map((r) => ({ ...r, contractNumber: map.get(r.contract_id)?.contract_number ?? 0, contractTitle: map.get(r.contract_id)?.title ?? '—' })), total: count ?? 0 };
}

export type AdjustmentOverview = { contractId: string; contractNumber: number; contractTitle: string; next: string; frequency: number; label: string | null; open: { id: string; percentage: number; effective_date: string; new_amount_cents: number } | null; current: ValueRow | null };
export async function loadAdjustments(c: PageCtx): Promise<AdjustmentOverview[]> {
  const s = c.ctx.supabase;
  const { data: rules } = await s.from('contract_adjustment_rules').select('contract_id, frequency_months, next_adjustment_date, reference_label').eq('organization_id', c.org).eq('active', true).order('next_adjustment_date').limit(500);
  const rs = (rules ?? []) as Array<{ contract_id: string; frequency_months: number; next_adjustment_date: string; reference_label: string | null }>;
  if (!rs.length) return [];
  const ids = rs.map((r) => r.contract_id);
  const [cs, vs, ad] = await Promise.all([
    s.from('contracts').select('id, contract_number, title, lifecycle_status, archived_at').in('id', ids),
    s.from('contract_value_versions').select('id, contract_id, amount_cents, billing_basis, effective_from, source_change_id, source_adjustment_id, created_at').in('contract_id', ids),
    s.from('contract_adjustments').select('id, contract_id, percentage_decimal, effective_date, new_amount_cents').in('contract_id', ids).eq('status', 'proposed'),
  ]);
  const cmap = new Map(((cs.data ?? []) as Array<{ id: string; contract_number: number; title: string; lifecycle_status: string; archived_at: string | null }>).map((x) => [x.id, x]));
  const vmap = new Map<string, ValueRow[]>();
  for (const v of (vs.data ?? []) as unknown as Array<ValueRow & { contract_id: string }>) vmap.set(v.contract_id, [...(vmap.get(v.contract_id) ?? []), v]);
  const amap = new Map(((ad.data ?? []) as Array<{ id: string; contract_id: string; percentage_decimal: number; effective_date: string; new_amount_cents: number }>).map((x) => [x.contract_id, x]));
  return rs.filter((r) => { const k = cmap.get(r.contract_id); return k && k.lifecycle_status === 'active' && !k.archived_at; }).map((r) => {
    const k = cmap.get(r.contract_id)!; const a = amap.get(r.contract_id);
    return { contractId: r.contract_id, contractNumber: k.contract_number, contractTitle: k.title, next: r.next_adjustment_date, frequency: r.frequency_months, label: r.reference_label,
      open: a ? { id: a.id, percentage: Number(a.percentage_decimal), effective_date: a.effective_date, new_amount_cents: Number(a.new_amount_cents) } : null, current: currentValue(vmap.get(r.contract_id) ?? [], c.today) };
  });
}

export type NotificationRow = { id: string; kind: string; contract_id: string; source_id: string | null; due_date: string | null; offset_days: number | null; actor_user_id: string | null; read_at: string | null; created_at: string };
export async function loadNotifications(c: PageCtx, page: number): Promise<{ rows: NotificationRow[]; total: number; contracts: Map<string, { contract_number: number; title: string }> }> {
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await c.ctx.supabase.from('notifications').select('id, kind, contract_id, source_id, due_date, offset_days, actor_user_id, read_at, created_at', { count: 'exact' })
    .eq('organization_id', c.org).eq('user_id', c.userId ?? '').order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as NotificationRow[];
  const ids = [...new Set(rows.map((r) => r.contract_id))];
  const cs = ids.length ? await c.ctx.supabase.from('contracts').select('id, contract_number, title').in('id', ids) : { data: [] };
  return { rows, total: count ?? 0, contracts: new Map(((cs.data ?? []) as Array<{ id: string; contract_number: number; title: string }>).map((x) => [x.id, x])) };
}

export type Dashboard = {
  period: { today: string; timezone: string; near_end_days: number }; active: number; drafts: number; valid_today: number; ending_30: number; ending_60: number; ending_90: number; end_reached: number;
  notice_soon: number; notice_overdue: number; obligations_pending: number; obligations_overdue: number; adjustments_expected: number; without_responsible: number; renewals_12m: number; without_value: number;
  values_by_basis: Record<string, { contracts: number; amount_cents: number }>; documents_by_category: Array<{ category: string; documents: number }>;
};
export async function loadDashboard(c: PageCtx): Promise<Dashboard> {
  const { data } = await c.ctx.supabase.rpc('ct_dashboard', { p_org: c.org });
  return data as Dashboard;
}

export async function loadRunInfo(c: PageCtx): Promise<{ last: { started_at: string; status: string; reminders_sent: number; reminders_consolidated: number; errors: number; trigger: string } | null; tokenSet: boolean }> {
  const { data } = await c.ctx.supabase.from('ct_job_runs').select('started_at, status, reminders_sent, reminders_consolidated, errors, trigger').eq('organization_id', c.org).order('started_at', { ascending: false }).limit(1);
  return { last: ((data ?? [])[0] as { started_at: string; status: string; reminders_sent: number; reminders_consolidated: number; errors: number; trigger: string } | undefined) ?? null, tokenSet: false };
}
export { isIsoDate };
