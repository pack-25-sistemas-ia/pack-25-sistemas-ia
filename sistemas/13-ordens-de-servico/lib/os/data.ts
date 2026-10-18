import 'server-only';
import type { PageCtx } from './page';
import { PAGE_SIZE, isUuid, one, pageFrom, safeSearch, type SearchParams } from './query';
import { addDays, isDate, localToInstant } from './time';
import { BACKLOG, isPriority, isStatus, type Status } from './status';
import type { ChecklistItem } from './checklist';

// Leituras (sempre com a sessão do usuário: o RLS decide o que cada perfil enxerga). Filtros vêm da URL e são validados.
export type OrderRow = {
  id: string; order_number: number; subject: string; execution_status: Status; priority: string; scheduled_start_at: string | null; scheduled_end_at: string | null;
  assigned_technician_user_id: string | null; created_at: string; completed_at: string | null; completion_version: number; version: number; quote_mode: 'required' | 'authorized'; customer_id: string;
  customers: { name: string } | { name: string }[] | null;
};
export const ORDER_COLUMNS = 'id, order_number, subject, execution_status, priority, scheduled_start_at, scheduled_end_at, assigned_technician_user_id, created_at, completed_at, completion_version, version, quote_mode, customer_id, customers(name)';
export const customerName = (r: Pick<OrderRow, 'customers'>): string => (Array.isArray(r.customers) ? r.customers[0]?.name : r.customers?.name) ?? '—';

export type Person = { user_id: string; role: string; profile: string | null; name: string; email: string; active: boolean };

/** Pessoas da empresa (só a gestão enxerga a lista completa; técnicos só se veem). */
export async function loadPeople(c: PageCtx): Promise<Person[]> {
  if (!c.isManager) return [{ user_id: c.userId, role: 'member', profile: c.profile, name: 'Você', email: c.ctx.user.email, active: true }];
  const { data } = await c.ctx.supabase.rpc('os_people', { p_org: c.org });
  return ((data ?? []) as Person[]);
}
export const technicians = (people: Person[]): Person[] => people.filter((p) => p.active && (p.profile === 'technician' || p.profile === 'manager' || p.profile === 'owner'));

export type ListFilters = { status?: string; tech?: string; priority?: string; q?: string; customer?: string; from?: string; to?: string; late?: boolean; mine?: boolean; page: number };
export function filtersFrom(sp: SearchParams, defaults: Partial<ListFilters> = {}): ListFilters {
  const f: ListFilters = { page: pageFrom(one(sp.page)), ...defaults };
  const st = one(sp.status);
  if (st === 'backlog' || isStatus(st)) f.status = st;
  const tech = one(sp.tech);
  if (tech === 'none' || tech === 'me' || isUuid(tech)) f.tech = tech;
  const pr = one(sp.priority);
  if (isPriority(pr)) f.priority = pr;
  f.q = safeSearch(one(sp.q)) ?? undefined;
  const cu = one(sp.customer);
  if (isUuid(cu)) f.customer = cu;
  const from = one(sp.from); const to = one(sp.to);
  if (from && isDate(from)) f.from = from;
  if (to && isDate(to)) f.to = to;
  if (one(sp.late) === '1') f.late = true;
  return f;
}

export async function listOrders(c: PageCtx, f: ListFilters, pageSize = PAGE_SIZE): Promise<{ rows: OrderRow[]; total: number }> {
  let q = c.ctx.supabase.from('service_orders').select(ORDER_COLUMNS, { count: 'exact' }).eq('organization_id', c.org);
  if (f.status === 'backlog') q = q.in('execution_status', BACKLOG as unknown as string[]);
  else if (f.status) q = q.eq('execution_status', f.status);
  if (f.mine || f.tech === 'me') q = q.eq('assigned_technician_user_id', c.userId);
  else if (f.tech === 'none') q = q.is('assigned_technician_user_id', null);
  else if (f.tech) q = q.eq('assigned_technician_user_id', f.tech);
  if (f.priority) q = q.eq('priority', f.priority);
  if (f.customer) q = q.eq('customer_id', f.customer);
  if (f.from) q = q.gte('created_at', new Date(localToInstant(f.from, '00:00', c.tz)).toISOString());
  if (f.to) q = q.lt('created_at', new Date(localToInstant(addDays(f.to, 1), '00:00', c.tz)).toISOString());
  if (f.late) q = q.in('execution_status', BACKLOG as unknown as string[]).lt('scheduled_end_at', new Date(c.now).toISOString());
  if (f.q) {
    const m = /^[A-Za-z]{0,6}-?0*(\d{1,9})$/.exec(f.q.replace(/\s/g, ''));
    if (m) q = q.eq('order_number', Number(m[1]));
    else {
      let ids: string[] = [];
      if (c.isManager) {
        const { data } = await c.ctx.supabase.from('customers').select('id').eq('organization_id', c.org).ilike('name', `%${f.q}%`).limit(30);
        ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
      }
      q = ids.length ? q.or(`subject.ilike.%${f.q}%,customer_id.in.(${ids.join(',')})`) : q.ilike('subject', `%${f.q}%`);
    }
  }
  const from = (f.page - 1) * pageSize;
  const { data, count } = await q.order('created_at', { ascending: false }).order('order_number', { ascending: false }).range(from, from + pageSize - 1);
  return { rows: (data ?? []) as unknown as OrderRow[], total: count ?? 0 };
}

export type QuoteVersion = {
  id: string; version_number: number; status: 'draft' | 'published' | 'approved' | 'rejected' | 'superseded'; subtotal_cents: number; discount_cents: number; total_cents: number; valid_until: string | null;
  terms_snapshot: string | null; notes: string | null; published_at: string | null; created_at: string; version: number; snapshot_version: number | null;
};
export type QuoteItem = { id: string; quote_version_id: string; position: number; kind: 'service' | 'part'; service_id: string | null; part_id: string | null; description: string; unit: string; quantity: string; unit_price_cents: number; line_total_cents: number };
export type Decision = { quote_version_id: string; decision: string; channel: string; declared_name: string; note: string | null; accepted_text: string; decided_at: string; justification: string | null; operator_user_id: string | null };
export type Snapshot = { snapshot_version: number; reason: string | null; customer_name: string; customer_phone: string | null; customer_email: string | null; contact_name: string | null; contact_phone: string | null; address: Record<string, string> | null; equipment: Record<string, string> | null; created_at: string };
export type ChecklistRow = {
  id: string; group_name: string; position: number; label: string; kind: ChecklistItem['kind']; options: string[] | null; required: boolean; allow_na: boolean; require_photo: boolean; note_rule: ChecklistItem['noteRule'];
  answer_bool: boolean | null; answer_text: string | null; answer_number: string | null; answer_option: string | null; not_applicable: boolean; note: string | null; answered_by: string | null; answered_at: string | null;
};
export type UsageRow = { id: string; part_id: string | null; description: string; unit: string; quantity: string; entry_kind: 'usage' | 'reversal' | 'adjustment'; reference_usage_id: string | null; reason: string | null; used_at: string; registered_by: string | null; registered_at: string };
export type CostRow = { id: string; category: string; description: string; amount_cents: number; corrects_cost_id: string | null; recorded_by: string | null; recorded_at: string };
export type UpdateRow = { id: string; author_user_id: string | null; visibility: 'internal' | 'customer'; body: string; created_at: string };
export type AttachmentRow = { id: string; update_id: string | null; checklist_item_id: string | null; category: string; visibility: 'internal' | 'customer'; original_filename: string; content_type: string; size_bytes: number; uploaded_by: string | null; created_at: string };
export type EventRow = { id: number; event_type: string; actor_kind: string; actor_user_id: string | null; data: Record<string, unknown>; created_at: string };
export type CompletionRow = { completion_version: number; summary: string; divergence_note: string | null; completed_by: string | null; completed_at: string; snapshot_version: number; parts_snapshot: Array<{ description: string; unit: string; quantity: string | number }>; quote_snapshot: { version_number?: number; total_cents?: number } | null };
export type AcceptanceRow = { completion_version: number; decision: 'accepted' | 'contested'; channel: string; declared_name: string; accepted_text: string; note: string | null; decided_at: string; justification: string | null; operator_user_id: string | null };
export type PauseRow = { id: string; started_at: string; ended_at: string | null; reason: string };
export type Readiness = { exec_block: string | null; checklist_problems: string[]; divergence: Array<{ key: string; description: string; unit: string; quoted_qty: number; used_qty: number; delta: number; relevant: boolean }> | null; accepted_current: boolean; acceptance: { decision: string } | null };

export type OrderDetail = {
  order: Record<string, unknown> & { id: string; organization_id: string; order_number: number; execution_status: Status; version: number; completion_version: number; quote_mode: 'required' | 'authorized'; priority: string; subject: string; problem_description: string;
    assigned_technician_user_id: string | null; scheduled_start_at: string | null; scheduled_end_at: string | null; created_at: string; started_at: string | null; completed_at: string | null; closed_at: string | null; cancelled_at: string | null; cancel_reason: string | null;
    customer_id: string; address_id: string | null; equipment_id: string | null; authorization_justification: string | null; authorized_by: string | null; authorized_at: string | null };
  snapshots: Snapshot[]; quotes: QuoteVersion[]; items: QuoteItem[]; decisions: Decision[]; checklist: ChecklistRow[]; usage: UsageRow[]; costs: CostRow[]; updates: UpdateRow[]; attachments: AttachmentRow[];
  events: EventRow[]; completions: CompletionRow[]; acceptances: AcceptanceRow[]; pauses: PauseRow[]; link: { id: string; expires_at: string; created_at: string; last_used_at: string | null } | null; ready: Readiness; names: Record<string, string>;
};

export async function loadOrder(c: PageCtx, id: string): Promise<OrderDetail | null> {
  const s = c.ctx.supabase;
  const { data: order } = await s.from('service_orders').select('*').eq('id', id).eq('organization_id', c.org).maybeSingle();
  if (!order) return null;
  const [snaps, quotes, items, decisions, checklist, usage, costs, updates, atts, events, completions, acceptances, pauses, links, ready, names, photoRows] = await Promise.all([
    s.from('service_order_snapshots').select('snapshot_version, reason, customer_name, customer_phone, customer_email, contact_name, contact_phone, address, equipment, created_at').eq('service_order_id', id).order('snapshot_version', { ascending: false }),
    s.from('quote_versions').select('id, version_number, status, subtotal_cents, discount_cents, total_cents, valid_until, terms_snapshot, notes, published_at, created_at, version, snapshot_version').eq('service_order_id', id).order('version_number', { ascending: false }),
    s.from('quote_items').select('id, quote_version_id, position, kind, service_id, part_id, description, unit, quantity, unit_price_cents, line_total_cents, quote_versions!inner(service_order_id)').eq('quote_versions.service_order_id', id).order('position'),
    s.from('quote_decisions').select('quote_version_id, decision, channel, declared_name, note, accepted_text, decided_at, justification, operator_user_id').eq('service_order_id', id),
    s.from('order_checklist_items').select('id, group_name, position, label, kind, options, required, allow_na, require_photo, note_rule, answer_bool, answer_text, answer_number, answer_option, not_applicable, note, answered_by, answered_at').eq('service_order_id', id).order('position'),
    s.from('order_part_usage').select('id, part_id, description, unit, quantity, entry_kind, reference_usage_id, reason, used_at, registered_by, registered_at').eq('service_order_id', id).order('registered_at'),
    c.isManager ? s.from('order_internal_costs').select('id, category, description, amount_cents, corrects_cost_id, recorded_by, recorded_at').eq('service_order_id', id).order('recorded_at') : Promise.resolve({ data: [] }),
    s.from('order_updates').select('id, author_user_id, visibility, body, created_at').eq('service_order_id', id).order('created_at', { ascending: false }).limit(100),
    s.from('order_attachments').select('id, update_id, checklist_item_id, category, visibility, original_filename, content_type, size_bytes, uploaded_by, created_at').eq('service_order_id', id).order('created_at', { ascending: false }).limit(200),
    s.from('order_events').select('id, event_type, actor_kind, actor_user_id, data, created_at').eq('service_order_id', id).order('id', { ascending: false }).limit(200),
    s.from('order_completions').select('completion_version, summary, divergence_note, completed_by, completed_at, snapshot_version, parts_snapshot, quote_snapshot').eq('service_order_id', id).order('completion_version', { ascending: false }),
    s.from('completion_acceptances').select('completion_version, decision, channel, declared_name, accepted_text, note, decided_at, justification, operator_user_id').eq('service_order_id', id).order('completion_version', { ascending: false }),
    s.from('order_pauses').select('id, started_at, ended_at, reason').eq('service_order_id', id).order('started_at', { ascending: false }),
    c.isManager ? s.from('public_access_tokens').select('id, expires_at, created_at, last_used_at').eq('service_order_id', id).is('revoked_at', null).gt('expires_at', new Date(c.now).toISOString()).maybeSingle() : Promise.resolve({ data: null }),
    s.rpc('os_order_readiness', { p_org: c.org, p_order: id }),
    s.rpc('os_order_people', { p_org: c.org, p_order: id }),
    s.from('order_attachments').select('checklist_item_id').eq('service_order_id', id).not('checklist_item_id', 'is', null).like('content_type', 'image/%'),
  ]);
  void photoRows;
  return {
    order: order as OrderDetail['order'],
    snapshots: (snaps.data ?? []) as Snapshot[], quotes: (quotes.data ?? []) as QuoteVersion[], items: ((items.data ?? []) as unknown as QuoteItem[]), decisions: (decisions.data ?? []) as Decision[],
    checklist: (checklist.data ?? []) as unknown as ChecklistRow[], usage: (usage.data ?? []) as UsageRow[], costs: (costs.data ?? []) as CostRow[], updates: (updates.data ?? []) as UpdateRow[],
    attachments: (atts.data ?? []) as AttachmentRow[], events: (events.data ?? []) as unknown as EventRow[], completions: (completions.data ?? []) as unknown as CompletionRow[],
    acceptances: (acceptances.data ?? []) as AcceptanceRow[], pauses: (pauses.data ?? []) as PauseRow[], link: (links.data ?? null) as OrderDetail['link'],
    ready: (ready.data ?? { exec_block: null, checklist_problems: [], divergence: null, accepted_current: false, acceptance: null }) as Readiness, names: (names.data ?? {}) as Record<string, string>,
  };
}

export type Option = { value: string; label: string };
export const toOptions = <T extends { id: string }>(rows: T[] | null | undefined, label: (r: T) => string): Option[] => (rows ?? []).map((r) => ({ value: r.id, label: label(r) }));
