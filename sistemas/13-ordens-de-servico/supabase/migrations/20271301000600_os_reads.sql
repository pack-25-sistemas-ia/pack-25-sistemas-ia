-- Gestão de Ordens de Serviço — LEITURAS COMPOSTAS: prontidão da ordem, dados dos documentos (PDF) e painel.
-- Tudo calculado no banco, com os mesmos filtros de acesso das políticas. Documentos para o CLIENTE nunca incluem notas internas, custos, CPF/CNPJ nem rascunhos.

begin;
set local check_function_bodies = off;

-- Pendências da ordem para a interface (o servidor revalida tudo ao executar a ação).
create function public.os_order_readiness(p_org uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.service_orders;
begin
  perform private.os_guard(p_org, 'staff');
  select * into o from public.service_orders where id = p_order and organization_id = p_org;
  if not found or not private.os_order_visible(p_org, o.assigned_technician_user_id) then raise exception 'ordem de serviço não encontrada' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'exec_block', private.os_exec_block(p_order),
    'checklist_problems', to_jsonb(private.os_checklist_problems(p_order)),
    'divergence', private.os_parts_divergence(p_order),
    'accepted_current', exists (select 1 from public.completion_acceptances a where a.service_order_id = p_order and a.completion_version = o.completion_version and a.decision = 'accepted'),
    'acceptance', private.os_public_acceptance(p_order, o.completion_version));
end $$;

-- ======================================================================= dados dos documentos (para o PDF)
-- kind: quote (p_ref = número da versão) · summary · completion (p_ref = versão da conclusão).
create function private.os_document_data(p_order uuid, p_kind text, p_ref integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.service_orders; st public.os_settings; q public.quote_versions; cmp public.order_completions; snap public.service_order_snapshots; sv integer; qjson jsonb; cjson jsonb;
begin
  select * into o from public.service_orders where id = p_order;
  if not found then raise exception 'Documento não encontrado.' using errcode = 'P0002'; end if;
  select * into st from public.os_settings where organization_id = o.organization_id;
  if p_kind not in ('quote', 'summary', 'completion') then raise exception 'tipo de documento inválido' using errcode = '22023'; end if;
  if p_kind = 'quote' then
    select * into q from public.quote_versions where service_order_id = p_order and version_number = p_ref and status <> 'draft';
    if not found then raise exception 'Documento não encontrado.' using errcode = 'P0002'; end if;
    sv := q.snapshot_version;
  elsif p_kind = 'completion' then
    select * into cmp from public.order_completions where service_order_id = p_order and completion_version = p_ref;
    if not found then raise exception 'Documento não encontrado.' using errcode = 'P0002'; end if;
    sv := cmp.snapshot_version;
  else
    select * into q from public.quote_versions where service_order_id = p_order and status in ('published', 'approved', 'rejected')
      order by (status = 'approved') desc, (status = 'published') desc, version_number desc limit 1;
    select * into cmp from public.order_completions where service_order_id = p_order order by completion_version desc limit 1;
    sv := private.os_snapshot_current(p_order);
  end if;
  select * into snap from public.service_order_snapshots where service_order_id = p_order and snapshot_version = coalesce(sv, private.os_snapshot_current(p_order));
  if q.id is not null then
    qjson := jsonb_build_object('version_number', q.version_number, 'status', q.status, 'subtotal_cents', q.subtotal_cents, 'discount_cents', q.discount_cents, 'total_cents', q.total_cents,
      'valid_until', q.valid_until, 'terms', q.terms_snapshot, 'notes', q.notes, 'published_at', q.published_at,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'description', i.description, 'unit', i.unit, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents) order by i.position), '[]'::jsonb)
                from public.quote_items i where i.quote_version_id = q.id),
      'decision', (select jsonb_build_object('decision', d.decision, 'decided_at', d.decided_at, 'declared_name', d.declared_name, 'channel', d.channel, 'accepted_text', d.accepted_text) from public.quote_decisions d where d.quote_version_id = q.id));
  end if;
  if cmp.id is not null then
    cjson := jsonb_build_object('version', cmp.completion_version, 'summary', cmp.summary, 'completed_at', cmp.completed_at, 'parts', cmp.parts_snapshot,
      'checklist', (select coalesce(jsonb_agg(jsonb_build_object('group', c ->> 'group', 'label', c ->> 'label', 'not_applicable', (c ->> 'not_applicable')::boolean, 'answer', c -> 'answer')), '[]'::jsonb) from jsonb_array_elements(cmp.checklist_snapshot) c),
      'current', (cmp.completion_version = o.completion_version),
      'acceptance', (select jsonb_build_object('decision', a.decision, 'decided_at', a.decided_at, 'declared_name', a.declared_name, 'channel', a.channel, 'accepted_text', a.accepted_text, 'note', a.note)
                     from public.completion_acceptances a where a.service_order_id = p_order and a.completion_version = cmp.completion_version));
  end if;
  return jsonb_build_object('kind', p_kind, 'generated_at', now(),
    'company', jsonb_build_object('name', coalesce(st.public_display_name, (select display_name from public.organization_settings where organization_id = o.organization_id)), 'primary_color', st.primary_color, 'timezone', st.timezone, 'logo_path', st.logo_path),
    'order', jsonb_build_object('number_text', private.os_number_text(o.organization_id, o.order_number), 'subject', o.subject, 'problem_description', o.problem_description, 'status', o.execution_status,
      'priority', o.priority, 'created_at', o.created_at, 'scheduled_start_at', o.scheduled_start_at, 'scheduled_end_at', o.scheduled_end_at, 'started_at', o.started_at, 'completed_at', o.completed_at, 'closed_at', o.closed_at),
    'customer', jsonb_build_object('name', snap.customer_name, 'phone', snap.customer_phone, 'email', snap.customer_email, 'contact_name', snap.contact_name, 'contact_phone', snap.contact_phone,
      'address', snap.address, 'equipment', snap.equipment, 'snapshot_version', snap.snapshot_version),
    'quote', qjson, 'completion', cjson);
end $$;
revoke all on function private.os_document_data(uuid, text, integer) from public, anon, authenticated;

-- Documento para a equipe (mesmo conteúdo do documento do cliente: o relatório interno não faz parte do MVP).
create function public.os_document(p_org uuid, p_order uuid, p_kind text, p_ref integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'staff');
  if not private.os_can_see_order(p_org, p_order) then raise exception 'ordem de serviço não encontrada' using errcode = 'P0002'; end if;
  return private.os_document_data(p_order, p_kind, p_ref);
end $$;

-- ======================================================================= painel
-- Definições (docs/DASHBOARD.md): backlog = aberta + agendada + em execução + pausada · aguardando aceite = concluída sem aceite válido da versão atual ·
-- atrasada = backlog cuja janela planejada terminou (atraso da PREVISÃO, não SLA contratual) · tempo de ciclo = concluída − aberta (tempo corrido) ·
-- valor aprovado = total da última versão aprovada de cada ordem, com decisão no período (não é receita recebida nem faturamento).
-- O técnico enxerga apenas as próprias ordens e nenhum valor comercial.
create function public.os_dashboard(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare prof text; tz text; f timestamptz; t timestamptz; uid uuid := (select auth.uid()); res jsonb;
begin
  perform private.os_guard(p_org, 'staff');
  prof := private.os_profile(p_org);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'período inválido (no máximo 366 dias)' using errcode = '22023'; end if;
  select timezone into tz from public.os_settings where organization_id = p_org;
  f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;
  with scope as (
    select * from public.service_orders o where o.organization_id = p_org and (prof <> 'technician' or o.assigned_technician_user_id = uid)),
  backlog as (select * from scope where execution_status in ('open', 'scheduled', 'in_progress', 'paused')),
  latest_approved as (
    select distinct on (q.service_order_id) q.service_order_id, q.id, q.total_cents, d.decided_at
    from public.quote_versions q join public.quote_decisions d on d.quote_version_id = q.id and d.decision = 'approved'
    where q.organization_id = p_org and q.status = 'approved' and q.service_order_id in (select id from scope)
    order by q.service_order_id, q.version_number desc),
  effective_quote as (
    select distinct on (q.service_order_id) q.service_order_id, q.id from public.quote_versions q
    where q.organization_id = p_org and q.status in ('approved', 'published') and q.service_order_id in (select id from scope)
    order by q.service_order_id, (q.status = 'approved') desc, q.version_number desc),
  cycle as (select extract(epoch from (completed_at - created_at)) as secs from scope where completed_at >= f and completed_at < t and execution_status in ('completed', 'closed'))
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', tz),
    'profile', prof,
    'by_status', (select coalesce(jsonb_object_agg(execution_status, n), '{}'::jsonb) from (select execution_status, count(*) n from scope group by 1) s),
    'backlog', (select count(*) from backlog),
    'open', (select count(*) from scope where execution_status = 'open'),
    'scheduled', (select count(*) from scope where execution_status = 'scheduled'),
    'in_progress', (select count(*) from scope where execution_status = 'in_progress'),
    'paused', (select count(*) from scope where execution_status = 'paused'),
    'awaiting_acceptance', (select count(*) from scope o where execution_status = 'completed'
      and not exists (select 1 from public.completion_acceptances a where a.service_order_id = o.id and a.completion_version = o.completion_version and a.decision = 'accepted')),
    'closed_in_period', (select count(*) from scope where closed_at >= f and closed_at < t),
    'cancelled_in_period', (select count(*) from scope where cancelled_at >= f and cancelled_at < t),
    'unassigned', (select count(*) from backlog where assigned_technician_user_id is null),
    'late', (select count(*) from backlog where scheduled_end_at is not null and scheduled_end_at < now()),
    'opened_in_period', (select count(*) from scope where created_at >= f and created_at < t),
    'completed_in_period', (select count(*) from scope where completed_at >= f and completed_at < t and execution_status in ('completed', 'closed')),
    'rework_in_period', (select count(distinct e.service_order_id) from public.order_events e where e.organization_id = p_org and e.event_type in ('reopened', 'reopened_after_close')
      and e.created_at >= f and e.created_at < t and e.service_order_id in (select id from scope)),
    'cycle', jsonb_build_object('count', (select count(*) from cycle), 'avg_seconds', (select avg(secs) from cycle), 'median_seconds', (select percentile_cont(0.5) within group (order by secs) from cycle),
      'basis', 'tempo corrido entre a abertura e a conclusão'),
    'by_technician', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u, 'name', coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'), 'backlog', b, 'in_progress', ip, 'completed_in_period', cp) order by b desc, coalesce(p.full_name, '')), '[]'::jsonb)
      from (select assigned_technician_user_id as u, count(*) filter (where execution_status in ('open', 'scheduled', 'in_progress', 'paused')) as b,
                   count(*) filter (where execution_status = 'in_progress') as ip,
                   count(*) filter (where completed_at >= f and completed_at < t and execution_status in ('completed', 'closed')) as cp
            from scope where assigned_technician_user_id is not null group by 1) x left join public.profiles p on p.id = x.u),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('service', s, 'orders', n) order by n desc, s), '[]'::jsonb)
      from (select coalesce(sc.name, i.description) as s, count(distinct i.quote_version_id) as n
            from effective_quote e join public.quote_items i on i.quote_version_id = e.id and i.kind = 'service'
            join scope sco on sco.id = e.service_order_id and sco.created_at >= f and sco.created_at < t
            left join public.service_catalog sc on sc.id = i.service_id group by 1) z),
    'approved_value', case when prof = 'technician' then null else jsonb_build_object(
      'count', (select count(*) from latest_approved where decided_at >= f and decided_at < t),
      'total_cents', (select coalesce(sum(total_cents), 0) from latest_approved where decided_at >= f and decided_at < t),
      'basis', 'valor aprovado pelo cliente; não é receita recebida nem faturamento') end
  ) into res;
  return res;
end $$;

-- ======================================================================= arquivos
-- Dados para o download (a interface só recebe o id; o caminho do Storage nunca vai ao navegador). O banco decide se o usuário pode ver a ordem dona do arquivo.
create function public.os_attachment_info(p_org uuid, p_attachment uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.order_attachments;
begin
  perform private.os_guard(p_org, 'staff');
  select * into a from public.order_attachments where id = p_attachment and organization_id = p_org;
  if not found or not private.os_can_see_order(p_org, a.service_order_id) then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', a.storage_path, 'filename', a.original_filename, 'content_type', a.content_type);
end $$;

-- Uploads órfãos (enviados ao Storage mas nunca vinculados a uma ordem), com mais de 2 horas. Só lista; quem remove é a gestão, pela API do Storage (a política só permite apagar órfãos).
create function public.os_orphan_uploads(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'manager');
  if to_regclass('storage.objects') is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(o.name) from (
    select name from storage.objects where bucket_id = 'os-files' and name like p_org::text || '/%' and created_at < now() - interval '2 hours'
      and not exists (select 1 from public.order_attachments a where a.storage_path = storage.objects.name) limit 200) o), '[]'::jsonb);
end $$;

-- Exportações (CSV) ficam na auditoria: quem, quando e quantas linhas — nunca o conteúdo.
create function public.os_audit_export(p_org uuid, p_kind text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'manager');
  if p_kind is null or p_kind !~ '^[a-z_]{2,40}$' then raise exception 'tipo de exportação inválido' using errcode = '22023'; end if;
  perform private.os_audit(p_org, 'export', 'export_' || p_kind, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;

commit;
