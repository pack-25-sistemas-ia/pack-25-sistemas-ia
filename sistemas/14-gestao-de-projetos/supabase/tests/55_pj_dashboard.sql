-- Gestão de Projetos e Tarefas — painel: definições dos indicadores (abertas, atrasadas, bloqueadas, sem responsável, concluídas no período, distribuição, carga, progresso),
-- escopo por acesso (colaborador só vê os próprios projetos), tarefas arquivadas e projetos cancelados fora das contas, fuso da empresa e «Sem tarefas» honesto.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_out 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a5","aal":"aal1","email":"out@t.invalid"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b1","aal":"aal1","email":"v@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.col(p uuid, sem text) returns uuid language sql security definer set search_path = '' as $$ select id from public.project_columns where project_id = p and semantic_status = sem order by position limit 1 $$;
create function test.tv(t uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.tasks where id = t $$;
create function test.today() returns date language sql security definer set search_path = '' as $$ select (now() at time zone (select timezone from public.pj_settings limit 1))::date $$;
create function test.mk(org uuid, p uuid, p_json jsonb) returns uuid language plpgsql as $$ begin return (public.pj_create_task(org, p, gen_random_uuid(), p_json) ->> 'id')::uuid; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a5', 'out@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b1', 'v@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Painel Teste', 'painel-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a5', 'member'),
    (org, 'ffffffff-0000-4000-8000-0000000000b1', 'viewer');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) cenário
:as_m
do $$
declare org uuid := test.t('org'); pa uuid; pb uuid; pc uuid; pd uuid; today date := test.today(); t uuid; ed text := 'ffffffff-0000-4000-8000-0000000000a3'; out text := 'ffffffff-0000-4000-8000-0000000000a5';
begin
  pa := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto A', 'status', 'active', 'members', jsonb_build_array(
    jsonb_build_object('user_id', ed, 'role', 'editor'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000b1', 'role', 'reader')))) ->> 'id')::uuid;
  pb := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto B', 'status', 'active', 'members', jsonb_build_array(jsonb_build_object('user_id', out, 'role', 'editor')))) ->> 'id')::uuid;
  pc := (public.pj_create_project(org, gen_random_uuid(), '{"name":"Projeto C (cancelado)"}') ->> 'id')::uuid;
  pd := (public.pj_create_project(org, gen_random_uuid(), '{"name":"Projeto D (sem tarefas)","status":"active"}') ->> 'id')::uuid;
  perform set_config('t.pa', pa::text, true); perform set_config('t.pb', pb::text, true); perform set_config('t.pd', pd::text, true);
  -- A: 1 atrasada, 1 bloqueada vencendo hoje, 1 em revisão sem responsável e sem prazo, 1 concluída, 1 arquivada
  perform test.mk(org, pa, jsonb_build_object('title', 'A1 atrasada', 'assignee_user_id', ed, 'priority', 'high', 'due_date', (today - 1)::text));
  t := test.mk(org, pa, jsonb_build_object('title', 'A2 hoje', 'assignee_user_id', ed, 'priority', 'urgent', 'due_date', today::text));
  perform public.pj_move_task(org, t, test.col(pa, 'in_progress'), null, null);
  perform public.pj_set_blocked(org, t, test.tv(t), 'Aguardando o cliente');
  t := test.mk(org, pa, jsonb_build_object('title', 'A3 revisão', 'priority', 'low'));
  perform public.pj_move_task(org, t, test.col(pa, 'review'), null, null);
  t := test.mk(org, pa, jsonb_build_object('title', 'A4 pronta', 'assignee_user_id', ed));
  perform public.pj_move_task(org, t, test.col(pa, 'done'), null, null);
  t := test.mk(org, pa, jsonb_build_object('title', 'A5 arquivada', 'due_date', (today - 5)::text));
  perform public.pj_archive_task(org, t, test.tv(t), 'Cancelada pelo cliente');
  -- B: 1 futura com responsável, 1 atrasada sem responsável
  perform test.mk(org, pb, jsonb_build_object('title', 'B1 futura', 'assignee_user_id', out, 'due_date', (today + 3)::text));
  perform test.mk(org, pb, jsonb_build_object('title', 'B2 atrasada', 'due_date', (today - 2)::text));
  -- C: tarefa em projeto cancelado (fora das contas)
  perform test.mk(org, pc, jsonb_build_object('title', 'C1 em projeto cancelado', 'due_date', (today - 9)::text));
  perform public.pj_set_project_status(org, pc, (select version from public.projects where id = pc), 'cancelled', 'Projeto abandonado');
  raise notice 'PASS: cenário montado (2)';
end $$;
reset role;

-- ===================================================================== (3) números da gestão (todos os projetos autorizados)
:as_m
do $$
declare org uuid := test.t('org'); d jsonb; today date := test.today();
begin
  d := public.pj_dashboard(org, today - 7, today + 7);
  assert (d ->> 'active_projects')::int = 3, 'projetos ativos: A, B e D (C está cancelado): ' || (d ->> 'active_projects');
  assert (d ->> 'open_tasks')::int = 5, 'abertas = A1, A2, A3, B1, B2 (A4 concluída, A5 arquivada e C1 de projeto cancelado ficam fora): ' || (d ->> 'open_tasks');
  assert (d ->> 'overdue')::int = 2, 'atrasadas = A1 e B2 (A2 vence hoje: ainda não atrasou): ' || (d ->> 'overdue');
  assert (d ->> 'blocked')::int = 1 and (d ->> 'unassigned')::int = 2, 'bloqueadas 1; sem responsável = A3 e B2';
  assert (d ->> 'completed_in_period')::int = 1, 'concluídas no período = A4';
  assert (d #>> '{by_stage,todo}')::int = 3 and (d #>> '{by_stage,in_progress}')::int = 1 and (d #>> '{by_stage,review}')::int = 1 and (d #>> '{by_stage,done}')::int = 1, 'distribuição por etapa: ' || (d -> 'by_stage')::text;
  assert (d #>> '{by_priority,urgent}')::int = 1 and (d #>> '{by_priority,high}')::int = 1 and (d #>> '{by_priority,low}')::int = 1 and (d #>> '{by_priority,normal}')::int = 2, 'distribuição por prioridade: ' || (d -> 'by_priority')::text;
  assert (select (x ->> 'open')::int from jsonb_array_elements(d -> 'load') x where x ->> 'user_id' = 'ffffffff-0000-4000-8000-0000000000a3') = 2
     and (select (x ->> 'overdue')::int from jsonb_array_elements(d -> 'load') x where x ->> 'user_id' = 'ffffffff-0000-4000-8000-0000000000a3') = 1
     and (select (x ->> 'blocked')::int from jsonb_array_elements(d -> 'load') x where x ->> 'user_id' = 'ffffffff-0000-4000-8000-0000000000a3') = 1, 'carga do responsável: 2 abertas, 1 atrasada, 1 bloqueada';
  assert (select (x ->> 'open')::int from jsonb_array_elements(d -> 'load') x where x -> 'user_id' = 'null'::jsonb) = 2, 'tarefas sem responsável aparecem numa linha própria';
  assert (select x ->> 'percent' from jsonb_array_elements(d -> 'progress') x where x ->> 'name' = 'Projeto A') = '25', 'progresso de A = 1 concluída de 4 não arquivadas = 25%';
  assert (select x ->> 'percent' from jsonb_array_elements(d -> 'progress') x where x ->> 'name' = 'Projeto D (sem tarefas)') is null
     and (select x ->> 'total' from jsonb_array_elements(d -> 'progress') x where x ->> 'name' = 'Projeto D (sem tarefas)') = '0', 'projeto sem tarefas: «Sem tarefas», nunca 100%';
  assert not exists (select 1 from jsonb_array_elements(d -> 'progress') x where x ->> 'name' like 'Projeto C%'), 'projeto cancelado fica fora do progresso';
  assert d #>> '{period,timezone}' = 'America/Sao_Paulo' and (d #>> '{period,today}')::date = today, 'período, fuso e «hoje» informados';
  -- filtrado por projeto
  d := public.pj_dashboard(org, today - 7, today + 7, test.t('pa'));
  assert (d ->> 'open_tasks')::int = 3 and (d ->> 'overdue')::int = 1, 'filtro por projeto: A tem 3 abertas e 1 atrasada';
  -- período no passado: nada concluído «no período», mas as contagens de situação não mudam
  d := public.pj_dashboard(org, today - 60, today - 30);
  assert (d ->> 'completed_in_period')::int = 0 and (d ->> 'open_tasks')::int = 5, 'período passado: sem concluídas; abertas é a situação atual';
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date - 400, current_date)$q$, org)), '%período inválido%', 'período máximo');
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date, current_date - 1)$q$, org)), '%período inválido%', 'período invertido');
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date - 1, current_date, %L)$q$, org, gen_random_uuid())), '%projeto não encontrado%', 'projeto inexistente');
  raise notice 'PASS: indicadores da gestão (3)';
end $$;
reset role;

-- ===================================================================== (4) cada pessoa vê só o que o acesso permite
:as_ed
do $$
declare org uuid := test.t('org'); d jsonb; today date := test.today();
begin
  d := public.pj_dashboard(org, today - 7, today + 7);
  assert (d ->> 'open_tasks')::int = 3 and (d ->> 'overdue')::int = 1 and (d ->> 'active_projects')::int = 1, 'colaborador: só o projeto A: ' || d::text;
  assert not exists (select 1 from jsonb_array_elements(d -> 'progress') x where x ->> 'name' like 'Projeto B%'), 'não vê o progresso do projeto B';
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date - 1, current_date, %L)$q$, org, test.t('pb'))), '%projeto não encontrado%', 'filtrar por projeto alheio');
  raise notice 'PASS: colaborador só enxerga os projetos dele no painel (4)';
end $$;
reset role;
:as_out
do $$
declare org uuid := test.t('org'); d jsonb; today date := test.today();
begin
  d := public.pj_dashboard(org, today - 7, today + 7);
  assert (d ->> 'open_tasks')::int = 2 and (d ->> 'overdue')::int = 1 and (d ->> 'unassigned')::int = 1, 'outro colaborador: só o projeto B';
  assert not exists (select 1 from jsonb_array_elements(d -> 'load') x where x ->> 'user_id' = 'ffffffff-0000-4000-8000-0000000000a3'), 'a carga de quem só trabalha em A não aparece';
  raise notice 'PASS: painel isolado por projeto (4)';
end $$;
reset role;
:as_v
do $$
declare org uuid := test.t('org'); d jsonb; today date := test.today();
begin
  d := public.pj_dashboard(org, today - 7, today + 7);
  assert (d ->> 'open_tasks')::int = 3, 'leitor da empresa vê o painel dos projetos em que participa';
  raise notice 'PASS: leitor consulta o painel (4)';
end $$;
reset role;

-- ===================================================================== (5) o período segue o fuso da empresa (dois fusos extremos: em qualquer hora, um deles difere da data UTC)
:as_o
do $$
declare org uuid := test.t('org'); d jsonb; tz text; ld date; n bigint;
begin
  foreach tz in array array['Pacific/Kiritimati', 'Etc/GMT+12'] loop
    perform public.pj_save_settings(org, jsonb_build_object('timezone', tz));
    ld := (now() at time zone tz)::date;
    d := public.pj_dashboard(org, ld, ld);
    assert (d ->> 'completed_in_period')::int = 1 and (d #>> '{period,today}')::date = ld, 'período no fuso da empresa (' || tz || '): ' || (d ->> 'completed_in_period');
  end loop;
  perform public.pj_save_settings(org, '{"timezone":"America/Sao_Paulo"}');
  perform test.has(test.errmsg(format($q$select public.pj_save_settings(%L, '{"timezone":"Marte/Olimpo"}')$q$, org)), '%fuso horário desconhecido%', 'fuso inválido');
  raise notice 'PASS: fuso da empresa nos períodos (5)';
end $$;
reset role;

rollback;
