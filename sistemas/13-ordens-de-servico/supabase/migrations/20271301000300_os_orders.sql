-- Gestão de Ordens de Serviço — CICLO DE VIDA DA ORDEM (RPCs os_*): abrir, editar, atribuir, agendar, iniciar, pausar, retomar, concluir, reabrir, encerrar, cancelar,
-- checklist, peças utilizadas, custos internos, notas e arquivos.
-- Regras no banco (a interface só reflete): número sem MAX+1 (contador com trava de linha), idempotência por chave, versão otimista (40001), travas de linha nas transições,
-- orçamento aprovado exigido para iniciar/retomar (ou execução autorizada com justificativa), checklist validado no servidor, conclusão congelada por versão.

begin;
set local check_function_bodies = off;

-- ======================================================================= auxiliares
create function private.os_check_window(p_start timestamptz, p_end timestamptz) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_start is null or p_end is null then raise exception 'informe início e fim da janela de atendimento' using errcode = '22023'; end if;
  if p_end <= p_start then raise exception 'o fim da janela precisa ser depois do início' using errcode = '22023'; end if;
  if p_end > p_start + interval '14 days' then raise exception 'a janela de atendimento pode ter no máximo 14 dias' using errcode = '22023'; end if;
end $$;
revoke all on function private.os_check_window(timestamptz, timestamptz) from public, anon, authenticated;

-- Outras ordens do mesmo técnico, ainda não encerradas, cuja janela se sobrepõe. É ALERTA (não bloqueio): a agenda do MVP representa janelas planejadas.
create function private.os_conflicts(p_org uuid, p_tech uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'start', o.scheduled_start_at, 'end', o.scheduled_end_at) order by o.scheduled_start_at), '[]'::jsonb)
  from public.service_orders o
  where o.organization_id = p_org and p_tech is not null and o.assigned_technician_user_id = p_tech and o.id is distinct from p_exclude
    and o.execution_status in ('scheduled', 'in_progress', 'paused') and o.scheduled_start_at is not null
    and o.scheduled_start_at < p_end and o.scheduled_end_at > p_start;
$$;
revoke all on function private.os_conflicts(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

create function public.os_schedule_conflicts(p_org uuid, p_tech uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'manager');
  perform private.os_check_window(p_start, p_end);
  return private.os_conflicts(p_org, p_tech, p_start, p_end, p_exclude);
end $$;

-- Pode iniciar/retomar? NULL = sim; texto = motivo do bloqueio. Uma versão de orçamento publicada e ainda sem decisão BLOQUEIA (o cliente pode recusar a nova condição).
create function private.os_exec_block(p_order uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare o public.service_orders;
begin
  select * into o from public.service_orders where id = p_order;
  if o.quote_mode = 'authorized' then return null; end if;
  if exists (select 1 from public.quote_versions where service_order_id = p_order and status = 'published') then
    return 'Há uma versão de orçamento publicada aguardando a decisão do cliente. Aguarde a aprovação ou recusa antes de iniciar ou retomar.';
  end if;
  if not exists (select 1 from public.quote_versions where service_order_id = p_order and status = 'approved') then
    return 'Esta ordem exige orçamento aprovado antes de iniciar ou retomar a execução.';
  end if;
  return null;
end $$;
revoke all on function private.os_exec_block(uuid) from public, anon, authenticated;

-- Quem pode agir na execução: o técnico responsável ou a gestão.
create function private.os_can_execute(o public.service_orders) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.os_profile(o.organization_id)
    when 'owner' then true when 'manager' then true
    when 'technician' then coalesce(o.assigned_technician_user_id = (select auth.uid()), false)
    else false end;
$$;
revoke all on function private.os_can_execute(public.service_orders) from public, anon, authenticated;

-- Orçamento-base (última versão aprovada) × peças efetivamente utilizadas. NULL quando não há orçamento aprovado (nada a comparar).
-- Chave de comparação: peça do catálogo (id) ou, para texto livre, a descrição normalizada. relevant = usou MAIS do que o aprovado (inclui peça não orçada).
create function private.os_parts_divergence(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare base uuid; rows jsonb;
begin
  select id into base from public.quote_versions where service_order_id = p_order and status = 'approved' order by version_number desc limit 1;
  if base is null then return null; end if;
  with quoted as (
    select coalesce(qi.part_id::text, 'd:' || lower(btrim(qi.description))) as k, max(qi.description) as d, max(qi.unit) as u, sum(qi.quantity) as q
    from public.quote_items qi where qi.quote_version_id = base and qi.kind = 'part' group by 1),
  used as (
    select coalesce(u.part_id::text, 'd:' || lower(btrim(u.description))) as k, max(u.description) as d, max(u.unit) as u, sum(u.quantity) as q
    from public.order_part_usage u where u.service_order_id = p_order group by 1 having sum(u.quantity) <> 0)
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'description', d, 'unit', un, 'quoted_qty', qq, 'used_qty', uq, 'delta', uq - qq, 'relevant', uq > qq) order by d), '[]'::jsonb) into rows
  from (select coalesce(quoted.k, used.k) as k, coalesce(quoted.d, used.d) as d, coalesce(quoted.u, used.u) as un, coalesce(quoted.q, 0) as qq, coalesce(used.q, 0) as uq
        from quoted full join used on used.k = quoted.k) x
  where qq <> uq;
  return rows;
end $$;
revoke all on function private.os_parts_divergence(uuid) from public, anon, authenticated;

-- Pendências do checklist (validação do SERVIDOR; nunca a contagem do navegador).
create function private.os_checklist_problems(p_order uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare i record; out text[] := '{}'; photos integer;
begin
  for i in select * from public.order_checklist_items where service_order_id = p_order order by position loop
    if i.answered_at is null then
      if i.required then out := out || ('Item obrigatório sem resposta: ' || i.label); end if;
      continue;
    end if;
    if i.not_applicable and not i.allow_na then out := out || ('Item não admite «não se aplica»: ' || i.label); continue; end if;
    if i.require_photo and not i.not_applicable then
      select count(*) into photos from public.order_attachments a where a.checklist_item_id = i.id and a.content_type like 'image/%';
      if photos = 0 then out := out || ('Foto obrigatória pendente: ' || i.label); end if;
    end if;
    if i.note_rule = 'always' and i.note is null then out := out || ('Justificativa obrigatória: ' || i.label);
    elsif i.note_rule = 'on_negative' and (i.not_applicable or i.answer_bool = false) and i.note is null then out := out || ('Justificativa obrigatória para resposta negativa: ' || i.label); end if;
  end loop;
  return out;
end $$;
revoke all on function private.os_checklist_problems(uuid) from public, anon, authenticated;

-- Copia os itens do modelo para a ordem (SNAPSHOT: alterações futuras do modelo não mudam ordens existentes).
create function private.os_apply_template(p_org uuid, p_order uuid, p_template uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare tpl public.checklist_templates; base integer; n integer;
begin
  select * into tpl from public.checklist_templates where id = p_template and organization_id = p_org;
  if not found or not tpl.active then raise exception 'modelo de checklist não encontrado ou inativo' using errcode = '22023'; end if;
  select coalesce(max(position), 0) into base from public.order_checklist_items where service_order_id = p_order;
  if base + (select count(*) from public.checklist_template_items where template_id = p_template) > 500 then raise exception 'checklist grande demais' using errcode = '22023'; end if;
  insert into public.order_checklist_items (organization_id, service_order_id, source_template_id, group_name, position, label, kind, options, required, allow_na, require_photo, note_rule)
  select p_org, p_order, p_template, tpl.name, base + ti.position, ti.label, ti.kind, ti.options, ti.required, ti.allow_na, ti.require_photo, ti.note_rule
  from public.checklist_template_items ti where ti.template_id = p_template order by ti.position;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.os_apply_template(uuid, uuid, uuid) from public, anon, authenticated;

create function private.os_snapshot_current(p_order uuid) returns integer
language sql stable security definer set search_path = '' as $$ select coalesce(max(snapshot_version), 0) from public.service_order_snapshots where service_order_id = p_order; $$;
revoke all on function private.os_snapshot_current(uuid) from public, anon, authenticated;

-- Cria uma linha de snapshot com os dados ATUAIS do cadastro (abertura ou atualização explícita).
create function private.os_take_snapshot(p_org uuid, p_order uuid, p_customer uuid, p_address uuid, p_equipment uuid, p_contact uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.customers; a public.customer_addresses; e public.equipment; k public.customer_contacts; v integer; addr jsonb; eq jsonb;
begin
  select * into c from public.customers where id = p_customer and organization_id = p_org;
  if p_address is not null then
    select * into a from public.customer_addresses where id = p_address and organization_id = p_org and customer_id = p_customer;
    addr := jsonb_strip_nulls(jsonb_build_object('label', a.label, 'street', a.street, 'number', a.number, 'complement', a.complement, 'district', a.district, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code, 'reference', a.reference));
  end if;
  if p_equipment is not null then
    select * into e from public.equipment where id = p_equipment and organization_id = p_org and customer_id = p_customer;
    eq := jsonb_strip_nulls(jsonb_build_object('kind', e.kind, 'brand', e.brand, 'model', e.model, 'serial_number', e.serial_number));
  end if;
  if p_contact is not null then select * into k from public.customer_contacts where id = p_contact and organization_id = p_org and customer_id = p_customer and active; end if;
  v := private.os_snapshot_current(p_order) + 1;
  insert into public.service_order_snapshots (organization_id, service_order_id, snapshot_version, reason, customer_name, customer_phone, customer_email, contact_name, contact_phone, address, equipment, created_by)
  values (p_org, p_order, v, p_reason, c.name, c.phone, c.email, k.name, k.phone, addr, eq, (select auth.uid()));
  return v;
end $$;
revoke all on function private.os_take_snapshot(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

-- ======================================================================= abrir ordem
-- p: customer_id, address_id?, equipment_id?, contact_id?, subject, problem_description, priority?, technician_id?, scheduled_start_at?, scheduled_end_at?,
--    template_ids?[], quote_mode ('required'|'authorized'), authorization_justification?, as_draft?
create function public.os_open_order(p_org uuid, p_idem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); cust uuid; addr uuid; eq uuid; cont uuid; tech uuid; subj text; descr text; prio text; qm text; just text; st text; ws timestamptz; we timestamptz;
  num bigint; oid uuid; hash text; prev jsonb; res jsonb; tpl text; sv integer;
begin
  perform private.os_guard(p_org, 'manager');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  hash := private.os_hash(array['open', coalesce(p ->> 'customer_id', ''), coalesce(p ->> 'subject', ''), coalesce(p ->> 'problem_description', ''), coalesce(p ->> 'address_id', ''), coalesce(p ->> 'equipment_id', ''),
    coalesce(p ->> 'technician_id', ''), coalesce(p ->> 'scheduled_start_at', ''), coalesce(p ->> 'priority', ''), coalesce(p ->> 'quote_mode', ''), coalesce(p ->> 'as_draft', '')]);
  prev := private.os_idem(p_org, uid, p_idem, 'open_order', hash);
  if prev is not null then return prev; end if;
  perform private.os_rate_hit('open:' || p_org::text || ':' || uid::text, 120, 600);

  cust := (p ->> 'customer_id')::uuid; addr := nullif(p ->> 'address_id', '')::uuid; eq := nullif(p ->> 'equipment_id', '')::uuid; cont := nullif(p ->> 'contact_id', '')::uuid; tech := nullif(p ->> 'technician_id', '')::uuid;
  if not exists (select 1 from public.customers where id = cust and organization_id = p_org and active) then raise exception 'cliente não encontrado ou inativo' using errcode = '22023'; end if;
  if addr is not null and not exists (select 1 from public.customer_addresses where id = addr and organization_id = p_org and customer_id = cust and active) then raise exception 'endereço inválido para este cliente' using errcode = '22023'; end if;
  if eq is not null and not exists (select 1 from public.equipment where id = eq and organization_id = p_org and customer_id = cust and active) then raise exception 'equipamento inválido para este cliente' using errcode = '22023'; end if;
  if cont is not null and not exists (select 1 from public.customer_contacts where id = cont and organization_id = p_org and customer_id = cust and active) then raise exception 'contato inválido para este cliente' using errcode = '22023'; end if;
  if tech is not null and not private.os_assignable(p_org, tech) then raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '22023'; end if;
  subj := private.os_req_text(p ->> 'subject', 3, 160, 'Assunto'); descr := private.os_req_text(p ->> 'problem_description', 3, 4000, 'Descrição da solicitação');
  prio := coalesce(nullif(p ->> 'priority', ''), 'normal');
  if prio not in ('low', 'normal', 'high', 'urgent') then raise exception 'prioridade inválida' using errcode = '22023'; end if;
  qm := coalesce(nullif(p ->> 'quote_mode', ''), 'required');
  if qm not in ('required', 'authorized') then raise exception 'modo de orçamento inválido' using errcode = '22023'; end if;
  just := private.os_opt_text(p ->> 'authorization_justification', 1000, 'Justificativa');
  if qm = 'authorized' and (just is null or char_length(just) < 10) then raise exception 'informe a justificativa (mínimo 10 caracteres) para executar sem orçamento' using errcode = '22023'; end if;
  if qm = 'required' then just := null; end if;
  ws := nullif(p ->> 'scheduled_start_at', '')::timestamptz; we := nullif(p ->> 'scheduled_end_at', '')::timestamptz;
  if ws is not null or we is not null then perform private.os_check_window(ws, we); end if;
  st := case when coalesce((p ->> 'as_draft')::boolean, false) then 'draft' when tech is not null and ws is not null then 'scheduled' else 'open' end;

  num := private.os_next_number(p_org);
  insert into public.service_orders (organization_id, order_number, customer_id, address_id, equipment_id, execution_status, quote_mode, authorization_justification, authorized_by, authorized_at,
    assigned_technician_user_id, priority, subject, problem_description, scheduled_start_at, scheduled_end_at, created_by)
  values (p_org, num, cust, addr, eq, st, qm, just, case when qm = 'authorized' then uid end, case when qm = 'authorized' then now() end,
    tech, prio, subj, descr, ws, we, uid) returning id into oid;
  sv := private.os_take_snapshot(p_org, oid, cust, addr, eq, cont, null);
  if p ? 'template_ids' and jsonb_typeof(p -> 'template_ids') = 'array' then
    if jsonb_array_length(p -> 'template_ids') > 5 then raise exception 'aplique no máximo 5 modelos de checklist' using errcode = '22023'; end if;
    for tpl in select value #>> '{}' from jsonb_array_elements(p -> 'template_ids') loop perform private.os_apply_template(p_org, oid, tpl::uuid); end loop;
  end if;
  perform private.os_event(p_org, oid, 'opened', jsonb_build_object('status', st, 'quote_mode', qm, 'priority', prio));
  if qm = 'authorized' then perform private.os_event(p_org, oid, 'execution_authorized', '{}'::jsonb); end if;
  if tech is not null then perform private.os_event(p_org, oid, 'assigned', jsonb_build_object('to', tech)); end if;
  if st = 'scheduled' then perform private.os_event(p_org, oid, 'scheduled', jsonb_build_object('start', ws, 'end', we)); end if;
  res := jsonb_build_object('id', oid, 'order_number', num, 'number_text', private.os_number_text(p_org, num), 'status', st, 'conflicts', case when st = 'scheduled' then private.os_conflicts(p_org, tech, ws, we, oid) else '[]'::jsonb end);
  perform private.os_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

-- ======================================================================= editar, rascunho, atribuir, agendar
create function public.os_update_order(p_org uuid, p_order uuid, p_version integer, p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; subj text; descr text; prio text; qm text; just text; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não pode ser editada (reabra para corrigir)', o.execution_status using errcode = '23514'; end if;
  subj := private.os_req_text(coalesce(p ->> 'subject', o.subject), 3, 160, 'Assunto'); descr := private.os_req_text(coalesce(p ->> 'problem_description', o.problem_description), 3, 4000, 'Descrição');
  prio := coalesce(nullif(p ->> 'priority', ''), o.priority);
  qm := coalesce(nullif(p ->> 'quote_mode', ''), o.quote_mode);
  just := case when qm = 'authorized' then coalesce(private.os_opt_text(p ->> 'authorization_justification', 1000, 'Justificativa'), o.authorization_justification) end;
  if qm not in ('required', 'authorized') then raise exception 'modo de orçamento inválido' using errcode = '22023'; end if;
  if prio not in ('low', 'normal', 'high', 'urgent') then raise exception 'prioridade inválida' using errcode = '22023'; end if;
  if qm = 'authorized' and (just is null or char_length(just) < 10) then raise exception 'informe a justificativa (mínimo 10 caracteres) para executar sem orçamento' using errcode = '22023'; end if;
  update public.service_orders set subject = subj, problem_description = descr, priority = prio, quote_mode = qm, authorization_justification = just,
    authorized_by = case when qm = 'authorized' then coalesce(case when o.quote_mode = 'authorized' then o.authorized_by end, (select auth.uid())) end,
    authorized_at = case when qm = 'authorized' then coalesce(case when o.quote_mode = 'authorized' then o.authorized_at end, now()) end
    where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'updated', jsonb_build_object('quote_mode', qm, 'priority', prio));
  if qm <> o.quote_mode then perform private.os_event(p_org, p_order, case when qm = 'authorized' then 'execution_authorized' else 'execution_authorization_revoked' end, '{}'::jsonb); end if;
  return v;
end $$;

create function public.os_confirm_draft(p_org uuid, p_order uuid, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status <> 'draft' then raise exception 'só rascunhos podem ser confirmados' using errcode = '23514'; end if;
  update public.service_orders set execution_status = case when assigned_technician_user_id is not null and scheduled_start_at is not null then 'scheduled' else 'open' end where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'confirmed', '{}'::jsonb);
  return v;
end $$;

-- Atualização EXPLÍCITA do local/equipamento/contato: nova linha de snapshot (com motivo) e atualização dos dados do cliente atuais. Documentos já aprovados mantêm a versão que usavam.
create function public.os_update_snapshot(p_org uuid, p_order uuid, p_version integer, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; addr uuid; eq uuid; cont uuid; rsn text; sv integer; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não pode ser editada (reabra para corrigir)', o.execution_status using errcode = '23514'; end if;
  rsn := private.os_req_text(p ->> 'reason', 5, 300, 'Motivo da atualização');
  addr := case when p ? 'address_id' then nullif(p ->> 'address_id', '')::uuid else o.address_id end;
  eq := case when p ? 'equipment_id' then nullif(p ->> 'equipment_id', '')::uuid else o.equipment_id end;
  cont := nullif(p ->> 'contact_id', '')::uuid;
  if addr is not null and not exists (select 1 from public.customer_addresses where id = addr and organization_id = p_org and customer_id = o.customer_id and active) then raise exception 'endereço inválido para este cliente' using errcode = '22023'; end if;
  if eq is not null and not exists (select 1 from public.equipment where id = eq and organization_id = p_org and customer_id = o.customer_id and active) then raise exception 'equipamento inválido para este cliente' using errcode = '22023'; end if;
  if cont is not null and not exists (select 1 from public.customer_contacts where id = cont and organization_id = p_org and customer_id = o.customer_id and active) then raise exception 'contato inválido para este cliente' using errcode = '22023'; end if;
  update public.service_orders set address_id = addr, equipment_id = eq where id = p_order returning version into v;
  sv := private.os_take_snapshot(p_org, p_order, o.customer_id, addr, eq, cont, rsn);
  perform private.os_event(p_org, p_order, 'snapshot_updated', jsonb_build_object('snapshot_version', sv));
  return jsonb_build_object('version', v, 'snapshot_version', sv);
end $$;

-- Atribuir (ou remover, com p_technician = null) o responsável técnico.
create function public.os_assign(p_org uuid, p_order uuid, p_version integer, p_technician uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer; conf jsonb := '[]'::jsonb;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não pode ser editada (reabra para corrigir)', o.execution_status using errcode = '23514'; end if;
  if p_technician is not null and not private.os_assignable(p_org, p_technician) then raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '22023'; end if;
  if p_technician is null and o.execution_status = 'in_progress' then raise exception 'pause a execução antes de remover o responsável' using errcode = '23514'; end if;
  if p_technician is not distinct from o.assigned_technician_user_id then return jsonb_build_object('version', o.version, 'conflicts', conf); end if;
  if p_technician is null and o.execution_status = 'scheduled' then
    update public.service_orders set assigned_technician_user_id = null, execution_status = 'open', scheduled_start_at = null, scheduled_end_at = null where id = p_order returning version into v;
  else
    update public.service_orders set assigned_technician_user_id = p_technician where id = p_order returning version into v;
  end if;
  if o.scheduled_start_at is not null and p_technician is not null and o.execution_status = 'scheduled' then conf := private.os_conflicts(p_org, p_technician, o.scheduled_start_at, o.scheduled_end_at, p_order); end if;
  perform private.os_event(p_org, p_order, case when p_technician is null then 'unassigned' else 'assigned' end, jsonb_build_object('from', o.assigned_technician_user_id, 'to', p_technician));
  return jsonb_build_object('version', v, 'conflicts', conf);
end $$;

-- Agendar: exige técnico e janela válida. Sobreposição com outras ordens do técnico é ALERTA no retorno (não bloqueia).
create function public.os_schedule(p_org uuid, p_order uuid, p_version integer, p_technician uuid, p_start timestamptz, p_end timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status not in ('open', 'scheduled') then raise exception 'só ordens abertas ou agendadas podem ser (re)agendadas' using errcode = '23514'; end if;
  if p_technician is null then raise exception 'escolha o técnico responsável para agendar' using errcode = '22023'; end if;
  if not private.os_assignable(p_org, p_technician) then raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '22023'; end if;
  perform private.os_check_window(p_start, p_end);
  update public.service_orders set assigned_technician_user_id = p_technician, scheduled_start_at = p_start, scheduled_end_at = p_end, execution_status = 'scheduled' where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'scheduled', jsonb_build_object('start', p_start, 'end', p_end, 'technician', p_technician));
  return jsonb_build_object('version', v, 'conflicts', private.os_conflicts(p_org, p_technician, p_start, p_end, p_order));
end $$;

create function public.os_unschedule(p_org uuid, p_order uuid, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status <> 'scheduled' then raise exception 'a ordem não está agendada' using errcode = '23514'; end if;
  update public.service_orders set execution_status = 'open', scheduled_start_at = null, scheduled_end_at = null where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'unscheduled', '{}'::jsonb);
  return v;
end $$;

-- ======================================================================= execução: iniciar, pausar, retomar
create function public.os_start(p_org uuid, p_order uuid, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer; blk text;
begin
  perform private.os_guard(p_org, 'staff');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status not in ('open', 'scheduled') then raise exception 'só ordens abertas ou agendadas podem ser iniciadas' using errcode = '23514'; end if;
  if o.assigned_technician_user_id is null then raise exception 'defina o técnico responsável antes de iniciar' using errcode = '23514'; end if;
  blk := private.os_exec_block(p_order);
  if blk is not null then raise exception '%', blk using errcode = '23514'; end if;
  update public.service_orders set execution_status = 'in_progress', started_at = coalesce(started_at, clock_timestamp()) where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'started', '{}'::jsonb);
  return v;
end $$;

create function public.os_pause(p_org uuid, p_order uuid, p_version integer, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer; rsn text;
begin
  perform private.os_guard(p_org, 'staff');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status <> 'in_progress' then raise exception 'só ordens em execução podem ser pausadas' using errcode = '23514'; end if;
  rsn := private.os_req_text(p_reason, 3, 300, 'Motivo da pausa');
  insert into public.order_pauses (organization_id, service_order_id, started_at, reason, started_by) values (p_org, p_order, clock_timestamp(), rsn, (select auth.uid()));
  update public.service_orders set execution_status = 'paused' where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'paused', '{}'::jsonb);
  return v;
end $$;

create function public.os_resume(p_org uuid, p_order uuid, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer; blk text;
begin
  perform private.os_guard(p_org, 'staff');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status <> 'paused' then raise exception 'só ordens pausadas podem ser retomadas' using errcode = '23514'; end if;
  if o.assigned_technician_user_id is null then raise exception 'defina o técnico responsável antes de retomar' using errcode = '23514'; end if;
  blk := private.os_exec_block(p_order);
  if blk is not null then raise exception '%', blk using errcode = '23514'; end if;
  update public.order_pauses set ended_at = clock_timestamp(), ended_by = (select auth.uid()) where service_order_id = p_order and ended_at is null;
  update public.service_orders set execution_status = 'in_progress' where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'resumed', '{}'::jsonb);
  return v;
end $$;

-- ======================================================================= conclusão (versionada), reabertura, encerramento, cancelamento
create function public.os_complete(p_org uuid, p_order uuid, p_version integer, p_summary text, p_divergence_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.service_orders; v integer; sm text; dn text; probs text[]; div jsonb; relevant boolean; cv integer; base public.quote_versions; qs jsonb; cl jsonb; ps jsonb;
begin
  perform private.os_guard(p_org, 'staff');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status <> 'in_progress' then raise exception 'só ordens em execução podem ser concluídas (retome a ordem pausada antes)' using errcode = '23514'; end if;
  sm := private.os_req_text(p_summary, 5, 4000, 'Resumo do serviço'); dn := private.os_opt_text(p_divergence_note, 1000, 'Justificativa da divergência de peças');
  probs := private.os_checklist_problems(p_order);
  if cardinality(probs) > 0 then
    raise exception 'checklist incompleto (% pendência(s)): %', cardinality(probs), array_to_string(probs[1:3], '; ') using errcode = '23514';
  end if;
  div := private.os_parts_divergence(p_order);
  relevant := div is not null and exists (select 1 from jsonb_array_elements(div) d where (d ->> 'relevant')::boolean);
  if relevant and (dn is null or char_length(dn) < 10) then
    raise exception 'há divergência relevante de peças em relação ao orçamento aprovado: justifique (mínimo 10 caracteres) ou crie uma nova versão do orçamento' using errcode = '23514';
  end if;
  cv := o.completion_version + 1;
  select * into base from public.quote_versions where service_order_id = p_order and status = 'approved' order by version_number desc limit 1;
  qs := case when base.id is not null then jsonb_build_object('quote_version_id', base.id, 'version_number', base.version_number, 'total_cents', base.total_cents) end;
  select coalesce(jsonb_agg(jsonb_build_object('group', c.group_name, 'label', c.label, 'kind', c.kind, 'required', c.required, 'not_applicable', c.not_applicable,
      'answer', case c.kind when 'boolean' then to_jsonb(c.answer_bool) when 'text' then to_jsonb(c.answer_text) when 'number' then to_jsonb(c.answer_number) else to_jsonb(c.answer_option) end,
      'note', c.note, 'answered_at', c.answered_at,
      'photos', (select count(*) from public.order_attachments a where a.checklist_item_id = c.id)) order by c.position), '[]'::jsonb) into cl
  from public.order_checklist_items c where c.service_order_id = p_order;
  select coalesce(jsonb_agg(jsonb_build_object('description', d, 'unit', un, 'quantity', q) order by d), '[]'::jsonb) into ps
  from (select max(u.description) as d, max(u.unit) as un, sum(u.quantity) as q from public.order_part_usage u where u.service_order_id = p_order
        group by coalesce(u.part_id::text, 'd:' || lower(btrim(u.description))) having sum(u.quantity) <> 0) x;
  insert into public.order_completions (organization_id, service_order_id, completion_version, snapshot_version, summary, divergence_note, checklist_snapshot, parts_snapshot, quote_snapshot, completed_by)
  values (p_org, p_order, cv, private.os_snapshot_current(p_order), sm, case when relevant then dn end, cl, ps, qs, (select auth.uid()));
  update public.service_orders set execution_status = 'completed', completed_at = clock_timestamp(), completion_version = cv where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'completed', jsonb_build_object('completion_version', cv, 'divergence', relevant));
  return jsonb_build_object('version', v, 'completion_version', cv);
end $$;

-- Reabrir para execução: concluída → em execução (gestão; ex.: cliente contestou) · encerrada → em execução (SÓ proprietário). A conclusão seguinte gera nova versão e novo pedido de aceite.
create function public.os_reopen(p_org uuid, p_order uuid, p_version integer, p_reason text, p_technician uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer; rsn text; blk text;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status not in ('completed', 'closed') then raise exception 'só ordens concluídas ou encerradas podem ser reabertas' using errcode = '23514'; end if;
  if o.execution_status = 'closed' and not private.os_is_owner(p_org) then raise exception 'só o proprietário pode reabrir uma ordem encerrada' using errcode = '42501'; end if;
  rsn := private.os_req_text(p_reason, 10, 500, 'Motivo da reabertura');
  if p_technician is not null and not private.os_assignable(p_org, p_technician) then raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '22023'; end if;
  if coalesce(p_technician, o.assigned_technician_user_id) is null then raise exception 'defina o técnico responsável para reabrir a execução' using errcode = '23514'; end if;
  blk := private.os_exec_block(p_order);
  if blk is not null then raise exception '%', blk using errcode = '23514'; end if;
  update public.service_orders set execution_status = 'in_progress', closed_at = null, assigned_technician_user_id = coalesce(p_technician, assigned_technician_user_id) where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, case when o.execution_status = 'closed' then 'reopened_after_close' else 'reopened' end,
    jsonb_build_object('completion_version', o.completion_version, 'reason_length', char_length(rsn)));
  insert into public.order_updates (organization_id, service_order_id, author_user_id, visibility, body) values (p_org, p_order, (select auth.uid()), 'internal', 'Ordem reaberta para execução. Motivo: ' || rsn);
  return v;
end $$;

create function public.os_close(p_org uuid, p_order uuid, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status <> 'completed' then raise exception 'só ordens concluídas podem ser encerradas' using errcode = '23514'; end if;
  if not exists (select 1 from public.completion_acceptances a where a.service_order_id = p_order and a.completion_version = o.completion_version and a.decision = 'accepted') then
    raise exception 'o encerramento exige o aceite da conclusão atual (versão %): peça o aceite ao cliente pelo link ou registre-o manualmente com justificativa', o.completion_version using errcode = '23514';
  end if;
  update public.service_orders set execution_status = 'closed', closed_at = clock_timestamp() where id = p_order returning version into v;
  perform private.os_event(p_org, p_order, 'closed', jsonb_build_object('completion_version', o.completion_version));
  return v;
end $$;

create function public.os_cancel(p_org uuid, p_order uuid, p_version integer, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; v integer; rsn text;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status not in ('draft', 'open', 'scheduled', 'in_progress', 'paused') then raise exception 'esta ordem não pode mais ser cancelada' using errcode = '23514'; end if;
  rsn := private.os_req_text(p_reason, 5, 500, 'Motivo do cancelamento');
  update public.order_pauses set ended_at = clock_timestamp(), ended_by = (select auth.uid()) where service_order_id = p_order and ended_at is null;
  update public.service_orders set execution_status = 'cancelled', cancelled_at = clock_timestamp(), cancel_reason = rsn where id = p_order returning version into v;
  update public.public_access_tokens set revoked_at = now() where service_order_id = p_order and revoked_at is null;
  update public.quote_versions set status = 'superseded' where service_order_id = p_order and status = 'published';
  perform private.os_event(p_org, p_order, 'cancelled', '{}'::jsonb);
  return v;
end $$;

-- ======================================================================= checklist
create function public.os_apply_checklist_template(p_org uuid, p_order uuid, p_version integer, p_template uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; n integer; v integer;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não pode ser editada (reabra para corrigir)', o.execution_status using errcode = '23514'; end if;
  n := private.os_apply_template(p_org, p_order, p_template);
  update public.service_orders set updated_at = now() where id = p_order;
  select version into v from public.service_orders where id = p_order;
  perform private.os_event(p_org, p_order, 'checklist_applied', jsonb_build_object('template_id', p_template, 'items', n));
  return jsonb_build_object('items', n, 'version', v);
end $$;

-- Responde um item. p: boolean (answer_bool) | text | number | option; not_applicable; note.
create function public.os_answer_checklist(p_org uuid, p_order uuid, p_item uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; i public.order_checklist_items; na boolean; ab boolean; at text; an numeric; ao text; nt text;
begin
  perform private.os_guard(p_org, 'staff');
  o := private.os_load_order(p_org, p_order, true, null);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status not in ('in_progress', 'paused') then raise exception 'o checklist é respondido durante a execução (inicie a ordem)' using errcode = '23514'; end if;
  select * into i from public.order_checklist_items where id = p_item and service_order_id = p_order and organization_id = p_org for update;
  if not found then raise exception 'item de checklist não encontrado' using errcode = 'P0002'; end if;
  na := coalesce((p ->> 'not_applicable')::boolean, false);
  nt := private.os_opt_text(p ->> 'note', 500, 'Justificativa');
  if na then
    if not i.allow_na then raise exception 'este item não admite «não se aplica»' using errcode = '22023'; end if;
  else
    case i.kind
      when 'boolean' then
        if jsonb_typeof(p -> 'boolean') is distinct from 'boolean' then raise exception 'responda sim ou não' using errcode = '22023'; end if;
        ab := (p ->> 'boolean')::boolean;
      when 'text' then
        at := private.os_req_text(p ->> 'text', 1, 1000, 'Resposta');
      when 'number' then
        if jsonb_typeof(p -> 'number') is distinct from 'number' then raise exception 'informe um número' using errcode = '22023'; end if;
        an := (p ->> 'number')::numeric;
        if abs(an) >= 1000000000 then raise exception 'número fora do permitido' using errcode = '22023'; end if;
      when 'select' then
        ao := p ->> 'option';
        if ao is null or not exists (select 1 from jsonb_array_elements_text(i.options) opt where opt = ao) then raise exception 'escolha uma das opções' using errcode = '22023'; end if;
    end case;
  end if;
  if i.note_rule = 'always' and nt is null then raise exception 'este item exige justificativa' using errcode = '22023'; end if;
  if i.note_rule = 'on_negative' and (na or ab = false) and nt is null then raise exception 'respostas negativas ou «não se aplica» exigem justificativa neste item' using errcode = '22023'; end if;
  update public.order_checklist_items set answer_bool = ab, answer_text = at, answer_number = an, answer_option = ao, not_applicable = na, note = nt, answered_by = (select auth.uid()), answered_at = clock_timestamp()
    where id = p_item;
  perform private.os_event(p_org, p_order, 'checklist_answered', jsonb_build_object('item_id', p_item));
end $$;

-- ======================================================================= peças utilizadas (registro de USO, não é estoque)
-- p: part_id? , description?, unit?, quantity, used_at?
create function public.os_add_part_usage(p_org uuid, p_order uuid, p_idem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.service_orders; part public.part_catalog; pid uuid; ds text; un text; q numeric; rid uuid; hash text; prev jsonb; res jsonb; ua timestamptz;
begin
  perform private.os_guard(p_org, 'staff');
  hash := private.os_hash(array['part_usage', p_order::text, coalesce(p ->> 'part_id', ''), coalesce(p ->> 'description', ''), coalesce(p ->> 'quantity', '')]);
  prev := private.os_idem(p_org, uid, p_idem, 'part_usage', hash);
  if prev is not null then return prev; end if;
  o := private.os_load_order(p_org, p_order, true, null);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status not in ('in_progress', 'paused') then raise exception 'peças são registradas durante a execução' using errcode = '23514'; end if;
  if jsonb_typeof(p -> 'quantity') is distinct from 'number' then raise exception 'informe a quantidade' using errcode = '22023'; end if;
  q := round((p ->> 'quantity')::numeric, 3);
  if q <= 0 or q > 1000000 then raise exception 'quantidade fora do permitido' using errcode = '22023'; end if;
  pid := nullif(p ->> 'part_id', '')::uuid;
  if pid is not null then
    select * into part from public.part_catalog where id = pid and organization_id = p_org and active;
    if not found then raise exception 'peça não encontrada ou inativa' using errcode = '22023'; end if;
    ds := part.name; un := part.unit;
  else
    ds := private.os_req_text(p ->> 'description', 2, 200, 'Descrição da peça'); un := private.os_req_text(coalesce(nullif(p ->> 'unit', ''), 'un'), 1, 16, 'Unidade');
  end if;
  ua := coalesce(nullif(p ->> 'used_at', '')::timestamptz, clock_timestamp());
  if ua > now() + interval '1 day' then raise exception 'a data de uso não pode estar no futuro' using errcode = '22023'; end if;
  insert into public.order_part_usage (organization_id, service_order_id, part_id, description, unit, quantity, entry_kind, used_at, registered_by) values (p_org, p_order, pid, ds, un, q, 'usage', ua, uid) returning id into rid;
  perform private.os_event(p_org, p_order, 'part_used', jsonb_build_object('usage_id', rid));
  res := jsonb_build_object('id', rid);
  perform private.os_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

-- Corrige um registro: estorno (quantidade negativa, até o saldo do registro) ou ajuste (+/-). Sempre referenciando o original, com motivo e autoria.
create function public.os_correct_part_usage(p_org uuid, p_order uuid, p_idem uuid, p_usage uuid, p_kind text, p_quantity numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.service_orders; u public.order_part_usage; q numeric; rsn text; net numeric; rid uuid; hash text; prev jsonb; res jsonb;
begin
  perform private.os_guard(p_org, 'staff');
  hash := private.os_hash(array['part_correct', p_order::text, p_usage::text, coalesce(p_kind, ''), coalesce(p_quantity::text, ''), coalesce(p_reason, '')]);
  prev := private.os_idem(p_org, uid, p_idem, 'part_correct', hash);
  if prev is not null then return prev; end if;
  o := private.os_load_order(p_org, p_order, true, null);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status not in ('in_progress', 'paused') then raise exception 'correções de peças são feitas durante a execução (reabra a ordem concluída)' using errcode = '23514'; end if;
  select * into u from public.order_part_usage where id = p_usage and service_order_id = p_order and organization_id = p_org and entry_kind = 'usage';
  if not found then raise exception 'registro de uso não encontrado' using errcode = 'P0002'; end if;
  if p_kind not in ('reversal', 'adjustment') then raise exception 'tipo de correção inválido' using errcode = '22023'; end if;
  rsn := private.os_req_text(p_reason, 3, 300, 'Motivo da correção');
  q := round(p_quantity, 3);
  if q is null or q = 0 or abs(q) > 1000000 then raise exception 'quantidade fora do permitido' using errcode = '22023'; end if;
  if p_kind = 'reversal' then q := -abs(q); end if;
  select sum(quantity) into net from public.order_part_usage where (id = p_usage or reference_usage_id = p_usage) and service_order_id = p_order;
  if net + q < 0 then raise exception 'a correção deixaria o saldo do registro negativo (saldo atual: %)', net using errcode = '22023'; end if;
  insert into public.order_part_usage (organization_id, service_order_id, part_id, description, unit, quantity, entry_kind, reference_usage_id, reason, registered_by)
  values (p_org, p_order, u.part_id, u.description, u.unit, q, p_kind, p_usage, rsn, uid) returning id into rid;
  perform private.os_event(p_org, p_order, 'part_corrected', jsonb_build_object('usage_id', rid, 'reference', p_usage, 'kind', p_kind));
  res := jsonb_build_object('id', rid);
  perform private.os_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

-- ======================================================================= custos internos (SÓ gestão)
create function public.os_add_cost(p_org uuid, p_order uuid, p_idem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.service_orders; cat text; ds text; amt bigint; corr uuid; rid uuid; hash text; prev jsonb; res jsonb;
begin
  perform private.os_guard(p_org, 'manager');
  hash := private.os_hash(array['cost', p_order::text, coalesce(p ->> 'category', ''), coalesce(p ->> 'description', ''), coalesce(p ->> 'amount_cents', ''), coalesce(p ->> 'corrects_cost_id', '')]);
  prev := private.os_idem(p_org, uid, p_idem, 'cost', hash);
  if prev is not null then return prev; end if;
  o := private.os_load_order(p_org, p_order, true, null);
  if o.execution_status in ('closed', 'cancelled') then raise exception 'ordem % não aceita novos registros', o.execution_status using errcode = '23514'; end if;
  cat := p ->> 'category';
  if cat is null or cat not in ('labor', 'part', 'travel', 'other') then raise exception 'categoria de custo inválida' using errcode = '22023'; end if;
  ds := private.os_req_text(p ->> 'description', 2, 200, 'Descrição do custo');
  if jsonb_typeof(p -> 'amount_cents') is distinct from 'number' then raise exception 'valor inválido' using errcode = '22023'; end if;
  amt := (p ->> 'amount_cents')::bigint; corr := nullif(p ->> 'corrects_cost_id', '')::uuid;
  if amt = 0 or abs(amt) > 1000000000 then raise exception 'valor fora do permitido' using errcode = '22023'; end if;
  if corr is not null and not exists (select 1 from public.order_internal_costs where id = corr and service_order_id = p_order and organization_id = p_org) then raise exception 'custo a corrigir não encontrado' using errcode = 'P0002'; end if;
  if amt < 0 and corr is null then raise exception 'valores negativos só corrigem um custo anterior' using errcode = '22023'; end if;
  insert into public.order_internal_costs (organization_id, service_order_id, category, description, amount_cents, corrects_cost_id, recorded_by) values (p_org, p_order, cat, ds, amt, corr, uid) returning id into rid;
  perform private.os_event(p_org, p_order, 'cost_recorded', jsonb_build_object('cost_id', rid));
  res := jsonb_build_object('id', rid);
  perform private.os_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

-- ======================================================================= notas e arquivos
-- p_attachments: [{path, mime, size, filename, category, visibility, sha256}]. Os arquivos já foram enviados ao Storage pelo servidor (caminho gerado por ele).
create function public.os_add_update(p_org uuid, p_order uuid, p_idem uuid, p_visibility text, p_body text, p_attachments jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.service_orders; bd text; rid uuid; hash text; prev jsonb; res jsonb; n integer := 0;
begin
  perform private.os_guard(p_org, 'staff');
  hash := private.os_hash(array['update', p_order::text, coalesce(p_visibility, ''), coalesce(p_body, ''), private.os_att_paths(p_attachments)]);
  prev := private.os_idem(p_org, uid, p_idem, 'update', hash);
  if prev is not null then return prev; end if;
  o := private.os_load_order(p_org, p_order, true, null);
  if o.execution_status in ('closed', 'cancelled') then raise exception 'ordem % não aceita novas notas (reabra se precisar corrigir)', o.execution_status using errcode = '23514'; end if;
  if p_visibility is null or p_visibility not in ('internal', 'customer') then raise exception 'visibilidade inválida' using errcode = '22023'; end if;
  bd := private.os_req_text(p_body, 1, 4000, 'Nota');
  perform private.os_rate_hit('update:' || p_org::text || ':' || uid::text, 200, 600);
  insert into public.order_updates (organization_id, service_order_id, author_user_id, visibility, body) values (p_org, p_order, uid, p_visibility, bd) returning id into rid;
  n := private.os_add_attachments(p_org, p_order, rid, null, case when jsonb_typeof(p_attachments) = 'array' then (select jsonb_agg(v || jsonb_build_object('visibility', p_visibility)) from jsonb_array_elements(p_attachments) v) else null end, uid);
  perform private.os_event(p_org, p_order, case when p_visibility = 'customer' then 'update_shared' else 'note_added' end, jsonb_build_object('update_id', rid, 'attachments', n));
  res := jsonb_build_object('id', rid, 'attachments', n);
  perform private.os_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

create function private.os_att_paths(p_att jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg((v ->> 'path') || ':' || coalesce(v ->> 'size', ''), ',' order by v ->> 'path'), '') from jsonb_array_elements(case when jsonb_typeof(p_att) = 'array' then p_att else '[]'::jsonb end) v;
$$;
revoke all on function private.os_att_paths(jsonb) from public, anon, authenticated;

-- Arquivos sem nota (fotos de antes/durante/depois, documentos, evidência de item do checklist).
create function public.os_add_files(p_org uuid, p_order uuid, p_idem uuid, p_item uuid, p_attachments jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.service_orders; hash text; prev jsonb; res jsonb; n integer;
begin
  perform private.os_guard(p_org, 'staff');
  hash := private.os_hash(array['files', p_order::text, coalesce(p_item::text, ''), private.os_att_paths(p_attachments)]);
  prev := private.os_idem(p_org, uid, p_idem, 'files', hash);
  if prev is not null then return prev; end if;
  o := private.os_load_order(p_org, p_order, true, null);
  if not private.os_can_execute(o) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if o.execution_status in ('closed', 'cancelled') then raise exception 'ordem % não aceita novos arquivos', o.execution_status using errcode = '23514'; end if;
  if p_attachments is null or jsonb_typeof(p_attachments) is distinct from 'array' or jsonb_array_length(p_attachments) < 1 then raise exception 'selecione ao menos um arquivo' using errcode = '22023'; end if;
  perform private.os_rate_hit('files:' || p_org::text || ':' || uid::text, 200, 600);
  n := private.os_add_attachments(p_org, p_order, null, p_item, p_attachments, uid);
  perform private.os_event(p_org, p_order, 'files_added', jsonb_build_object('count', n));
  res := jsonb_build_object('count', n);
  perform private.os_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

-- Compartilhar com o cliente (ou voltar a ocultar) um arquivo. Só a gestão. O evento registra a mudança.
create function public.os_set_attachment_visibility(p_org uuid, p_attachment uuid, p_visibility text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.order_attachments; o public.service_orders;
begin
  perform private.os_guard(p_org, 'manager');
  if p_visibility is null or p_visibility not in ('internal', 'customer') then raise exception 'visibilidade inválida' using errcode = '22023'; end if;
  select * into a from public.order_attachments where id = p_attachment and organization_id = p_org;
  if not found then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;
  o := private.os_load_order(p_org, a.service_order_id, true, null);
  if o.execution_status in ('closed', 'cancelled') then raise exception 'ordem % não pode ser editada', o.execution_status using errcode = '23514'; end if;
  if a.visibility = p_visibility then return; end if;
  update public.order_attachments set visibility = p_visibility where id = p_attachment;
  perform private.os_event(p_org, a.service_order_id, case when p_visibility = 'customer' then 'file_shared' else 'file_hidden' end, jsonb_build_object('attachment_id', p_attachment));
end $$;

commit;
