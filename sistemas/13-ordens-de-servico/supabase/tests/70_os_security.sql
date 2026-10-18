-- Ordens de Serviço — segurança: isolamento entre empresas (leitura, RPCs e chaves compostas), escrita direta negada em TODAS as tabelas, MFA no banco, privilégios das funções,
-- search_path fixo, auditoria sem valores e imutabilidade da organização.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_o_aal1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal1","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_t1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"t1@t.invalid"}'', true); set local role authenticated;'
\set as_x 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"x@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
create function test.path(org uuid, ord uuid, ext text) returns text language sql as $$ select org::text || '/' || ord::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || ext $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 't1@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c0', 'x@t.invalid');

-- ===================================================================== (1) duas empresas com dados completos
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa A', 'empresa-a');
  perform set_config('t.a', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member');
end $$;
reset role;
:as_x
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa B', 'empresa-b');
  perform set_config('t.b', org::text, true);
end $$;
reset role;

create function test.seed(p_org uuid, p_tech uuid, p_tag text) returns void language plpgsql as $$
declare c uuid; ad uuid; eq uuid; o uuid; q uuid; v integer; sv uuid; pt uuid; tp uuid;
begin
  c := public.os_save_customer(p_org, null, jsonb_build_object('name', 'Cliente ' || p_tag, 'internal_notes', 'segredo ' || p_tag));
  ad := public.os_save_address(p_org, c, null, '{"label":"Sede","street":"Rua","city":"Cidade","state":"SP"}');
  eq := public.os_save_equipment(p_org, c, null, '{"kind":"Equipamento"}');
  sv := public.os_save_service(p_org, null, '{"name":"Serviço","reference_price_cents":100}');
  pt := public.os_save_part(p_org, null, '{"code":"P1","name":"Peça","reference_price_cents":100}');
  tp := public.os_save_template(p_org, null, 'Modelo', null, true, '[{"label":"Item um","kind":"boolean","required":true}]'::jsonb);
  o := (public.os_open_order(p_org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'address_id', ad, 'equipment_id', eq, 'subject', 'Ordem ' || p_tag, 'problem_description', 'Descrição.', 'technician_id', p_tech, 'template_ids', jsonb_build_array(tp))) ->> 'id')::uuid;
  q := public.os_quote_new_draft(p_org, o); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(p_org, q, v, jsonb_build_object('valid_date', (current_date + 5)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'part', 'part_id', pt, 'description', 'Peça', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 100))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(p_org, q, v);
  perform public.os_add_update(p_org, o, gen_random_uuid(), 'internal', 'nota ' || p_tag, null);
  perform public.os_add_cost(p_org, o, gen_random_uuid(), jsonb_build_object('category', 'other', 'description', 'custo ' || p_tag, 'amount_cents', 100));
  perform public.os_create_link(p_org, o, encode(sha256(convert_to('token-' || p_tag, 'UTF8')), 'hex'));
  perform set_config('t.c_' || p_tag, c::text, true); perform set_config('t.ad_' || p_tag, ad::text, true); perform set_config('t.eq_' || p_tag, eq::text, true);
  perform set_config('t.o_' || p_tag, o::text, true); perform set_config('t.q_' || p_tag, q::text, true); perform set_config('t.pt_' || p_tag, pt::text, true); perform set_config('t.sv_' || p_tag, sv::text, true);
  perform set_config('t.tp_' || p_tag, tp::text, true);
end $$;
grant execute on function test.seed(uuid, uuid, text) to authenticated;

:as_m
select test.seed(test.t('a'), 'ffffffff-0000-4000-8000-0000000000a2', 'A');
reset role;
:as_x
select test.seed(test.t('b'), null, 'B');
reset role;

-- ===================================================================== (2) leitura isolada nos dois sentidos
:as_x
do $$
declare t text; n bigint;
begin
  foreach t in array array['os_settings', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog', 'checklist_templates', 'checklist_template_items',
    'service_orders', 'service_order_snapshots', 'order_pauses', 'quote_versions', 'quote_items', 'quote_decisions', 'order_part_usage', 'order_internal_costs', 'order_checklist_items', 'order_updates',
    'order_attachments', 'order_completions', 'completion_acceptances', 'order_events', 'public_access_tokens', 'technician_status'] loop
    execute format('select count(*) from public.%I where organization_id = %L', t, test.t('a')) into n;
    assert n = 0, 'empresa B enxerga linhas da A em ' || t;
  end loop;
  assert test.count('select 1 from public.service_orders') = 1 and test.count('select 1 from public.customers') = 1, 'B só enxerga o que é dela';
  raise notice 'PASS: B não lê nenhuma tabela da A (2)';
end $$;
reset role;
:as_o
do $$
declare t text; n bigint;
begin
  foreach t in array array['customers', 'service_orders', 'quote_versions', 'order_updates', 'order_internal_costs', 'public_access_tokens', 'order_events'] loop
    execute format('select count(*) from public.%I where organization_id = %L', t, test.t('b')) into n;
    assert n = 0, 'empresa A enxerga linhas da B em ' || t;
  end loop;
  raise notice 'PASS: A não lê nenhuma tabela da B (2)';
end $$;
reset role;

-- ===================================================================== (3) RPCs: ids de outra empresa nunca funcionam
:as_x
do $$
declare b uuid := test.t('b'); a uuid := test.t('a');
begin
  perform set_config('t.qd_B', public.os_quote_new_draft(b, test.t('o_B'))::text, true);
  -- com o id da empresa A: sem perfil algum
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{}')$q$, a)), '%sem permissão%', 'B não opera na empresa A');
  perform test.has(test.errmsg(format($q$select public.os_dashboard(%L, current_date - 1, current_date)$q$, a)), '%sem permissão%', 'B não vê painel da A');
  -- com o id da empresa B mas ids da A
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), jsonb_build_object('customer_id', %L, 'subject', 'Cruzado', 'problem_description', 'texto'))$q$, b, test.t('c_A'))), '%cliente não encontrado%', 'cliente da A em ordem da B');
  perform test.has(test.errmsg(format($q$select public.os_save_address(%L, %L, null, '{"label":"Casa","street":"Rua","city":"Cidade","state":"SP"}')$q$, b, test.t('c_A'))), '%cliente não encontrado%', 'endereço para cliente da A');
  perform test.has(test.errmsg(format($q$select public.os_save_equipment(%L, %L, null, '{"kind":"Coisa"}')$q$, b, test.t('c_A'))), '%cliente não encontrado%', 'equipamento para cliente da A');
  perform test.has(test.errmsg(format($q$select public.os_start(%L, %L, 1)$q$, b, test.t('o_A'))), '%não encontrada%', 'iniciar ordem da A');
  perform test.has(test.errmsg(format($q$select public.os_update_order(%L, %L, 1, '{"subject":"Invasão"}')$q$, b, test.t('o_A'))), '%não encontrada%', 'editar ordem da A');
  perform test.has(test.errmsg(format($q$select public.os_quote_new_draft(%L, %L)$q$, b, test.t('o_A'))), '%não encontrada%', 'orçamento na ordem da A');
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, 1, '{"items":[]}')$q$, b, test.t('q_A'))), '%não encontrado%', 'rascunho da A');
  perform test.has(test.errmsg(format($q$select public.os_quote_decide_manual(%L, %L, 'approved', 'Invasor', 'Tentando aprovar da outra empresa.', null, null)$q$, b, test.t('q_A'))), '%não encontrado%', 'aprovar orçamento da A');
  perform test.has(test.errmsg(format($q$select public.os_create_link(%L, %L, repeat('b', 64))$q$, b, test.t('o_A'))), '%não encontrada%', 'link para ordem da A');
  perform test.has(test.errmsg(format($q$select public.os_document(%L, %L, 'summary', 0)$q$, b, test.t('o_A'))), '%não encontrada%', 'documento da A');
  perform test.has(test.errmsg(format($q$select public.os_add_update(%L, %L, gen_random_uuid(), 'internal', 'invasão', null)$q$, b, test.t('o_A'))), '%não encontrada%', 'nota na ordem da A');
  perform test.has(test.errmsg(format($q$select public.os_apply_checklist_template(%L, %L, 1, %L)$q$, b, test.t('o_B'), test.t('tp_A'))), '%modelo de checklist não encontrado%', 'modelo da A em ordem da B');
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, %L, '{"name":"Sobrescrita"}')$q$, b, test.t('c_A'))), '%cliente não encontrado%', 'sobrescrever cliente da A');
  perform test.has(test.errmsg(format($q$select public.os_save_service(%L, %L, '{"name":"Sobrescrita","reference_price_cents":1}')$q$, b, test.t('sv_A'))), '%serviço não encontrado%', 'sobrescrever serviço da A');
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('path', test.path(%L, %L, 'jpg'), 'mime', 'image/jpeg', 'size', 100, 'filename', 'x.jpg')))$q$, b, test.t('o_A'), a, test.t('o_A'))), '%não encontrada%', 'arquivo na ordem da A');
  -- usar peça da A num orçamento da B
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'part', 'part_id', %L, 'description', 'Peça', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 1))))$q$, b, test.t('qd_B'), test.cnt(format('select version from public.quote_versions where id = %L', test.t('qd_B'))), test.t('pt_A'))), '%peça do catálogo inválida%', 'peça da A em orçamento da B');
  raise notice 'PASS: nenhuma RPC aceita ids de outra empresa (3)';
end $$;
reset role;

-- ===================================================================== (4) chaves compostas: o banco recusa vínculos cruzados mesmo para quem escreve direto
do $$
declare a uuid := test.t('a'); b uuid := test.t('b');
begin
  perform test.has(test.errmsg(format($q$insert into public.service_orders (organization_id, order_number, customer_id, subject, problem_description) values (%L, 99, %L, 'Cruzada', 'texto')$q$, b, test.t('c_A'))), '%foreign key%', 'ordem da B com cliente da A');
  perform test.has(test.errmsg(format($q$insert into public.service_orders (organization_id, order_number, customer_id, address_id, subject, problem_description) values (%L, 99, %L, %L, 'Cruzada', 'texto')$q$, a, test.t('c_A'), test.t('ad_B'))), '%foreign key%', 'endereço de outra empresa');
  perform test.has(test.errmsg(format($q$insert into public.service_orders (organization_id, order_number, customer_id, equipment_id, subject, problem_description) values (%L, 99, %L, %L, 'Cruzada', 'texto')$q$, a, test.t('c_A'), test.t('eq_B'))), '%foreign key%', 'equipamento de outra empresa');
  perform test.has(test.errmsg(format($q$insert into public.quote_items (organization_id, quote_version_id, position, kind, part_id, description, unit, quantity, unit_price_cents, line_total_cents) values (%L, %L, 50, 'part', %L, 'Peça', 'un', 1, 1, 1)$q$, b, test.t('qd_B'), test.t('pt_A'))), '%foreign key%', 'item com peça de outra empresa');
  perform test.has(test.errmsg(format($q$insert into public.order_checklist_items (organization_id, service_order_id, group_name, position, label, kind) values (%L, %L, 'x', 90, 'Item cruzado', 'text')$q$, b, test.t('o_A'))), '%foreign key%', 'item de checklist em ordem de outra empresa');
  perform test.has(test.errmsg(format($q$insert into public.order_part_usage (organization_id, service_order_id, part_id, description, unit, quantity) values (%L, %L, %L, 'Peça', 'un', 1)$q$, a, test.t('o_A'), test.t('pt_B'))), '%foreign key%', 'uso de peça de outra empresa');
  -- equipamento de OUTRO cliente da mesma empresa
  perform test.sql(format($q$insert into public.customers (id, organization_id, name) values ('eeeeeeee-0000-4000-8000-000000000001', %L, 'Outro cliente da A')$q$, a));
  perform test.sql(format($q$insert into public.equipment (id, organization_id, customer_id, kind) values ('eeeeeeee-0000-4000-8000-000000000002', %L, 'eeeeeeee-0000-4000-8000-000000000001', 'Equip do outro')$q$, a));
  perform test.has(test.errmsg(format($q$insert into public.service_orders (organization_id, order_number, customer_id, equipment_id, subject, problem_description) values (%L, 99, %L, 'eeeeeeee-0000-4000-8000-000000000002', 'Cruzada', 'texto')$q$, a, test.t('c_A'))), '%foreign key%', 'equipamento de outro cliente');
  perform test.has(test.errmsg(format($q$update public.service_orders set organization_id = %L where id = %L$q$, b, test.t('o_A'))), '%organização do registro não pode mudar%', 'organização imutável');
  perform test.has(test.errmsg(format($q$update public.customers set organization_id = %L where id = %L$q$, b, test.t('c_A'))), '%organização do registro não pode mudar%', 'organização do cliente imutável');
  raise notice 'PASS: chaves compostas e organização imutável (4)';
end $$;

-- ===================================================================== (5) nenhuma escrita direta, em nenhuma tabela, para ninguém (nem o proprietário)
:as_o
do $$
declare t text;
begin
  foreach t in array array['os_settings', 'technician_status', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog', 'checklist_templates',
    'checklist_template_items', 'service_orders', 'service_order_snapshots', 'order_pauses', 'quote_versions', 'quote_items', 'quote_decisions', 'order_part_usage', 'order_internal_costs',
    'order_checklist_items', 'order_updates', 'order_attachments', 'order_completions', 'completion_acceptances', 'order_events', 'public_access_tokens', 'order_number_counters', 'mutation_requests', 'os_rate_limits'] loop
    perform test.has(test.errmsg(format('insert into public.%I default values', t)), '%permission denied%', 'insert direto em ' || t);
    perform test.has(test.errmsg(format('update public.%I set %I = %I', t, (select attname from pg_attribute where attrelid = ('public.' || t)::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1), (select attname from pg_attribute where attrelid = ('public.' || t)::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1))), '%permission denied%', 'update direto em ' || t);
    perform test.has(test.errmsg(format('delete from public.%I', t)), '%permission denied%', 'delete direto em ' || t);
  end loop;
  foreach t in array array['order_number_counters', 'mutation_requests', 'os_rate_limits'] loop
    perform test.has(test.errmsg(format('select 1 from public.%I', t)), '%permission denied%', 'select direto em ' || t);
  end loop;
  perform test.has(test.errmsg('select token_hash from public.public_access_tokens'), '%permission denied%', 'hash do token ilegível');
  raise notice 'PASS: escrita direta negada em todas as tabelas (5)';
end $$;
reset role;

-- ===================================================================== (6) MFA no banco: proprietário sem AAL2 não opera
:as_o_aal1
do $$
declare a uuid := test.t('a');
begin
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{}')$q$, a)), '%verificação em duas etapas%', 'proprietário sem AAL2');
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"Sem MFA"}')$q$, a)), '%verificação em duas etapas%', 'cadastro sem AAL2');
  raise notice 'PASS: MFA exigido também nas funções do sistema (6)';
end $$;
reset role;

-- ===================================================================== (7) funções: privilégios, search_path e portas públicas declaradas
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'os\_%' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  assert bad is null, 'SECURITY DEFINER sem search_path fixo: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'os\_%' and p.proname not like 'os\_public\_%' and has_function_privilege('anon', p.oid, 'execute');
  assert bad is null, 'anon executa função administrativa: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'os\_public\_%' and (not has_function_privilege('anon', p.oid, 'execute') or coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'PUBLIC_ENDPOINT:%');
  assert bad is null, 'porta pública sem anon/sem marca: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname like 'os\_%' and has_function_privilege('anon', p.oid, 'execute');
  assert bad is null, 'anon executa função interna: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname like 'os\_%' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname not in ('os_role', 'os_tech_active', 'os_profile', 'os_is_owner', 'os_is_manager', 'os_is_staff', 'os_order_visible', 'os_can_see_order', 'os_customer_visible', 'os_address_visible', 'os_equipment_visible', 'os_guard');
  assert bad is null, 'authenticated executa função interna: ' || coalesce(bad, '');
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert bad is null, 'tabela sem RLS: ' || coalesce(bad, '');
  raise notice 'PASS: privilégios das funções, search_path fixo, portas públicas declaradas, RLS em tudo (7)';
end $$;

-- ===================================================================== (8) auditoria só com nomes de colunas (sem valores pessoais)
do $$
declare n bigint;
begin
  select count(*) into n from public.audit_log where entity in ('customers', 'customer_private', 'service_orders', 'quote_versions') and (changes::text like '%Cliente A%' or changes::text like '%segredo%' or changes::text like '%Ordem A%');
  assert n = 0, 'auditoria não carrega valores';
  assert (select count(*) from public.audit_log where entity = 'customers' and organization_id = test.t('a')) >= 1 and (select count(*) from public.audit_log where entity = 'service_orders' and organization_id = test.t('a')) >= 1, 'ações foram auditadas';
  assert (select count(*) from public.audit_log where entity = 'public_access_tokens') >= 1, 'criação de link auditada';
  raise notice 'PASS: auditoria sem valores pessoais (8)';
end $$;

-- ===================================================================== (9) técnico não escala privilégio
:as_t1
do $$
declare a uuid := test.t('a'); o uuid := test.t('o_A');
begin
  assert test.affected(format($q$update public.organization_members set role = 'owner' where organization_id = %L and user_id = auth.uid()$q$, a)) = 0, 'técnico não se promove (RLS do Core)';
  assert test.count(format('select 1 from public.service_orders where id = %L', test.t('o_B'))) = 0, 'técnico não vê ordem de outra empresa';
  assert test.count(format('select 1 from public.customer_private where organization_id = %L', a)) = 0, 'técnico não lê CPF/CNPJ';
  perform test.has(test.errmsg(format($q$select public.os_dashboard(%L, current_date - 1, current_date)$q$, test.t('b'))), '%sem permissão%', 'técnico não vê painel de outra empresa');
  raise notice 'PASS: técnico não escala privilégio (9)';
end $$;
reset role;

rollback;
