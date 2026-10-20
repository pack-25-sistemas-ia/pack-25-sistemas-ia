-- Gestão de Contratos — visibilidade DENTRO da empresa: quem não tem vínculo com o contrato não enxerga vínculos, valores, reajustes, partes, notificações de outros nem execuções do agendador.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d2","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_rl 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d3","aal":"aal1","email":"rl@t.invalid"}'', true); set local role authenticated;'
\set as_nl 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d4","aal":"aal1","email":"nl@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.notify(org uuid, c uuid, users uuid[]) returns integer language sql security definer set search_path = '' as $$ select private.ct_notify(org, c, 'contract_assigned', users) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000d0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d2', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d3', 'rl@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d4', 'nl@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Empresa Visibilidade', 'empresa-visibilidade'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000d2', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000d3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000d4', 'member');
end $$;
reset role;

-- ===================================================================== (1) um contrato ativo com valor, reajuste proposto, notificações e uma execução do agendador
:as_m
do $$
declare org uuid := test.t('org'); cpl uuid; cpu uuid; c uuid;
begin
  cpl := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte Ligada"}', gen_random_uuid());
  cpu := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte Solta"}', gen_random_uuid());
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato visível só a quem tem vínculo', 'start_date', (current_date - 30)::text, 'end_date', (current_date + 200)::text,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cpl, 'role_description', 'Contratada')),
    'access', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000d3', 'role', 'reader')),
    'value', jsonb_build_object('amount_cents', 100000, 'billing_basis', 'monthly'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c, (select version from public.contracts where id = c));
  perform public.ct_simulate_adjustment(org, c, current_date - 1, 5, 'IPCA', null, null, null);
  perform public.ct_run_reminders_now(org);
  perform set_config('t.c', c::text, true); perform set_config('t.cpl', cpl::text, true); perform set_config('t.cpu', cpu::text, true);
  -- as próprias notificações da gestão e as de quem tem e não tem acesso
  perform test.sql(format($q$insert into public.notifications (organization_id, user_id, kind, contract_id) values
    (%L, 'ffffffff-0000-4000-8000-0000000000d3', 'contract_assigned', %L), (%L, 'ffffffff-0000-4000-8000-0000000000d4', 'contract_assigned', %L), (%L, 'ffffffff-0000-4000-8000-0000000000d2', 'contract_assigned', %L)$q$, org, c, org, c, org, c));
  -- a gestão enxerga tudo, inclusive partes ainda sem contrato e as execuções do agendador
  assert (select count(*) from public.counterparties) = 2, 'gestão vê todas as partes, mesmo a que ainda não está em contrato';
  assert (select count(*) from public.ct_job_runs) >= 1, 'gestão vê as execuções do agendador';
  assert (select count(*) from public.contract_access where contract_id = c) = 1 and (select count(*) from public.contract_value_versions where contract_id = c) = 1
    and (select count(*) from public.contract_adjustments where contract_id = c) = 1, 'gestão vê vínculos, valores e reajustes';
  -- notificar: quem perdeu o acesso não recebe; quem fez a ação não notifica a si mesmo
  assert test.notify(org, c, array['ffffffff-0000-4000-8000-0000000000d4'::uuid]) = 0, 'sem acesso ao contrato, sem notificação';
  assert test.notify(org, c, array['ffffffff-0000-4000-8000-0000000000d2'::uuid]) = 0, 'a própria pessoa não é notificada pela própria ação';
  assert test.notify(org, c, array['ffffffff-0000-4000-8000-0000000000d3'::uuid]) = 1, 'quem tem acesso é notificado';
  raise notice 'PASS: preparação e visão da gestão (1)';
end $$;
reset role;

-- ===================================================================== (2) quem tem vínculo de leitura vê o seu; quem não tem vínculo não vê nada
:as_rl
do $$
declare org uuid := test.t('org'); c uuid := test.t('c');
begin
  assert (select count(*) from public.contract_access where contract_id = c) = 1, 'leitor vê o vínculo do contrato que enxerga';
  assert (select count(*) from public.contract_value_versions where contract_id = c) = 1, 'leitor vê o histórico de valores do contrato';
  assert (select count(*) from public.contract_adjustments where contract_id = c) = 1, 'leitor vê os reajustes do contrato';
  assert (select count(*) from public.counterparties) = 1 and (select count(*) from public.counterparties where id = test.t('cpl')) = 1, 'leitor vê só a parte do contrato que enxerga';
  assert (select count(*) from public.notifications) >= 1 and (select count(*) from public.notifications where user_id <> 'ffffffff-0000-4000-8000-0000000000d3') = 0, 'só as próprias notificações';
  assert (select count(*) from public.ct_job_runs) = 0, 'colaborador não vê execuções do agendador';
  raise notice 'PASS: leitor vinculado (2)';
end $$;
reset role;
:as_nl
do $$
declare org uuid := test.t('org'); c uuid := test.t('c');
begin
  assert (select count(*) from public.contracts) = 0, 'sem vínculo, nenhum contrato';
  assert (select count(*) from public.contract_access) = 0, 'sem vínculo, nenhum vínculo de acesso';
  assert (select count(*) from public.contract_value_versions) = 0, 'sem vínculo, nenhum valor';
  assert (select count(*) from public.contract_adjustments) = 0, 'sem vínculo, nenhum reajuste';
  assert (select count(*) from public.counterparties) = 0, 'sem vínculo, nenhuma parte';
  assert (select count(*) from public.notifications) = 0, 'notificação de contrato que já não enxerga some (ele tem uma linha, mas sem acesso não aparece)';
  assert (select count(*) from public.ct_job_runs) = 0, 'sem vínculo, nenhuma execução do agendador';
  raise notice 'PASS: sem vínculo, nada (3)';
end $$;
reset role;

rollback;
