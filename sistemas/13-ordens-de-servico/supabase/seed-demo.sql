-- DEMONSTRAÇÃO «Assistência Horizonte» — dados 100% fictícios, determinísticos e RELATIVOS à data/hora de execução (nada fica no futuro; nada é temporalmente impossível).
-- Aplicado por `node scripts/seed-demo.mjs` (senha aleatória gerada na hora e exibida só no seu terminal; nenhuma credencial fixa é publicada).
-- Somente para uso LOCAL. NUNCA aplique em produção. Variável psql: pw (senha dos usuários @demo.exemplo).
-- Usuários: dono (proprietário), gestor e tecnico1…3 (técnicos) @demo.exemplo. O proprietário cadastra o 2º fator (TOTP) no primeiro acesso.
-- O histórico é inserido com instantes explícitos (a API de escrita usa o relógio do banco); as regras de integridade e os gatilhos continuam valendo.
-- Não há fotos na demonstração (arquivos precisam existir no Storage): envie fotos pelo próprio sistema para ver a galeria.

select set_config('demo.pw', :'pw', false);
select set_config('request.jwt.claims', '', false);
begin;

do $$
declare pw text := extensions.crypt(current_setting('demo.pw'), extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where slug = 'assistencia-horizonte') then raise exception 'a demonstração já existe neste banco (rode supabase db reset antes)'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', e.nome), now(), now(), '', '', '', ''
  from (values ('dono@demo.exemplo', 'Helena Costa'), ('gestor@demo.exemplo', 'Marcos Almeida'), ('tecnico1@demo.exemplo', 'Rafael Tavares'), ('tecnico2@demo.exemplo', 'Carla Nogueira'), ('tecnico3@demo.exemplo', 'Diego Ferraz')) as e(email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
end $$;

-- empresa e papéis (a partir daqui o proprietário «assina» como AAL2, como faria no app depois de cadastrar o 2º fator)
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'dono@demo.exemplo'), 'aal', 'aal2', 'role', 'authenticated')::text, false);
select public.create_organization('Assistência Horizonte (demonstração)', 'assistencia-horizonte') as org \gset
insert into public.organization_members (organization_id, user_id, role)
select :'org', u.id, case when u.email = 'gestor@demo.exemplo' then 'manager'::public.org_role else 'member'::public.org_role end from auth.users u where u.email like '%@demo.exemplo' and u.email <> 'dono@demo.exemplo';
select set_config('demo.org', :'org', false);
select public.os_save_settings(:'org', '{"public_display_name":"Assistência Horizonte — demonstração","primary_color":"#b45309","order_prefix":"OS","quote_validity_days":15,"link_ttl_days":30,"default_quote_terms":"DEMONSTRAÇÃO: pagamento na entrega do serviço. Peças com 90 dias de garantia. Valores em reais.","retention_policy_text":"DEMONSTRAÇÃO: ordens são mantidas por 5 anos para fins de garantia e obrigações legais; pedidos de exclusão ou anonimização são atendidos pela gestão (veja docs/SECURITY.md)."}');
update public.organization_settings set display_name = 'Assistência Horizonte (demonstração)', theme = jsonb_build_object('primary', '#b45309') where organization_id = :'org';

-- cadastros -------------------------------------------------------------------------------------------------------------
select public.os_save_service(:'org', null, '{"name":"Diagnóstico técnico","unit":"un","reference_price_cents":9000,"description":"Visita e avaliação do defeito"}');
select public.os_save_service(:'org', null, '{"name":"Manutenção preventiva","unit":"un","reference_price_cents":18000,"description":"Limpeza, revisão e testes"}');
select public.os_save_service(:'org', null, '{"name":"Troca de componente","unit":"un","reference_price_cents":14000}');
select public.os_save_service(:'org', null, '{"name":"Instalação de equipamento","unit":"un","reference_price_cents":32000}');
select public.os_save_service(:'org', null, '{"name":"Hora técnica adicional","unit":"h","reference_price_cents":12000}');
select public.os_save_part(:'org', null, '{"code":"CAP-40","name":"Capacitor 40 µF","unit":"un","reference_price_cents":3500}');
select public.os_save_part(:'org', null, '{"code":"RES-3000","name":"Resistência 3000 W","unit":"un","reference_price_cents":12900}');
select public.os_save_part(:'org', null, '{"code":"TER-01","name":"Termostato universal","unit":"un","reference_price_cents":8400}');
select public.os_save_part(:'org', null, '{"code":"GAS-R410","name":"Gás refrigerante R-410A","unit":"kg","reference_price_cents":21000}');
select public.os_save_part(:'org', null, '{"code":"CAB-25","name":"Cabo flexível 2,5 mm²","unit":"m","reference_price_cents":1100}');
select public.os_save_part(:'org', null, '{"code":"VED-01","name":"Borracha de vedação","unit":"un","reference_price_cents":4200}');
select public.os_save_template(:'org', null, 'Manutenção de ar-condicionado', 'Revisão completa de split', true, '[
  {"label":"Filtros limpos?","kind":"boolean","required":true,"note_rule":"on_negative"},
  {"label":"Pressão do gás (psi)","kind":"number","required":true},
  {"label":"Dreno desobstruído?","kind":"boolean","required":true,"allow_na":true,"note_rule":"on_negative"},
  {"label":"Foto da unidade interna","kind":"boolean","required":false,"require_photo":true},
  {"label":"Condição geral","kind":"select","options":["Boa","Regular","Ruim"],"required":false,"note_rule":"on_negative"}]'::jsonb);
select public.os_save_template(:'org', null, 'Reparo de eletrodoméstico', 'Forno, geladeira, máquina', true, '[
  {"label":"Equipamento liga normalmente?","kind":"boolean","required":true,"note_rule":"on_negative"},
  {"label":"Teste de funcionamento por 30 minutos","kind":"boolean","required":true},
  {"label":"Observações finais","kind":"text","required":false,"allow_na":true}]'::jsonb);
select public.os_save_template(:'org', null, 'Instalação elétrica', 'Pontos, tomadas e quadros', true, '[
  {"label":"Disjuntor dimensionado conforme a carga?","kind":"boolean","required":true,"note_rule":"on_negative"},
  {"label":"Tensão medida (V)","kind":"number","required":true},
  {"label":"Aterramento verificado?","kind":"boolean","required":true,"allow_na":true,"note_rule":"always"}]'::jsonb);
reset role;

-- ===================================================================== auxiliares (apenas nesta sessão)
create function pg_temp.u(p_email text) returns uuid language sql stable as $$ select id from auth.users where email = p_email $$;
create function pg_temp.org() returns uuid language sql stable as $$ select current_setting('demo.org')::uuid $$;
create function pg_temp.h(n numeric) returns timestamptz language sql stable as $$ select now() - make_interval(secs => (n * 3600)::double precision) $$;

create function pg_temp.cust(p_name text, p_kind text, p_doc text, p_email text, p_phone text, p_street text, p_number text, p_city text, p_uf text, p_label text) returns uuid language plpgsql as $$
declare c uuid := gen_random_uuid();
begin
  insert into public.customers (id, organization_id, name, kind, email, phone, created_at) values (c, pg_temp.org(), p_name, p_kind, p_email, p_phone, pg_temp.h(24 * 60));
  insert into public.customer_private (customer_id, organization_id, document, internal_notes) values (c, pg_temp.org(), p_doc, null);
  insert into public.customer_addresses (organization_id, customer_id, label, street, number, city, state, is_default) values (pg_temp.org(), c, p_label, p_street, p_number, p_city, p_uf, true);
  return c;
end $$;
create function pg_temp.addr_of(c uuid) returns uuid language sql stable as $$ select id from public.customer_addresses where customer_id = c order by is_default desc limit 1 $$;
create function pg_temp.eqp(c uuid, p_kind text, p_brand text, p_model text, p_serial text) returns uuid language plpgsql as $$
declare e uuid := gen_random_uuid();
begin insert into public.equipment (id, organization_id, customer_id, kind, brand, model, serial_number) values (e, pg_temp.org(), c, p_kind, p_brand, p_model, p_serial); return e; end $$;
create function pg_temp.contact(c uuid, p_name text, p_phone text) returns void language sql as $$
  insert into public.customer_contacts (organization_id, customer_id, name, phone, is_primary) values (pg_temp.org(), c, p_name, p_phone, true) $$;

create function pg_temp.ev(o uuid, p_type text, p_at timestamptz, p_actor uuid default null, p_kind text default 'user', p_data jsonb default '{}'::jsonb) returns void language sql as $$
  insert into public.order_events (organization_id, service_order_id, event_type, actor_kind, actor_user_id, data, created_at) values (pg_temp.org(), o, p_type, p_kind, p_actor, p_data, p_at) $$;

-- abre a ordem (aberta ou rascunho) já com snapshot e evento inicial
create function pg_temp.mk(p_num bigint, c uuid, e uuid, p_subject text, p_desc text, p_prio text, p_at timestamptz, p_by text default 'gestor@demo.exemplo', p_mode text default 'required', p_just text default null, p_draft boolean default false) returns uuid language plpgsql as $$
declare o uuid := gen_random_uuid(); a uuid := pg_temp.addr_of(c); cu public.customers; ad public.customer_addresses; eq public.equipment; k public.customer_contacts;
begin
  insert into public.service_orders (id, organization_id, order_number, customer_id, address_id, equipment_id, execution_status, quote_mode, authorization_justification, authorized_by, authorized_at, priority, subject, problem_description, created_by, created_at)
  values (o, pg_temp.org(), p_num, c, a, e, case when p_draft then 'draft' else 'open' end, p_mode, p_just, case when p_mode = 'authorized' then pg_temp.u(p_by) end, case when p_mode = 'authorized' then p_at end, p_prio, p_subject, p_desc, pg_temp.u(p_by), p_at);
  select * into cu from public.customers where id = c; select * into ad from public.customer_addresses where id = a; select * into eq from public.equipment where id = e;
  select * into k from public.customer_contacts where customer_id = c and is_primary limit 1;
  insert into public.service_order_snapshots (organization_id, service_order_id, snapshot_version, customer_name, customer_phone, customer_email, contact_name, contact_phone, address, equipment, created_by, created_at)
  values (pg_temp.org(), o, 1, cu.name, cu.phone, cu.email, k.name, k.phone,
    jsonb_strip_nulls(jsonb_build_object('label', ad.label, 'street', ad.street, 'number', ad.number, 'city', ad.city, 'state', ad.state)),
    case when e is not null then jsonb_strip_nulls(jsonb_build_object('kind', eq.kind, 'brand', eq.brand, 'model', eq.model, 'serial_number', eq.serial_number)) end, pg_temp.u(p_by), p_at);
  perform pg_temp.ev(o, 'opened', p_at, pg_temp.u(p_by), 'user', jsonb_build_object('status', case when p_draft then 'draft' else 'open' end, 'quote_mode', p_mode, 'priority', p_prio));
  if p_mode = 'authorized' then perform pg_temp.ev(o, 'execution_authorized', p_at, pg_temp.u(p_by)); end if;
  return o;
end $$;

create function pg_temp.tpl(o uuid, p_name text) returns void language sql as $$
  select private.os_apply_template(pg_temp.org(), o, (select id from public.checklist_templates where organization_id = pg_temp.org() and name = p_name)) $$;

create function pg_temp.assign(o uuid, p_tech text, p_at timestamptz) returns void language plpgsql as $$
begin update public.service_orders set assigned_technician_user_id = pg_temp.u(p_tech) where id = o; perform pg_temp.ev(o, 'assigned', p_at, pg_temp.u('gestor@demo.exemplo'), 'user', jsonb_build_object('to', pg_temp.u(p_tech))); end $$;
create function pg_temp.schedule(o uuid, p_tech text, p_start timestamptz, p_end timestamptz, p_at timestamptz) returns void language plpgsql as $$
begin
  update public.service_orders set assigned_technician_user_id = pg_temp.u(p_tech), scheduled_start_at = p_start, scheduled_end_at = p_end, execution_status = 'scheduled' where id = o;
  perform pg_temp.ev(o, 'scheduled', p_at, pg_temp.u('gestor@demo.exemplo'), 'user', jsonb_build_object('start', p_start, 'end', p_end));
end $$;

-- orçamento: versão seguinte, itens por nome de serviço/código de peça; publica (supersede a publicada anterior) e, se pedido, registra a decisão
create function pg_temp.quote(o uuid, p_items jsonb, p_disc bigint, p_pub timestamptz, p_valid_days integer, p_decision text default null, p_dec_at timestamptz default null, p_dec_name text default null, p_channel text default 'customer_link', p_just text default null) returns uuid language plpgsql as $$
declare q uuid := gen_random_uuid(); vn integer; it jsonb; pos integer := 0; sid uuid; pid uuid; qty numeric; price bigint; ord public.service_orders;
begin
  select * into ord from public.service_orders where id = o;
  select coalesce(max(version_number), 0) + 1 into vn from public.quote_versions where service_order_id = o;
  update public.quote_versions set status = 'superseded' where service_order_id = o and status = 'published';
  insert into public.quote_versions (id, organization_id, service_order_id, version_number, created_by, created_at) values (q, pg_temp.org(), o, vn, pg_temp.u('gestor@demo.exemplo'), p_pub - interval '20 minutes');
  for it in select value from jsonb_array_elements(p_items) loop
    pos := pos + 1; qty := (it ->> 'qty')::numeric; price := (it ->> 'price')::bigint;
    sid := case when it ? 'svc' then (select id from public.service_catalog where organization_id = pg_temp.org() and name = it ->> 'svc') end;
    pid := case when it ? 'part' then (select id from public.part_catalog where organization_id = pg_temp.org() and code = it ->> 'part') end;
    insert into public.quote_items (organization_id, quote_version_id, position, kind, service_id, part_id, description, unit, quantity, unit_price_cents, line_total_cents)
    values (pg_temp.org(), q, pos, case when it ? 'part' then 'part' else 'service' end, sid, pid, it ->> 'desc', coalesce(it ->> 'unit', 'un'), qty, price, round(qty * price));
  end loop;
  perform private.os_recalc_quote(q, p_disc);
  update public.quote_versions set status = 'published', published_at = p_pub, published_by = pg_temp.u('gestor@demo.exemplo'), valid_until = p_pub + make_interval(days => p_valid_days),
    terms_snapshot = 'DEMONSTRAÇÃO: pagamento na entrega do serviço. Peças com 90 dias de garantia.', snapshot_version = 1 where id = q;
  perform pg_temp.ev(o, 'quote_published', p_pub, pg_temp.u('gestor@demo.exemplo'), 'user', jsonb_build_object('quote_version_id', q, 'version_number', vn));
  if p_decision is not null then
    insert into public.quote_decisions (organization_id, service_order_id, quote_version_id, decision, channel, declared_name, accepted_text, decided_at, operator_user_id, justification, evidence)
    values (pg_temp.org(), o, q, p_decision, p_channel, p_dec_name, private.os_quote_text(q, p_decision, p_channel), p_dec_at, case when p_channel = 'staff_manual' then pg_temp.u('gestor@demo.exemplo') end, p_just,
      case when p_channel = 'customer_link' then jsonb_build_object('source', 'demo', 'user_agent', 'Navegador de demonstração') else '{}'::jsonb end);
    update public.quote_versions set status = p_decision where id = q;
    perform pg_temp.ev(o, case when p_decision = 'approved' then 'quote_approved' else 'quote_rejected' end, p_dec_at, case when p_channel = 'staff_manual' then pg_temp.u('gestor@demo.exemplo') end,
      case when p_channel = 'customer_link' then 'customer_link' else 'user' end, jsonb_build_object('quote_version_id', q, 'version_number', vn, 'channel', p_channel));
  end if;
  return q;
end $$;

create function pg_temp.start(o uuid, p_at timestamptz) returns void language plpgsql as $$
declare tech uuid;
begin
  update public.service_orders set execution_status = 'in_progress', started_at = coalesce(started_at, p_at) where id = o returning assigned_technician_user_id into tech;
  perform pg_temp.ev(o, 'started', p_at, tech);
end $$;
create function pg_temp.pause(o uuid, p_reason text, p_from timestamptz, p_to timestamptz default null) returns void language plpgsql as $$
declare tech uuid;
begin
  select assigned_technician_user_id into tech from public.service_orders where id = o;
  insert into public.order_pauses (organization_id, service_order_id, started_at, ended_at, reason, started_by, ended_by) values (pg_temp.org(), o, p_from, p_to, p_reason, tech, case when p_to is not null then tech end);
  perform pg_temp.ev(o, 'paused', p_from, tech);
  if p_to is null then update public.service_orders set execution_status = 'paused' where id = o;
  else perform pg_temp.ev(o, 'resumed', p_to, tech); end if;
end $$;

-- responde um item do checklist pelo texto (boolean/number/select/text)
create function pg_temp.ans(o uuid, p_label text, p_val text, p_at timestamptz, p_note text default null, p_na boolean default false) returns void language plpgsql as $$
declare i public.order_checklist_items; tech uuid;
begin
  select * into i from public.order_checklist_items where service_order_id = o and label = p_label;
  select assigned_technician_user_id into tech from public.service_orders where id = o;
  update public.order_checklist_items set not_applicable = p_na, note = p_note, answered_by = tech, answered_at = p_at,
    answer_bool = case when not p_na and i.kind = 'boolean' then p_val = 'sim' end, answer_number = case when not p_na and i.kind = 'number' then p_val::numeric end,
    answer_text = case when not p_na and i.kind = 'text' then p_val end, answer_option = case when not p_na and i.kind = 'select' then p_val end where id = i.id;
end $$;
create function pg_temp.ans_all(o uuid, p_at timestamptz) returns void language plpgsql as $$
declare i record;
begin
  for i in select * from public.order_checklist_items where service_order_id = o and answered_at is null and (required or kind = 'select') order by position loop
    perform pg_temp.ans(o, i.label, case i.kind when 'boolean' then 'sim' when 'number' then '10.5' when 'select' then 'Boa' else 'ok' end, p_at, case when i.note_rule = 'always' then 'Verificado no local.' end);
  end loop;
end $$;
create function pg_temp.use(o uuid, p_code text, p_qty numeric, p_at timestamptz) returns uuid language plpgsql as $$
declare pt public.part_catalog; tech uuid; r uuid := gen_random_uuid();
begin
  select * into pt from public.part_catalog where organization_id = pg_temp.org() and code = p_code;
  select assigned_technician_user_id into tech from public.service_orders where id = o;
  insert into public.order_part_usage (id, organization_id, service_order_id, part_id, description, unit, quantity, entry_kind, used_at, registered_by, registered_at) values (r, pg_temp.org(), o, pt.id, pt.name, pt.unit, p_qty, 'usage', p_at, tech, p_at);
  perform pg_temp.ev(o, 'part_used', p_at, tech, 'user', jsonb_build_object('usage_id', r));
  return r;
end $$;
create function pg_temp.reverse(o uuid, ref uuid, p_qty numeric, p_reason text, p_at timestamptz) returns void language plpgsql as $$
declare u public.order_part_usage; tech uuid;
begin
  select * into u from public.order_part_usage where id = ref; select assigned_technician_user_id into tech from public.service_orders where id = o;
  insert into public.order_part_usage (organization_id, service_order_id, part_id, description, unit, quantity, entry_kind, reference_usage_id, reason, used_at, registered_by, registered_at) values (pg_temp.org(), o, u.part_id, u.description, u.unit, -p_qty, 'reversal', ref, p_reason, p_at, tech, p_at);
  perform pg_temp.ev(o, 'part_corrected', p_at, tech, 'user', jsonb_build_object('reference', ref));
end $$;
create function pg_temp.cost(o uuid, p_cat text, p_desc text, p_cents bigint, p_at timestamptz) returns void language sql as $$
  insert into public.order_internal_costs (organization_id, service_order_id, category, description, amount_cents, recorded_by, recorded_at) values (pg_temp.org(), o, p_cat, p_desc, p_cents, pg_temp.u('gestor@demo.exemplo'), p_at) $$;
create function pg_temp.note(o uuid, p_vis text, p_by text, p_body text, p_at timestamptz) returns void language plpgsql as $$
begin
  insert into public.order_updates (organization_id, service_order_id, author_user_id, visibility, body, created_at) values (pg_temp.org(), o, pg_temp.u(p_by), p_vis, p_body, p_at);
  perform pg_temp.ev(o, case when p_vis = 'customer' then 'update_shared' else 'note_added' end, p_at, pg_temp.u(p_by));
end $$;

-- conclui: congela checklist, peças e orçamento-base (mesma lógica de os_complete, com o instante informado)
create function pg_temp.complete(o uuid, p_at timestamptz, p_summary text, p_note text default null) returns void language plpgsql as $$
declare ord public.service_orders; cv integer; base public.quote_versions; cl jsonb; ps jsonb;
begin
  select * into ord from public.service_orders where id = o; cv := ord.completion_version + 1;
  select * into base from public.quote_versions where service_order_id = o and status = 'approved' order by version_number desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('group', c.group_name, 'label', c.label, 'kind', c.kind, 'required', c.required, 'not_applicable', c.not_applicable,
    'answer', case c.kind when 'boolean' then to_jsonb(c.answer_bool) when 'text' then to_jsonb(c.answer_text) when 'number' then to_jsonb(c.answer_number) else to_jsonb(c.answer_option) end, 'note', c.note, 'answered_at', c.answered_at, 'photos', 0) order by c.position), '[]'::jsonb) into cl
    from public.order_checklist_items c where c.service_order_id = o;
  select coalesce(jsonb_agg(jsonb_build_object('description', d, 'unit', un, 'quantity', q) order by d), '[]'::jsonb) into ps
    from (select max(u.description) d, max(u.unit) un, sum(u.quantity) q from public.order_part_usage u where u.service_order_id = o group by coalesce(u.part_id::text, lower(u.description)) having sum(u.quantity) <> 0) x;
  insert into public.order_completions (organization_id, service_order_id, completion_version, snapshot_version, summary, divergence_note, checklist_snapshot, parts_snapshot, quote_snapshot, completed_by, completed_at)
  values (pg_temp.org(), o, cv, 1, p_summary, p_note, cl, ps, case when base.id is not null then jsonb_build_object('quote_version_id', base.id, 'version_number', base.version_number, 'total_cents', base.total_cents) end, ord.assigned_technician_user_id, p_at);
  update public.service_orders set execution_status = 'completed', completed_at = p_at, completion_version = cv where id = o;
  perform pg_temp.ev(o, 'completed', p_at, ord.assigned_technician_user_id, 'user', jsonb_build_object('completion_version', cv, 'divergence', p_note is not null));
end $$;
create function pg_temp.accept(o uuid, p_decision text, p_name text, p_note text, p_at timestamptz, p_channel text default 'customer_link') returns void language plpgsql as $$
declare cv integer;
begin
  select completion_version into cv from public.service_orders where id = o;
  insert into public.completion_acceptances (organization_id, service_order_id, completion_version, decision, channel, declared_name, accepted_text, note, decided_at, operator_user_id, justification, evidence)
  values (pg_temp.org(), o, cv, p_decision, p_channel, p_name, private.os_completion_text(o, cv, p_decision, p_channel), p_note, p_at, case when p_channel = 'staff_manual' then pg_temp.u('gestor@demo.exemplo') end,
    case when p_channel = 'staff_manual' then 'O cliente respondeu presencialmente na entrega do serviço.' end, case when p_channel = 'customer_link' then jsonb_build_object('source', 'demo', 'user_agent', 'Navegador de demonstração') else '{}'::jsonb end);
  perform pg_temp.ev(o, case when p_decision = 'accepted' then 'completion_accepted' else 'completion_contested' end, p_at, case when p_channel = 'staff_manual' then pg_temp.u('gestor@demo.exemplo') end,
    case when p_channel = 'customer_link' then 'customer_link' else 'user' end, jsonb_build_object('completion_version', cv, 'channel', p_channel));
end $$;
create function pg_temp.close(o uuid, p_at timestamptz) returns void language plpgsql as $$
begin update public.service_orders set execution_status = 'closed', closed_at = p_at where id = o; perform pg_temp.ev(o, 'closed', p_at, pg_temp.u('gestor@demo.exemplo')); end $$;
create function pg_temp.reopen(o uuid, p_reason text, p_at timestamptz) returns void language plpgsql as $$
begin
  update public.service_orders set execution_status = 'in_progress', closed_at = null where id = o;
  perform pg_temp.ev(o, 'reopened', p_at, pg_temp.u('gestor@demo.exemplo'));
  perform pg_temp.note(o, 'internal', 'gestor@demo.exemplo', 'Ordem reaberta para execução. Motivo: ' || p_reason, p_at);
end $$;
create function pg_temp.cancel(o uuid, p_reason text, p_at timestamptz) returns void language plpgsql as $$
begin update public.service_orders set execution_status = 'cancelled', cancelled_at = p_at, cancel_reason = p_reason where id = o; perform pg_temp.ev(o, 'cancelled', p_at, pg_temp.u('gestor@demo.exemplo')); end $$;

-- ===================================================================== clientes e equipamentos
select pg_temp.cust('Padaria Estrela Ltda', 'company', '11222333000181', 'contato@padariaestrela.exemplo', '(11) 3333-1001', 'Rua das Acácias', '120', 'São Paulo', 'SP', 'Loja') as c1 \gset
select pg_temp.cust('Maria Souza', 'person', '52998224725', 'maria.souza@exemplo.test', '(11) 98888-2002', 'Rua do Sol', '45', 'São Paulo', 'SP', 'Residência') as c2 \gset
select pg_temp.cust('Clínica Bem Viver', 'company', null, 'recepcao@bemviver.exemplo', '(11) 3333-3003', 'Av. Central', '900', 'Guarulhos', 'SP', 'Unidade centro') as c3 \gset
select pg_temp.cust('João Pereira', 'person', null, null, '(11) 97777-4004', 'Rua Verde', '77', 'Osasco', 'SP', 'Casa') as c4 \gset
select pg_temp.cust('Condomínio Jardim das Flores', 'company', null, 'sindico@jardimdasflores.exemplo', '(11) 3333-5005', 'Alameda das Flores', '300', 'Santo André', 'SP', 'Portaria') as c5 \gset
select pg_temp.cust('Oficina Rápida Ltda', 'company', null, null, '(11) 3333-6006', 'Av. Industrial', '1500', 'Barueri', 'SP', 'Galpão') as c6 \gset
select pg_temp.contact(:'c1', 'Sr. Antônio (gerente)', '(11) 99999-1001');
select pg_temp.contact(:'c3', 'Dra. Paula (administração)', '(11) 99999-3003');
select pg_temp.contact(:'c5', 'Sr. Roberto (síndico)', '(11) 99999-5005');
select pg_temp.eqp(:'c1', 'Forno industrial', 'Fornax', 'F-200', 'FX200-8841') as e1 \gset
select pg_temp.eqp(:'c2', 'Máquina de lavar', 'Lavamax', 'LM-11', 'LM11-0234') as e2 \gset
select pg_temp.eqp(:'c3', 'Ar-condicionado split 18.000 BTU', 'Brisa', 'BR-18', 'BR18-7712') as e3 \gset
select pg_temp.eqp(:'c3', 'Ar-condicionado split 12.000 BTU', 'Brisa', 'BR-12', 'BR12-3320') as e3b \gset
select pg_temp.eqp(:'c4', 'Geladeira', 'Frio Bom', 'FB-400', null) as e4 \gset
select pg_temp.eqp(:'c6', 'Compressor de ar', 'Pressur', 'PR-50', 'PR50-1190') as e6 \gset

-- ===================================================================== ordens (histórico coerente; tudo no passado)
-- 1 · ENCERRADA — forno da padaria (orçamento aprovado pelo link, divergência de peça justificada, aceite pelo link, retrabalho: conclusão contestada e refeita)
select pg_temp.mk(1, :'c1', :'e1', 'Forno não esquenta', 'O forno liga, mas não passa de 80 graus. A produção da manhã está comprometida.', 'high', pg_temp.h(24 * 12), 'gestor@demo.exemplo') as o1 \gset
select pg_temp.tpl(:'o1', 'Reparo de eletrodoméstico');
select pg_temp.assign(:'o1', 'tecnico1@demo.exemplo', pg_temp.h(24 * 12 - 0.2));
select pg_temp.quote(:'o1', '[{"svc":"Diagnóstico técnico","desc":"Diagnóstico técnico","qty":1,"price":9000},{"svc":"Troca de componente","desc":"Troca da resistência","qty":1,"price":14000},{"part":"RES-3000","desc":"Resistência 3000 W","qty":1,"price":12900}]'::jsonb, 1000, pg_temp.h(24 * 12 - 1), 15, 'approved', pg_temp.h(24 * 12 - 3), 'Antônio Ribeiro') as q1 \gset
select pg_temp.start(:'o1', pg_temp.h(24 * 11));
select pg_temp.use(:'o1', 'RES-3000', 1, pg_temp.h(24 * 11 - 1)) as u1 \gset
select pg_temp.use(:'o1', 'TER-01', 1, pg_temp.h(24 * 11 - 1.2)) as u1b \gset
select pg_temp.ans(:'o1', 'Equipamento liga normalmente?', 'sim', pg_temp.h(24 * 11 - 2));
select pg_temp.ans(:'o1', 'Teste de funcionamento por 30 minutos', 'sim', pg_temp.h(24 * 11 - 2.2));
select pg_temp.cost(:'o1', 'part', 'Resistência e termostato (compra)', 17800, pg_temp.h(24 * 11 - 3));
select pg_temp.cost(:'o1', 'labor', '3 horas de mão de obra', 21000, pg_temp.h(24 * 11 - 3));
select pg_temp.complete(:'o1', pg_temp.h(24 * 11 - 3), 'Troquei a resistência queimada e instalei um termostato novo (encontrado com defeito durante o teste). Forno testado por 30 minutos a 220 °C.', 'O termostato não estava no orçamento: o defeito só apareceu depois da troca da resistência.');
select pg_temp.accept(:'o1', 'contested', 'Antônio Ribeiro', 'A porta do forno continua soltando calor pelo lado direito.', pg_temp.h(24 * 10));
select pg_temp.reopen(:'o1', 'Cliente contestou: vedação da porta com folga.', pg_temp.h(24 * 10 - 1));
select pg_temp.use(:'o1', 'VED-01', 1, pg_temp.h(24 * 9 - 6)) as u1c \gset
select pg_temp.complete(:'o1', pg_temp.h(24 * 9 - 7), 'Substituí a borracha de vedação da porta e reajustei as dobradiças. Sem perda de calor nos testes.', 'Borracha de vedação e termostato não estavam no orçamento aprovado.');
select pg_temp.accept(:'o1', 'accepted', 'Antônio Ribeiro', 'Agora ficou perfeito.', pg_temp.h(24 * 9 - 20));
select pg_temp.close(:'o1', pg_temp.h(24 * 9 - 21));
select pg_temp.note(:'o1', 'customer', 'tecnico1@demo.exemplo', 'Peças chegam hoje à tarde; o atendimento volta na quinta pela manhã.', pg_temp.h(24 * 11 - 4));
select pg_temp.note(:'o1', 'internal', 'gestor@demo.exemplo', 'Cliente antigo, pagamento sempre em dia. Combinar visita preventiva para o próximo trimestre.', pg_temp.h(24 * 9 - 22));

-- 2 · ENCERRADA — manutenção preventiva da clínica (aceite registrado manualmente pela equipe)
select pg_temp.mk(2, :'c3', :'e3', 'Manutenção preventiva do ar-condicionado', 'Revisão semestral da unidade da recepção.', 'normal', pg_temp.h(24 * 8), 'gestor@demo.exemplo') as o2 \gset
select pg_temp.tpl(:'o2', 'Manutenção de ar-condicionado');
select pg_temp.assign(:'o2', 'tecnico2@demo.exemplo', pg_temp.h(24 * 8 - 0.1));
select pg_temp.quote(:'o2', '[{"svc":"Manutenção preventiva","desc":"Manutenção preventiva","qty":1,"price":18000}]'::jsonb, 0, pg_temp.h(24 * 8 - 1), 15, 'approved', pg_temp.h(24 * 8 - 2), 'Dra. Paula Mendes', 'staff_manual', 'Aprovação por telefone confirmada pela gestora da clínica.');
select pg_temp.start(:'o2', pg_temp.h(24 * 7));
select pg_temp.ans_all(:'o2', pg_temp.h(24 * 7 - 1));
select pg_temp.use(:'o2', 'GAS-R410', 0.5, pg_temp.h(24 * 7 - 1.5)) as u2 \gset
select pg_temp.complete(:'o2', pg_temp.h(24 * 7 - 2), 'Limpeza dos filtros e da serpentina, desobstrução do dreno e complemento de gás. Pressão normalizada.', 'Gás refrigerante complementar (0,5 kg) não estava no orçamento.');
select pg_temp.accept(:'o2', 'accepted', 'Dra. Paula Mendes', null, pg_temp.h(24 * 7 - 3), 'staff_manual');
select pg_temp.close(:'o2', pg_temp.h(24 * 7 - 3.5));

-- 3 · CONCLUÍDA, AGUARDANDO ACEITE — instalação elétrica no condomínio
select pg_temp.mk(3, :'c5', null, 'Instalação de ponto elétrico na portaria', 'Novo ponto para o equipamento de controle de acesso.', 'normal', pg_temp.h(24 * 5), 'gestor@demo.exemplo') as o3 \gset
select pg_temp.tpl(:'o3', 'Instalação elétrica');
select pg_temp.assign(:'o3', 'tecnico3@demo.exemplo', pg_temp.h(24 * 5 - 0.1));
select pg_temp.quote(:'o3', '[{"svc":"Instalação de equipamento","desc":"Instalação do ponto elétrico","qty":1,"price":32000},{"part":"CAB-25","desc":"Cabo flexível 2,5 mm²","qty":12,"price":1100,"unit":"m"}]'::jsonb, 0, pg_temp.h(24 * 5 - 1), 15, 'approved', pg_temp.h(24 * 5 - 4), 'Roberto Lima') as q3 \gset
select pg_temp.start(:'o3', pg_temp.h(24 * 3));
select pg_temp.use(:'o3', 'CAB-25', 12, pg_temp.h(24 * 3 - 1)) as u3 \gset
select pg_temp.ans_all(:'o3', pg_temp.h(24 * 3 - 2));
select pg_temp.complete(:'o3', pg_temp.h(24 * 3 - 3), 'Ponto elétrico instalado com disjuntor dedicado, aterramento conferido e identificação no quadro.');

-- 4 · CONCLUÍDA, CONCLUSÃO CONTESTADA PELO CLIENTE (aguarda reabertura da gestão)
select pg_temp.mk(4, :'c2', :'e2', 'Máquina de lavar não centrifuga', 'Para de centrifugar no meio do ciclo.', 'normal', pg_temp.h(24 * 6), 'gestor@demo.exemplo') as o4 \gset
select pg_temp.tpl(:'o4', 'Reparo de eletrodoméstico');
select pg_temp.assign(:'o4', 'tecnico1@demo.exemplo', pg_temp.h(24 * 6 - 0.1));
select pg_temp.quote(:'o4', '[{"svc":"Diagnóstico técnico","desc":"Diagnóstico técnico","qty":1,"price":9000},{"part":"CAP-40","desc":"Capacitor 40 µF","qty":1,"price":3500}]'::jsonb, 0, pg_temp.h(24 * 6 - 1), 15, 'approved', pg_temp.h(24 * 6 - 2), 'Maria Souza') as q4 \gset
select pg_temp.start(:'o4', pg_temp.h(24 * 4));
select pg_temp.use(:'o4', 'CAP-40', 1, pg_temp.h(24 * 4 - 1)) as u4 \gset
select pg_temp.ans_all(:'o4', pg_temp.h(24 * 4 - 1.5));
select pg_temp.complete(:'o4', pg_temp.h(24 * 4 - 2), 'Troquei o capacitor do motor e testei dois ciclos completos.');
select pg_temp.accept(:'o4', 'contested', 'Maria Souza', 'Ainda faz barulho forte na centrifugação.', pg_temp.h(24 * 2));

-- 5 · EM EXECUÇÃO — ar-condicionado da clínica (checklist parcial; peça usada ACIMA do orçamento = divergência)
select pg_temp.mk(5, :'c3', :'e3b', 'Ar-condicionado não gela', 'Sala de espera quente; o equipamento liga mas não refrigera.', 'urgent', pg_temp.h(30), 'gestor@demo.exemplo') as o5 \gset
select pg_temp.tpl(:'o5', 'Manutenção de ar-condicionado');
select pg_temp.assign(:'o5', 'tecnico2@demo.exemplo', pg_temp.h(29.8));
select pg_temp.quote(:'o5', '[{"svc":"Diagnóstico técnico","desc":"Diagnóstico técnico","qty":1,"price":9000},{"part":"GAS-R410","desc":"Gás refrigerante R-410A","qty":0.5,"price":21000,"unit":"kg"}]'::jsonb, 0, pg_temp.h(29), 15, 'approved', pg_temp.h(27), 'Dra. Paula Mendes') as q5 \gset
select pg_temp.start(:'o5', pg_temp.h(5));
select pg_temp.use(:'o5', 'GAS-R410', 1.2, pg_temp.h(3)) as u5 \gset
select pg_temp.ans(:'o5', 'Filtros limpos?', 'sim', pg_temp.h(4.5));
select pg_temp.ans(:'o5', 'Pressão do gás (psi)', '95.5', pg_temp.h(4));

-- 6 · EM EXECUÇÃO — execução autorizada SEM orçamento (justificativa da gestão)
select pg_temp.mk(6, :'c6', :'e6', 'Compressor perdendo pressão', 'O compressor desarma sozinho e não mantém 8 bar.', 'urgent', pg_temp.h(8), 'gestor@demo.exemplo', 'authorized', 'Urgência: a oficina está parada; o responsável autorizou a execução por telefone e o orçamento seguirá depois.') as o6 \gset
select pg_temp.assign(:'o6', 'tecnico3@demo.exemplo', pg_temp.h(7.9));
select pg_temp.start(:'o6', pg_temp.h(6));
select pg_temp.note(:'o6', 'customer', 'tecnico3@demo.exemplo', 'Chegamos ao local e já iniciamos o diagnóstico do compressor.', pg_temp.h(5.5));
select pg_temp.note(:'o6', 'internal', 'tecnico3@demo.exemplo', 'Suspeita de válvula de retenção travada. Levar kit de reparo na próxima visita.', pg_temp.h(5));

-- 7 · PAUSADA — aguardando peça; orçamento v2 PUBLICADO e pendente (impede retomar)
select pg_temp.mk(7, :'c4', :'e4', 'Geladeira não resfria', 'Alimentos estragando; o motor liga e desliga o tempo todo.', 'high', pg_temp.h(52), 'gestor@demo.exemplo') as o7 \gset
select pg_temp.tpl(:'o7', 'Reparo de eletrodoméstico');
select pg_temp.assign(:'o7', 'tecnico1@demo.exemplo', pg_temp.h(51.8));
select pg_temp.quote(:'o7', '[{"svc":"Diagnóstico técnico","desc":"Diagnóstico técnico","qty":1,"price":9000},{"svc":"Troca de componente","desc":"Troca do termostato","qty":1,"price":14000},{"part":"TER-01","desc":"Termostato universal","qty":1,"price":8400}]'::jsonb, 0, pg_temp.h(50), 15, 'approved', pg_temp.h(48), 'João Pereira') as q7 \gset
select pg_temp.start(:'o7', pg_temp.h(26));
select pg_temp.pause(:'o7', 'Aguardando peça do fornecedor: o compressor também precisa de troca.', pg_temp.h(20));
select pg_temp.quote(:'o7', '[{"svc":"Diagnóstico técnico","desc":"Diagnóstico técnico","qty":1,"price":9000},{"svc":"Troca de componente","desc":"Troca do termostato e do relé","qty":1,"price":22000},{"part":"TER-01","desc":"Termostato universal","qty":1,"price":8400},{"desc":"Relé de partida do compressor","qty":1,"price":6500}]'::jsonb, 1000, pg_temp.h(18), 15) as q7b \gset
select pg_temp.note(:'o7', 'customer', 'gestor@demo.exemplo', 'Encontramos mais um item a trocar. Enviamos uma nova versão do orçamento para a sua aprovação.', pg_temp.h(18));

-- 8 · AGENDADA (amanhã) e 9 · AGENDADA com janela SOBREPOSTA do mesmo técnico (alerta de agenda)
select pg_temp.mk(8, :'c1', :'e1', 'Revisão semestral do forno', 'Revisão preventiva agendada.', 'low', pg_temp.h(72), 'gestor@demo.exemplo') as o8 \gset
select pg_temp.tpl(:'o8', 'Reparo de eletrodoméstico');
select pg_temp.quote(:'o8', '[{"svc":"Manutenção preventiva","desc":"Revisão semestral do forno","qty":1,"price":18000}]'::jsonb, 0, pg_temp.h(70), 15, 'approved', pg_temp.h(60), 'Antônio Ribeiro');
select pg_temp.schedule(:'o8', 'tecnico2@demo.exemplo', now() + interval '20 hours', now() + interval '22 hours', pg_temp.h(59));
select pg_temp.mk(9, :'c5', null, 'Troca de lâmpadas da garagem', 'Várias lâmpadas queimadas na garagem do subsolo.', 'normal', pg_temp.h(40), 'gestor@demo.exemplo') as o9 \gset
select pg_temp.schedule(:'o9', 'tecnico2@demo.exemplo', now() + interval '21 hours', now() + interval '23 hours', pg_temp.h(30));

-- 10 · AGENDADA com a janela JÁ ENCERRADA (atraso da previsão)
select pg_temp.mk(10, :'c3', :'e3', 'Verificação de ruído no ar-condicionado', 'Ruído metálico ao ligar.', 'normal', pg_temp.h(60), 'gestor@demo.exemplo') as o10 \gset
select pg_temp.quote(:'o10', '[{"svc":"Diagnóstico técnico","desc":"Diagnóstico técnico","qty":1,"price":9000}]'::jsonb, 0, pg_temp.h(58), 15, 'approved', pg_temp.h(55), 'Dra. Paula Mendes');
select pg_temp.schedule(:'o10', 'tecnico3@demo.exemplo', pg_temp.h(10), pg_temp.h(8), pg_temp.h(40));

-- 11 · ABERTA sem responsável · 12 · ABERTA com orçamento RECUSADO (início bloqueado)
select pg_temp.mk(11, :'c2', null, 'Instalação de chuveiro elétrico', 'Chuveiro novo comprado pela cliente; precisa de instalação.', 'normal', pg_temp.h(3), 'gestor@demo.exemplo') as o11 \gset
select pg_temp.mk(12, :'c6', :'e6', 'Manutenção preventiva do compressor', 'Revisão geral solicitada pelo gerente.', 'normal', pg_temp.h(100), 'gestor@demo.exemplo') as o12 \gset
select pg_temp.assign(:'o12', 'tecnico3@demo.exemplo', pg_temp.h(99));
select pg_temp.quote(:'o12', '[{"svc":"Manutenção preventiva","desc":"Revisão do compressor","qty":1,"price":18000},{"svc":"Hora técnica adicional","desc":"Horas adicionais","qty":4,"price":12000,"unit":"h"}]'::jsonb, 0, pg_temp.h(96), 15, 'rejected', pg_temp.h(90), 'Gerente da oficina');
select pg_temp.note(:'o12', 'internal', 'gestor@demo.exemplo', 'Cliente achou caro. Ligar na próxima semana oferecendo desconto no pacote anual.', pg_temp.h(89));

-- 13 · RASCUNHO · 14 · CANCELADA
select pg_temp.mk(13, :'c4', null, 'Revisão elétrica da casa (a confirmar)', 'Cliente ainda vai confirmar o dia da visita.', 'low', pg_temp.h(6), 'gestor@demo.exemplo', 'required', null, true) as o13 \gset
select pg_temp.mk(14, :'c2', null, 'Troca de torneira', 'Pedido cancelado pela cliente.', 'low', pg_temp.h(24 * 4), 'gestor@demo.exemplo') as o14 \gset
select pg_temp.cancel(:'o14', 'A cliente resolveu o problema por conta própria.', pg_temp.h(24 * 3));

-- numeração: o próximo número continua depois da última ordem criada
update public.order_number_counters set last_number = (select max(order_number) from public.service_orders where organization_id = pg_temp.org()) where organization_id = pg_temp.org();

commit;
