-- Gestão de Contratos — lembretes, casos de borda: rascunho, prazo superado, vencidos, regras inativas, destinatários, antecedência já enviada, falha isolada, fuso da empresa, limite do agendador e painel.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
create function test.today() returns date language sql security definer set search_path = '' as $$ select private.ct_today(current_setting('t.org')::uuid) $$;
-- «hoje + n dias, ao meio-dia» no fuso da empresa
create function test.run(n integer) returns jsonb language sql security definer set search_path = '' as $$
  select private.ct_process_reminders(current_setting('t.org')::uuid, ((private.ct_today(current_setting('t.org')::uuid) + n)::timestamp + interval '12 hours') at time zone (select timezone from public.ct_settings where organization_id = current_setting('t.org')::uuid), 'manual') $$;
create function test.run_at(ts timestamptz) returns jsonb language sql security definer set search_path = '' as $$ select private.ct_process_reminders(current_setting('t.org')::uuid, ts, 'manual') $$;
create function test.nk(c uuid) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.notifications where contract_id = c and kind like 'reminder%' $$;
create function test.nu(u uuid, k text, c uuid) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.notifications where user_id = u and kind = k and contract_id = c $$;
-- cria um contrato: fim em hoje + fim_dias, responsável opcional, aviso opcional, ativo ou rascunho
create function test.mk(title text, fim_dias integer, resp uuid, aviso integer, ativar boolean) returns uuid language plpgsql as $$
declare org uuid := current_setting('t.org')::uuid; t date := test.today(); c uuid; p jsonb;
begin
  p := jsonb_build_object('title', title, 'start_date', (t - 100)::text, 'end_date', (t + fim_dias)::text, 'parties', jsonb_build_array(jsonb_build_object('counterparty_id', current_setting('t.cp')::uuid, 'role_description', 'Contratada')),
    'access', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000c2', 'role', 'editor')));
  if resp is not null then p := p || jsonb_build_object('responsible_user_id', resp); end if;
  if aviso is not null then p := p || jsonb_build_object('notice_days', aviso); end if;
  c := (public.ct_create_contract(org, gen_random_uuid(), p) ->> 'id')::uuid;
  if ativar then perform public.ct_activate_contract(org, c, test.cv(c)); end if;
  return c;
end $$;
create function test.rule(ev text, offs integer[], act boolean) returns void language sql security definer set search_path = '' as $$ update public.reminder_rules set offsets_days = offs, active = act where organization_id = current_setting('t.org')::uuid and event_type = ev $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000c0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c2', 'ed@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c3', 'm3@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Lembretes Borda', 'lembretes-borda'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000c1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000c2', 'member');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); ed uuid := 'ffffffff-0000-4000-8000-0000000000c2'; m uuid := 'ffffffff-0000-4000-8000-0000000000c1'; o uuid := 'ffffffff-0000-4000-8000-0000000000c0';
  cp uuid; draft uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; o3 uuid; o4 uuid; o6 uuid; r jsonb;
begin
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte da Borda"}', gen_random_uuid());
  perform set_config('t.cp', cp::text, true);

  -- rascunho tem prazos, mas não gera lembrete
  draft := test.mk('Rascunho', 5, ed, null, false);
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and superseded_at is null$q$, draft)) >= 1, 'o rascunho tem prazo vigente';

  -- prazo superado antes de qualquer execução: a revisão antiga não notifica
  c2 := test.mk('Renovado antes de avisar', 30, ed, null, true);
  perform public.ct_renew_contract(org, c2, test.cv(c2), test.today() + 200, false, null, 'Renovado antes do primeiro aviso', null);

  -- obrigação vencida e obrigação de contrato encerrado
  c3 := test.mk('Obrigação vencida', 300, ed, null, true);
  o3 := public.ct_save_obligation(org, c3, null, null, jsonb_build_object('title', 'Entrega atrasada', 'due_date', (test.today() - 2)::text, 'responsible_user_id', ed));
  c4 := test.mk('Encerrado com obrigação', 300, ed, null, true);
  o4 := public.ct_save_obligation(org, c4, null, null, jsonb_build_object('title', 'Entrega de contrato encerrado', 'due_date', (test.today() + 1)::text, 'responsible_user_id', ed));
  perform public.ct_close_contract(org, c4, test.cv(c4), 'Encerramento normal do contrato');

  -- regra inativa: o aviso (hoje+10) não notifica e não é erro; o fim (hoje+20) notifica
  c5 := test.mk('Regra inativa', 20, ed, 10, true);
  perform public.ct_save_reminder_rule(org, 'notice', '{30,15,7,1}', false);

  -- obrigação com responsável diferente do responsável do contrato
  c6 := test.mk('Obrigação de outra pessoa', 300, ed, null, true);
  o6 := public.ct_save_obligation(org, c6, null, null, jsonb_build_object('title', 'Entrega da gestão', 'due_date', (test.today() + 1)::text, 'responsible_user_id', m));

  -- sem responsável: avisa a gestão (proprietário e gestor)
  c7 := test.mk('Sem responsável', 5, null, null, true);

  perform set_config('t.draft', draft::text, true); perform set_config('t.c2', c2::text, true); perform set_config('t.c3', c3::text, true); perform set_config('t.c4', c4::text, true);
  perform set_config('t.c5', c5::text, true); perform set_config('t.c6', c6::text, true); perform set_config('t.c7', c7::text, true);
  raise notice 'PASS: contratos de borda criados (2)';
end $$;
reset role;

do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000c2'; m uuid := 'ffffffff-0000-4000-8000-0000000000c1'; o uuid := 'ffffffff-0000-4000-8000-0000000000c0'; r jsonb;
begin
  r := test.run(0);
  assert (r ->> 'errors')::int = 0, 'regra inativa não é erro: ' || r::text;
  assert test.nk(test.t('draft')) = 0, 'rascunho não gera lembrete';
  assert test.nk(test.t('c2')) = 0, 'a revisão antiga do prazo não notifica';
  assert test.nk(test.t('c3')) = 0, 'obrigação vencida não notifica';
  assert test.nk(test.t('c4')) = 0, 'obrigação de contrato encerrado não notifica';
  assert test.nu(ed, 'reminder_notice', test.t('c5')) = 0, 'regra inativa não notifica o aviso';
  assert test.nu(ed, 'reminder_contract_end', test.t('c5')) = 1, 'o fim do mesmo contrato notifica normalmente';
  assert test.nu(m, 'reminder_obligation', test.t('c6')) = 1 and test.nu(ed, 'reminder_obligation', test.t('c6')) = 0, 'a obrigação avisa quem responde por ela, não o responsável do contrato';
  assert test.nu(o, 'reminder_contract_end', test.t('c7')) = 1 and test.nu(m, 'reminder_contract_end', test.t('c7')) = 1, 'sem responsável, avisa o proprietário e os gestores';
  raise notice 'PASS: casos de borda da primeira execução (3)';
end $$;

-- ===================================================================== (4) antecedência já enviada e destinatário novo
:as_m
do $$
declare org uuid := test.t('org'); ed uuid := 'ffffffff-0000-4000-8000-0000000000c2'; c8 uuid;
begin
  perform public.ct_save_reminder_rule(org, 'contract_end', '{7}', true);
  c8 := test.mk('Antecedência já enviada', 20, ed, null, true);
  perform set_config('t.c8', c8::text, true);
end $$;
reset role;
do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000c2'; m uuid := 'ffffffff-0000-4000-8000-0000000000c1'; m3 uuid := 'ffffffff-0000-4000-8000-0000000000c3'; r jsonb;
begin
  r := test.run(14); -- c8 faltam 6 dias: envia a de 7
  assert test.nu(ed, 'reminder_contract_end', test.t('c8')) = 1, 'a antecedência de 7 dias foi enviada';
  perform test.rule('contract_end', '{30,7}', true);
  r := test.run(14); -- agora existe uma antecedência MAIOR (30) ainda não entregue: não se envia depois de uma menor
  assert test.nu(ed, 'reminder_contract_end', test.t('c8')) = 1, 'não volta a avisar com uma antecedência maior do que a já enviada';
  assert test.cnt(format($q$select count(*) from public.reminder_deliveries where source_id in (select id from public.contract_deadlines where contract_id = %L) and offset_days = 30 and status = 'consolidated'$q$, test.t('c8'))) = 1, 'a de 30 dias ficou como consolidada';
  -- histórico de envios é por pessoa: quem entra depois recebe o aviso atual
  perform test.rule('contract_end', '{60,30,15,7}', true);
end $$;
:as_m
select set_config('t.c9', test.mk('Destinatário novo', 30, null, null, true)::text, true);
reset role;
do $$
declare m uuid := 'ffffffff-0000-4000-8000-0000000000c1'; m3 uuid := 'ffffffff-0000-4000-8000-0000000000c3'; r jsonb;
begin
  r := test.run(23); -- c9 faltam 7 dias: proprietário e gestor recebem a de 7
  assert test.nu(m, 'reminder_contract_end', test.t('c9')) = 1, 'o gestor recebeu';
  perform test.sql(format($q$insert into public.organization_members (organization_id, user_id, role) values (%L, %L, 'manager')$q$, test.t('org'), m3));
  r := test.run(23);
  assert test.nu(m3, 'reminder_contract_end', test.t('c9')) = 1, 'quem entrou na gestão depois também recebe o aviso atual';
  assert test.nu(m, 'reminder_contract_end', test.t('c9')) = 1, 'e quem já recebeu não recebe de novo';
  raise notice 'PASS: antecedência já enviada e destinatário novo (4)';
end $$;

-- ===================================================================== (5) uma falha isolada não derruba as demais; a execução fica «parcial»
:as_m
do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000c2'; c10 uuid; c11 uuid;
begin
  c10 := test.mk('Falha simulada', 3, null, null, true);
  c11 := test.mk('Segue funcionando', 3, ed, null, true);
  perform set_config('t.c10', c10::text, true); perform set_config('t.c11', c11::text, true);
end $$;
reset role;
create function test.boom() returns trigger language plpgsql as $$ begin if new.contract_id = current_setting('t.c10')::uuid then raise exception 'falha simulada'; end if; return new; end $$;
create trigger boom before insert on public.notifications for each row execute function test.boom();
do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000c2'; r jsonb;
begin
  r := test.run(0);
  assert (r ->> 'errors')::int = 1, 'a falha foi contada: ' || r::text;
  assert test.nk(test.t('c10')) = 0, 'o item com falha não deixou rastro (desfeito por inteiro)';
  assert test.nu(ed, 'reminder_contract_end', test.t('c11')) = 1, 'os demais itens seguiram';
  assert (select status from public.ct_job_runs order by id desc limit 1) = 'partial', 'a execução ficou parcial';
  assert (select errors from public.ct_job_runs order by id desc limit 1) = 1, 'a execução registrou 1 erro';
  raise notice 'PASS: falha isolada (5)';
end $$;
drop trigger boom on public.notifications;

-- ===================================================================== (6) fuso da empresa: o «hoje» é o do fuso configurado, não o UTC
:as_m
do $$
declare c12 uuid;
begin
  c12 := test.mk('Fuso distante', 40, 'ffffffff-0000-4000-8000-0000000000c2', null, true);
  perform set_config('t.c12', c12::text, true);
end $$;
reset role;
select test.sql(format($q$update public.ct_settings set timezone = 'Pacific/Kiritimati' where organization_id = %L$q$, test.t('org')));
do $$
declare due date := (select end_date from public.contracts where id = test.t('c12')); r jsonb;
begin
  -- 20:00 UTC do dia (due - 8) já é o dia (due - 7) em UTC+14
  r := test.run_at(((due - 8)::timestamp + interval '20 hours') at time zone 'UTC');
  assert exists (select 1 from public.notifications where contract_id = test.t('c12') and kind = 'reminder_contract_end' and offset_days = 7), 'com o fuso da empresa, faltam 7 dias e a antecedência de 7 é a enviada';
  assert (r ->> 'today')::date = due - 7, 'o «hoje» do processamento é o do fuso da empresa';
  raise notice 'PASS: fuso da empresa (6)';
end $$;
select test.sql(format($q$update public.ct_settings set timezone = 'America/Sao_Paulo' where organization_id = %L$q$, test.t('org')));

-- ===================================================================== (7) limite de chamadas do agendador (120 por hora)
:as_o
select set_config('t.tok', public.ct_rotate_job_token(test.t('org')), true);
reset role;
do $$
declare ok int := 0; blocked int := 0; i int;
begin
  for i in 1..125 loop
    begin
      perform public.ct_run_reminders(current_setting('t.tok'));
      ok := ok + 1;
    exception when sqlstate '54000' then blocked := blocked + 1;
    end;
  end loop;
  assert ok = 120 and blocked = 5, format('120 chamadas por hora (passaram %s, barradas %s)', ok, blocked);
  raise notice 'PASS: limite do agendador (7)';
end $$;

-- ===================================================================== (8) painel: contrato arquivado não entra
:as_m
do $$
declare org uuid := test.t('org'); c13 uuid; before_n int; after_renew int; after_archive int;
begin
  c13 := test.mk('Renovado e arquivado', 300, null, null, true);
  before_n := (public.ct_dashboard(org) ->> 'renewals_12m')::int;
  perform public.ct_renew_contract(org, c13, test.cv(c13), test.today() + 400, false, null, 'Renovação para o painel', null);
  after_renew := (public.ct_dashboard(org) ->> 'renewals_12m')::int;
  assert after_renew = before_n + 1, 'a renovação aparece no painel';
  perform public.ct_close_contract(org, c13, test.cv(c13), 'Encerramento normal do contrato');
  perform public.ct_archive_contract(org, c13, test.cv(c13), true);
  after_archive := (public.ct_dashboard(org) ->> 'renewals_12m')::int;
  assert after_archive = before_n, 'contrato arquivado sai do painel';
  raise notice 'PASS: painel sem arquivados (8)';
end $$;
reset role;

rollback;
