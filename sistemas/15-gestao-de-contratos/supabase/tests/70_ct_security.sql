-- Gestão de Contratos — segurança: isolamento entre empresas e entre contratos, escrita direta negada, funções com papel exigido, MFA, privilégios (sem portas públicas além do agendador),
-- documentos pessoais restritos à gestão, auditoria sem valores pessoais, acesso removido na hora.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_o_aal1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal1","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_out 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a5","aal":"aal1","email":"out@t.invalid"}'', true); set local role authenticated;'
\set as_x 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"x@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.cnt_path(v uuid) returns text language sql security definer set search_path = '' as $$ select storage_path from public.contract_document_versions where id = v $$;
grant execute on function test.cnt_path(uuid) to authenticated;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a5', 'out@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c0', 'x@t.invalid');

-- ===================================================================== (1) duas empresas; contrato com documento, aditivo, valor e obrigação em cada uma
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa A', 'empresa-a'); perform set_config('t.a', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a5', 'member');
end $$;
reset role;
:as_x
select set_config('t.b', public.create_organization('Empresa B', 'empresa-b')::text, true);
reset role;

create function test.seed(org uuid, tag text, editor uuid) returns void language plpgsql as $$
declare cp uuid; c uuid; d jsonb;
begin
  cp := public.ct_save_counterparty(org, null, null, jsonb_build_object('person_type', 'company', 'name', 'Parte ' || tag, 'document_number', case tag when 'A' then '11222333000181' else '45723174000110' end), gen_random_uuid());
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato ' || tag, 'start_date', (current_date - 30)::text, 'end_date', (current_date + 90)::text, 'notice_days', 20,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Parte')),
    'access', case when editor is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('user_id', editor, 'role', 'editor')) end,
    'value', jsonb_build_object('amount_cents', 50000, 'billing_basis', 'monthly'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c, (select version from public.contracts where id = c));
  d := public.ct_add_document(org, c, gen_random_uuid(), 'Contrato ' || tag, 'main', jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 1234, 'filename', 'segredo-' || tag || '.pdf'));
  perform public.ct_save_obligation(org, c, null, null, jsonb_build_object('title', 'Obrigação ' || tag, 'due_date', (current_date + 10)::text));
  perform set_config('t.c_' || tag, c::text, true); perform set_config('t.cp_' || tag, cp::text, true); perform set_config('t.v_' || tag, d ->> 'version_id', true);
end $$;
grant execute on function test.seed(uuid, text, uuid) to authenticated;
:as_m
select test.seed(test.t('a'), 'A', 'ffffffff-0000-4000-8000-0000000000a3');
reset role;
:as_x
select test.seed(test.t('b'), 'B', null);
reset role;

-- ===================================================================== (2) isolamento nos dois sentidos
:as_x
do $$
declare t text; n bigint;
begin
  foreach t in array array['ct_settings', 'counterparties', 'counterparty_documents', 'contract_categories', 'contracts', 'contract_access', 'contract_parties', 'contract_documents', 'contract_document_versions',
    'contract_changes', 'contract_value_versions', 'contract_adjustment_rules', 'contract_adjustments', 'contract_obligations', 'contract_deadlines', 'reminder_rules', 'notifications', 'contract_events'] loop
    execute format('select count(*) from public.%I where organization_id = %L', t, test.t('a')) into n;
    assert n = 0, 'empresa B enxerga linhas da A em ' || t;
  end loop;
  assert test.count('select 1 from public.contracts') = 1, 'B só enxerga o contrato dela';
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, null, '{"title":"Invasão"}')$q$, test.t('a'), test.t('c_A'))), '%sem permissão%', 'B não opera na empresa A');
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, null, '{"title":"Invasão"}')$q$, test.t('b'), test.t('c_A'))), '%contrato não encontrado%', 'B não alcança contrato de A pelo id nem usando a própria empresa');
  perform test.has(test.errmsg(format($q$select public.ct_document_info(%L, %L)$q$, test.t('b'), test.t('v_A'))), '%arquivo não encontrado%', 'B não obtém caminho de arquivo de A');
  perform test.has(test.errmsg(format($q$select public.ct_add_party(%L, %L, %L, 'Parte')$q$, test.t('b'), test.t('c_B'), test.t('cp_A'))), '%parte inválida%', 'B não vincula parte de A ao próprio contrato');
  raise notice 'PASS: empresa B não alcança a A (2)';
end $$;
reset role;
:as_m
do $$
begin
  assert test.count('select 1 from public.contracts') = 1 and test.count(format('select 1 from public.contracts where organization_id = %L', test.t('b'))) = 0, 'gestão da A não enxerga a B';
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, null, '{"title":"Invasão"}')$q$, test.t('a'), test.t('c_B'))), '%contrato não encontrado%', 'gestão da A não alcança contrato de B');
  raise notice 'PASS: isolamento no outro sentido (2)';
end $$;
reset role;

-- ===================================================================== (3) colaborador só enxerga o contrato a que foi vinculado; documentos pessoais só da gestão
:as_ed
do $$
declare org uuid := test.t('a');
begin
  assert test.count('select 1 from public.contracts') = 1, 'colaborador vê só o contrato vinculado';
  assert test.count('select 1 from public.counterparties') = 1, 'e só as partes desse contrato';
  assert test.count('select 1 from public.counterparty_documents') = 0, 'CPF/CNPJ só para a gestão';
  assert test.count('select 1 from public.contract_document_versions') = 1, 'documentos do contrato visíveis';
  assert test.cnt('select count(*) from public.contract_events') >= 0;
  perform test.has(test.errmsg('select storage_path from public.contract_document_versions'), '%permission denied%', 'o caminho do Storage não é legível pela API');
  assert private.ct_file_readable(test.cnt_path(test.t('v_A'))), 'a política de leitura do Storage libera quem enxerga o contrato (sem precisar ler a coluna)';
  assert not private.ct_file_readable(test.cnt_path(test.t('v_B'))), 'e nega o arquivo de outra empresa';
  assert not private.ct_file_readable('qualquer/outro/caminho.pdf'), 'e o caminho sem registro';
  assert private.ct_file_registered(test.cnt_path(test.t('v_A'))), 'arquivo registrado não é órfão';
  assert (select identity_snapshot ->> 'document_masked' from public.contract_parties limit 1) = '**.***.***/0001-**', 'o snapshot só traz o documento mascarado';
  raise notice 'PASS: colaborador vinculado vê só o que é seu e nunca o CPF/CNPJ completo (3)';
end $$;
reset role;
:as_out
do $$
begin
  assert test.count('select 1 from public.contracts') = 0 and test.count('select 1 from public.contract_documents') = 0 and test.count('select 1 from public.counterparties') = 0 and test.count('select 1 from public.contract_events') = 0
    and test.count('select 1 from public.contract_obligations') = 0 and test.count('select 1 from public.contract_deadlines') = 0, 'sem vínculo: nada é visível';
  perform test.has(test.errmsg(format($q$select public.ct_document_info(%L, %L)$q$, test.t('a'), test.t('v_A'))), '%arquivo não encontrado%', 'sem vínculo, sem caminho de arquivo');
  raise notice 'PASS: sem vínculo, nada (3)';
end $$;
reset role;

-- ===================================================================== (4) escrita direta negada; funções exigem papel; MFA
:as_ed
do $$
declare q text;
begin
  foreach q in array array[
    format($q$update public.contracts set title = 'Invasão' where id = %L$q$, test.t('c_A')),
    format($q$delete from public.contract_events where contract_id = %L$q$, test.t('c_A')),
    format($q$insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from) values (%L, %L, 1, 'monthly', current_date)$q$, test.t('a'), test.t('c_A')),
    format($q$update public.contract_obligations set status = 'completed' where contract_id = %L$q$, test.t('c_A')),
    format($q$insert into public.contract_access (organization_id, contract_id, user_id, contract_role) values (%L, %L, %L, 'editor')$q$, test.t('a'), test.t('c_A'), 'ffffffff-0000-4000-8000-0000000000a5')] loop
    perform test.has(test.errmsg(q), '%permission denied%', 'escrita direta negada: ' || left(q, 50));
  end loop;
  foreach q in array array['contract_number_counters', 'mutation_requests', 'ct_rate_limits', 'ct_job_tokens', 'reminder_deliveries'] loop
    perform test.has(test.errmsg('select * from public.' || q), '%permission denied%', 'sem leitura: ' || q);
  end loop;
  perform test.has(test.errmsg(format($q$select public.ct_set_access(%L, %L, %L, 'editor')$q$, test.t('a'), test.t('c_A'), 'ffffffff-0000-4000-8000-0000000000a5')), '%sem permissão%', 'editor não concede acesso');
  perform test.has(test.errmsg(format($q$select public.ct_save_settings(%L, '{"primary_color":"#112233"}')$q$, test.t('a'))), '%sem permissão%', 'colaborador não altera configurações');
  perform test.has(test.errmsg(format($q$select public.ct_save_category(%L, null, 'Categoria nova')$q$, test.t('a'))), '%sem permissão%', 'colaborador não cria categoria');
  raise notice 'PASS: nenhuma escrita direta; funções exigem papel (4)';
end $$;
reset role;
:as_o_aal1
do $$
begin
  perform test.has(test.errmsg(format($q$select public.ct_save_settings(%L, '{"primary_color":"#112233"}')$q$, test.t('a'))), '%verificação em duas etapas%', 'proprietário sem 2º fator é barrado');
  raise notice 'PASS: proprietário sem 2º fator não opera (4)';
end $$;
reset role;

-- ===================================================================== (5) privilégios das funções e higiene
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname like 'ct\_%' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'ct_run_reminders';
  assert bad is null, 'anon executa funções do sistema: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like 'ct\_%' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('ct_role', 'ct_profile', 'ct_is_owner', 'ct_is_manager', 'ct_is_member', 'ct_contract_role', 'ct_can_see_contract', 'ct_can_edit_contract', 'ct_can_manage_contract', 'ct_can_see_counterparty', 'ct_can_edit_file', 'ct_can_see_file', 'ct_file_readable', 'ct_file_registered', 'ct_guard');
  assert bad is null, 'funções internas expostas: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'ct\_%' and not has_function_privilege('authenticated', p.oid, 'execute');
  assert bad is null, 'funções públicas sem acesso para autenticados: ' || coalesce(bad, '');
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.proname like 'ct\_%' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')) = 0, 'toda função SECURITY DEFINER fixa o search_path';
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and (c.relname like 'contract%' or c.relname in ('counterparties', 'notifications', 'reminder_rules', 'reminder_deliveries')) and not c.relrowsecurity;
  assert bad is null, 'tabelas sem RLS: ' || coalesce(bad, '');
  raise notice 'PASS: só o agendador é público; internas fechadas; search_path fixo; RLS em tudo (5)';
end $$;

-- ===================================================================== (6) auditoria sem valores pessoais; acesso removido vale na hora
do $$
declare txt text;
begin
  select string_agg(coalesce(changes::text, '') || coalesce(entity, ''), ' ') into txt from public.audit_log where entity in ('contracts', 'counterparties', 'contract_access');
  assert txt is not null and txt not like '%11222333000181%' and txt not like '%11.222.333%', 'a auditoria não guarda o CPF/CNPJ';
  raise notice 'PASS: auditoria sem documento pessoal (6)';
end $$;
:as_m
do $$
begin
  perform public.ct_set_access(test.t('a'), test.t('c_A'), 'ffffffff-0000-4000-8000-0000000000a3', null);
end $$;
reset role;
:as_ed
do $$
begin
  assert test.count('select 1 from public.contracts') = 0 and test.count('select 1 from public.contract_documents') = 0 and test.count('select 1 from public.counterparties') = 0, 'remover o acesso revoga a leitura na hora';
  assert not private.ct_file_readable(test.cnt_path(test.t('v_A'))), 'e o download do arquivo (política do Storage)';
  perform test.has(test.errmsg(format($q$select public.ct_document_info(%L, %L)$q$, test.t('a'), test.t('v_A'))), '%arquivo não encontrado%', 'e o download');
  raise notice 'PASS: acesso removido vale imediatamente (6)';
end $$;
reset role;

rollback;
