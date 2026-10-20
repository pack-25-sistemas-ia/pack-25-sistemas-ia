-- Gestão de Contratos — perfis e papéis no contrato: administrador do Core = proprietário, «Leitor» da empresa só consulta, contrato de outra empresa não tem papel.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_adm 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e1","aal":"aal2","email":"adm@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e2","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_rd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e3","aal":"aal1","email":"col@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e3","aal":"aal1","email":"col@t.invalid"}'', true); set local role authenticated;'
\set as_vw 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e4","aal":"aal1","email":"vw@t.invalid"}'', true); set local role authenticated;'
\set as_x 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000e5","aal":"aal2","email":"x@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.profile(org uuid, u uuid) returns text language sql security definer set search_path = '' as $$ select private.ct_profile_of(org, u) $$;
create function test.role_of(org uuid, c uuid, u uuid) returns text language sql security definer set search_path = '' as $$ select private.ct_contract_role_of(org, c, u) $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
create function test.can_edit(org uuid, c uuid) returns boolean language sql security definer set search_path = '' as $$ select private.ct_can_edit_contract(org, c) $$;
create function test.can_manage(org uuid, c uuid) returns boolean language sql security definer set search_path = '' as $$ select private.ct_can_manage_contract(org, c) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000e0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e1', 'adm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e2', 'm@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000e3', 'col@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e4', 'vw@t.invalid'), ('ffffffff-0000-4000-8000-0000000000e5', 'x@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa Papéis', 'empresa-papeis'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000e1', 'admin'), (org, 'ffffffff-0000-4000-8000-0000000000e2', 'manager'),
    (org, 'ffffffff-0000-4000-8000-0000000000e3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000e4', 'viewer');
end $$;
reset role;
:as_x
select set_config('t.org_b', public.create_organization('Empresa Outra', 'empresa-outra')::text, true);
do $$
declare c uuid;
begin
  c := (public.ct_create_contract(test.t('org_b'), gen_random_uuid(), jsonb_build_object('title', 'Contrato de outra empresa', 'start_date', current_date::text, 'end_date', (current_date + 30)::text)) ->> 'id')::uuid;
  perform set_config('t.c_b', c::text, true);
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); c uuid;
begin
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato com leitor da empresa', 'start_date', current_date::text, 'end_date', (current_date + 90)::text)) ->> 'id')::uuid;
  perform set_config('t.c', c::text, true);
  -- «Leitor» da empresa: só leitor no contrato
  perform test.has(test.errmsg(format($q$select public.ct_set_access(%L, %L, 'ffffffff-0000-4000-8000-0000000000e4', 'editor')$q$, org, c)), '%só pode ser leitor%', 'Leitor da empresa não vira editor');
  perform public.ct_set_access(org, c, 'ffffffff-0000-4000-8000-0000000000e4', 'reader');
  perform public.ct_set_access(org, c, 'ffffffff-0000-4000-8000-0000000000e3', 'reader');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) perfis e papéis
do $$
declare org uuid := test.t('org'); c uuid := test.t('c');
begin
  assert test.profile(org, 'ffffffff-0000-4000-8000-0000000000e0') = 'owner', 'dono do Core = proprietário';
  assert test.profile(org, 'ffffffff-0000-4000-8000-0000000000e1') = 'owner', 'administrador do Core = proprietário';
  assert test.profile(org, 'ffffffff-0000-4000-8000-0000000000e2') = 'manager', 'gerente = gestor';
  assert test.profile(org, 'ffffffff-0000-4000-8000-0000000000e3') = 'collaborator', 'membro = colaborador';
  assert test.profile(org, 'ffffffff-0000-4000-8000-0000000000e4') = 'viewer', 'leitor do Core = leitor da empresa';
  assert test.profile(org, 'ffffffff-0000-4000-8000-0000000000e5') is null, 'quem é de outra empresa não tem perfil aqui';
  assert test.role_of(org, c, 'ffffffff-0000-4000-8000-0000000000e1') = 'manager', 'administrador gere todos os contratos';
  assert test.role_of(org, c, 'ffffffff-0000-4000-8000-0000000000e4') = 'reader', 'leitor da empresa lê o contrato a que foi vinculado';
  assert test.role_of(org, c, 'ffffffff-0000-4000-8000-0000000000e3') = 'reader', 'colaborador com vínculo de leitura';
  assert test.role_of(org, test.t('c_b'), 'ffffffff-0000-4000-8000-0000000000e2') is null, 'gestor da empresa A não tem papel em contrato da empresa B';
  assert test.role_of(test.t('org_b'), c, 'ffffffff-0000-4000-8000-0000000000e5') is null, 'proprietário da B não tem papel em contrato da A';
  raise notice 'PASS: perfis e papéis (2)';
end $$;

-- ===================================================================== (3) o administrador faz o que é do proprietário; o leitor da empresa não escreve
:as_adm
do $$
declare org uuid := test.t('org');
begin
  perform public.ct_save_settings(org, '{"contract_prefix":"ADM"}'::jsonb);
  assert (select contract_prefix from public.ct_settings where organization_id = org) = 'ADM', 'administrador salva configurações';
  assert length(public.ct_rotate_job_token(org)) = 64, 'administrador gera o token do agendador';
  raise notice 'PASS: administrador age como proprietário (3)';
end $$;
reset role;
:as_vw
do $$
declare org uuid := test.t('org'); c uuid := test.t('c');
begin
  assert (select count(*) from public.contracts where id = c) = 1, 'leitor da empresa enxerga o contrato vinculado';
  perform test.has(test.errmsg(format($q$select public.ct_save_obligation(%L, %L, null, null, '{"title":"Tentativa","due_date":"2099-01-01"}')$q$, org, c)), '%sem permissão%', 'leitor da empresa não cria obrigação');
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, null, '{"title":"Invasão"}')$q$, org, c)), '%sem permissão%', 'leitor da empresa não edita o contrato');
  raise notice 'PASS: leitor da empresa só consulta (3)';
end $$;
reset role;

-- ===================================================================== (4) editar × gerir, para quem consulta (leitor), edita (editor) e gere (gestor)
:as_rd
do $$ begin
  assert not test.can_edit(test.t('org'), test.t('c')) and not test.can_manage(test.t('org'), test.t('c')), 'leitor nem edita nem gere';
end $$;
reset role;
:as_m
select public.ct_set_access(test.t('org'), test.t('c'), 'ffffffff-0000-4000-8000-0000000000e3', 'editor');
do $$ begin
  assert test.can_edit(test.t('org'), test.t('c')) and test.can_manage(test.t('org'), test.t('c')), 'gestor edita e gere';
end $$;
reset role;
:as_ed
do $$ begin
  assert test.can_edit(test.t('org'), test.t('c')) and not test.can_manage(test.t('org'), test.t('c')), 'editor edita mas não gere';
  raise notice 'PASS: editar × gerir (4)';
end $$;
reset role;

rollback;
