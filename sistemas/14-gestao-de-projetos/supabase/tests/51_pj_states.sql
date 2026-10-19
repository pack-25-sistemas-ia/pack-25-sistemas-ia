-- Gestão de Projetos e Tarefas — domínio no banco, parte 2: ciclo de vida do projeto (planejado, ativo, pausado, concluído, cancelado, arquivado), somente consulta, reabertura com motivo,
-- exclusão física negada, tarefas arquivadas na conclusão e rebaixamento de quem vira «Leitor» da empresa.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_lead 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"lead@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.col(p uuid, sem text, nth integer default 1) returns uuid language sql security definer set search_path = '' as $$
  select id from (select id, row_number() over (order by position) rn from public.project_columns where project_id = p and semantic_status = sem) x where rn = nth $$;
create function test.pv(p uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.projects where id = p $$;
create function test.tv(t uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.tasks where id = t $$;
create function test.mk(org uuid, p uuid, title text) returns uuid language plpgsql as $$ begin return (public.pj_create_task(org, p, gen_random_uuid(), jsonb_build_object('title', title)) ->> 'id')::uuid; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'lead@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Estados Teste', 'estados-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) projeto planejado: prepara, não executa
:as_m
do $$
declare org uuid := test.t('org'); p uuid; c2 uuid; t uuid; v integer;
begin
  p := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto em planejamento', 'members', jsonb_build_array(
    jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a2', 'role', 'lead'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'role', 'editor')))) ->> 'id')::uuid;
  perform set_config('t.pb', p::text, true);
  t := test.mk(org, p, 'Levantar requisitos'); perform set_config('t.tb', t::text, true);
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, org, t, test.col(p, 'in_progress'))), '%ainda não iniciado%', 'planejado não executa');
  c2 := public.pj_add_column(org, p, (select board_version from public.projects where id = p), 'Backlog', 'todo');
  perform public.pj_move_task(org, t, c2, null, null);
  assert (select column_id from public.tasks where id = t) = c2, 'dentro do mesmo tipo (preparação) pode mover em projeto planejado';
  perform test.has(test.errmsg(format($q$select public.pj_toggle_checklist_item(%L, (select (public.pj_add_checklist_item(%L, %L, 'Item'))), true)$q$, org, org, t)), '%projeto ativo%', 'marcar checklist exige projeto ativo');
  v := test.pv(p);
  perform public.pj_update_project(org, p, v, '{"description":"Escopo em definição","start_date":"2026-02-01","due_date":"2026-06-30"}');
  perform public.pj_set_project_status(org, p, test.pv(p), 'active');
  assert (select status from public.projects where id = p) = 'active', 'planejado → ativo';
  perform public.pj_move_task(org, t, test.col(p, 'in_progress'), null, null);
  assert (select semantic_status from public.project_columns c join public.tasks x on x.column_id = c.id where x.id = t) = 'in_progress', 'ativo executa';
  raise notice 'PASS: projeto planejado prepara e não executa; ativo executa (2)';
end $$;
reset role;

-- ===================================================================== (3) conclusão: exige tratar pendências; depois é somente consulta
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('pb'); t uuid := test.t('tb'); t2 uuid; v integer; done uuid := test.col(test.t('pb'), 'done');
begin
  t2 := test.mk(org, p, 'Entregar o escopo');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'completed')$q$, org, p, test.pv(p))), '%2 tarefa(s)%', 'conclui só sem pendências');
  perform public.pj_move_task(org, t, done, null, null);
  perform public.pj_archive_task(org, t2, test.tv(t2), 'Fora do escopo desta fase');
  perform public.pj_set_project_status(org, p, test.pv(p), 'completed');
  assert (select status from public.projects where id = p) = 'completed' and (select completed_at from public.projects where id = p) is not null, 'concluído, com completed_at';
  -- somente consulta
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Nova"}')$q$, org, p)), '%não aceita novas tarefas%', 'concluído não recebe tarefas');
  perform test.has(test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), 'oi')$q$, org, t)), '%não aceita comentários%', 'concluído não recebe comentários');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, org, t, test.col(p, 'todo'))), '%não aceita movimentações%', 'concluído não move');
  perform test.has(test.errmsg(format($q$select public.pj_update_project(%L, %L, %s, '{"name":"Novo nome"}')$q$, org, p, test.pv(p))), '%somente para consulta%', 'concluído não edita');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000a1', 'reader')$q$, org, p)), '%não aceita alterações de participantes%', 'concluído não altera participantes');
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, null, 'Etapa nova', 'todo')$q$, org, p)), '%não aceita alterações no quadro%', 'concluído não altera o quadro');
  assert test.cnt(format('select count(*) from public.tasks where project_id = %L and archived_at is null', p)) = 1, 'a tarefa arquivada fica fora das pendências';
  raise notice 'PASS: conclusão do projeto (pendências, somente consulta) (3)';
end $$;
reset role;

-- ===================================================================== (4) reabertura: só liderança, com motivo, volta a ativo, notifica e preserva o histórico
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('pb');
begin
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'active', 'Cliente pediu ajustes finais')$q$, org, p, test.pv(p))), '%sem permissão%', 'editor não reabre projeto');
  raise notice 'PASS: editor não reabre (4)';
end $$;
reset role;
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('pb');
begin
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'active')$q$, org, p, test.pv(p))), '%motivo (mínimo 5%', 'reabrir exige motivo');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'active', 'ok')$q$, org, p, test.pv(p))), '%motivo (mínimo 5%', 'motivo curto demais');
  perform public.pj_set_project_status(org, p, test.pv(p), 'active', 'Cliente pediu ajustes finais');
  assert (select status from public.projects where id = p) = 'active' and (select completed_at from public.projects where id = p) is null, 'volta a ativo e limpa a conclusão atual';
  assert (select count(*) from public.project_events where project_id = p and event_type = 'project_reopened') = 1, 'evento de reabertura';
  assert (select count(*) from public.project_events where project_id = p and event_type = 'status_changed' and data ->> 'to' = 'completed') = 1, 'o histórico mantém a conclusão anterior';
  assert test.cnt(format('select count(*) from public.notifications where kind = ''project_reopened'' and project_id = %L and user_id = %L', p, 'ffffffff-0000-4000-8000-0000000000a3')) = 1, 'o editor é notificado da reabertura';
  assert test.cnt(format('select count(*) from public.notifications where kind = ''project_reopened'' and user_id = %L', 'ffffffff-0000-4000-8000-0000000000a2')) = 0, 'quem reabriu não é notificado';
  raise notice 'PASS: reabertura (liderança, motivo, histórico, notificação) (4)';
end $$;
reset role;

-- ===================================================================== (5) cancelamento e arquivamento
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('pb');
begin
  perform test.has(test.errmsg(format($q$select public.pj_archive_project(%L, %L, %s, true)$q$, org, p, test.pv(p))), '%só projetos concluídos ou cancelados%', 'ativo não é arquivado');
  perform public.pj_set_project_status(org, p, test.pv(p), 'cancelled', 'Cliente desistiu do projeto');
  assert (select status from public.projects where id = p) = 'cancelled', 'cancelado';
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Nova"}')$q$, org, p)), '%não aceita novas tarefas%', 'cancelado é somente consulta');
  perform public.pj_archive_project(org, p, test.pv(p), true, 'Encerrado');
  assert (select archived_at from public.projects where id = p) is not null, 'arquivado (atributo separado do status)';
  assert (select status from public.projects where id = p) = 'cancelled', 'o status continua o mesmo';
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'active', 'Voltou o interesse do cliente')$q$, org, p, test.pv(p))), '%desarquive antes%', 'arquivado não muda de status');
  perform test.has(test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), 'oi')$q$, org, test.t('tb'))), '%não aceita comentários%', 'arquivado é somente consulta');
  assert test.errmsg(format($q$select test.sql('update public.projects set name = ''Reescrito'' where id = ''%s''')$q$, p)) like '%arquivado é somente para consulta%', 'nem por SQL direto';
  perform public.pj_archive_project(org, p, test.pv(p), false);
  assert (select archived_at from public.projects where id = p) is null, 'desarquivado';
  perform public.pj_set_project_status(org, p, test.pv(p), 'active', 'Voltou o interesse do cliente');
  assert (select status from public.projects where id = p) = 'active', 'reaberto depois de desarquivar';
  assert (select count(*) from public.project_events where project_id = p and event_type in ('project_archived', 'project_unarchived')) = 2, 'arquivar e desarquivar ficam no histórico';
  raise notice 'PASS: cancelamento e arquivamento preservam o histórico (5)';
end $$;
reset role;

-- ===================================================================== (6) nada se apaga fisicamente
do $$
declare p uuid := test.t('pb'); t uuid := test.t('tb');
begin
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.projects where id = ''%s''')$q$, p)), '%não pode ser apagado%', 'projeto não é apagado');
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.tasks where id = ''%s''')$q$, t)), '%não pode ser apagado%', 'tarefa não é apagada');
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.project_events where project_id = ''%s''')$q$, p)), '%não pode ser apagado%', 'histórico não é apagado');
  perform test.has(test.errmsg(format($q$select test.sql('update public.project_events set event_type = ''x1'' where project_id = ''%s''')$q$, p)), '%registro imutável%', 'histórico não é reescrito');
  raise notice 'PASS: sem exclusão física nem reescrita do histórico (6)';
end $$;

-- ===================================================================== (7) quem vira «Leitor» da empresa perde as tarefas e fica só como leitor
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('pb'); t uuid := test.t('tb');
begin
  perform public.pj_assign_task(org, t, test.tv(t), 'ffffffff-0000-4000-8000-0000000000a3');
  assert (select assignee_user_id from public.tasks where id = t) = 'ffffffff-0000-4000-8000-0000000000a3', 'tarefa atribuída ao editor';
end $$;
reset role;
:as_o
do $$
declare p uuid := test.t('pb'); t uuid := test.t('tb');
begin
  update public.organization_members set role = 'viewer' where organization_id = test.t('org') and user_id = 'ffffffff-0000-4000-8000-0000000000a3';
  assert test.cnt(format('select count(*) from public.tasks where id = %L and assignee_user_id is null', t)) = 1, 'rebaixado a Leitor: perde a responsabilidade';
  assert (select project_role from public.project_members where project_id = p and user_id = 'ffffffff-0000-4000-8000-0000000000a3') = 'reader', 'e vira leitor nos projetos';
  raise notice 'PASS: Leitor da empresa nunca é responsável nem editor (7)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('pb');
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Tentativa"}')$q$, org, p)), '%sem permissão%', 'ex-editor agora só lê');
  assert test.count('select 1 from public.tasks') >= 1, 'continua enxergando o projeto como leitor';
  raise notice 'PASS: ex-editor apenas consulta (7)';
end $$;
reset role;

rollback;
