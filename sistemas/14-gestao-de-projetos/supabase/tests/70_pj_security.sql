-- Gestão de Projetos e Tarefas — segurança: isolamento entre empresas nos dois sentidos, RPCs que recusam ids de outra empresa ou de projeto alheio, chaves compostas, escrita direta negada,
-- MFA nas funções, privilégios das funções (sem portas públicas), auditoria sem valores pessoais, acesso a anexos e ausência de escalada de privilégio.

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
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.col(p uuid, sem text) returns uuid language sql security definer set search_path = '' as $$ select id from public.project_columns where project_id = p and semantic_status = sem order by position limit 1 $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a5', 'out@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c0', 'x@t.invalid');

-- ===================================================================== (1) duas empresas, cada uma com projeto, tarefa, etiqueta e anexo
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
do $$
begin
  perform set_config('t.b', public.create_organization('Empresa B', 'empresa-b')::text, true);
end $$;
reset role;

create function test.seed(org uuid, tag text, member uuid) returns void language plpgsql as $$
declare p uuid; t uuid; l uuid; path text;
begin
  p := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Projeto ' || tag, 'status', 'active', 'members',
    case when member is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('user_id', member, 'role', 'editor')) end)) ->> 'id')::uuid;
  l := public.pj_save_label(org, p, null, 'Etiqueta ' || tag, '#112233');
  t := (public.pj_create_task(org, p, gen_random_uuid(), jsonb_build_object('title', 'Tarefa ' || tag, 'label_ids', jsonb_build_array(l), 'checklist', jsonb_build_array(jsonb_build_object('title', 'Item ' || tag, 'required', true)))) ->> 'id')::uuid;
  perform public.pj_add_comment(org, t, gen_random_uuid(), 'Comentário secreto ' || tag);
  path := org::text || '/' || t::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf';
  perform public.pj_add_attachments(org, t, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', path, 'mime', 'application/pdf', 'size', 1234, 'filename', 'segredo-' || tag || '.pdf')));
  perform set_config('t.p_' || tag, p::text, true); perform set_config('t.t_' || tag, t::text, true); perform set_config('t.l_' || tag, l::text, true);
  perform set_config('t.att_' || tag, (select id::text from public.task_attachments where task_id = t), true);
end $$;
grant execute on function test.seed(uuid, text, uuid) to authenticated;

:as_m
select test.seed(test.t('a'), 'A', 'ffffffff-0000-4000-8000-0000000000a3');
reset role;
:as_x
select test.seed(test.t('b'), 'B', null);
reset role;

-- ===================================================================== (2) leitura isolada nos dois sentidos
:as_x
do $$
declare t text; n bigint;
begin
  foreach t in array array['pj_settings', 'projects', 'project_members', 'project_columns', 'project_labels', 'tasks', 'task_labels', 'task_checklist_items', 'task_comments', 'task_attachments',
    'project_events', 'task_events', 'notifications'] loop
    execute format('select count(*) from public.%I where organization_id = %L', t, test.t('a')) into n;
    assert n = 0, 'empresa B enxerga linhas da A em ' || t;
  end loop;
  assert test.count('select 1 from public.projects') = 1 and test.count('select 1 from public.tasks') = 1, 'B só enxerga o que é dela';
  raise notice 'PASS: B não lê nenhuma tabela da A (2)';
end $$;
reset role;
:as_o
do $$
declare t text; n bigint;
begin
  foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'task_events', 'project_events'] loop
    execute format('select count(*) from public.%I where organization_id = %L', t, test.t('b')) into n;
    assert n = 0, 'empresa A enxerga linhas da B em ' || t;
  end loop;
  raise notice 'PASS: A não lê nenhuma tabela da B (2)';
end $$;
reset role;

-- ===================================================================== (3) RPCs: ids de outra empresa e de projeto alheio nunca funcionam
:as_x
do $$
declare b uuid := test.t('b'); a uuid := test.t('a');
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Invasão"}')$q$, a)), '%sem permissão%', 'B não cria projeto na A');
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date - 1, current_date)$q$, a)), '%sem permissão%', 'B não vê painel da A');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Invasão"}')$q$, b, test.t('p_A'))), '%projeto não encontrado%', 'tarefa em projeto da A usando a empresa B');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), '{"title":"Invasão"}')$q$, a, test.t('p_A'))), '%sem permissão%', 'tarefa em projeto da A usando a empresa A');
  perform test.has(test.errmsg(format($q$select public.pj_update_task(%L, %L, 1, '{"title":"Invasão"}')$q$, b, test.t('t_A'))), '%tarefa não encontrada%', 'editar tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_assign_task(%L, %L, 1, null)$q$, b, test.t('t_A'))), '%tarefa não encontrada%', 'atribuir tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, b, test.t('t_A'), test.col(test.t('p_A'), 'in_progress'))), '%tarefa não encontrada%', 'mover tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, b, test.t('t_B'), test.col(test.t('p_A'), 'in_progress'))), '%etapa de destino inválida%', 'mover tarefa da B para etapa da A');
  perform test.has(test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), 'invasão')$q$, b, test.t('t_A'))), '%tarefa não encontrada%', 'comentar tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_set_blocked(%L, %L, 1, 'invasão')$q$, b, test.t('t_A'))), '%tarefa não encontrada%', 'bloquear tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_archive_task(%L, %L, 1, 'invasão')$q$, b, test.t('t_A'))), '%tarefa não encontrada%', 'arquivar tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_set_project_status(%L, %L, 1, 'cancelled', 'invasão aqui')$q$, b, test.t('p_A'))), '%projeto não encontrado%', 'cancelar projeto da A');
  perform test.has(test.errmsg(format($q$select public.pj_add_member(%L, %L, 'ffffffff-0000-4000-8000-0000000000c0', 'editor')$q$, b, test.t('p_A'))), '%projeto não encontrado%', 'entrar em projeto da A');
  perform test.has(test.errmsg(format($q$select public.pj_add_column(%L, %L, null, 'Invasão', 'todo')$q$, b, test.t('p_A'))), '%projeto não encontrado%', 'etapa em projeto da A');
  perform test.has(test.errmsg(format($q$select public.pj_set_task_labels(%L, %L, array[%L::uuid])$q$, b, test.t('t_B'), test.t('l_A'))), '%etiqueta inválida%', 'etiqueta da A em tarefa da B');
  perform test.has(test.errmsg(format($q$select public.pj_attachment_info(%L, %L)$q$, b, test.t('att_A'))), '%arquivo não encontrado%', 'URL de anexo da A');
  perform test.has(test.errmsg(format($q$select public.pj_toggle_checklist_item(%L, (select id from public.task_checklist_items where task_id = %L limit 1), true)$q$, b, test.t('t_A'))), '%item não encontrado%', 'checklist da A');
  perform test.has(test.errmsg(format($q$select public.pj_add_attachments(%L, %L, gen_random_uuid(), jsonb_build_array(jsonb_build_object('path', %L, 'mime', 'application/pdf', 'size', 10, 'filename', 'x.pdf')))$q$, b, test.t('t_A'),
    test.t('a')::text || '/' || test.t('t_A')::text || '/' || repeat('a', 32) || '.pdf')), '%tarefa não encontrada%', 'anexo em tarefa da A');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Cruzada', 'label_ids', jsonb_build_array(%L::uuid)))$q$, b, test.t('p_B'), test.t('l_A'))), '%etiqueta inválida%', 'etiqueta da A em tarefa nova da B');
  perform test.has(test.errmsg(format($q$select public.pj_create_task(%L, %L, gen_random_uuid(), jsonb_build_object('title', 'Cruzada', 'assignee_user_id', 'ffffffff-0000-4000-8000-0000000000a3'))$q$, b, test.t('p_B'))), '%responsável inválido%', 'responsável da A em tarefa da B');
  perform test.has(test.errmsg(format($q$select public.pj_people(%L)$q$, a)), '%sem permissão%', 'lista de pessoas da A');
  raise notice 'PASS: nenhuma RPC aceita ids de outra empresa (3)';
end $$;
reset role;

-- colaborador de FORA do projeto (mesma empresa): também nada
:as_out
do $$
declare a uuid := test.t('a');
begin
  perform test.has(test.errmsg(format($q$select public.pj_update_task(%L, %L, 1, '{"title":"Invasão"}')$q$, a, test.t('t_A'))), '%tarefa não encontrada%', 'não participa: editar');
  perform test.has(test.errmsg(format($q$select public.pj_move_task(%L, %L, %L, null, null)$q$, a, test.t('t_A'), test.col(test.t('p_A'), 'in_progress'))), '%não encontrad%', 'não participa: mover');
  perform test.has(test.errmsg(format($q$select public.pj_add_comment(%L, %L, gen_random_uuid(), 'invasão')$q$, a, test.t('t_A'))), '%tarefa não encontrada%', 'não participa: comentar');
  perform test.has(test.errmsg(format($q$select public.pj_attachment_info(%L, %L)$q$, a, test.t('att_A'))), '%arquivo não encontrado%', 'não participa: baixar anexo');
  perform test.has(test.errmsg(format($q$select public.pj_dashboard(%L, current_date - 1, current_date, %L)$q$, a, test.t('p_A'))), '%projeto não encontrado%', 'não participa: painel do projeto');
  assert test.count('select 1 from public.task_comments') = 0 and test.count('select 1 from public.task_attachments') = 0 and test.count('select 1 from public.task_events') = 0, 'não lê comentários, anexos nem histórico';
  assert not private.pj_can_see_task(a, test.t('t_A')) and not private.pj_can_edit_task(a, test.t('t_A')), 'as funções de política do Storage negam';
  perform test.has(test.errmsg(format($q$select public.pj_people(%L)$q$, a)), '%sem permissão%', 'colaborador comum não lista pessoas');
  raise notice 'PASS: quem não participa do projeto não lê nem age (3)';
end $$;
reset role;

:as_ed
do $$
declare a uuid := test.t('a');
begin
  assert private.pj_can_see_task(a, test.t('t_A')) and private.pj_can_edit_task(a, test.t('t_A')), 'participante editor passa nas políticas do Storage';
  assert public.pj_attachment_info(a, test.t('att_A')) ->> 'name' = 'segredo-A.pdf', 'participante obtém a informação do anexo';
  assert public.pj_project_people(a, test.t('p_A')) is not null, 'lista de nomes do próprio projeto';
  perform test.has(test.errmsg(format($q$select public.pj_project_people(%L, %L)$q$, test.t('b'), test.t('p_B'))), '%sem permissão%', 'e não de outra empresa');
  raise notice 'PASS: acesso a anexos depende do acesso ao projeto (3)';
end $$;
reset role;

-- ===================================================================== (4) chaves compostas: o banco recusa vínculos cruzados mesmo para quem escreve direto
do $$
declare a uuid := test.t('a'); b uuid := test.t('b'); p2 uuid;
begin
  perform test.has(test.errmsg(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position) values (%L, %L, 90, %L, 'Cruzada', 90)$q$, a, test.t('p_A'), test.col(test.t('p_B'), 'todo'))), '%foreign key%', 'tarefa com etapa de OUTRO projeto');
  perform test.has(test.errmsg(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position) values (%L, %L, 90, %L, 'Cruzada', 90)$q$, b, test.t('p_A'), test.col(test.t('p_A'), 'todo'))), '%foreign key%', 'tarefa da empresa B em projeto da A');
  perform test.has(test.errmsg(format($q$insert into public.task_labels (organization_id, project_id, task_id, label_id) values (%L, %L, %L, %L)$q$, b, test.t('p_B'), test.t('t_B'), test.t('l_A'))), '%foreign key%', 'etiqueta de outro projeto/empresa');
  perform test.has(test.errmsg(format($q$insert into public.project_members (organization_id, project_id, user_id, project_role) values (%L, %L, 'ffffffff-0000-4000-8000-0000000000a3', 'reader')$q$, b, test.t('p_B'))), '%foreign key%', 'participante que não é membro da empresa');
  perform test.has(test.errmsg(format($q$insert into public.task_comments (organization_id, task_id, author_user_id, body) values (%L, %L, null, 'x')$q$, b, test.t('t_A'))), '%foreign key%', 'comentário com empresa trocada');
  perform test.has(test.errmsg(format($q$insert into public.task_checklist_items (organization_id, task_id, title, position) values (%L, %L, 'x', 9)$q$, b, test.t('t_A'))), '%foreign key%', 'checklist com empresa trocada');
  perform test.has(test.errmsg(format($q$update public.tasks set assignee_user_id = 'ffffffff-0000-4000-8000-0000000000c0' where id = %L$q$, test.t('t_A'))), '%responsável inválido%', 'responsável de outra empresa (o gatilho recusa antes da chave composta)');
  perform test.has(test.errmsg(format($q$update public.tasks set organization_id = %L where id = %L$q$, b, test.t('t_A'))), '%organização do registro não pode mudar%', 'organização imutável (tarefa)');
  perform test.has(test.errmsg(format($q$update public.projects set organization_id = %L where id = %L$q$, b, test.t('p_A'))), '%organização do registro não pode mudar%', 'organização imutável (projeto)');
  -- tarefa de um projeto da MESMA empresa não pode apontar para etapa de outro projeto
  perform test.sql(format($q$insert into public.projects (id, organization_id, project_number, name, status) values ('eeeeeeee-0000-4000-8000-000000000001', %L, 99, 'Outro projeto da A', 'active')$q$, a));
  perform test.sql(format($q$insert into public.project_columns (id, organization_id, project_id, name, semantic_status, position) values ('eeeeeeee-0000-4000-8000-000000000002', %L, 'eeeeeeee-0000-4000-8000-000000000001', 'Col', 'todo', 1)$q$, a));
  perform test.has(test.errmsg(format($q$insert into public.tasks (organization_id, project_id, task_number, column_id, title, position) values (%L, %L, 91, 'eeeeeeee-0000-4000-8000-000000000002', 'Cruzada', 91)$q$, a, test.t('p_A'))), '%foreign key%', 'etapa de outro projeto da mesma empresa');
  raise notice 'PASS: chaves compostas e organização imutável (4)';
end $$;

-- ===================================================================== (5) nenhuma escrita direta, em nenhuma tabela, para ninguém (nem o proprietário)
:as_o
do $$
declare t text; col text;
begin
  foreach t in array array['pj_settings', 'projects', 'project_members', 'project_columns', 'project_labels', 'tasks', 'task_labels', 'task_checklist_items', 'task_comments', 'task_attachments',
    'project_events', 'task_events', 'notifications', 'project_number_counters', 'task_number_counters', 'mutation_requests', 'pj_rate_limits'] loop
    select attname into col from pg_attribute where attrelid = ('public.' || t)::regclass and attnum > 0 and not attisdropped and attgenerated = '' order by attnum desc limit 1;
    perform test.has(test.errmsg(format('insert into public.%I default values', t)), '%permission denied%', 'insert direto em ' || t);
    perform test.has(test.errmsg(format('update public.%I set %I = %I', t, col, col)), '%permission denied%', 'update direto em ' || t);
    perform test.has(test.errmsg(format('delete from public.%I', t)), '%permission denied%', 'delete direto em ' || t);
  end loop;
  foreach t in array array['project_number_counters', 'task_number_counters', 'mutation_requests', 'pj_rate_limits'] loop
    perform test.has(test.errmsg(format('select 1 from public.%I', t)), '%permission denied%', 'select direto em ' || t);
  end loop;
  perform test.has(test.errmsg('select storage_path from public.task_attachments'), '%permission denied%', 'caminho do storage não é legível pela API');
  raise notice 'PASS: escrita direta negada em todas as tabelas (5)';
end $$;
reset role;

-- ===================================================================== (6) MFA no banco: proprietário sem AAL2 não opera
:as_o_aal1
do $$
declare a uuid := test.t('a');
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Sem MFA"}')$q$, a)), '%verificação em duas etapas%', 'proprietário sem AAL2');
  perform test.has(test.errmsg(format($q$select public.pj_save_settings(%L, '{"primary_color":"#112233"}')$q$, a)), '%verificação em duas etapas%', 'configurações sem AAL2');
  raise notice 'PASS: MFA exigido também nas funções do sistema (6)';
end $$;
reset role;

-- ===================================================================== (7) funções: privilégios, search_path e nenhuma porta pública
do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'pj\_%' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  assert bad is null, 'SECURITY DEFINER sem search_path fixo: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like 'pj\_%' and has_function_privilege('anon', p.oid, 'execute');
  assert bad is null, 'anon executa função do sistema (este sistema não tem porta pública): ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname like 'pj\_%' and has_function_privilege('authenticated', p.oid, 'execute')
    and p.proname not in ('pj_role', 'pj_profile', 'pj_is_owner', 'pj_is_manager', 'pj_is_member', 'pj_project_role', 'pj_can_see_project', 'pj_can_edit_project', 'pj_can_lead_project', 'pj_can_edit_task', 'pj_can_see_task', 'pj_guard');
  assert bad is null, 'authenticated executa função interna: ' || coalesce(bad, '');
  select string_agg(p.oid::regprocedure::text, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'pj\_%' and not has_function_privilege('authenticated', p.oid, 'execute');
  assert bad is null, 'função do sistema sem EXECUTE para authenticated: ' || coalesce(bad, '');
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert bad is null, 'tabela sem RLS: ' || coalesce(bad, '');
  raise notice 'PASS: privilégios das funções, search_path fixo, sem portas públicas, RLS em tudo (7)';
end $$;

:as_anon
do $$
begin
  perform test.has(test.errmsg(format($q$select public.pj_create_project(%L, gen_random_uuid(), '{"name":"Anônimo"}')$q$, test.t('a'))), '%permission denied%', 'anon não cria projeto');
  perform test.has(test.errmsg('select 1 from public.projects'), '%permission denied%', 'anon não lê projetos');
  perform test.has(test.errmsg('select 1 from public.tasks'), '%permission denied%', 'anon não lê tarefas');
  perform test.has(test.errmsg(format($q$select public.pj_attachment_info(%L, %L)$q$, test.t('a'), test.t('att_A'))), '%permission denied%', 'anon não lê anexo');
  raise notice 'PASS: o anônimo não alcança nada do sistema (7)';
end $$;
reset role;

-- ===================================================================== (8) auditoria só com nomes de colunas (sem valores pessoais)
do $$
declare n bigint;
begin
  select count(*) into n from public.audit_log where entity in ('projects', 'project_members', 'project_columns') and (changes::text like '%Projeto A%' or changes::text like '%Comentário secreto%' or changes::text like '%segredo%');
  assert n = 0, 'auditoria não carrega valores';
  assert (select count(*) from public.audit_log where entity = 'projects' and organization_id = test.t('a')) >= 1, 'ações administrativas foram auditadas';
  assert (select count(*) from public.task_events where data::text like '%Comentário secreto%') = 0 and (select count(*) from public.project_events where data::text like '%Comentário secreto%') = 0, 'eventos não guardam texto de comentário';
  raise notice 'PASS: auditoria e histórico sem conteúdo desnecessário (8)';
end $$;

-- ===================================================================== (9) colaborador não escala privilégio
:as_ed
do $$
declare a uuid := test.t('a');
begin
  assert test.affected(format($q$update public.organization_members set role = 'owner' where organization_id = %L and user_id = auth.uid()$q$, a)) = 0, 'colaborador não se promove (RLS do Core)';
  assert test.count(format('select 1 from public.projects where id = %L', test.t('p_B'))) = 0, 'colaborador não vê projeto de outra empresa';
  perform test.has(test.errmsg(format($q$select public.pj_save_settings(%L, '{"primary_color":"#112233"}')$q$, a)), '%sem permissão%', 'colaborador não altera configurações');
  perform test.has(test.errmsg(format($q$select public.pj_set_logo(%L, 'x')$q$, a)), '%sem permissão%', 'colaborador não troca logotipo');
  perform test.has(test.errmsg(format($q$select public.pj_audit_export(%L, 'tarefas', 3)$q$, test.t('b'))), '%sem permissão%', 'não audita exportação de outra empresa');
  raise notice 'PASS: colaborador não escala privilégio (9)';
end $$;
reset role;

rollback;
