-- Gestão de Projetos e Tarefas — fronteiras e camadas: cada asserção existe para derrubar uma mutação específica do teste de mutação (scripts/mutation-check.mjs).
-- Cobre: leitura (RLS) por tabela, papéis, níveis de autorização, gatilhos diretos (SQL sem passar pelas funções), mensagens próprias das funções, limites numéricos,
-- operações repetidas que não geram evento e restrições de esquema.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_lead 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"lead@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_rd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"rd@t.invalid"}'', true); set local role authenticated;'
\set as_out 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a5","aal":"aal1","email":"out@t.invalid"}'', true); set local role authenticated;'
\set as_vw 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a6","aal":"aal1","email":"vw@t.invalid"}'', true); set local role authenticated;'
\set as_x 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"x@t.invalid"}'', true); set local role authenticated;'
\set as_nobody 'select set_config(''request.jwt.claims'', ''{}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
-- SQL direto (sem passar pelas funções pj_*): devolve a mensagem de erro, ou nulo se a instrução foi aceita
create function test.derr(q text) returns text language plpgsql security definer set search_path = '' as $$
begin
  begin execute q; exception when others then return sqlerrm; end;
  return null;
end $$;
create function test.col(p uuid, sem text, nth integer default 1) returns uuid language sql security definer set search_path = '' as $$
  select id from (select id, row_number() over (order by position) rn from public.project_columns where project_id = p and semantic_status = sem) x where rn = nth $$;
create function test.pv(p uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.projects where id = p $$;
create function test.bv(p uuid) returns integer language sql security definer set search_path = '' as $$ select board_version from public.projects where id = p $$;
create function test.tv(t uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.tasks where id = t $$;
create function test.tev(t uuid, ty text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.task_events where task_id = t and event_type = ty $$;
create function test.pev(p uuid, ty text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.project_events where project_id = p and event_type = ty $$;
create function test.notif(u uuid, t uuid, k text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.notifications where user_id = u and task_id = t and kind = k $$;
create function test.mk(org uuid, p uuid, title text, extra jsonb default '{}'::jsonb) returns uuid language plpgsql as $$
begin return (public.pj_create_task(org, p, gen_random_uuid(), jsonb_build_object('title', title) || extra) ->> 'id')::uuid; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 'lead@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a4', 'rd@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a5', 'out@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a6', 'vw@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c0', 'x@t.invalid');

-- ===================================================================== (1) empresas e projeto base
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Fronteiras', 'fronteiras'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'),
    (org, 'ffffffff-0000-4000-8000-0000000000a4', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a5', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a6', 'viewer');
end $$;
reset role;
:as_x
select set_config('t.orgb', public.create_organization('Outra empresa', 'outra-empresa')::text, true);
reset role;

:as_m
do $$
declare org uuid := test.t('org'); p uuid; l uuid; t1 uuid;
begin
  p := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto base', 'status', 'active', 'start_date', '2026-02-01', 'due_date', '2026-06-30', 'members', jsonb_build_array(
    jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a2', 'role', 'lead'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'role', 'editor'),
    jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a4', 'role', 'reader'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a6', 'role', 'reader')))) ->> 'id')::uuid;
  perform set_config('t.p', p::text, true);
  l := public.pj_save_label(org, p, null, 'Etiqueta um', '#112233'); perform set_config('t.l', l::text, true);
  t1 := test.mk(org, p, 'Tarefa um', jsonb_build_object('assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a2', 'label_ids', jsonb_build_array(l)));
  perform set_config('t.t1', t1::text, true);
  perform public.pj_add_comment(org, t1, gen_random_uuid(), 'Primeiro comentário');
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) quem não participa não lê NENHUMA tabela do projeto; ninguém lê notificação alheia
:as_out
do $$
declare p uuid := test.t('p'); t text;
begin
  foreach t in array array['project_members', 'project_columns', 'project_labels', 'task_comments', 'task_checklist_items', 'task_labels', 'project_events', 'task_events'] loop
    assert test.cnt(format('select count(*) from public.%I where organization_id = %L', t, test.t('org'))) > 0 or t = 'task_checklist_items' or t = 'task_comments', 'preparação: ' || t;
  end loop;
  assert test.count('select 1 from public.project_members') = 0, 'quem não participa não lê participantes';
  assert test.count('select 1 from public.project_columns') = 0, 'quem não participa não lê etapas';
  assert test.count('select 1 from public.project_labels') = 0, 'quem não participa não lê etiquetas';
  assert test.count('select 1 from public.task_comments') = 0, 'quem não participa não lê comentários';
  assert test.count('select 1 from public.project_events') = 0, 'quem não participa não lê eventos do projeto';
  assert test.count('select 1 from public.task_events') = 0, 'quem não participa não lê eventos da tarefa';
  assert test.count('select 1 from public.task_labels') = 0, 'quem não participa não lê etiquetas das tarefas';
  raise notice 'PASS: quem não participa não lê nenhuma tabela do projeto (2)';
end $$;
reset role;
:as_ed
do $$
begin
  assert test.count('select 1 from public.project_members') > 0 and test.count('select 1 from public.project_columns') > 0, 'participante lê o projeto';
  assert test.count('select 1 from public.notifications where user_id <> auth.uid()') = 0, 'ninguém lê notificação de outra pessoa, mesmo vendo o projeto';
  raise notice 'PASS: notificações alheias invisíveis (2)';
end $$;
reset role;
:as_lead
do $$
begin
  assert test.count('select 1 from public.notifications where user_id = auth.uid()') >= 1, 'a pessoa lê a própria notificação';
  raise notice 'PASS: notificação própria visível (2)';
end $$;
reset role;

-- ===================================================================== (3) papéis e níveis
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p');
begin
  assert not private.pj_can_lead_project(org, p), 'editor não lidera';
  assert private.pj_can_edit_project(org, p), 'editor edita';
  perform test.has(test.errmsg(format($q$select public.pj_people(%L, %L)$q$, org, p)), '%sem permissão%', 'editor não lista pessoas');
  raise notice 'PASS: editor edita mas não lidera (3)';
end $$;
reset role;
:as_rd
do $$
declare org uuid := test.t('org'); p uuid := test.t('p');
begin
  assert not private.pj_can_edit_project(org, p), 'leitor não edita';
  assert not private.pj_can_lead_project(org, p), 'leitor não lidera';
  raise notice 'PASS: leitor não edita (3)';
end $$;
reset role;
:as_m
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_save_settings(%L, '{"primary_color":"#112233"}')$q$, test.t('org'))), '%sem permissão%', 'gestor não altera configurações da empresa');
  perform test.has(test.errmsg(format($q$select public.pj_set_logo(%L, null)$q$, test.t('org'))), '%sem permissão%', 'gestor não troca logotipo');
  raise notice 'PASS: configurações só do proprietário (3)';
end $$;
reset role;
:as_o
do $$
declare org uuid := test.t('org');
begin
  perform test.has(test.errmsg(format($q$select public.pj_set_logo(%L, 'outra-empresa/logo-12345678.png')$q$, org)), '%caminho de logotipo inválido%', 'logotipo só do próprio caminho');
  perform public.pj_set_logo(org, org::text || '/logo-12345678.png');
  perform public.pj_set_logo(org, null);
  raise notice 'PASS: caminho do logotipo (3)';
end $$;
reset role;
:as_nobody
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, '2026-01-01', '2026-01-02')$q$, test.t('org'))), '%sessão inválida%', 'sem sessão a função recusa com mensagem própria');
  raise notice 'PASS: sem sessão (3)';
end $$;
reset role;

-- ===================================================================== (4) projeto base: conclusão, cancelamento e arquivamento — SQL direto contra os gatilhos
:as_m
do $$
declare org uuid := test.t('org'); pc uuid; px uuid; tc uuid; tx uuid;
begin
  pc := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto a concluir', 'status', 'active', 'members', jsonb_build_array(
    jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a4', 'role', 'reader'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a6', 'role', 'reader')))) ->> 'id')::uuid;
  perform set_config('t.pc', pc::text, true);
  tc := test.mk(org, pc, 'Entrega única'); perform set_config('t.tc', tc::text, true);
  perform public.pj_move_task(org, tc, test.col(pc, 'done'), null, null);
  px := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto a cancelar', 'status', 'active')) ->> 'id')::uuid;
  perform set_config('t.px', px::text, true);
  tx := test.mk(org, px, 'Tarefa que ficará aberta'); perform set_config('t.tx', tx::text, true);
  -- pausado não conclui direto: precisa voltar a ativo (e a transição é validada no banco)
  perform public.pj_set_project_status(org, pc, test.pv(pc), 'paused');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'completed')$q$, org, pc, test.pv(pc))), '%transição de status do projeto inválida%', 'pausado não conclui direto');
  perform public.pj_set_project_status(org, pc, test.pv(pc), 'active');
  perform public.pj_set_project_status(org, pc, test.pv(pc), 'completed');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, %s, 'cancelled', 'fora')$q$, org, pc, test.pv(pc))), '%motivo%', 'motivo de cancelamento tem no mínimo 5 caracteres');
  perform public.pj_set_project_status(org, px, test.pv(px), 'cancelled', 'Cliente desistiu do projeto');
  raise notice 'PASS: projetos concluído e cancelado preparados (4)';
end $$;
reset role;

do $$
declare org uuid := test.t('org'); pc uuid := test.t('pc'); px uuid := test.t('px'); p uuid := test.t('p'); tc uuid := test.t('tc'); tx uuid := test.t('tx'); v integer;
begin
  -- transições inválidas direto no banco
  perform test.has(test.derr(format($q$update public.projects set status = 'paused' where id = %L$q$, pc)), '%transição de status do projeto inválida%', 'concluído não vai para pausado');
  perform test.has(test.derr(format($q$update public.projects set status = 'completed', completed_at = now() where id = %L$q$, test.t('p'))), '%não é possível concluir%', 'projeto com tarefa aberta não conclui');
  -- concluído e cancelado são só consulta
  perform test.has(test.derr(format($q$update public.projects set name = 'Outro nome' where id = %L$q$, pc)), '%somente para consulta%', 'concluído não edita');
  perform test.has(test.derr(format($q$update public.projects set name = 'Outro nome' where id = %L$q$, px)), '%somente para consulta%', 'cancelado não edita');
  perform test.has(test.derr(format($q$delete from public.project_columns where project_id = %L and semantic_status = 'in_progress'$q$, pc)), '%não aceita alterações no quadro%', 'concluído não perde etapa');
  perform test.has(test.derr(format($q$update public.tasks set title = 'Mudou' where id = %L$q$, tx)), '%não aceita alterações%', 'tarefa de projeto cancelado não edita');
  perform test.has(test.derr(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position, created_by) values (%L, %L, 9001, %L, 'Nova', 9001, %L)$q$,
    org, pc, test.col(pc, 'todo'), 'ffffffff-0000-4000-8000-0000000000a1')), '%novas tarefas%', 'projeto concluído não recebe tarefa direto');
  perform test.has(test.derr(format($q$insert into public.task_checklist_items (organization_id, task_id, title, required, position) values (%L, %L, 'Item', false, 1)$q$, org, tx)), '%não aceita alterações%', 'projeto cancelado não recebe item de checklist');
  perform test.has(test.derr(format($q$insert into public.task_comments (organization_id, task_id, author_user_id, body) values (%L, %L, %L, 'oi')$q$, org, tx, 'ffffffff-0000-4000-8000-0000000000a1')), '%não aceita comentários%', 'projeto cancelado não recebe comentário');
  -- arquivar: só concluído/cancelado; arquivado é só consulta e não "reabre" junto
  perform test.has(test.derr(format($q$update public.projects set archived_at = now() where id = %L$q$, p)), '%só projetos concluídos ou cancelados%', 'ativo não arquiva');
  perform public.pj_archive_project(org, pc, test.pv(pc), true, 'Encerrado');
  perform test.has(test.derr(format($q$update public.projects set status = 'active' where id = %L$q$, pc)), '%arquivado é somente para consulta%', 'arquivado não muda de status');
  perform test.has(test.derr(format($q$update public.projects set archived_at = null, status = 'active' where id = %L$q$, pc)), '%passos separados%', 'desarquivar e reabrir não juntos');
  perform test.has(test.derr(format($q$update public.projects set name = 'x1' where id = %L$q$, pc)), '%somente para consulta%', 'arquivado não edita');
  -- versão sobe a cada mudança real
  v := test.pv(p);
  perform test.sql(format($q$update public.projects set description = 'Descrição nova' where id = %L$q$, p));
  assert test.pv(p) = v + 1, 'versão do projeto sobe em mudança de conteúdo';
  perform test.sql(format($q$update public.projects set description = 'Descrição nova' where id = %L$q$, p));
  assert test.pv(p) = v + 1, 'versão do projeto não sobe sem mudança';
  v := test.tv(test.t('t1'));
  perform test.sql(format($q$update public.tasks set description = 'Detalhe' where id = %L$q$, test.t('t1')));
  assert test.tv(test.t('t1')) = v + 1, 'versão da tarefa sobe em mudança de conteúdo';
  -- etapa não muda de projeto
  perform test.has(test.derr(format($q$update public.project_columns set project_id = %L where id = %L$q$, p, (select id from public.project_columns where project_id = test.t('px') and semantic_status = 'review'))), '%não muda de projeto%', 'etapa não muda de projeto');
  -- responsável precisa ser elegível, também pelo SQL direto
  perform test.has(test.derr(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position, created_by, assignee_user_id) values (%L, %L, 9002, %L, 'Nova', 9002, %L, %L)$q$,
    org, p, test.col(p, 'todo'), 'ffffffff-0000-4000-8000-0000000000a1', 'ffffffff-0000-4000-8000-0000000000a5')), '%responsável inválido%', 'responsável de fora do projeto no insert direto');
  -- eventos e restrições de esquema
  perform test.has(test.derr(format($q$delete from public.task_events where task_id = %L$q$, tc)), '%não pode ser apagado%', 'evento da tarefa não se apaga');
  perform test.has(test.derr(format($q$insert into public.projects (organization_id, project_number, name, status, created_by) values (%L, 9001, 'Sem data', 'completed', %L)$q$, org, 'ffffffff-0000-4000-8000-0000000000a1')), '%check%', 'concluído exige data de conclusão');
  perform test.has(test.derr(format($q$insert into public.projects (organization_id, project_number, name, status, created_by) values (%L, 9002, 'Status solto', 'qualquer', %L)$q$, org, 'ffffffff-0000-4000-8000-0000000000a1')), '%check%', 'status do projeto restrito');
  perform test.has(test.derr(format($q$insert into public.task_events (organization_id, project_id, task_id, event_type, actor_kind, data) values (%L, %L, %L, 'x', 'user', '[]'::jsonb)$q$, org, pc, tc)), '%task_events_data_check%', 'dados do evento são um objeto');
  perform test.has(test.derr(format($q$insert into public.task_attachments (organization_id, task_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by) values (%L, %L, 'p', 'a.exe', 'application/x-msdownload', 10, %L)$q$, org, test.t('t1'), 'ffffffff-0000-4000-8000-0000000000a1')), '%check%', 'tipo do anexo restrito pelo esquema');
  perform test.has(test.derr(format($q$insert into public.task_attachments (organization_id, task_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by) values (%L, %L, 'p', 'a.pdf', 'application/pdf', 99999999, %L)$q$, org, test.t('t1'), 'ffffffff-0000-4000-8000-0000000000a1')), '%check%', 'tamanho do anexo restrito pelo esquema');
  raise notice 'PASS: gatilhos de projeto, etapa, tarefa e esquema por SQL direto (4)';
end $$;

create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
grant execute on function test.txt(text) to authenticated;

-- ===================================================================== (5) criação e edição de projeto: mensagens próprias, limites e operações repetidas
:as_m
do $$
declare org uuid := test.t('org'); pc uuid := test.t('pc'); p uuid := test.t('p'); n bigint; v integer;
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, null, '{"name":"Sem chave"}')$q$, org)), '%chave ausente%', 'criação exige chave de idempotência');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), jsonb_build_object('name', repeat('n', 121)))$q$, org)), '%entre 2 e 120%', 'nome longo demais');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), jsonb_build_object('name', 'Projeto longo', 'description', repeat('d', 4001)))$q$, org)), '%no máximo 4000%', 'descrição longa demais');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), jsonb_build_object('name', 'Projeto fora', 'members', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000c0', 'role', 'editor'))))$q$, org)), '%membro da empresa%', 'participante de fora da empresa');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), jsonb_build_object('name', 'Projeto papel', 'members', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'role', 'chefe'))))$q$, org)), '%papel de participante inválido%', 'papel inválido na criação');
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), jsonb_build_object('name', 'Datas', 'start_date', '2026-05-01', 'due_date', '2026-04-01'))$q$, org)), '%data de início não pode ser depois%', 'datas invertidas na criação');
  perform test.has(test.errmsg(format($q$select public.pj_update_project(%L, %L, %s, '{"start_date":"2026-08-01"}')$q$, org, p, test.pv(p))), '%data de início não pode ser depois%', 'datas invertidas na edição');
  perform test.has(test.errmsg(format($q$select public.pj_update_project(%L, %L, %s, '{"name":"Novo nome"}')$q$, org, pc, test.pv(pc))), '%arquivado, concluído ou cancelado%', 'projeto arquivado não edita (mensagem da função)');
  -- editar sem nada novo não gera evento nem versão
  n := test.pev(p, 'project_updated'); v := test.pv(p);
  assert public.pj_update_project(org, p, v, '{"name":"Projeto base"}') = v, 'sem mudança devolve a mesma versão';
  assert test.pev(p, 'project_updated') = n and test.pv(p) = v, 'sem mudança não grava evento nem sobe versão';
  -- arquivar repetido não gera evento
  assert test.pev(pc, 'project_archived') = 1, 'um evento de arquivamento';
  perform public.pj_archive_project(org, pc, test.pv(pc), true, 'de novo');
  assert test.pev(pc, 'project_archived') = 1, 'arquivar de novo não repete o evento';
  raise notice 'PASS: criação e edição de projeto — mensagens, limites e repetições (5)';
end $$;
reset role;
:as_ed
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_archive_project(%L, %L, %s, true, 'quero arquivar')$q$, test.t('org'), test.t('p'), test.pv(test.t('p')))), '%sem permissão%', 'editor não arquiva projeto');
  perform test.has(test.errmsg(format($q$select public.pj_set_member_role(%L, %L, %L, 'reader', 'unassign')$q$, test.t('org'), test.t('p'), 'ffffffff-0000-4000-8000-0000000000a4')), '%sem permissão%', 'editor não muda papéis');
  raise notice 'PASS: editor sem liderança (5)';
end $$;
reset role;
:as_out
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_project_people(%L, %L)$q$, test.t('org'), test.t('p'))), '%projeto não encontrado%', 'quem não participa não lista nomes do projeto');
  raise notice 'PASS: nomes só de projeto visível (5)';
end $$;
reset role;

-- ===================================================================== (6) participantes: papéis repetidos, ausentes, transferência e notificações
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; n bigint; t2 uuid;
begin
  perform test.has(test.errmsg(format($q$select public.pj_set_member_role(%L, %L, %L, 'reader', 'unassign')$q$, org, p, 'ffffffff-0000-4000-8000-0000000000a5')), '%não participa%', 'papel de quem não participa');
  perform test.has(test.errmsg(format($q$select public.pj_remove_member(%L, %L, %L, 'unassign')$q$, org, p, 'ffffffff-0000-4000-8000-0000000000a5')), '%não participa%', 'remover quem não participa');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, %L, 'chefe')$q$, org, p, 'ffffffff-0000-4000-8000-0000000000a5')), '%papel de participante inválido%', 'papel inválido ao adicionar');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, %L, 'editor')$q$, org, p, 'ffffffff-0000-4000-8000-0000000000c0')), '%membro da empresa%', 'adicionar quem é de fora da empresa');
  n := test.pev(p, 'member_role_changed');
  assert public.pj_set_member_role(org, p, ed, 'editor', null) = 0, 'mesmo papel não faz nada';
  assert test.pev(p, 'member_role_changed') = n, 'mesmo papel não grava evento';
  t2 := test.mk(org, p, 'Tarefa do editor', jsonb_build_object('assignee_user_id', ed));
  perform set_config('t.t2', t2::text, true);
  assert test.notif(ed, t2, 'task_assigned') = 1, 'responsável é avisado ao ser atribuído na criação';
  assert test.tev(t2, 'assignee_changed') = 1, 'evento de atribuição na criação';
  perform test.has(test.errmsg(format($q$select public.pj_remove_member(%L, %L, %L, 'transfer', %L)$q$, org, p, ed, ed)), '%outra pessoa%', 'não transfere para si mesmo');
  perform test.has(test.errmsg(format($q$select public.pj_remove_member(%L, %L, %L, 'transfer', %L)$q$, org, p, ed, 'ffffffff-0000-4000-8000-0000000000a4')), '%outra pessoa%', 'não transfere para leitor');
  perform test.has(test.errmsg(format($q$select public.pj_remove_member(%L, %L, %L, null)$q$, org, p, ed)), '%desatribuir ou transferir%', 'exige escolha explícita');
  raise notice 'PASS: participantes — repetições e escolhas explícitas (6)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t3 uuid; t4 uuid;
begin
  t3 := test.mk(org, p, 'Criada pelo editor, para a liderança', jsonb_build_object('assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a2')); perform set_config('t.t3', t3::text, true);
  t4 := test.mk(org, p, 'Criada e atribuída ao mesmo editor', jsonb_build_object('assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a3')); perform set_config('t.t4', t4::text, true);
  raise notice 'PASS: tarefas do editor (6)';
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; l uuid := 'ffffffff-0000-4000-8000-0000000000a2'; t2 uuid := test.t('t2'); t3 uuid := test.t('t3'); t4 uuid := test.t('t4');
begin
  perform public.pj_add_comment(org, t4, gen_random_uuid(), 'Comentário da gestão');
  assert test.notif(ed, t4, 'task_comment') = 1, 'responsável que também é o autor da tarefa recebe um único aviso';
  perform public.pj_remove_member(org, p, ed, 'transfer', l);
  assert test.tev(t2, 'assignee_changed') = 2, 'a transferência grava o evento de troca de responsável';
  assert test.notif(l, t2, 'task_assigned') = 1, 'o novo responsável é avisado da transferência';
  assert (select assignee_user_id from public.tasks where id = t2) = l, 'a tarefa foi para a liderança';
  perform public.pj_add_comment(org, t3, gen_random_uuid(), 'Comentário depois da saída');
  assert test.notif(ed, t3, 'task_comment') = 0, 'quem saiu do projeto não recebe aviso';
  assert test.notif(l, t3, 'task_comment') = 1, 'o responsável atual recebe o aviso';
  raise notice 'PASS: transferência e avisos (6)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org');
begin
  assert test.count('select 1 from public.notifications') = 0, 'notificação de projeto que a pessoa perdeu não aparece';
  assert (public.pj_my_context(org) ->> 'unread_notifications')::integer = 0, 'contador de não lidas ignora projeto perdido';
  raise notice 'PASS: projeto perdido não vaza notificação (6)';
end $$;
reset role;
:as_m
select public.pj_add_member(test.t('org'), test.t('p'), 'ffffffff-0000-4000-8000-0000000000a3', 'editor');
reset role;

-- ===================================================================== (7) quadro: etapas, ordem, limites
:as_m
do $$
declare org uuid := test.t('org'); pb uuid; bv integer; ids uuid[]; i integer; ta uuid; tb uuid; tc uuid; td uuid; backlog uuid; af uuid;
begin
  pb := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Quadro', 'status', 'active')) ->> 'id')::uuid; perform set_config('t.pb', pb::text, true);
  af := test.col(pb, 'todo');
  bv := test.bv(pb);
  backlog := public.pj_add_column(org, pb, bv, 'Backlog', 'todo');
  assert test.bv(pb) = bv + 1, 'criar etapa sobe a versão do quadro';
  perform public.pj_rename_column(org, pb, backlog, 'Fila');
  assert (select semantic_status from public.project_columns where id = backlog) = 'todo' and (select name from public.project_columns where id = backlog) = 'Fila', 'renomear não muda o tipo';
  perform public.pj_rename_column(org, pb, test.col(pb, 'in_progress'), 'Fazendo');
  assert (select semantic_status from public.project_columns where id = test.col(pb, 'in_progress')) = 'in_progress', 'renomear etapa de andamento mantém o tipo';
  select array_agg(id order by position) into ids from public.project_columns where project_id = pb;
  perform test.has(test.errmsg(format($q$select public.pj_reorder_columns(%L, %L, null, %L::uuid[])$q$, org, pb, array[ids[1], ids[1], ids[3], ids[4], ids[5]])), '%ordem das etapas inválida%', 'etapa repetida na ordem');
  perform test.has(test.errmsg(format($q$select public.pj_reorder_columns(%L, %L, null, %L::uuid[])$q$, org, pb, array[ids[1], ids[2], ids[3], ids[4], test.col(test.t('p'), 'todo')])), '%ordem das etapas inválida%', 'etapa de outro projeto na ordem');
  bv := test.bv(pb);
  perform public.pj_reorder_columns(org, pb, bv, array[ids[5], ids[4], ids[3], ids[2], ids[1]]);
  assert test.bv(pb) = bv + 1, 'reordenar sobe a versão do quadro';
  perform public.pj_reorder_columns(org, pb, test.bv(pb), ids);
  ta := test.mk(org, pb, 'A um', jsonb_build_object('column_id', af)); tb := test.mk(org, pb, 'A dois', jsonb_build_object('column_id', af));
  tc := test.mk(org, pb, 'Fila um', jsonb_build_object('column_id', backlog)); td := test.mk(org, pb, 'Fila dois', jsonb_build_object('column_id', backlog));
  perform public.pj_archive_task(org, td, test.tv(td), 'Não vai mais ser feita');
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, null, %L, null)$q$, org, pb, backlog)), '%escolha para qual etapa%', 'etapa ocupada exige destino');
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, null, %L, %L)$q$, org, pb, backlog, test.col(pb, 'review'))), '%mesmo tipo%', 'destino de outro tipo');
  perform test.has(test.errmsg(format($q$select public.pj_delete_column(%L, %L, null, %L, %L)$q$, org, pb, backlog, backlog)), '%destino inválida%', 'destino não pode ser a própria etapa');
  perform public.pj_delete_column(org, pb, null, backlog, af);
  assert (select column_id from public.tasks where id = tc) = af and (select position from public.tasks where id = tc) = 3, 'a tarefa realocada vai para o fim da etapa de destino';
  assert (select column_id from public.tasks where id = td) = af, 'a tarefa arquivada também muda de etapa';
  assert (select array_agg(position order by position) from public.project_columns where project_id = pb) = array[1, 2, 3, 4], 'posições das etapas renumeradas';
  for i in 5..12 loop perform public.pj_add_column(org, pb, null, 'Etapa ' || i, 'in_progress'); end loop;
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, null, 'Etapa 13', 'in_progress')$q$, org, pb)), '%até 12 etapas%', 'limite de etapas');
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, null, 'Tipo ruim', 'qualquer')$q$, org, pb)), '%tipo de etapa inválido%', 'tipo de etapa inválido');
  for i in 1..39 loop perform public.pj_save_label(org, pb, null, 'Etiqueta ' || i, '#0a0b0c'); end loop;
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, null, 'Cor ruim', 'vermelho')$q$, org, pb)), '%cor inválida%', 'cor inválida');
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, null, 'Etiqueta 1', '#0a0b0c')$q$, org, pb)), '%já existe uma etiqueta%', 'nome repetido');
  perform public.pj_save_label(org, pb, null, 'Etiqueta 40', '#0a0b0c');
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, null, 'Etiqueta 41', '#0a0b0c')$q$, org, pb)), '%até 40 etiquetas%', 'limite de etiquetas');
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, null, 'Num projeto cancelado', '#0a0b0c')$q$, org, test.t('px'))), '%não aceita alterações%', 'projeto cancelado não recebe etiqueta');
  raise notice 'PASS: etapas e etiquetas — ordem, realocação e limites (7)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); l2 uuid;
begin
  l2 := public.pj_save_label(org, p, null, 'Etiqueta do editor', '#0a0b0c');
  perform test.has(test.errmsg(format($q$select public.pj_save_label(%L, %L, %L, 'Renomeada', '#0a0b0c')$q$, org, p, l2)), '%sem permissão%', 'editor cria mas não edita etiqueta');
  perform test.has(test.errmsg(format($q$select public.pj_delete_label(%L, %L, %L)$q$, org, p, l2)), '%sem permissão%', 'editor não remove etiqueta');
  raise notice 'PASS: etiquetas — criar é do editor, editar e remover são da liderança (7)';
end $$;
reset role;
:as_lead
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); l uuid := test.t('l'); t1 uuid := test.t('t1');
begin
  assert test.count(format('select 1 from public.task_labels where label_id = %L', l)) = 1, 'a etiqueta está numa tarefa';
  perform public.pj_delete_label(org, p, l);
  assert test.count(format('select 1 from public.task_labels where task_id = %L', t1)) = 0, 'remover a etiqueta a tira das tarefas';
  raise notice 'PASS: remover etiqueta limpa as tarefas (7)';
end $$;
reset role;

-- ===================================================================== (8) leitor do projeto: nenhuma escrita em tarefa passa (cada função tem a sua própria recusa)
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t1 uuid := test.t('t1'); item uuid;
begin
  item := public.pj_add_checklist_item(org, t1, 'Item de teste', false); perform set_config('t.item', item::text, true);
  raise notice 'PASS: item de checklist preparado (8)';
end $$;
reset role;
:as_rd
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t1 uuid := test.t('t1'); item uuid := test.t('item'); q text;
begin
  foreach q in array array[
    format($q$select public.pj_update_task(%L, %L, null, '{"title":"Invasão"}')$q$, org, t1),
    format($q$select public.pj_assign_task(%L, %L, null, null)$q$, org, t1),
    format($q$select public.pj_set_blocked(%L, %L, null, 'Motivo qualquer')$q$, org, t1),
    format($q$select public.pj_set_task_labels(%L, %L, '{}')$q$, org, t1),
    format($q$select public.pj_add_checklist_item(%L, %L, 'Novo item')$q$, org, t1),
    format($q$select public.pj_toggle_checklist_item(%L, %L, true)$q$, org, item),
    format($q$select public.pj_remove_checklist_item(%L, %L)$q$, org, item),
    format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), 'Comentário do leitor')$q$, org, t1),
    format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), '[]'::jsonb)$q$, org, t1),
    format($q$select public.pj_move_task(%L, %L, %L)$q$, org, t1, test.col(p, 'in_progress')),
    format($q$select public.pj_archive_task(%L, %L, null, 'Quero arquivar')$q$, org, t1)] loop
    perform test.has(test.errmsg(q), '%sem permissão%', 'leitor não escreve: ' || left(q, 60));
  end loop;
  raise notice 'PASS: o leitor do projeto não escreve em nenhuma função de tarefa (8)';
end $$;
reset role;

-- ===================================================================== (9) tarefas: criação, datas, impedimento, etiquetas, checklist, ordem do quadro e avisos
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); l uuid := 'ffffffff-0000-4000-8000-0000000000a2'; pp uuid; tn uuid; r jsonb; n bigint; v integer; ba text; i integer; t5 uuid; t6 uuid; t7 uuid; item uuid; lab uuid;
begin
  -- projeto planejado: criar já «em andamento» exige projeto ativo
  pp := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Ainda planejado')) ->> 'id')::uuid;
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Já andando', 'column_id', %L))$q$, org, pp, test.col(pp, 'in_progress'))), '%só é possível criar tarefas em andamento%', 'planejado não cria tarefa em andamento');
  assert test.mk(org, pp, 'Preparação', jsonb_build_object('column_id', test.col(pp, 'todo'))) is not null, 'planejado cria tarefa em «A fazer»';
  -- limites de criação
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Muitas etiquetas', 'label_ids', (select jsonb_agg(gen_random_uuid()) from generate_series(1, 11))))$q$, org, p)), '%até 10 etiquetas%', 'limite de etiquetas na criação');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Checklist enorme', 'checklist', (select jsonb_agg(jsonb_build_object('title', 'i' || g)) from generate_series(1, 51) g)))$q$, org, p)), '%até 50 itens%', 'limite do checklist na criação');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Prioridade ruim', 'priority', 'altíssima'))$q$, org, p)), '%prioridade inválida%', 'prioridade inválida');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Datas', 'start_date', '2026-05-10', 'due_date', '2026-05-01'))$q$, org, p)), '%data de início não pode ser depois%', 'datas invertidas na tarefa');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Responsável ruim', 'assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a4'))$q$, org, p)), '%responsável inválido%', 'leitor não pode ser responsável');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Etapa de outro', 'column_id', %L))$q$, org, p, test.col(pp, 'todo'))), '%etapa inválida%', 'etapa de outro projeto');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Já concluída', 'column_id', %L))$q$, org, p, test.col(p, 'done'))), '%etapa concluída%', 'não nasce concluída');
  -- avisos de planejamento e aviso ao responsável
  r := public.pj_create_task(org, p, gen_random_uuid(), jsonb_build_object('title', 'Fora do período', 'assignee_user_id', l, 'due_date', '2026-07-15'));
  tn := (r ->> 'id')::uuid;
  assert (r -> 'warnings')::text like '%vencimento%', 'vencimento fora do período avisa';
  assert test.notif(l, tn, 'task_assigned') = 1, 'responsável é avisado na criação';
  assert test.tev(tn, 'assignee_changed') = 1, 'evento de atribuição na criação';
  r := public.pj_update_task(org, tn, test.tv(tn), '{"due_date":"2026-09-30"}');
  assert (r -> 'warnings')::text like '%vencimento%', 'edição também avisa';
  r := public.pj_update_task(org, tn, test.tv(tn), '{"due_date":"2026-06-10","start_date":"2026-06-01"}');
  assert (r -> 'warnings')::text = '[]', 'dentro do período não avisa';
  -- atribuição repetida não gera evento nem aviso
  n := test.tev(tn, 'assignee_changed');
  perform public.pj_assign_task(org, tn, test.tv(tn), l);
  assert test.tev(tn, 'assignee_changed') = n, 'atribuir à mesma pessoa não grava evento';
  -- impedimento
  t5 := test.mk(org, p, 'Tarefa com impedimento');
  perform test.has(test.errmsg(format($q$select public.pj_set_blocked(%L, %L, null, 'ab')$q$, org, t5)), '%mínimo 3 caracteres%', 'motivo do impedimento curto');
  n := test.tev(t5, 'task_unblocked');
  perform public.pj_set_blocked(org, t5, test.tv(t5), null);
  assert test.tev(t5, 'task_unblocked') = n, 'desbloquear quem não está bloqueada não grava evento';
  perform public.pj_set_blocked(org, t5, test.tv(t5), 'Aguardando o cliente');
  ba := test.txt(format('select blocked_at::text from public.tasks where id = %L', t5));
  n := test.tev(t5, 'task_blocked');
  perform public.pj_set_blocked(org, t5, test.tv(t5), 'Aguardando o cliente');
  assert test.tev(t5, 'task_blocked') = n, 'mesmo motivo não grava evento';
  perform public.pj_set_blocked(org, t5, test.tv(t5), 'Aguardando outra informação');
  assert test.txt(format('select blocked_at::text from public.tasks where id = %L', t5)) = ba, 'atualizar o motivo mantém a data original do impedimento';
  perform public.pj_move_task(org, t5, test.col(p, 'done'), null, null);
  perform test.has(test.errmsg(format($q$select public.pj_set_blocked(%L, %L, null, 'Tarde demais')$q$, org, t5)), '%concluída não pode ser bloqueada%', 'tarefa concluída não bloqueia');
  -- etiquetas da tarefa
  perform test.has(test.errmsg(format($q$select public.pj_set_task_labels(%L, %L, (select array_agg(gen_random_uuid()) from generate_series(1, 11)))$q$, org, tn)), '%até 10 etiquetas%', 'limite de etiquetas por tarefa');
  lab := public.pj_save_label(org, p, null, 'Para remover', '#aabbcc');
  perform public.pj_set_task_labels(org, tn, array[lab]);
  assert test.count(format('select 1 from public.task_labels where task_id = %L', tn)) = 1, 'etiqueta aplicada';
  perform public.pj_set_task_labels(org, tn, '{}');
  assert test.count(format('select 1 from public.task_labels where task_id = %L', tn)) = 0, 'etiqueta removida da tarefa';
  -- checklist
  t6 := test.mk(org, p, 'Checklist em teste');
  item := public.pj_add_checklist_item(org, t6, 'Item obrigatório', true);
  perform public.pj_toggle_checklist_item(org, item, true);
  perform public.pj_toggle_checklist_item(org, item, true);
  assert test.tev(t6, 'checklist_item_completed') = 1, 'marcar duas vezes grava um único evento';
  perform public.pj_toggle_checklist_item(org, item, false);
  assert test.tev(t6, 'checklist_item_reopened') = 1, 'desmarcar grava evento e limpa quem concluiu';
  perform public.pj_remove_checklist_item(org, item);
  t7 := test.mk(org, p, 'Checklist cheio');
  for i in 1..50 loop perform public.pj_add_checklist_item(org, t7, 'Item ' || i, false); end loop;
  perform test.has(test.errmsg(format($q$select public.pj_add_checklist_item(%L, %L, 'Item 51')$q$, org, t7)), '%até 50 itens%', 'limite do checklist');
  perform set_config('t.t6', t6::text, true);
  raise notice 'PASS: criação, datas, impedimento, etiquetas e checklist (9)';
end $$;
reset role;
:as_x
do $$
declare item uuid := test.t('item');
begin
  perform test.has(test.errmsg(format($q$select public.pj_toggle_checklist_item(%L, %L, true)$q$, test.t('orgb'), item)), '%item não encontrado%', 'item de outra empresa');
  perform test.has(test.errmsg(format($q$select public.pj_remove_checklist_item(%L, %L)$q$, test.t('orgb'), item)), '%item não encontrado%', 'item de outra empresa não se remove');
  raise notice 'PASS: checklist de outra empresa (9)';
end $$;
reset role;

-- ===================================================================== (10) ordem do quadro, reabertura e avisos
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); t1 uuid := test.t('t1'); t2 uuid := test.t('t2'); t3 uuid := test.t('t3'); t4 uuid := test.t('t4'); todo uuid := test.col(test.t('p'), 'todo'); v2 integer; v3 integer;
begin
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, %L)$q$, org, t3, todo, t3)), '%posição de referência inválida%', 'não se põe a tarefa antes dela mesma');
  perform public.pj_archive_task(org, t4, test.tv(t4), 'Não será mais feita');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, %L)$q$, org, t3, todo, t4)), '%posição de referência inválida%', 'não se referencia tarefa arquivada');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L)$q$, org, t4, todo)), '%arquivada é somente para consulta%', 'tarefa arquivada não se move');
  v2 := test.tv(t2); v3 := test.tv(t3);
  perform public.pj_move_task(org, t1, todo, null, null);
  assert test.tv(t2) = v2 and test.tv(t3) = v3, 'mudar só a posição não sobe a versão das outras tarefas';
  assert (select position from public.tasks where id = t1) = (select count(*) from public.tasks where column_id = todo and archived_at is null), 'sem referência a tarefa vai para o fim da etapa';
  assert (select position from public.tasks where id = t2) = 1, 'a primeira passa a ser a segunda tarefa';
  perform test.has(test.errmsg(format($q$select public.pj_set_task_labels(%L, %L, '{}')$q$, org, t4)), '%não aceita alterações%', 'tarefa arquivada não muda etiquetas');
  perform test.has(test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), 'Comentário em arquivada')$q$, org, t4)), '%arquivada é somente para consulta%', 'tarefa arquivada não recebe comentário');
  raise notice 'PASS: ordem do quadro (10)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); tr uuid;
begin
  tr := test.mk(org, p, 'Para reabrir', jsonb_build_object('assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a2')); perform set_config('t.tr', tr::text, true);
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); tr uuid := test.t('tr'); done_at text;
begin
  perform public.pj_move_task(org, tr, test.col(p, 'done'), null, null);
  assert test.tev(tr, 'task_completed') = 1, 'evento de conclusão';
  done_at := test.txt(format('select completed_at::text from public.tasks where id = %L', tr));
  perform public.pj_update_task(org, tr, test.tv(tr), '{"title":"Para reabrir (concluída)"}');
  assert test.txt(format('select completed_at::text from public.tasks where id = %L', tr)) = done_at, 'editar tarefa concluída mantém a data de conclusão';
  perform public.pj_move_task(org, tr, test.col(p, 'todo'), null, null);
  assert test.tev(tr, 'task_reopened') = 1, 'evento de reabertura';
  assert test.notif('ffffffff-0000-4000-8000-0000000000a2', tr, 'task_reopened') = 1, 'o responsável é avisado da reabertura';
  assert test.notif('ffffffff-0000-4000-8000-0000000000a3', tr, 'task_reopened') = 1, 'quem criou a tarefa também é avisado da reabertura';
  perform public.pj_add_comment(org, tr, gen_random_uuid(), 'Comentário na tarefa reaberta');
  assert test.notif('ffffffff-0000-4000-8000-0000000000a3', tr, 'task_comment') = 1 and test.notif('ffffffff-0000-4000-8000-0000000000a2', tr, 'task_comment') = 1, 'comentário avisa responsável e autor da tarefa';
  raise notice 'PASS: reabertura avisa responsável e autor (10)';
end $$;
reset role;

-- ===================================================================== (11) comentários, anexos e notificações
:as_lead
do $$
declare org uuid := test.t('org'); t1 uuid := test.t('t1'); i integer; failed integer := 0; msg text;
begin
  for i in 1..130 loop
    msg := test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), %L)$q$, org, t1, 'Comentário ' || i));
    if msg is not null then failed := i; exit; end if;
  end loop;
  assert failed > 100 and failed <= 125, 'o limite de comentários por janela trava depois de ~120 (travou no ' || failed || ')';
  perform test.has(msg, '%Muitas tentativas%', 'mensagem do limite de comentários');
  raise notice 'PASS: limite de comentários (11)';
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); ta uuid; tb uuid; i integer; idem uuid := gen_random_uuid(); files jsonb; n integer;
begin
  ta := test.mk(org, p, 'Com muitos anexos'); tb := test.mk(org, p, 'Anexo idempotente');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), (select jsonb_agg(jsonb_build_object('path', %L || '/' || %L || '/' || md5(g::text) || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'a.pdf')) from generate_series(1, 6) g))$q$, org, ta, org::text, ta::text)), '%até 5 arquivos%', 'até 5 arquivos por envio');
  for i in 1..12 loop
    perform public.pj_add_attachments(org, ta, gen_random_uuid(), (select jsonb_agg(jsonb_build_object('path', org::text || '/' || ta::text || '/' || md5(i::text || g::text) || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'a.pdf')) from generate_series(1, 5) g));
  end loop;
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('x') || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'a.pdf')))$q$, org, ta, org::text, ta::text)), '%limite de arquivos%', 'limite de arquivos por tarefa');
  files := jsonb_build_array(jsonb_build_object('path', org::text || '/' || tb::text || '/' || md5('y') || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'b.pdf'));
  assert public.pj_add_attachments(org, tb, idem, files) = 1, 'primeiro envio';
  assert public.pj_add_attachments(org, tb, idem, files) = 1, 'o mesmo envio repetido devolve o mesmo resultado';
  assert test.cnt(format('select count(*) from public.task_attachments where task_id = %L', tb)) = 1, 'duplo envio não duplica o anexo';
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('z') || '.exe', 'mime', 'application/pdf', 'size', 100, 'filename', 'c.pdf')))$q$, org, tb, org::text, tb::text)), '%arquivo inválido%', 'extensão fora da lista');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('w') || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'c.pdf')))$q$, org, tb, org::text, ta::text)), '%arquivo inválido%', 'caminho de outra tarefa');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('v') || '.pdf', 'mime', 'application/zip', 'size', 100, 'filename', 'c.pdf')))$q$, org, tb, org::text, tb::text)), '%tipo de arquivo não permitido%', 'tipo fora da lista');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('u') || '.pdf', 'mime', 'text/plain', 'size', 100, 'filename', 'c.pdf')))$q$, org, tb, org::text, tb::text)), '%arquivo inválido%', 'tipo e extensão precisam combinar');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('t') || '.pdf', 'mime', 'application/pdf', 'size', 0, 'filename', 'c.pdf')))$q$, org, tb, org::text, tb::text)), '%tamanho máximo%', 'arquivo vazio');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L || '/' || %L || '/' || md5('s') || '.pdf', 'mime', 'application/pdf', 'size', 99999999, 'filename', 'c.pdf')))$q$, org, tb, org::text, tb::text)), '%tamanho máximo%', 'arquivo grande demais');
  assert public.pj_attachment_info(org, (select id from public.task_attachments where task_id = tb limit 1)) ->> 'name' = 'b.pdf', 'quem vê o projeto obtém o caminho do anexo';
  raise notice 'PASS: anexos — limites, validações e idempotência (11)';
end $$;
reset role;
:as_x
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_attachment_info(%L, %L)$q$, test.t('orgb'), (select id from public.task_attachments limit 1))), '%arquivo não encontrado%', 'anexo de outra empresa');
  raise notice 'PASS: anexo de outra empresa (11)';
end $$;
reset role;
:as_out
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_attachment_info(%L, %L)$q$, test.t('org'), (select id from public.task_attachments limit 1))), '%arquivo não encontrado%', 'anexo de projeto que não vejo');
  raise notice 'PASS: anexo de projeto inacessível (11)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org'); l uuid := 'ffffffff-0000-4000-8000-0000000000a2'; nid uuid; before bigint; after bigint;
begin
  nid := test.txt(format('select id::text from public.notifications where user_id = %L and read_at is null limit 1', l))::uuid;
  before := test.cnt(format('select count(*) from public.notifications where user_id = %L and read_at is null', l));
  perform public.pj_mark_notification_read(org, nid);
  perform public.pj_mark_all_notifications_read(org);
  after := test.cnt(format('select count(*) from public.notifications where user_id = %L and read_at is null', l));
  assert before > 0 and after = before, 'marcar como lida só afeta as próprias notificações';
  raise notice 'PASS: notificações lidas só as próprias (11)';
end $$;
reset role;

-- ===================================================================== (12) painel, exportação e saída da empresa
:as_m
do $$
declare org uuid := test.t('org'); pd uuid; td1 uuid; td2 uuid; d jsonb; n bigint; i integer; msg text;
begin
  pd := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Para o painel', 'status', 'active')) ->> 'id')::uuid;
  td1 := test.mk(org, pd, 'Urgente concluída', jsonb_build_object('priority', 'urgent'));
  td2 := test.mk(org, pd, 'Bloqueada e concluída');
  perform public.pj_set_blocked(org, td2, test.tv(td2), 'Parado por falta de dado');
  perform public.pj_move_task(org, td1, test.col(pd, 'done'), null, null);
  perform public.pj_move_task(org, td2, test.col(pd, 'done'), null, null);
  d := public.pj_dashboard(org, current_date - 1, current_date + 1, pd);
  assert (d ->> 'completed_in_period')::integer = 2, 'duas concluídas no período';
  assert (d ->> 'blocked')::integer = 0, 'bloqueio só conta tarefa aberta';
  assert (d -> 'by_priority' ->> 'urgent')::integer = 0, 'prioridade só conta tarefa aberta';
  d := public.pj_dashboard(org, current_date - 1, current_date + 1, test.t('pc'));
  assert (d ->> 'completed_in_period')::integer = 0, 'projeto arquivado não entra nas concluídas do período';
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date, current_date - 1)$q$, org)), '%período inválido%', 'período invertido');
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date - 400, current_date)$q$, org)), '%período inválido%', 'período maior que 366 dias');
  perform test.has(test.errmsg(format($q$select public.pj_audit_export(%L, 'Tipo Inválido!', 3)$q$, org)), '%tipo de exportação inválido%', 'tipo de exportação');
  n := test.cnt(format($q$select count(*) from public.audit_log where organization_id = %L and action = 'export'$q$, org));
  perform public.pj_audit_export(org, 'tarefas', 5);
  assert test.cnt(format($q$select count(*) from public.audit_log where organization_id = %L and action = 'export'$q$, org)) = n + 1, 'exportação fica na auditoria';
  for i in 2..30 loop perform public.pj_audit_export(org, 'tarefas', 1); end loop;
  perform test.has(test.errmsg(format($q$select public.pj_audit_export(%L, 'tarefas', 1)$q$, org)), '%Muitas tentativas%', 'limite de exportações');
  raise notice 'PASS: painel, período e exportação (12)';
end $$;
reset role;
:as_vw
do $$
begin
  assert test.count('select 1 from public.projects') >= 2, 'leitor da empresa enxerga os projetos em que participa';
  raise notice 'PASS: leitor da empresa (12)';
end $$;
reset role;

-- tarefa arquivada não impede a saída do participante (só as abertas contam)
:as_m
do $$
declare org uuid := test.t('org'); p uuid := test.t('p'); ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; te uuid;
begin
  te := test.mk(org, p, 'Arquivada do editor', jsonb_build_object('assignee_user_id', ed));
  perform public.pj_archive_task(org, te, test.tv(te), 'Não será mais feita');
  assert public.pj_remove_member(org, p, ed, null) = 0, 'sem tarefas abertas nada a tratar';
  perform public.pj_add_member(org, p, ed, 'editor');
  raise notice 'PASS: tarefa arquivada não trava a saída do participante (12)';
end $$;
reset role;

-- saída da empresa: some das participações, inclusive de projeto concluído/arquivado (a cascata não pode travar)
do $$
declare org uuid := test.t('org'); vw uuid := 'ffffffff-0000-4000-8000-0000000000a6'; ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; t8 uuid;
begin
  assert test.cnt(format('select count(*) from public.project_members where user_id = %L', vw)) >= 2, 'o leitor participa de projetos, um deles concluído e arquivado';
  perform test.sql(format('delete from public.organization_members where organization_id = %L and user_id = %L', org, vw));
  assert test.cnt(format('select count(*) from public.project_members where user_id = %L', vw)) = 0, 'sair da empresa tira as participações';
  -- mudar o papel na empresa para algo que NÃO é «Leitor» não mexe nas tarefas
  t8 := (select id from public.tasks where project_id = test.t('p') and title = 'Tarefa do editor');
  perform test.sql(format($q$update public.tasks set assignee_user_id = %L where id = %L$q$, ed, t8));
  perform test.sql(format($q$update public.organization_members set role = 'admin' where organization_id = %L and user_id = %L$q$, org, ed));
  assert (select assignee_user_id from public.tasks where id = t8) = ed, 'virar administrador mantém as tarefas atribuídas';
  raise notice 'PASS: saída da empresa e mudança de papel (12)';
end $$;

rollback;
