-- Gestão de Contratos — lembretes idempotentes (antecedências alcançadas no fuso da empresa, consolidação de atrasos, revisões, acesso removido, agendador por token) e painel.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_rd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"rd@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.today() returns date language sql security definer set search_path = '' as $$ select private.ct_today(current_setting('t.org')::uuid) $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
-- executa o processamento como se fosse «hoje + n dias, ao meio-dia» no fuso da empresa
create function test.run(n integer) returns jsonb language sql security definer set search_path = '' as $$
  select private.ct_process_reminders(current_setting('t.org')::uuid, ((private.ct_today(current_setting('t.org')::uuid) + n)::timestamp + interval '12 hours') at time zone (select timezone from public.ct_settings where organization_id = current_setting('t.org')::uuid), 'manual') $$;
create function test.nc(u uuid, k text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.notifications where user_id = u and kind = k $$;
create function test.ncc(u uuid, k text, c uuid) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.notifications where user_id = u and kind = k and contract_id = c $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a4', 'rd@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Lembretes Teste', 'lembretes-teste'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a4', 'member');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) contrato A: fim em hoje+30, aviso 10 dias antes (hoje+20), responsável = editor
:as_m
do $$
declare org uuid := test.t('org'); today date := test.today(); ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; cp uuid; a uuid;
begin
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte A"}', gen_random_uuid());
  perform set_config('t.cp', cp::text, true);
  a := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato A', 'start_date', (today - 60)::text, 'end_date', (today + 30)::text, 'responsible_user_id', ed, 'notice_days', 10,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Contratada')),
    'access', jsonb_build_array(jsonb_build_object('user_id', ed, 'role', 'editor')), 'value', jsonb_build_object('amount_cents', 100000, 'billing_basis', 'monthly'))) ->> 'id')::uuid;
  perform set_config('t.a', a::text, true);
  perform public.ct_activate_contract(org, a, test.cv(a));
  raise notice 'PASS: contrato A ativo (2)';
end $$;
reset role;

do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; r jsonb; a uuid := test.t('a');
begin
  -- hoje: fim alcançou 60 e 30 (fica a mais recente, 30; a de 60 é consolidada); aviso (hoje+20) alcançou 30
  r := test.run(0);
  assert (r ->> 'sent')::int = 2 and (r ->> 'consolidated')::int = 1, 'primeira execução: 2 enviados e 1 consolidado (' || r::text || ')';
  assert test.nc(ed, 'reminder_contract_end') = 1 and test.nc(ed, 'reminder_notice') = 1, 'o responsável recebeu os dois avisos';
  -- repetir não duplica nada (idempotência)
  r := test.run(0);
  assert (r ->> 'sent')::int = 0 and (r ->> 'consolidated')::int = 0, 'segunda execução no mesmo dia não gera nada';
  assert test.nc(ed, 'reminder_contract_end') = 1, 'sem notificação duplicada';
  assert (select count(*) from public.ct_job_runs) = 2 and (select count(*) from public.ct_job_runs where status = 'ok') = 2, 'cada execução fica registrada';
  -- hoje+16: fim alcançou 15; aviso alcançou 15 e 7 (envia só o 7 e consolida o 15)
  r := test.run(16);
  assert (r ->> 'sent')::int = 2 and (r ->> 'consolidated')::int = 1, 'execução atrasada consolida: ' || r::text;
  assert test.nc(ed, 'reminder_notice') = 2 and test.nc(ed, 'reminder_contract_end') = 2, 'um aviso novo de cada tipo';
  assert exists (select 1 from public.notifications where user_id = ed and kind = 'reminder_notice' and offset_days = 7) and not exists (select 1 from public.notifications where user_id = ed and kind = 'reminder_notice' and offset_days = 15), 'ficou a antecedência mais recente (7), sem a de 15';
  -- hoje+25: o aviso (hoje+20) já passou e não notifica mais; o fim alcançou 7
  r := test.run(25);
  assert (r ->> 'sent')::int = 1, 'prazo já vencido não notifica; só o fim (7): ' || r::text;
  assert (select count(*) from public.reminder_deliveries where event_type = 'notice' and status = 'sent') = 2, 'o aviso vencido não gerou novos envios';
  raise notice 'PASS: lembretes idempotentes, com consolidação e sem notificar prazo vencido (2)';
end $$;

-- ===================================================================== (3) mudança de prazo (renovação) invalida os lembretes antigos
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); today date := test.today();
begin
  perform public.ct_renew_contract(org, a, test.cv(a), today + 130, false, null, 'Renovação até o fim do ano seguinte');
  raise notice 'PASS: renovado (3)';
end $$;
reset role;
do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; r jsonb; a uuid := test.t('a'); n bigint;
begin
  n := test.ncc(ed, 'reminder_contract_end', a);
  r := test.run(25);
  assert (r ->> 'sent')::int = 0, 'nova revisão do fim (hoje+130) ainda não alcançou nenhuma antecedência: ' || r::text;
  assert test.ncc(ed, 'reminder_contract_end', a) = n, 'a revisão antiga não notifica mais';
  r := test.run(75);   -- hoje+130 − 60 = hoje+70 já passou
  assert (r ->> 'sent')::int >= 1 and test.ncc(ed, 'reminder_contract_end', a) = n + 1, 'a nova revisão tem as próprias entregas';
  raise notice 'PASS: mudança de prazo invalida lembretes antigos e gera os novos (3)';
end $$;

-- ===================================================================== (4) obrigações, acesso removido, concluída e contrato encerrado
:as_ed
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); today date := test.today(); o1 uuid; o2 uuid;
begin
  o1 := public.ct_save_obligation(org, a, null, null, jsonb_build_object('title', 'Já cumprida', 'responsible_user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'due_date', (today + 77)::text));
  perform public.ct_complete_obligation(org, o1, null, 'ok');
  o2 := public.ct_save_obligation(org, a, null, null, jsonb_build_object('title', 'Entregar relatório', 'responsible_user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'due_date', (today + 78)::text));
  perform set_config('t.o2', o2::text, true);
  raise notice 'PASS: obrigações criadas (4)';
end $$;
reset role;
do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; r jsonb; n0 bigint;
begin
  n0 := test.nc(ed, 'reminder_obligation');
  r := test.run(75);   -- a pendente vence em hoje+78: alcançou 7 e 3 → envia 3, consolida 7; a concluída nunca notifica
  assert test.nc(ed, 'reminder_obligation') = n0 + 1, 'só a obrigação pendente notificou (' || r::text || ')';
  assert (select count(*) from public.reminder_deliveries where event_type = 'obligation' and status = 'consolidated') >= 1, 'a antecedência anterior foi consolidada';
  raise notice 'PASS: obrigação concluída não notifica; pendente consolida (4)';
end $$;
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); m uuid := 'ffffffff-0000-4000-8000-0000000000a1'; ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; b uuid; today date := test.today();
begin
  -- o responsável do contrato sai do contrato: obrigações vão para a gestão, ele deixa de receber
  perform test.has(test.errmsg(format($q$select public.ct_set_access(%L, %L, %L, null)$q$, org, a, ed)), '%responsável pelo contrato%', 'responsável do contrato não perde o acesso sem troca');
  perform public.ct_set_responsible(org, a, test.cv(a), null);
  perform test.has(test.errmsg(format($q$select public.ct_set_access(%L, %L, %L, null)$q$, org, a, ed)), '%obrigação(ões) pendente(s)%', 'obrigações pendentes exigem escolha');
  perform public.ct_set_access(org, a, ed, null, 'transfer', m);
  assert (select responsible_user_id from public.contract_obligations where id = test.t('o2')) = m, 'obrigação transferida para a gestão';
  raise notice 'PASS: acesso removido com tratamento das obrigações (4)';
end $$;
reset role;
do $$
declare ed uuid := 'ffffffff-0000-4000-8000-0000000000a1'; edu uuid := 'ffffffff-0000-4000-8000-0000000000a3'; r jsonb; before_ed bigint; before_m bigint; a uuid := test.t('a');
begin
  before_ed := (select count(*) from public.notifications where user_id = edu);
  before_m := (select count(*) from public.notifications where user_id = ed);
  r := test.run(77);   -- sem responsável no contrato, o fim vai para a gestão; a obrigação agora é da gestão (alcançou 1)
  assert (select count(*) from public.notifications where user_id = edu) = before_ed, 'quem perdeu o acesso não recebe mais nada';
  assert (select count(*) from public.notifications where user_id = ed) > before_m, 'a gestão passa a receber (' || r::text || ')';
  raise notice 'PASS: quem perdeu o acesso deixa de receber lembretes (4)';
end $$;
:as_m
do $$
declare org uuid := test.t('org'); today date := test.today(); b uuid; cp uuid := test.t('cp');
begin
  b := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato B', 'start_date', (today - 5)::text, 'end_date', (today + 80)::text,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Parte')))) ->> 'id')::uuid;
  perform set_config('t.b', b::text, true);
  perform public.ct_activate_contract(org, b, test.cv(b));
  perform public.ct_terminate_contract(org, b, test.cv(b), today, 'Rescindido por acordo entre as partes');
end $$;
reset role;
do $$
declare r jsonb; b uuid := test.t('b');
begin
  r := test.run(90);
  assert (select count(*) from public.notifications where contract_id = b) = 0, 'contrato rescindido não gera lembrete';
  raise notice 'PASS: contrato rescindido não notifica (4)';
end $$;

-- ===================================================================== (5) agendador: token da empresa, idempotente, sem service_role
:as_ed
do $$
begin
  perform test.has(test.errmsg(format($q$select public.ct_rotate_job_token(%L)$q$, test.t('org'))), '%sem permissão%', 'colaborador não gera token');
  perform test.has(test.errmsg(format($q$select public.ct_run_reminders_now(%L)$q$, test.t('org'))), '%sem permissão%', 'colaborador não executa lembretes');
end $$;
reset role;
:as_o
do $$
declare tok text;
begin
  tok := public.ct_rotate_job_token(test.t('org')); perform set_config('t.tok', tok, true);
  assert length(tok) = 64, 'token de 64 caracteres';
end $$;
reset role;
:as_anon
do $$
declare r jsonb;
begin
  r := public.ct_run_reminders(current_setting('t.tok'));
  assert r ? 'sent' and (r ->> 'errors')::int = 0, 'o agendador executa com o token';
  perform test.has(test.errmsg($q$select public.ct_run_reminders('0000000000000000000000000000000000000000000000000000000000000000')$q$), '%token inválido%', 'token errado');
  perform test.has(test.errmsg($q$select public.ct_run_reminders('abc')$q$), '%token inválido%', 'token malformado');
  perform test.has(test.errmsg($q$select public.ct_rotate_job_token(gen_random_uuid())$q$), '%permission denied%', 'anônimo não gira token');
  perform test.has(test.errmsg($q$select public.ct_dashboard(gen_random_uuid())$q$), '%permission denied%', 'anônimo não vê painel');
end $$;
reset role;
:as_o
do $$
declare tok2 text;
begin
  tok2 := public.ct_rotate_job_token(test.t('org'));
  assert tok2 <> current_setting('t.tok'), 'girar gera outro token';
  perform set_config('t.tok2', tok2, true);
end $$;
reset role;
:as_anon
do $$
begin
  perform test.has(test.errmsg(format($q$select public.ct_run_reminders(%L)$q$, current_setting('t.tok'))), '%token inválido%', 'o token anterior deixa de valer');
  assert (public.ct_run_reminders(current_setting('t.tok2')) ->> 'errors')::int = 0, 'o novo token vale';
  raise notice 'PASS: agendador por token (5)';
end $$;
reset role;
:as_m
do $$
begin
  assert (public.ct_run_reminders_now(test.t('org')) ->> 'errors')::int = 0, 'execução manual pela gestão';
  assert (select count(*) from public.ct_job_runs where trigger = 'scheduler') >= 2 and (select count(*) from public.ct_job_runs where trigger = 'manual') >= 1, 'execuções do agendador e manuais registradas';
end $$;
reset role;

-- ===================================================================== (6) painel com dados reais e respeitando o acesso
:as_m
do $$
declare org uuid := test.t('org'); today date := test.today(); cp uuid := test.t('cp'); c uuid; d uuid; dash jsonb; m uuid := 'ffffffff-0000-4000-8000-0000000000a1'; rd uuid := 'ffffffff-0000-4000-8000-0000000000a4';
begin
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato C', 'start_date', (today - 10)::text, 'end_date', (today + 20)::text, 'responsible_user_id', m, 'notice_days', 30,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Parte')), 'access', jsonb_build_array(jsonb_build_object('user_id', rd, 'role', 'reader')),
    'value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'annual'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c, test.cv(c));
  perform set_config('t.c', c::text, true);
  d := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato D', 'start_date', (today - 100)::text, 'end_date', (today - 3)::text,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Parte')))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, d, test.cv(d));
  dash := public.ct_dashboard(org);
  assert (dash ->> 'active')::int = 3, 'ativos: A, C e D';
  assert (dash ->> 'valid_today')::int = 2, 'vigentes hoje: A e C (D já passou do fim)';
  assert (dash ->> 'ending_30')::int = 1 and (dash ->> 'ending_60')::int = 1 and (dash ->> 'ending_90')::int = 1, 'fim em 30/60/90 dias (inclusivo): só C';
  assert (dash ->> 'end_reached')::int = 1, 'fim de vigência atingido sem encerrar: D';
  assert (dash ->> 'notice_overdue')::int = 1 and (dash ->> 'notice_soon')::int = 0, 'prazo de aviso ultrapassado: C';
  assert (dash ->> 'without_responsible')::int = 2, 'sem responsável: A e D';
  assert (dash ->> 'renewals_12m')::int = 1, 'uma renovação';
  assert (dash ->> 'without_value')::int = 1, 'sem valor: D (nunca zero)';
  assert (dash -> 'values_by_basis' -> 'monthly' ->> 'amount_cents')::bigint = 100000 and (dash -> 'values_by_basis' -> 'annual' ->> 'amount_cents')::bigint = 120000, 'valores separados por periodicidade, sem somar mensal com anual';
  assert (dash ->> 'obligations_pending')::int = 1 and (dash ->> 'obligations_overdue')::int = 0, 'obrigações pendentes';
  assert (dash -> 'period' ->> 'timezone') = 'America/Sao_Paulo', 'fuso informado';
  raise notice 'PASS: painel gerencial (6)';
end $$;
reset role;
:as_rd
do $$
declare dash jsonb := public.ct_dashboard(test.t('org'));
begin
  assert (dash ->> 'active')::int = 1 and (dash ->> 'without_responsible')::int = 0 and (dash ->> 'obligations_pending')::int = 0, 'o leitor vê só o painel do contrato a que tem acesso';
  assert (dash -> 'values_by_basis' -> 'monthly') is null, 'sem vazamento de valores de outros contratos';
  raise notice 'PASS: painel respeita o acesso (6)';
end $$;
reset role;

rollback;
