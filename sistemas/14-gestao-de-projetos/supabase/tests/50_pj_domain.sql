-- Gestão de Projetos e Tarefas — domínio no banco, parte 1: projetos, participantes, etapas do quadro, tarefas, Kanban persistente (ordem, versão do quadro), estados do projeto,
-- checklist e conclusão, idempotência e numeração. Fixtures à mão (Postgres puro com o harness do Core).

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_lead 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"lead@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_ed2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"ed2@t.invalid"}'', true); set local role authenticated;'
\set as_out 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a5","aal":"aal1","email":"out@t.invalid"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b1","aal":"aal1","email":"v@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.col(p uuid, sem text, nth integer default 1) returns uuid language sql security definer set search_path = '' as $$
  select id from (select id, row_number() over (order by position) rn from public.project_columns where project_id = p and semantic_status = sem) x where rn = nth $$;
create function test.bv(p uuid) returns integer language sql security definer set search_path = '' as $$ select board_version from public.projects where id = p $$;
create function test.pv(p uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.projects where id = p $$;
create function test.tv(t uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.tasks where id = t $$;
-- ordem das tarefas ativas de uma etapa, como lista de números
create function test.order_of(c uuid) returns text language sql security definer set search_path = '' as $$
  select coalesce(string_agg(task_number::text, ',' order by position), '') from public.tasks where column_id = c and archived_at is null $$;
create function test.dense(c uuid) returns boolean language sql security definer set search_path = '' as $$
  select coalesce((select bool_and(position = rn) from (select position, row_number() over (order by position) rn from public.tasks where column_id = c and archived_at is null) x), true) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'lead@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a4', 'ed2@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a5', 'out@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000b1', 'v@t.invalid');

-- ===================================================================== (1) preparação: empresa e pessoas
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Agência Teste', 'agencia-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'),
    (org, 'ffffffff-0000-4000-8000-0000000000a4', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a5', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000b1', 'viewer');
  assert (select count(*) from public.pj_settings where organization_id = org) = 1 and test.cnt(format('select last_number from public.project_number_counters where organization_id = %L', org)) = 0, 'configurações e contador criados com a empresa';
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) projeto: criação, quadro inicial, participantes, numeração e idempotência
:as_m
do $$
declare org uuid := test.t('org'); r jsonb; r2 jsonb; k uuid := gen_random_uuid(); p uuid; p2 uuid;
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"X"}')$q$, org)), '%Nome do projeto%', 'nome curto');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Projeto ok","start_date":"2026-05-10","due_date":"2026-05-01"}')$q$, org)), '%início não pode ser depois%', 'datas invertidas');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Projeto ok","due_date":"31/12/2026"}')$q$, org)), '%AAAA-MM-DD%', 'data fora do formato');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Projeto ok","status":"completed"}')$q$, org)), '%começa planejado ou ativo%', 'projeto novo não nasce concluído');
  r := public.pj_create_project(org, k, jsonb_build_object('name', 'Site Novo', 'description', 'Redesenho do site institucional', 'status', 'active', 'start_date', '2026-01-05', 'due_date', '2026-12-30',
    'members', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a2', 'role', 'lead'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'role', 'editor'),
      jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000b1', 'role', 'reader'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a1', 'role', 'editor'))));
  p := (r ->> 'id')::uuid; perform set_config('t.p', p::text, true);
  assert (r ->> 'project_number')::int = 1, 'primeiro projeto: número 1';
  assert (select array_agg(name || ':' || semantic_status order by position) from public.project_columns where project_id = p) = array['A fazer:todo', 'Em andamento:in_progress', 'Em revisão:review', 'Concluído:done'], 'quadro inicial';
  assert (select count(*) from public.project_members where project_id = p) = 3, 'gestão não vira participante explícito (já vê tudo); 3 participantes';
  r2 := public.pj_create_project(org, k, jsonb_build_object('name', 'Site Novo', 'description', 'Redesenho do site institucional', 'status', 'active', 'start_date', '2026-01-05', 'due_date', '2026-12-30',
    'members', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a2', 'role', 'lead'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'role', 'editor'),
      jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000b1', 'role', 'reader'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a1', 'role', 'editor'))));
  assert r2 = r and (select count(*) from public.projects where organization_id = org) = 1, 'duplo clique não duplica o projeto';
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, %L, '{"name":"Outro nome"}')$q$, org, k)), '%já foi usada com outros dados%', 'mesma chave com outros dados é recusada');
  p2 := (public.pj_create_project(org, gen_random_uuid(), '{"name":"Campanha de Lançamento"}') ->> 'id')::uuid; perform set_config('t.p2', p2::text, true);
  assert (select project_number from public.projects where id = p2) = 2 and (select status from public.projects where id = p2) = 'planned', 'segundo projeto: número 2, planejado';
  assert (select count(*) from public.project_events where project_id = p and event_type = 'project_created') = 1, 'evento de criação';
  raise notice 'PASS: projetos (criação, quadro inicial, numeração, idempotência) (2)';
end $$;
reset role;

:as_lead
do $$
declare org uuid := test.t('org');
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Projeto do colaborador"}')$q$, org)), '%sem permissão%', 'colaborador não cria projeto');
  raise notice 'PASS: só a gestão cria projetos (2)';
end $$;
reset role;

-- ===================================================================== (3) participantes
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('p');
begin
  perform public.pj_add_member(org, p, 'ffffffff-0000-4000-8000-0000000000a4', 'editor');
  assert (select project_role from public.project_members where project_id = p and user_id = 'ffffffff-0000-4000-8000-0000000000a4') = 'editor', 'líder adiciona participante';
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000a4', 'reader')$q$, org, p)), '%já participa%', 'não duplica participante');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000b1', 'editor')$q$, org, p)), '%já participa%', 'leitor já participa (duplicado antes da regra de papel)');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000a1', 'editor')$q$, org, p)), '%já têm acesso a todos%', 'gestão não é participante explícito');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, %L, 'editor')$q$, org, p, gen_random_uuid())), '%membro da empresa%', 'só membros da empresa participam');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000a5', 'chefe')$q$, org, p)), '%papel de participante inválido%', 'papel inválido');
  perform public.pj_remove_member(org, p, 'ffffffff-0000-4000-8000-0000000000a4');
  assert (select count(*) from public.project_members where project_id = p and user_id = 'ffffffff-0000-4000-8000-0000000000a4') = 0, 'líder remove participante sem tarefas';
  perform public.pj_add_member(org, p, 'ffffffff-0000-4000-8000-0000000000a4', 'editor');
  raise notice 'PASS: participantes (líder gerencia; regras de papel) (3)';
end $$;
reset role;

:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p');
begin
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000a5', 'editor')$q$, org, p)), '%sem permissão%', 'editor não gerencia participantes');
  perform test.has(test.errmsg(format($q$select public.pj_update_project(%L, %L, 1, '{"name":"Invasão"}')$q$, org, p)), '%sem permissão%', 'editor não altera o projeto');
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, 1, 'Nova', 'todo')$q$, org, p)), '%sem permissão%', 'editor não altera etapas');
  raise notice 'PASS: editor sem poderes de liderança (3)';
end $$;
reset role;

:as_v
do $$
declare org uuid := test.t('org'); p uuid := test.t('p');
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Tarefa do leitor"}')$q$, org, p)), '%sem permissão%', 'leitor não cria tarefa');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000a5', 'reader')$q$, org, p)), '%sem permissão%', 'leitor não gerencia participantes');
  assert test.count('select 1 from public.projects') = 1, 'leitor enxerga só o projeto em que participa';
  raise notice 'PASS: leitor só consulta (3)';
end $$;
reset role;

:as_out
do $$
declare org uuid := test.t('org'); p uuid := test.t('p');
begin
  assert test.count('select 1 from public.projects') = 0, 'colaborador de fora não enxerga o projeto';
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Invasão"}')$q$, org, p)), '%projeto não encontrado%', 'quem não participa não age no projeto');
  raise notice 'PASS: quem não participa não enxerga nem age (3)';
end $$;
reset role;

-- ===================================================================== (4) tarefas: criação, validações, número, responsável elegível, etiquetas, checklist na criação
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); r jsonb; k uuid := gen_random_uuid(); lbl uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid; lblx uuid;
begin
  -- a etiqueta de OUTRO projeto não vale
  lblx := public.pj_save_label(org, test.t('p2'), null, 'Interna P2', '#ff0000');
exception when others then
  perform test.has(sqlerrm, '%projeto não encontrado%', 'editor não cria etiqueta em projeto alheio');
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); lbl uuid;
begin
  perform set_config('t.lblx', public.pj_save_label(org, test.t('p2'), null, 'Interna P2', '#ff0000')::text, true);
  lbl := public.pj_save_label(org, test.t('p'), null, 'Design', '#2563eb'); perform set_config('t.lbl', lbl::text, true);
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, null, 'design', '#2563eb')$q$, org, test.t('p'))), '%já existe uma etiqueta%', 'nome de etiqueta único (sem diferenciar maiúsculas)');
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, null, 'Cor ruim', 'azul')$q$, org, test.t('p'))), '%cor inválida%', 'cor inválida');
  raise notice 'PASS: etiquetas (4)';
end $$;
reset role;

:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); r jsonb; k uuid := gen_random_uuid(); t1 uuid; t2 uuid; t3 uuid; t4 uuid;
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"x"}')$q$, org, p)), '%Título%', 'título curto');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Tarefa","priority":"enorme"}')$q$, org, p)), '%prioridade inválida%', 'prioridade inválida');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Tarefa","start_date":"2026-03-10","due_date":"2026-03-01"}')$q$, org, p)), '%início não pode ser depois do vencimento%', 'início depois do vencimento');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Tarefa', 'column_id', %L::uuid))$q$, org, p, test.col(test.t('p2'), 'todo'))), '%etapa inválida%', 'etapa de outro projeto');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Tarefa', 'column_id', %L::uuid))$q$, org, p, test.col(p, 'done'))), '%etapa concluída%', 'não nasce concluída');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Tarefa', 'label_ids', jsonb_build_array(%L::uuid)))$q$, org, p, test.t('lblx'))), '%etiqueta inválida%', 'etiqueta de outro projeto');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Tarefa","assignee_user_id":"ffffffff-0000-4000-8000-0000000000b1"}')$q$, org, p)), '%responsável inválido%', 'leitor não pode ser responsável');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Tarefa","assignee_user_id":"ffffffff-0000-4000-8000-0000000000a5"}')$q$, org, p)), '%responsável inválido%', 'quem não participa não pode ser responsável');
  r := public.pj_create_task(org, p, k, jsonb_build_object('title', 'Wireframes da home', 'description', 'Primeira versão', 'priority', 'high', 'assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a3',
    'start_date', '2025-12-20', 'due_date', '2026-02-01', 'label_ids', jsonb_build_array(test.t('lbl')),
    'checklist', jsonb_build_array(jsonb_build_object('title', 'Revisar com o cliente', 'required', true), jsonb_build_object('title', 'Exportar PDF', 'required', false))));
  t1 := (r ->> 'id')::uuid; perform set_config('t.t1', t1::text, true);
  assert (r ->> 'task_number')::int = 1, 'primeira tarefa: número 1';
  assert jsonb_array_length(r -> 'warnings') = 1 and r #>> '{warnings,0}' like '%início%fora do período%', 'data fora do período do projeto: AVISO, sem ajuste silencioso: ' || (r -> 'warnings')::text;
  assert (select start_date from public.tasks where id = t1) = '2025-12-20'::date, 'a data informada foi preservada';
  assert r = public.pj_create_task(org, p, k, jsonb_build_object('title', 'Wireframes da home', 'description', 'Primeira versão', 'priority', 'high', 'assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a3',
    'start_date', '2025-12-20', 'due_date', '2026-02-01', 'label_ids', jsonb_build_array(test.t('lbl')),
    'checklist', jsonb_build_array(jsonb_build_object('title', 'Revisar com o cliente', 'required', true), jsonb_build_object('title', 'Exportar PDF', 'required', false)))) and test.cnt(format('select count(*) from public.tasks where project_id = %L', p)) = 1, 'duplo clique não duplica a tarefa';
  assert (select count(*) from public.task_checklist_items where task_id = t1) = 2 and (select count(*) from public.task_labels where task_id = t1) = 1, 'checklist e etiqueta criados';
  t2 := (public.pj_create_task(org, p, gen_random_uuid(), '{"title":"Texto institucional","priority":"normal"}') ->> 'id')::uuid; perform set_config('t.t2', t2::text, true);
  t3 := (public.pj_create_task(org, p, gen_random_uuid(), '{"title":"Banco de imagens","priority":"low"}') ->> 'id')::uuid; perform set_config('t.t3', t3::text, true);
  t4 := (public.pj_create_task(org, p, gen_random_uuid(), '{"title":"Contrato do domínio","priority":"urgent"}') ->> 'id')::uuid; perform set_config('t.t4', t4::text, true);
  assert (select array_agg(task_number order by task_number) from public.tasks where project_id = p) = array[1, 2, 3, 4]::bigint[], 'números sequenciais por projeto';
  assert test.order_of(test.col(p, 'todo')) = '1,2,3,4' and test.dense(test.col(p, 'todo')), 'novas tarefas entram ao fim da primeira etapa «A fazer»';
  assert (select count(*) from public.notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a3') = 0, 'quem atribui a si mesmo não recebe notificação';
  assert (select count(*) from public.task_events where task_id = t1 and event_type in ('task_created', 'assignee_changed')) = 2, 'eventos de criação e responsável';
  raise notice 'PASS: tarefas (validações, números, avisos de data, etiquetas, checklist, idempotência) (4)';
end $$;
reset role;

-- ===================================================================== (5) editar, atribuir, notificação de atribuição, conflito de versão
:as_ed
do $$
declare org uuid := test.t('org'); t1 uuid := test.t('t1'); v integer; r jsonb;
begin
  v := test.tv(t1);
  perform test.has(test.errmsg(format($q$select public.pj_update_task(%L, %L, %s, '{"title":"Título velho"}')$q$, org, t1, v + 5)), '%Outra pessoa alterou%', 'versão antiga da tarefa é recusada');
  r := public.pj_update_task(org, t1, v, '{"priority":"urgent","due_date":"2026-02-10"}');
  assert (r ->> 'version')::int = v + 1 and (select priority from public.tasks where id = t1) = 'urgent', 'atualiza e incrementa a versão';
  assert (select count(*) from public.task_events where task_id = t1 and event_type in ('priority_changed', 'dates_changed')) = 2, 'eventos de prioridade e datas';
  v := test.tv(t1);
  assert public.pj_update_task(org, t1, v, '{"priority":"urgent"}') ->> 'version' = v::text, 'sem mudança: versão intacta';
  perform test.has(test.errmsg(format($q$select public.pj_update_task(%L, %L, %s, '{"start_date":"2026-03-01","due_date":"2026-02-10"}')$q$, org, t1, test.tv(t1))), '%início não pode ser depois do vencimento%', 'datas invertidas na edição');
  -- atribuir
  perform test.has(test.errmsg(format($q$select public.pj_assign_task(%L, %L, %s, 'ffffffff-0000-4000-8000-0000000000b1')$q$, org, t1, test.tv(t1))), '%responsável inválido%', 'leitor não recebe tarefa');
  perform public.pj_assign_task(org, test.t('t2'), test.tv(test.t('t2')), 'ffffffff-0000-4000-8000-0000000000a4');
  assert (select assignee_user_id from public.tasks where id = test.t('t2')) = 'ffffffff-0000-4000-8000-0000000000a4', 'responsável definido';
  assert test.cnt(format('select count(*) from public.notifications where user_id = %L and kind = ''task_assigned'' and task_id = %L', 'ffffffff-0000-4000-8000-0000000000a4', test.t('t2'))) = 1, 'notificação de atribuição para o novo responsável';
  perform public.pj_assign_task(org, test.t('t2'), test.tv(test.t('t2')), null);
  assert (select assignee_user_id from public.tasks where id = test.t('t2')) is null, 'responsável removido';
  perform public.pj_assign_task(org, test.t('t2'), test.tv(test.t('t2')), 'ffffffff-0000-4000-8000-0000000000a4');
  raise notice 'PASS: edição, versão otimista e atribuição (5)';
end $$;
reset role;

-- ===================================================================== (6) Kanban: mover, reordenar, versão do quadro
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t1 uuid := test.t('t1'); t2 uuid := test.t('t2'); t3 uuid := test.t('t3'); t4 uuid := test.t('t4');
  todo uuid := test.col(p, 'todo'); prog uuid := test.col(p, 'in_progress'); rev uuid := test.col(p, 'review'); done uuid := test.col(p, 'done'); r jsonb; b integer;
begin
  b := test.bv(p);
  -- reordenar dentro da etapa: t4 antes de t1
  r := public.pj_move_task(org, t4, todo, t1, b);
  assert test.order_of(todo) = '4,1,2,3' and test.dense(todo), 'reordenação persiste, posições 1..n: ' || test.order_of(todo);
  assert (r ->> 'board_version')::int = b + 1, 'versão do quadro incrementa';
  -- versão antiga do quadro é recusada, sem sobrescrever
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, %s)$q$, org, t3, prog, b)), '%Outra pessoa alterou o quadro%', 'versão antiga do quadro');
  assert test.order_of(todo) = '4,1,2,3', 'nada mudou com o conflito';
  -- mover entre etapas: t2 para «Em andamento»
  r := public.pj_move_task(org, t2, prog, null, null);
  assert test.order_of(todo) = '4,1,3' and test.dense(todo) and test.order_of(prog) = '2' and test.dense(prog), 'origem reindexada e destino com a tarefa: ' || test.order_of(todo) || ' / ' || test.order_of(prog);
  r := public.pj_move_task(org, t3, prog, t2, null);
  assert test.order_of(prog) = '3,2' and test.order_of(todo) = '4,1' and test.dense(todo) and test.dense(prog), 'inserção antes de uma referência';
  -- no-op não incrementa nada
  b := test.bv(p);
  r := public.pj_move_task(org, t3, prog, t2, null);
  assert (r ->> 'changed')::boolean is false and test.bv(p) = b, 'mover para onde já está não muda o quadro';
  -- referência inválida / etapa de outro projeto
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, %L, null)$q$, org, t1, prog, t1)), '%posição de referência inválida%', 'referência não pode ser a própria tarefa');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, %L, null)$q$, org, t1, todo, t3)), '%posição de referência inválida%', 'referência precisa estar na etapa de destino');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, org, t1, test.col(test.t('p2'), 'todo'))), '%etapa de destino inválida%', 'etapa de outro projeto é rejeitada');
  assert test.cnt(format('select count(*) from public.tasks where project_id = %L and archived_at is null', p)) = 4, 'nenhum cartão perdido';
  raise notice 'PASS: Kanban (ordem, reindexação, versão do quadro, validações) (6)';
end $$;
reset role;

-- ===================================================================== (7) conclusão exige checklist obrigatório; reabertura
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t1 uuid := test.t('t1'); done uuid := test.col(p, 'done'); todo uuid := test.col(p, 'todo'); r jsonb; it uuid;
begin
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, org, t1, done)), '%item(ns) obrigatório(s)%', 'não conclui com item obrigatório pendente');
  assert (select completed_at from public.tasks where id = t1) is null, 'continua aberta';
  select id into it from public.task_checklist_items where task_id = t1 and required;
  perform public.pj_toggle_checklist_item(org, it, true);
  r := public.pj_move_task(org, t1, done, null, null);
  assert (r ->> 'completed')::boolean and (select completed_at from public.tasks where id = t1) is not null, 'conclui com o obrigatório feito e registra completed_at';
  assert (select count(*) from public.task_events where task_id = t1 and event_type = 'task_completed') = 1, 'evento de conclusão';
  perform test.has(test.errmsg(format($q$select public.pj_toggle_checklist_item(%L, %L, false)$q$, org, it)), '%reabra a tarefa%', 'checklist de tarefa concluída é imutável');
  perform test.has(test.errmsg(format($q$select public.pj_add_checklist_item(%L, %L, 'Item novo')$q$, org, t1)), '%reabra a tarefa%', 'não adiciona item em tarefa concluída');
  -- reabrir: sai de «Concluído»
  r := public.pj_move_task(org, t1, todo, null, null);
  assert (r ->> 'reopened')::boolean and (select completed_at from public.tasks where id = t1) is null, 'reabertura limpa o completed_at atual';
  assert (select count(*) from public.task_events where task_id = t1 and event_type in ('task_completed', 'task_reopened')) = 2, 'o histórico mantém conclusão e reabertura';
  assert test.cnt(format('select count(*) from public.notifications where kind = ''task_reopened'' and task_id = %L', t1)) = 0, 'reabrir a própria tarefa não notifica o autor (responsável e criador são o mesmo)';
  r := public.pj_move_task(org, t1, done, null, null);
  assert (select completed_at from public.tasks where id = t1) is not null, 'conclui de novo';
  raise notice 'PASS: conclusão com checklist e reabertura (7)';
end $$;
reset role;

-- ===================================================================== (8) impedimento, arquivamento de tarefa
:as_ed
do $$
declare org uuid := test.t('org'); t3 uuid := test.t('t3'); t1 uuid := test.t('t1');
begin
  perform test.has(test.errmsg(format($q$select public.pj_set_blocked(%L, %L, %s, 'x')$q$, org, t3, test.tv(t3))), '%mínimo 3%', 'impedimento exige motivo');
  perform public.pj_set_blocked(org, t3, test.tv(t3), 'Aguardando aprovação do cliente');
  assert (select blocked_at from public.tasks where id = t3) is not null and (select blocked_reason from public.tasks where id = t3) = 'Aguardando aprovação do cliente', 'bloqueada com motivo';
  assert (select semantic_status from public.project_columns c join public.tasks t on t.column_id = c.id where t.id = t3) = 'in_progress', 'bloqueio não muda a etapa';
  perform public.pj_set_blocked(org, t3, test.tv(t3), null);
  assert (select blocked_at from public.tasks where id = t3) is null and (select count(*) from public.task_events where task_id = t3 and event_type in ('task_blocked', 'task_unblocked')) = 2, 'desbloqueio registrado';
  perform test.has(test.errmsg(format($q$select public.pj_set_blocked(%L, %L, %s, 'Motivo qualquer')$q$, org, t1, test.tv(t1))), '%concluída não pode ser bloqueada%', 'tarefa concluída não é bloqueada');
  perform test.has(test.errmsg(format($q$select public.pj_archive_task(%L, %L, %s, 'motivo')$q$, org, t3, test.tv(t3))), '%sem permissão%', 'editor não arquiva tarefa');
  raise notice 'PASS: impedimento independente da etapa; arquivar é da liderança (8)';
end $$;
reset role;

:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t3 uuid := test.t('t3'); t1 uuid := test.t('t1');
begin
  perform test.has(test.errmsg(format($q$select public.pj_archive_task(%L, %L, %s, 'x')$q$, org, t3, test.tv(t3))), '%motivo (mínimo 5%', 'tarefa não concluída exige motivo para arquivar');
  perform public.pj_archive_task(org, t1, test.tv(t1), null);
  assert (select archived_at from public.tasks where id = t1) is not null, 'tarefa concluída arquiva sem motivo';
  perform test.has(test.errmsg(format($q$select public.pj_update_task(%L, %L, %s, '{"title":"Editar arquivada"}')$q$, org, t1, test.tv(t1))), '%somente para consulta%', 'arquivada é somente consulta');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, org, t1, test.col(p, 'todo'))), '%somente para consulta%', 'arquivada não se move');
  assert test.dense(test.col(p, 'done')), 'posições seguem íntegras';
  raise notice 'PASS: arquivar tarefa (liderança, motivo, somente consulta) (8)';
end $$;
reset role;

-- ===================================================================== (9) etapas do quadro: adicionar, renomear, reordenar, excluir com realocação
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); b integer; c1 uuid; c2 uuid; prog uuid := test.col(p, 'in_progress'); todo uuid := test.col(p, 'todo'); done uuid := test.col(p, 'done'); ids uuid[];
begin
  b := test.bv(p);
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, %s, 'Nova etapa', 'todo')$q$, org, p, b - 1)), '%Outra pessoa alterou o quadro%', 'versão antiga do quadro nas etapas');
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, %s, 'Nova etapa', 'fazendo')$q$, org, p, b)), '%tipo de etapa inválido%', 'tipo inválido');
  c1 := public.pj_add_column(org, p, b, 'Triagem', 'todo', 1);
  assert (select array_agg(name order by position) from public.project_columns where project_id = p) = array['Triagem', 'A fazer', 'Em andamento', 'Em revisão', 'Concluído'], 'etapa inserida na posição pedida';
  perform public.pj_rename_column(org, p, c1, 'Entrada');
  assert (select name || ':' || semantic_status from public.project_columns where id = c1) = 'Entrada:todo', 'renomear não altera a semântica';
  ids := (select array_agg(id order by position desc) from public.project_columns where project_id = p);
  perform public.pj_reorder_columns(org, p, test.bv(p), ids);
  assert (select array_agg(name order by position) from public.project_columns where project_id = p) = array['Concluído', 'Em revisão', 'Em andamento', 'A fazer', 'Entrada'], 'reordenação das etapas persiste';
  perform public.pj_reorder_columns(org, p, test.bv(p), (select array_agg(id order by case semantic_status when 'todo' then 1 when 'in_progress' then 2 when 'review' then 3 else 4 end, position) from public.project_columns where project_id = p));
  perform test.has(test.errmsg(format($q$select public.pj_reorder_columns(%L, %L, %s, array[%L::uuid])$q$, org, p, test.bv(p), c1)), '%ordem das etapas inválida%', 'a ordem precisa conter todas as etapas');
  -- excluir etapa com tarefas exige realocação explícita, para etapa do MESMO tipo
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, %s, %L)$q$, org, p, test.bv(p), prog)), '%escolha para qual etapa%', 'etapa com tarefas não é excluída sem realocação');
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, %s, %L, %L)$q$, org, p, test.bv(p), prog, done)), '%mesmo tipo%', 'realocação só para etapa do mesmo tipo');
  c2 := public.pj_add_column(org, p, test.bv(p), 'Em produção', 'in_progress');
  perform public.pj_delete_column(org, p, test.bv(p), prog, c2);
  assert (select count(*) from public.project_columns where id = prog) = 0 and test.order_of(c2) = '3,2' and test.dense(c2), 'exclusão com realocação preserva as tarefas e a ordem: ' || test.order_of(c2);
  assert (select array_agg(position order by position) from public.project_columns where project_id = p) = (select array_agg(g) from generate_series(1, (select count(*)::int from public.project_columns where project_id = p)) g), 'etapas renumeradas 1..n';
  -- o quadro precisa de «A fazer» e «Concluído»
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, %s, %L)$q$, org, p, test.bv(p), done)), '%escolha para qual etapa%', 'etapa «Concluído» com tarefa não some');
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, %s, %L, %L)$q$, org, p, test.bv(p), done, done)), '%destino inválida%', 'destino não pode ser a própria etapa');
  assert test.errmsg(format($q$select test.sql('update public.project_columns set semantic_status = ''review'' where id = ''%s''')$q$, c2)) like '%tem tarefas%', 'o tipo de uma etapa ocupada não muda';
  raise notice 'PASS: etapas (inserir, renomear, reordenar, excluir com realocação atômica) (9)';
end $$;
reset role;

-- ===================================================================== (10) comentários, anexos e notificações
:as_ed
do $$
declare org uuid := test.t('org'); t2 uuid := test.t('t2'); t3 uuid := test.t('t3'); c uuid; k uuid := gen_random_uuid(); p uuid := test.t('p');
begin
  perform test.has(test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), '   ')$q$, org, t2)), '%Comentário%', 'comentário vazio');
  c := public.pj_add_comment(org, t3, k, 'Cliente respondeu: **pode seguir**. <script>alert(1)</script>');
  assert public.pj_add_comment(org, t3, k, 'Cliente respondeu: **pode seguir**. <script>alert(1)</script>') = c and (select count(*) from public.task_comments where task_id = t3) = 1, 'duplo envio não duplica o comentário';
  assert (select body from public.task_comments where id = c) like '%<script>%', 'o texto é guardado como veio (a renderização é que é segura, sem HTML)';
  assert (select count(*) from public.task_events where task_id = t3 and event_type = 'comment_added' and data::text like '%script%') = 0, 'o corpo do comentário não vai para o histórico';
  assert test.cnt(format('select count(*) from public.notifications where kind = ''task_comment'' and task_id = %L and user_id = %L', t3, 'ffffffff-0000-4000-8000-0000000000a3')) = 0, 'o autor não é notificado';
  -- comentário numa tarefa atribuída a OUTRA pessoa notifica o responsável e o criador (deduplicados, sem o autor)
  perform public.pj_add_comment(org, t2, gen_random_uuid(), 'Atualização sobre o texto');
  assert test.cnt(format('select count(*) from public.notifications where kind = ''task_comment'' and task_id = %L and user_id = %L', t2, 'ffffffff-0000-4000-8000-0000000000a4')) = 1, 'responsável recebe o aviso de comentário';
  perform test.has(test.errmsg(format($q$select test.sql('update public.task_comments set body = ''reescrito'' where id = ''%s''')$q$, c)), '%registro imutável%', 'comentário é append-only');
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.task_comments where id = ''%s''')$q$, c)), '%não pode ser apagado%', 'comentário não se apaga');
  raise notice 'PASS: comentários (idempotentes, append-only, notificações deduplicadas) (10)';
end $$;
reset role;

:as_ed2
do $$
declare org uuid := test.t('org'); n uuid; before_unread bigint;
begin
  select id into n from public.notifications where user_id = 'ffffffff-0000-4000-8000-0000000000a4' and read_at is null limit 1;
  assert n is not null and (select count(*) from public.notifications) >= 2, 'o responsável vê as próprias notificações';
  before_unread := (public.pj_my_context(org) ->> 'unread_notifications')::bigint;
  perform public.pj_mark_notification_read(org, n);
  assert (public.pj_my_context(org) ->> 'unread_notifications')::bigint = before_unread - 1, 'marcar como lida reduz o contador';
  perform public.pj_mark_all_notifications_read(org);
  assert (public.pj_my_context(org) ->> 'unread_notifications')::int = 0, 'marcar todas como lidas';
  raise notice 'PASS: notificações internas (10)';
end $$;
reset role;

-- ===================================================================== (11) anexos: validação do que o servidor registrou
:as_ed
do $$
declare org uuid := test.t('org'); t2 uuid := test.t('t2'); path text := test.t('org')::text || '/' || test.t('t2')::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf';
begin
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'application/pdf', 'size', 1000, 'filename', 'a.pdf')))$q$, org, t2, replace(path, t2::text, gen_random_uuid()::text))), '%arquivo inválido%', 'caminho de outra tarefa');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/svg+xml', 'size', 1000, 'filename', 'a.pdf')))$q$, org, t2, path)), '%tipo de arquivo não permitido%', 'SVG não é aceito');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'image/png', 'size', 1000, 'filename', 'a.pdf')))$q$, org, t2, path)), '%arquivo inválido%', 'tipo e extensão precisam bater');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'application/pdf', 'size', 99999999, 'filename', 'a.pdf')))$q$, org, t2, path)), '%tamanho máximo%', 'acima do limite');
  assert public.pj_add_attachments(org, t2, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', path, 'mime', 'application/pdf', 'size', 2048, 'filename', 'briefing/..\final.pdf'))) = 1, 'anexo registrado';
  assert (select original_filename from public.task_attachments where task_id = t2) = 'briefing_.._final.pdf', 'nome do arquivo sanitizado';
  assert (public.pj_attachment_info(org, (select id from public.task_attachments where task_id = t2)) ->> 'path') = path, 'informações para URL assinada';
  perform test.has(test.errmsg(format($q$select test.sql('update public.task_attachments set original_filename = ''x'' where task_id = ''%s''')$q$, t2)), '%registro imutável%', 'anexo é imutável');
  raise notice 'PASS: anexos (validação, nome seguro, imutável) (11)';
end $$;
reset role;

-- ===================================================================== (12) estados do projeto: pausa, conclusão, reabertura, arquivamento
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); v integer;
begin
  -- projeto pausado: organizar pode, executar não
  v := test.pv(p);
  perform public.pj_set_project_status(org, p, v, 'paused');
  assert (select status from public.projects where id = p) = 'paused', 'projeto pausado';
  raise notice 'PASS: projeto pausado (12)';
end $$;
reset role;

:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t2 uuid := test.t('t2'); todo uuid := test.col(p, 'todo'); prog uuid := (select id from public.project_columns where project_id = p and semantic_status = 'in_progress' limit 1);
  review uuid := test.col(p, 'review'); r jsonb; n integer;
begin
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, org, t2, review)), '%projeto pausado%', 'pausado bloqueia movimentação de execução');
  perform public.pj_add_comment(org, t2, gen_random_uuid(), 'Comentário durante a pausa');
  assert (select count(*) from public.task_comments where task_id = t2) = 2, 'comentários seguem permitidos na pausa';
  r := public.pj_create_task(org, p, gen_random_uuid(), '{"title":"Planejamento durante a pausa"}');
  assert (r ->> 'task_number')::int = 5, 'organizar (criar tarefa) é permitido na pausa';
  r := public.pj_move_task(org, (r ->> 'id')::uuid, todo, test.t('t4'), null);
  assert (r ->> 'changed')::boolean is not null, 'reordenar na mesma etapa é organização, permitida na pausa';
  perform test.has(test.errmsg(format($q$select public.pj_toggle_checklist_item(%L, (select id from public.task_checklist_items where task_id = %L limit 1), false)$q$, org, test.t('t1'))), '%somente para consulta%', 'checklist de tarefa arquivada é somente consulta');
  raise notice 'PASS: pausa permite comentar e organizar, bloqueia execução (12)';
end $$;
reset role;

:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); v integer;
begin
  v := test.pv(p);
  perform public.pj_set_project_status(org, p, v, 'active');
  v := test.pv(p);
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'completed')$q$, org, p, v)), '%não é possível concluir%tarefa(s)%', 'não conclui com tarefas abertas');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'cancelled')$q$, org, p, v)), '%motivo%', 'cancelar exige motivo');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'planned')$q$, org, p, v)), '%transição de status do projeto inválida%', 'ativo não volta a planejado');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'paused')$q$, org, p, v - 3)), '%Outra pessoa alterou%', 'versão antiga do projeto');
  raise notice 'PASS: estados do projeto (conclusão exige tratar pendências) (12)';
end $$;
reset role;

-- ===================================================================== (13) remover participante e sair da empresa tratam as tarefas
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t2 uuid := test.t('t2'); ed2 uuid := 'ffffffff-0000-4000-8000-0000000000a4'; n integer;
begin
  perform test.has(test.errmsg(format($q$select public.pj_remove_member(%L, %L, %L)$q$, org, p, ed2)), '%responsável por%tarefa(s)%', 'remover exige tratar as tarefas');
  perform test.has(test.errmsg(format($q$select public.pj_remove_member(%L, %L, %L, 'transfer', 'ffffffff-0000-4000-8000-0000000000b1')$q$, org, p, ed2)), '%outra pessoa do projeto com permissão%', 'não transfere para leitor');
  perform test.has(test.errmsg(format($q$select public.pj_set_member_role(%L, %L, %L, 'reader')$q$, org, p, ed2)), '%escolha desatribuir ou transferir%', 'rebaixar a leitor também exige tratar as tarefas');
  n := public.pj_remove_member(org, p, ed2, 'transfer', 'ffffffff-0000-4000-8000-0000000000a3');
  assert n >= 1 and (select assignee_user_id from public.tasks where id = t2) = 'ffffffff-0000-4000-8000-0000000000a3', 'tarefas transferidas explicitamente';
  assert (select count(*) from public.project_members where project_id = p and user_id = ed2) = 0, 'participante removido';
  assert (select count(*) from public.task_events where task_id = t2 and event_type = 'assignee_changed') >= 2, 'histórico da transferência';
  raise notice 'PASS: remoção de participante exige desatribuição ou transferência (13)';
end $$;
reset role;

:as_ed2
do $$
begin
  assert test.count('select 1 from public.projects') = 0 and test.count('select 1 from public.tasks') = 0, 'quem foi removido deixa de ver o projeto e as tarefas NA HORA';
  assert test.count('select 1 from public.notifications') = 0, 'e deixa de ver notificações daquele projeto';
  raise notice 'PASS: remoção do projeto revoga o acesso imediatamente (13)';
end $$;
reset role;

-- sair da empresa: todas as tarefas perdem o responsável (inclusive arquivadas) e o acesso some
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t3 uuid := test.t('t3');
begin
  perform public.pj_assign_task(org, t3, test.tv(t3), 'ffffffff-0000-4000-8000-0000000000a3');
  assert (select assignee_user_id from public.tasks where id = t3) = 'ffffffff-0000-4000-8000-0000000000a3', 'tarefa atribuída ao editor';
end $$;
reset role;
:as_o
do $$
declare org uuid := test.t('org'); t3 uuid := test.t('t3');
begin
  delete from public.organization_members where organization_id = org and user_id = 'ffffffff-0000-4000-8000-0000000000a3';
  assert test.cnt(format('select count(*) from public.tasks where assignee_user_id = %L', 'ffffffff-0000-4000-8000-0000000000a3')) = 0, 'sair da empresa desatribui todas as tarefas';
  assert test.cnt(format('select count(*) from public.project_members where user_id = %L', 'ffffffff-0000-4000-8000-0000000000a3')) = 0, 'e remove as participações';
  assert (select count(*) from public.task_events where task_id = t3 and event_type = 'assignee_removed' and actor_kind = 'system') = 1, 'evento de sistema na tarefa';
  assert (select count(*) from public.tasks where id = t3) = 1, 'a autoria histórica é preservada (a tarefa continua)';
  raise notice 'PASS: sair da empresa trata atribuições e revoga acessos (13)';
end $$;
reset role;

rollback;
