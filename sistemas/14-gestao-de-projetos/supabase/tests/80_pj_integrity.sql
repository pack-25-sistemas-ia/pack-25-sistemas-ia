-- Gestão de Projetos e Tarefas — integridade NO BANCO, mesmo para quem escreve SQL direto (como dono das tabelas, sem passar pelas funções pj_*):
-- gatilhos de projeto/tarefa/etapa/participante/checklist, unicidade, restrições de data e cálculo, posições do quadro e limite de tentativas.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
-- executa SQL como dono (sem RLS) e devolve a mensagem do erro, ou null se funcionou
create function test.bad(q text) returns text language plpgsql as $$ begin perform test.sql(q); return null; exception when others then return sqlerrm; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.col(p uuid, sem text, nth integer default 1) returns uuid language sql security definer set search_path = '' as $$
  select id from (select id, row_number() over (order by position) rn from public.project_columns where project_id = p and semantic_status = sem) x where rn = nth $$;
create function test.tv(t uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.tasks where id = t $$;
create function test.mk(org uuid, p uuid, title text) returns uuid language plpgsql as $$ begin return (public.pj_create_task(org, p, gen_random_uuid(), jsonb_build_object('title', title)) ->> 'id')::uuid; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000b1', 'v@t.invalid');

-- ===================================================================== (1) preparação
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Integridade Teste', 'integridade-teste'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000b1', 'viewer');
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); pa uuid; pp uuid; t1 uuid; t2 uuid; t3 uuid; t4 uuid;
begin
  pa := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Ativo', 'status', 'active', 'start_date', '2026-01-01', 'due_date', '2026-12-31', 'members', jsonb_build_array(
    jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'role', 'editor'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000b1', 'role', 'reader')))) ->> 'id')::uuid;
  pp := (public.pj_create_project(org, gen_random_uuid(), '{"name":"Planejado"}') ->> 'id')::uuid;
  perform set_config('t.pa', pa::text, true); perform set_config('t.pp', pp::text, true);
  t1 := (public.pj_create_task(org, pa, gen_random_uuid(), jsonb_build_object('title', 'Com obrigatório', 'assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'checklist', jsonb_build_array(jsonb_build_object('title', 'Revisar', 'required', true)))) ->> 'id')::uuid;
  t2 := test.mk(org, pa, 'Segunda'); t3 := test.mk(org, pa, 'Terceira');
  t4 := test.mk(org, pp, 'Tarefa do planejado');
  perform set_config('t.t1', t1::text, true); perform set_config('t.t2', t2::text, true); perform set_config('t.t3', t3::text, true); perform set_config('t.t4', t4::text, true);
  perform public.pj_add_comment(org, t1, gen_random_uuid(), 'Comentário inicial');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) tarefa: regras de execução no gatilho
do $$
declare pa uuid := test.t('pa'); pp uuid := test.t('pp'); t1 uuid := test.t('t1'); t2 uuid := test.t('t2'); t4 uuid := test.t('t4'); done uuid := test.col(test.t('pa'), 'done'); prog uuid := test.col(test.t('pa'), 'in_progress'); v integer;
begin
  perform test.has(test.bad(format($q$update public.tasks set column_id = %L where id = %L$q$, done, t1)), '%item(ns) obrigatório(s)%', 'conclusão direta exige o checklist obrigatório');
  perform test.has(test.bad(format($q$update public.tasks set column_id = %L where id = %L$q$, test.col(pp, 'in_progress'), t4)), '%só é possível mover tarefas entre etapas de execução%', 'projeto planejado não executa (nem por SQL direto)');
  perform test.sql(format($q$update public.tasks set completed_at = now() where id = %L$q$, t2));
  assert (select completed_at from public.tasks where id = t2) is null, 'completed_at não vive fora da etapa «Concluído»';
  perform test.has(test.bad(format($q$update public.tasks set assignee_user_id = 'ffffffff-0000-4000-8000-0000000000b1' where id = %L$q$, t2)), '%responsável inválido%', 'leitor não é responsável (SQL direto)');
  perform test.has(test.bad(format($q$update public.tasks set task_number = 99 where id = %L$q$, t2)), '%identidade da tarefa%', 'número da tarefa é imutável');
  perform test.has(test.bad(format($q$update public.tasks set created_by = 'ffffffff-0000-4000-8000-0000000000b1' where id = %L$q$, t2)), '%identidade da tarefa%', 'autoria é imutável');
  perform test.has(test.bad(format($q$update public.tasks set start_date = '2026-05-02', due_date = '2026-05-01' where id = %L$q$, t2)), '%violates check constraint%', 'início depois do vencimento (restrição)');
  perform test.has(test.bad(format($q$update public.tasks set blocked_at = now() where id = %L$q$, t2)), '%violates check constraint%', 'impedimento exige motivo (restrição)');
  perform test.has(test.bad(format($q$update public.tasks set blocked_reason = 'sem data' where id = %L$q$, t2)), '%violates check constraint%', 'motivo sem data de bloqueio (restrição)');
  perform test.has(test.bad(format($q$update public.tasks set position = 0 where id = %L$q$, t2)), '%violates check constraint%', 'posição começa em 1');
  perform test.has(test.bad(format($q$update public.tasks set position = (select position from public.tasks where id = %L) where id = %L$q$, t1, t2)), '%duplicate key%', 'duas tarefas ativas não dividem a posição');
  perform test.has(test.bad(format($q$update public.tasks set priority = 'critica' where id = %L$q$, t2)), '%violates check constraint%', 'prioridade inválida');
  perform test.has(test.bad(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position) values (%L, %L, 1, %L, 'Número repetido', 50)$q$, test.t('org'), pa, test.col(pa, 'todo'))), '%duplicate key%', 'número de tarefa único por projeto');
  perform test.has(test.bad(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position) values (%L, %L, 50, %L, 'Já concluída', 50)$q$, test.t('org'), pa, done)), '%não nasce concluída%', 'tarefa nova não nasce concluída');
  v := test.tv(t2);
  perform test.sql(format($q$update public.tasks set title = 'Segunda (editada)' where id = %L$q$, t2));
  assert test.tv(t2) = v + 1, 'a versão sobe a cada mudança real';
  perform test.sql(format($q$update public.tasks set position = position where id = %L$q$, t2));
  assert test.tv(t2) = v + 1, 'e não sobe sem mudança';
  raise notice 'PASS: gatilho da tarefa (2)';
end $$;

-- ===================================================================== (3) projeto: transições, conclusão, identidade, unicidade
do $$
declare org uuid := test.t('org'); pa uuid := test.t('pa'); pp uuid := test.t('pp');
begin
  perform test.has(test.bad(format($q$update public.projects set status = 'completed' where id = %L$q$, pp)), '%transição de status do projeto inválida%', 'planejado não conclui direto');
  perform test.has(test.bad(format($q$update public.projects set status = 'completed' where id = %L$q$, pa)), '%não é possível concluir%', 'conclusão direta com tarefas abertas');
  perform test.has(test.bad(format($q$update public.projects set status = 'paused' where id = %L$q$, pp)), '%transição de status do projeto inválida%', 'planejado não pausa');
end $$;
do $$
declare org uuid := test.t('org'); pa uuid := test.t('pa'); pp uuid := test.t('pp'); bv integer;
begin
  perform test.has(test.bad(format($q$update public.projects set project_number = 77 where id = %L$q$, pa)), '%identidade do projeto%', 'número do projeto é imutável');
  perform test.has(test.bad(format($q$update public.projects set start_date = '2027-01-01', due_date = '2026-01-01' where id = %L$q$, pa)), '%violates check constraint%', 'início depois da entrega (restrição)');
  perform test.has(test.bad(format($q$update public.projects set archived_at = now() where id = %L$q$, pa)), '%só projetos concluídos ou cancelados%', 'projeto ativo não é arquivado');
  perform test.has(test.bad(format($q$update public.projects set board_version = 0 where id = %L$q$, pa)), '%versão do quadro inválida%', 'versão do quadro nunca fica abaixo da atual');
  perform test.sql(format($q$update public.projects set board_version = 3 where id = %L$q$, pa));
  perform test.has(test.bad(format($q$update public.projects set board_version = 2 where id = %L$q$, pa)), '%versão do quadro inválida%', 'versão do quadro nunca diminui');
  perform test.has(test.bad(format($q$insert into public.projects (organization_id, project_number, name) values (%L, 1, 'Número repetido')$q$, org)), '%duplicate key%', 'número do projeto único por empresa');
  perform test.sql(format($q$update public.projects set completed_at = now() where id = %L$q$, pa));
  assert (select completed_at from public.projects where id = pa) is null, 'completed_at não vive fora do projeto concluído';
  raise notice 'PASS: gatilho do projeto (3)';
end $$;

-- ===================================================================== (4) etapas: mínimo «A fazer» e «Concluído», tipo fixo se ocupada, posição única
do $$
declare pa uuid := test.t('pa'); pp uuid := test.t('pp'); c uuid;
begin
  perform test.has(test.bad(format($q$delete from public.project_columns where id = %L$q$, test.col(pp, 'todo'))), '%ao menos uma etapa do tipo%', 'não remove a única etapa «A fazer»');
  perform test.has(test.bad(format($q$delete from public.project_columns where id = %L$q$, test.col(pp, 'done'))), '%ao menos uma etapa do tipo%', 'não remove a única etapa «Concluído»');
  perform test.has(test.bad(format($q$update public.project_columns set semantic_status = 'review' where id = %L$q$, test.col(pp, 'done'))), '%ao menos uma etapa do tipo%', 'não troca o tipo da única «Concluído» (vazia)');
  perform test.has(test.bad(format($q$update public.project_columns set semantic_status = 'in_progress' where id = %L$q$, test.col(pp, 'todo'))), '%tem tarefas%', 'a única «A fazer» está ocupada');
  perform test.has(test.bad(format($q$update public.project_columns set semantic_status = 'review' where id = %L$q$, test.col(pa, 'todo'))), '%tem tarefas%', 'etapa ocupada não muda de tipo');
  perform test.has(test.bad(format($q$delete from public.project_columns where id = %L$q$, test.col(pa, 'todo'))), '%ao menos uma etapa do tipo%', 'a etapa ocupada «A fazer» é a única (barrada antes da FK)');
  perform test.has(test.bad(format($q$update public.project_columns set semantic_status = 'wip' where id = %L$q$, test.col(pp, 'review'))), '%violates check constraint%', 'tipo de etapa inválido');
  c := test.col(pp, 'review');
  perform test.sql(format($q$update public.project_columns set semantic_status = 'in_progress' where id = %L$q$, c));
  assert (select semantic_status from public.project_columns where id = c) = 'in_progress', 'etapa vazia pode mudar de tipo se o quadro continuar válido';
  perform test.sql('set constraints all immediate');
  perform test.has(test.bad(format($q$update public.project_columns set position = 1 where id = %L$q$, c)), '%duplicate key%', 'posição de etapa única por projeto');
  perform test.sql('set constraints all deferred');
  raise notice 'PASS: etapas do quadro (4)';
end $$;

-- ===================================================================== (5) participantes: gestão, leitor, tarefas abertas
do $$
declare org uuid := test.t('org'); pa uuid := test.t('pa'); pp uuid := test.t('pp');
begin
  perform test.has(test.bad(format($q$insert into public.project_members (organization_id, project_id, user_id, project_role) values (%L, %L, 'ffffffff-0000-4000-8000-0000000000a1', 'editor')$q$, org, pp)), '%já têm acesso a todos%', 'gestão não vira participante');
  perform test.has(test.bad(format($q$insert into public.project_members (organization_id, project_id, user_id, project_role) values (%L, %L, 'ffffffff-0000-4000-8000-0000000000b1', 'editor')$q$, org, pp)), '%Leitor%', 'Leitor da empresa só é leitor');
  perform test.has(test.bad(format($q$insert into public.project_members (organization_id, project_id, user_id, project_role) values (%L, %L, 'ffffffff-0000-4000-8000-0000000000a3', 'chefe')$q$, org, pp)), '%violates check constraint%', 'papel inválido');
  perform test.has(test.bad(format($q$delete from public.project_members where project_id = %L and user_id = 'ffffffff-0000-4000-8000-0000000000a3'$q$, pa)), '%responsável por%tarefa(s)%', 'não remove quem tem tarefa aberta');
  perform test.has(test.bad(format($q$update public.project_members set project_role = 'reader' where project_id = %L and user_id = 'ffffffff-0000-4000-8000-0000000000a3'$q$, pa)), '%responsável por%tarefa(s)%', 'não rebaixa a leitor quem tem tarefa aberta');
  perform test.has(test.bad(format($q$insert into public.project_members (organization_id, project_id, user_id, project_role) values (%L, %L, 'ffffffff-0000-4000-8000-0000000000a3', 'editor')$q$, org, pa)), '%duplicate key%', 'participante único');
  raise notice 'PASS: participantes (5)';
end $$;

-- ===================================================================== (6) checklist, comentários, notificações e eventos
do $$
declare org uuid := test.t('org'); t1 uuid := test.t('t1'); t3 uuid := test.t('t3'); i uuid;
begin
  select id into i from public.task_checklist_items where task_id = t1;
  perform test.has(test.bad(format($q$update public.task_checklist_items set title = 'Reescrito' where id = %L$q$, i)), '%só muda de concluído/pendente%', 'o item do checklist não é reescrito');
  perform test.has(test.bad(format($q$update public.task_checklist_items set completed_at = now() where id = %L$q$, i)), '%violates check constraint%', 'conclusão do item exige quem concluiu');
  perform test.has(test.bad(format($q$insert into public.task_comments (organization_id, task_id, body) values (%L, %L, '   ')$q$, org, t1)), '%violates check constraint%', 'comentário vazio');
  perform test.has(test.bad(format($q$insert into public.task_events (organization_id, project_id, task_id, event_type, data) values (%L, %L, %L, 'x', '[]')$q$, org, test.t('pa'), t1)), '%violates check constraint%', 'dados do evento precisam ser objeto');
  perform test.sql(format($q$insert into public.notifications (organization_id, user_id, kind, project_id, task_id) values (%L, 'ffffffff-0000-4000-8000-0000000000a3', 'task_assigned', %L, %L)$q$, org, test.t('pa'), t3));
  perform test.has(test.bad(format($q$update public.notifications set kind = 'task_comment' where task_id = %L$q$, t3)), '%só pode ser marcada como lida%', 'notificação só muda o «lida»');
  perform test.sql(format($q$update public.notifications set read_at = now() where task_id = %L$q$, t3));
  perform test.has(test.bad(format($q$update public.notifications set read_at = null where task_id = %L$q$, t3)), '%só pode ser marcada como lida%', 'não volta a «não lida»');
  perform test.has(test.bad(format($q$insert into public.notifications (organization_id, user_id, kind, project_id) values (%L, 'ffffffff-0000-4000-8000-0000000000a3', 'spam', %L)$q$, org, test.t('pa'))), '%violates check constraint%', 'tipo de notificação inválido');
  raise notice 'PASS: checklist, comentários, notificações (6)';
end $$;

-- ===================================================================== (7) etiquetas e configurações
do $$
declare org uuid := test.t('org'); pa uuid := test.t('pa');
begin
  perform test.sql(format($q$insert into public.project_labels (organization_id, project_id, name) values (%L, %L, 'Urgente')$q$, org, pa));
  perform test.has(test.bad(format($q$insert into public.project_labels (organization_id, project_id, name) values (%L, %L, ' urgente ')$q$, org, pa)), '%duplicate key%', 'nome de etiqueta único sem diferenciar maiúsculas');
  perform test.has(test.bad(format($q$update public.pj_settings set primary_color = 'azul' where organization_id = %L$q$, org)), '%violates check constraint%', 'cor inválida');
  perform test.has(test.bad(format($q$update public.pj_settings set project_prefix = 'prj-1' where organization_id = %L$q$, org)), '%violates check constraint%', 'prefixo inválido');
  perform test.has(test.bad(format($q$update public.pj_settings set attachment_max_size_bytes = 99999999 where organization_id = %L$q$, org)), '%violates check constraint%', 'tamanho máximo de anexo limitado a 10 MB');
  perform test.has(test.bad(format($q$update public.pj_settings set timezone = 'Marte/Olimpo, 1' where organization_id = %L$q$, org)), '%violates check constraint%', 'formato do fuso');
  raise notice 'PASS: etiquetas e configurações (7)';
end $$;

-- ===================================================================== (8) limite de tentativas
do $$
declare i int;
begin
  for i in 1..3 loop perform test.sql($q$select private.pj_rate_hit('teste-limite', 3, 600)$q$); end loop;
  perform test.has(test.bad($q$select private.pj_rate_hit('teste-limite', 3, 600)$q$), '%Muitas tentativas%', 'a 4ª tentativa estoura o limite de 3');
  assert test.bad($q$select private.pj_rate_hit('outro-balde', 3, 600)$q$) is null, 'outro balde não é afetado';
  raise notice 'PASS: limite de tentativas (8)';
end $$;

rollback;
