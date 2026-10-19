-- Gestão de Projetos e Tarefas — TAREFAS: criar, editar, atribuir, MOVER (Kanban persistente com trava por projeto e versão do quadro), impedimento, arquivar, etiquetas,
-- checklist, comentários, anexos e notificações. O status funcional da tarefa é a semântica da etapa onde ela está; nunca há um segundo campo de status.
-- Movimentação: o cliente envia a INTENÇÃO (tarefa, etapa de destino, tarefa de referência); o servidor autoriza, valida a versão do quadro, trava o projeto, recalcula posições 1..n e grava de uma vez.

begin;
set local check_function_bodies = off;

create function private.pj_priority_ok(p text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p not in ('low', 'normal', 'high', 'urgent') then raise exception 'prioridade inválida' using errcode = '22023'; end if;
  return p;
end $$;
revoke all on function private.pj_priority_ok(text) from public, anon, authenticated;

-- Avisos de planejamento (nunca ajustam datas em silêncio): datas fora do intervalo do projeto.
create function private.pj_date_warnings(p public.projects, p_start date, p_due date) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare w jsonb := '[]'::jsonb;
begin
  if p_start is not null and ((p.start_date is not null and p_start < p.start_date) or (p.due_date is not null and p_start > p.due_date)) then
    w := w || to_jsonb('A data de início está fora do período do projeto.'::text);
  end if;
  if p_due is not null and ((p.start_date is not null and p_due < p.start_date) or (p.due_date is not null and p_due > p.due_date)) then
    w := w || to_jsonb('O vencimento está fora do período do projeto.'::text);
  end if;
  return w;
end $$;
revoke all on function private.pj_date_warnings(public.projects, date, date) from public, anon, authenticated;

-- ======================================================================= criar
-- p: title, description, priority, assignee_user_id, start_date, due_date, column_id (padrão: primeira etapa «A fazer»), label_ids [], checklist [{title, required}]
create function public.pj_create_task(p_org uuid, p_project uuid, p_idem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); pr public.projects; ttl text; ds text; pri text; asg uuid; sd date; dd date; col public.project_columns; num bigint; tid uuid; prev jsonb; res jsonb; hash text;
  lbl uuid; item jsonb; pos integer := 0; warn jsonb;
begin
  perform private.pj_guard(p_org, 'member');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  pr := private.pj_load_project(p_org, p_project, true, null);
  perform private.pj_require(p_org, p_project, 'edit');
  perform private.pj_rate_hit('task:' || p_org::text || ':' || uid::text, 240, 600);
  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita novas tarefas (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  ttl := private.pj_req_text(p ->> 'title', 2, 200, 'Título'); ds := private.pj_opt_text(p ->> 'description', 8000, 'Descrição');
  pri := private.pj_priority_ok(coalesce(nullif(p ->> 'priority', ''), 'normal'));
  asg := nullif(p ->> 'assignee_user_id', '')::uuid;
  sd := private.pj_opt_date(p ->> 'start_date', 'Data de início'); dd := private.pj_opt_date(p ->> 'due_date', 'Vencimento');
  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois do vencimento' using errcode = '22023'; end if;
  if asg is not null and not private.pj_assignable(p_org, p_project, asg) then raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '22023'; end if;
  hash := private.pj_hash(array[p_project::text, ttl, coalesce(ds, ''), pri, coalesce(asg::text, ''), coalesce(sd::text, ''), coalesce(dd::text, ''), coalesce(p ->> 'column_id', ''), coalesce((p -> 'label_ids')::text, ''), coalesce((p -> 'checklist')::text, '')]);
  prev := private.pj_idem(p_org, uid, p_idem, 'create_task', hash);
  if prev is not null then return prev; end if;
  if nullif(p ->> 'column_id', '') is not null then
    select * into col from public.project_columns where id = (p ->> 'column_id')::uuid and project_id = p_project and organization_id = p_org;
    if not found then raise exception 'etapa inválida para este projeto' using errcode = '22023'; end if;
  else
    select * into col from public.project_columns where project_id = p_project and semantic_status = 'todo' order by position limit 1;
  end if;
  if col.semantic_status = 'done' then raise exception 'uma tarefa nova não pode ser criada em etapa concluída' using errcode = '22023'; end if;
  if col.semantic_status <> 'todo' and not private.pj_writable(p_project, 'execute') then raise exception 'só é possível criar tarefas em andamento com o projeto ativo' using errcode = '23514'; end if;
  num := private.pj_next_task_number(p_org, p_project);
  insert into public.tasks (organization_id, project_id, task_number, column_id, title, description, priority, assignee_user_id, start_date, due_date, position, created_by)
    values (p_org, p_project, num, col.id, ttl, ds, pri, asg, sd, dd, private.pj_end_position(col.id), uid) returning id into tid;
  if p ? 'label_ids' then
    if jsonb_typeof(p -> 'label_ids') is distinct from 'array' or jsonb_array_length(p -> 'label_ids') > 10 then raise exception 'até 10 etiquetas por tarefa' using errcode = '22023'; end if;
    for lbl in select (value #>> '{}')::uuid from jsonb_array_elements(p -> 'label_ids') loop
      if not exists (select 1 from public.project_labels where id = lbl and project_id = p_project and organization_id = p_org) then raise exception 'etiqueta inválida para este projeto' using errcode = '22023'; end if;
      insert into public.task_labels (organization_id, project_id, task_id, label_id) values (p_org, p_project, tid, lbl) on conflict do nothing;
    end loop;
  end if;
  if p ? 'checklist' then
    if jsonb_typeof(p -> 'checklist') is distinct from 'array' or jsonb_array_length(p -> 'checklist') > 50 then raise exception 'o checklist aceita até 50 itens' using errcode = '22023'; end if;
    for item in select value from jsonb_array_elements(p -> 'checklist') loop
      pos := pos + 1;
      insert into public.task_checklist_items (organization_id, task_id, title, required, position)
        values (p_org, tid, private.pj_req_text(item ->> 'title', 1, 200, 'Item do checklist'), coalesce((item ->> 'required')::boolean, false), pos);
    end loop;
  end if;
  perform private.pj_task_event(p_org, p_project, tid, 'task_created', jsonb_build_object('task_number', num, 'column', col.name, 'priority', pri));
  if asg is not null then
    perform private.pj_task_event(p_org, p_project, tid, 'assignee_changed', jsonb_build_object('from', null, 'to', asg));
    perform private.pj_notify(p_org, p_project, tid, 'task_assigned', array[asg]);
  end if;
  warn := private.pj_date_warnings(pr, sd, dd);
  res := jsonb_build_object('id', tid, 'task_number', num, 'warnings', warn);
  perform private.pj_idem_done(p_org, uid, p_idem, res);
  return res;
exception when invalid_text_representation then raise exception 'identificador inválido nos dados da tarefa' using errcode = '22023';
end $$;

-- ======================================================================= editar
-- p: title, description, priority, start_date, due_date (só os informados mudam). Responsável e etapa têm funções próprias.
create function public.pj_update_task(p_org uuid, p_task uuid, p_expected integer, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; pr public.projects; ttl text; ds text; pri text; sd date; dd date; changed text[] := '{}'; v integer;
begin
  perform private.pj_guard(p_org, 'member');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  t := private.pj_load_task(p_org, p_task, false, null);
  pr := private.pj_load_project(p_org, t.project_id, true, null);
  t := private.pj_load_task(p_org, p_task, true, p_expected);
  perform private.pj_require(p_org, t.project_id, 'edit');
  ttl := case when p ? 'title' then private.pj_req_text(p ->> 'title', 2, 200, 'Título') else t.title end;
  ds := case when p ? 'description' then private.pj_opt_text(p ->> 'description', 8000, 'Descrição') else t.description end;
  pri := case when p ? 'priority' then private.pj_priority_ok(p ->> 'priority') else t.priority end;
  sd := case when p ? 'start_date' then private.pj_opt_date(p ->> 'start_date', 'Data de início') else t.start_date end;
  dd := case when p ? 'due_date' then private.pj_opt_date(p ->> 'due_date', 'Vencimento') else t.due_date end;
  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois do vencimento' using errcode = '22023'; end if;
  if ttl is distinct from t.title then changed := array_append(changed, 'title'); end if;
  if ds is distinct from t.description then changed := array_append(changed, 'description'); end if;
  if pri is distinct from t.priority then changed := array_append(changed, 'priority'); end if;
  if sd is distinct from t.start_date or dd is distinct from t.due_date then changed := array_append(changed, 'dates'); end if;
  if cardinality(changed) = 0 then return jsonb_build_object('version', t.version, 'warnings', private.pj_date_warnings(pr, sd, dd)); end if;
  update public.tasks set title = ttl, description = ds, priority = pri, start_date = sd, due_date = dd where id = p_task returning version into v;
  if 'priority' = any (changed) then perform private.pj_task_event(p_org, t.project_id, p_task, 'priority_changed', jsonb_build_object('from', t.priority, 'to', pri)); end if;
  if 'dates' = any (changed) then
    perform private.pj_task_event(p_org, t.project_id, p_task, 'dates_changed', jsonb_build_object('from_start', t.start_date, 'to_start', sd, 'from_due', t.due_date, 'to_due', dd));
  end if;
  if 'title' = any (changed) or 'description' = any (changed) then
    perform private.pj_task_event(p_org, t.project_id, p_task, 'task_updated', jsonb_build_object('fields', to_jsonb(array_remove(array_remove(changed, 'priority'), 'dates'))));
  end if;
  return jsonb_build_object('version', v, 'warnings', private.pj_date_warnings(pr, sd, dd));
end $$;

-- Responsável: um só, opcional; precisa participar do projeto com permissão de edição (gestão, líder ou editor).
create function public.pj_assign_task(p_org uuid, p_task uuid, p_expected integer, p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v integer;
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, false, null);
  perform private.pj_load_project(p_org, t.project_id, true, null);
  t := private.pj_load_task(p_org, p_task, true, p_expected);
  perform private.pj_require(p_org, t.project_id, 'edit');
  if p_user is not null and not private.pj_assignable(p_org, t.project_id, p_user) then raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '22023'; end if;
  if p_user is not distinct from t.assignee_user_id then return t.version; end if;
  update public.tasks set assignee_user_id = p_user where id = p_task returning version into v;
  perform private.pj_task_event(p_org, t.project_id, p_task, 'assignee_changed', jsonb_build_object('from', t.assignee_user_id, 'to', p_user));
  if p_user is not null then perform private.pj_notify(p_org, t.project_id, p_task, 'task_assigned', array[p_user]); end if;
  return v;
end $$;

-- ======================================================================= mover (Kanban)
-- p_before_task: insere ANTES dessa tarefa da etapa de destino; nulo = ao final. p_board_version: versão do quadro que o usuário viu (nulo = não confere).
-- Entre etapas de tipos diferentes (execução) o projeto precisa estar ativo; dentro do mesmo tipo vale em qualquer estado que permita organizar. Para «Concluído» o servidor confere o checklist.
create function public.pj_move_task(p_org uuid, p_task uuid, p_to_column uuid, p_before_task uuid default null, p_board_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid uuid; pr public.projects; t public.tasks; src public.project_columns; dst public.project_columns; ids uuid[]; cur uuid[]; idx integer; nb integer; v integer; completed boolean := false; reopened boolean := false; msg text;
begin
  perform private.pj_guard(p_org, 'member');
  select project_id into pid from public.tasks where id = p_task and organization_id = p_org;
  if not found then raise exception 'tarefa não encontrada' using errcode = 'P0002'; end if;
  pr := private.pj_load_project(p_org, pid, true, null);                 -- trava do projeto PRIMEIRO (impede movimentos simultâneos de embaralhar o quadro)
  t := private.pj_load_task(p_org, p_task, true, null);
  perform private.pj_require(p_org, pid, 'edit');
  if p_board_version is not null and pr.board_version <> p_board_version then perform private.pj_conflict('o quadro'); end if;
  if t.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;
  if not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita movimentações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  select * into src from public.project_columns where id = t.column_id;
  select * into dst from public.project_columns where id = p_to_column and project_id = pid and organization_id = p_org;
  if not found then raise exception 'etapa de destino inválida para este projeto' using errcode = '22023'; end if;
  if dst.semantic_status <> src.semantic_status and not private.pj_writable(pid, 'execute') then
    msg := case when pr.status = 'paused' then 'projeto pausado: movimentações de execução ficam bloqueadas até retomar' else 'projeto ainda não iniciado: ative o projeto para mover tarefas entre etapas de execução' end;
    raise exception '%', msg using errcode = '23514';
  end if;
  if p_before_task is not null then
    if p_before_task = p_task or not exists (select 1 from public.tasks where id = p_before_task and column_id = dst.id and archived_at is null) then raise exception 'posição de referência inválida' using errcode = '22023'; end if;
  end if;
  select coalesce(array_agg(id order by position, id), '{}') into cur from public.tasks where column_id = dst.id and archived_at is null;
  select coalesce(array_agg(id order by position, id), '{}') into ids from public.tasks where column_id = dst.id and archived_at is null and id <> p_task;
  if p_before_task is null then ids := ids || p_task;
  else idx := array_position(ids, p_before_task); ids := ids[1:idx - 1] || p_task || ids[idx:]; end if;
  if dst.id = src.id and ids = cur then return jsonb_build_object('board_version', pr.board_version, 'version', t.version, 'changed', false); end if;
  if dst.id <> src.id then
    update public.tasks set column_id = dst.id, position = 2000000 where id = p_task;   -- gatilho: execução, checklist e completed_at
    perform private.pj_apply_order(dst.id, ids);
    perform private.pj_reindex_column(src.id);
    completed := dst.semantic_status = 'done'; reopened := src.semantic_status = 'done';
  else
    perform private.pj_apply_order(dst.id, ids);
  end if;
  nb := private.pj_bump_board(pid);
  select version into v from public.tasks where id = p_task;
  perform private.pj_task_event(p_org, pid, p_task, 'task_moved', jsonb_build_object('from', src.name, 'to', dst.name, 'from_semantic', src.semantic_status, 'to_semantic', dst.semantic_status));
  if completed then perform private.pj_task_event(p_org, pid, p_task, 'task_completed', '{}'::jsonb); end if;
  if reopened then
    perform private.pj_task_event(p_org, pid, p_task, 'task_reopened', jsonb_build_object('to', dst.name));
    perform private.pj_notify(p_org, pid, p_task, 'task_reopened', array[t.assignee_user_id, t.created_by]);
  end if;
  return jsonb_build_object('board_version', nb, 'version', v, 'changed', true, 'completed', completed, 'reopened', reopened);
end $$;

-- ======================================================================= impedimento (independente da etapa)
create function public.pj_set_blocked(p_org uuid, p_task uuid, p_expected integer, p_reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; rsn text := private.pj_opt_text(p_reason, 500, 'Motivo do impedimento'); v integer; sem text;
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, false, null);
  perform private.pj_load_project(p_org, t.project_id, true, null);
  t := private.pj_load_task(p_org, p_task, true, p_expected);
  perform private.pj_require(p_org, t.project_id, 'edit');
  select semantic_status into sem from public.project_columns where id = t.column_id;
  if rsn is not null then
    if char_length(rsn) < 3 then raise exception 'informe o motivo do impedimento (mínimo 3 caracteres)' using errcode = '22023'; end if;
    if sem = 'done' then raise exception 'uma tarefa concluída não pode ser bloqueada' using errcode = '23514'; end if;
    if t.blocked_reason is not distinct from rsn then return t.version; end if;
    update public.tasks set blocked_at = coalesce(blocked_at, clock_timestamp()), blocked_reason = rsn where id = p_task returning version into v;
    perform private.pj_task_event(p_org, t.project_id, p_task, 'task_blocked', jsonb_build_object('reason', rsn, 'update', t.blocked_at is not null));
  else
    if t.blocked_at is null then return t.version; end if;
    update public.tasks set blocked_at = null, blocked_reason = null where id = p_task returning version into v;
    perform private.pj_task_event(p_org, t.project_id, p_task, 'task_unblocked', '{}'::jsonb);
  end if;
  return v;
end $$;

-- ======================================================================= arquivar (liderança)
create function public.pj_archive_task(p_org uuid, p_task uuid, p_expected integer, p_reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; rsn text := private.pj_opt_text(p_reason, 500, 'Motivo'); sem text; v integer;
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, false, null);
  perform private.pj_load_project(p_org, t.project_id, true, null);
  t := private.pj_load_task(p_org, p_task, true, p_expected);
  perform private.pj_require(p_org, t.project_id, 'lead');
  if t.archived_at is not null then return t.version; end if;
  select semantic_status into sem from public.project_columns where id = t.column_id;
  if sem <> 'done' and (rsn is null or char_length(rsn) < 5) then raise exception 'informe o motivo (mínimo 5 caracteres) para arquivar uma tarefa não concluída' using errcode = '22023'; end if;
  update public.tasks set archived_at = clock_timestamp() where id = p_task returning version into v;
  perform private.pj_task_event(p_org, t.project_id, p_task, 'task_archived', jsonb_build_object('reason', rsn, 'was_done', sem = 'done'));
  return v;
end $$;

-- ======================================================================= etiquetas da tarefa
create function public.pj_set_task_labels(p_org uuid, p_task uuid, p_label_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; l uuid; ids uuid[];
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, false, null);
  perform private.pj_load_project(p_org, t.project_id, true, null);
  t := private.pj_load_task(p_org, p_task, true, null);
  perform private.pj_require(p_org, t.project_id, 'edit');
  if t.archived_at is not null or not private.pj_writable(t.project_id, 'organize') then raise exception 'a tarefa não aceita alterações (arquivada ou projeto somente para consulta)' using errcode = '23514'; end if;
  ids := coalesce((select array_agg(distinct x) from unnest(p_label_ids) x), '{}');
  if cardinality(ids) > 10 then raise exception 'até 10 etiquetas por tarefa' using errcode = '22023'; end if;
  foreach l in array ids loop
    if not exists (select 1 from public.project_labels where id = l and project_id = t.project_id and organization_id = p_org) then raise exception 'etiqueta inválida para este projeto' using errcode = '22023'; end if;
  end loop;
  if (select coalesce(array_agg(label_id order by label_id), '{}') from public.task_labels where task_id = p_task) = (select coalesce(array_agg(x order by x), '{}') from unnest(ids) x) then return; end if;
  delete from public.task_labels where task_id = p_task and not (label_id = any (ids));
  insert into public.task_labels (organization_id, project_id, task_id, label_id) select p_org, t.project_id, p_task, x from unnest(ids) x on conflict do nothing;
  perform private.pj_task_event(p_org, t.project_id, p_task, 'labels_changed', jsonb_build_object('count', cardinality(ids)));
end $$;

-- ======================================================================= checklist
create function public.pj_add_checklist_item(p_org uuid, p_task uuid, p_title text, p_required boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.tasks; iid uuid; pos integer;
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, true, null);
  perform private.pj_require(p_org, t.project_id, 'edit');
  select coalesce(max(position), 0) + 1 into pos from public.task_checklist_items where task_id = p_task;
  if pos > 50 then raise exception 'o checklist aceita até 50 itens' using errcode = '22023'; end if;
  insert into public.task_checklist_items (organization_id, task_id, title, required, position) values (p_org, p_task, private.pj_req_text(p_title, 1, 200, 'Item do checklist'), coalesce(p_required, false), pos) returning id into iid;
  perform private.pj_task_event(p_org, t.project_id, p_task, 'checklist_item_added', jsonb_build_object('required', coalesce(p_required, false)));
  return iid;
end $$;

create function public.pj_toggle_checklist_item(p_org uuid, p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.task_checklist_items; t public.tasks;
begin
  perform private.pj_guard(p_org, 'member');
  select * into i from public.task_checklist_items where id = p_item and organization_id = p_org;
  if not found then raise exception 'item não encontrado' using errcode = 'P0002'; end if;
  t := private.pj_load_task(p_org, i.task_id, true, null);
  perform private.pj_require(p_org, t.project_id, 'edit');
  if p_done is null then raise exception 'informe se o item está concluído' using errcode = '22023'; end if;
  if p_done = (i.completed_at is not null) then return; end if;
  update public.task_checklist_items set completed_at = case when p_done then clock_timestamp() end, completed_by = case when p_done then (select auth.uid()) end where id = p_item;
  perform private.pj_task_event(p_org, t.project_id, i.task_id, case when p_done then 'checklist_item_completed' else 'checklist_item_reopened' end, jsonb_build_object('required', i.required));
end $$;

create function public.pj_remove_checklist_item(p_org uuid, p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.task_checklist_items; t public.tasks;
begin
  perform private.pj_guard(p_org, 'member');
  select * into i from public.task_checklist_items where id = p_item and organization_id = p_org;
  if not found then raise exception 'item não encontrado' using errcode = 'P0002'; end if;
  t := private.pj_load_task(p_org, i.task_id, true, null);
  perform private.pj_require(p_org, t.project_id, 'edit');
  delete from public.task_checklist_items where id = p_item;
  perform private.pj_task_event(p_org, t.project_id, i.task_id, 'checklist_item_removed', jsonb_build_object('required', i.required));
end $$;

-- ======================================================================= comentários (append-only) e anexos
create function public.pj_add_comment(p_org uuid, p_task uuid, p_idem uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); t public.tasks; b text := private.pj_req_text(p_body, 1, 4000, 'Comentário'); prev jsonb; cid uuid;
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, false, null);
  perform private.pj_require(p_org, t.project_id, 'edit');
  perform private.pj_rate_hit('cmt:' || p_org::text || ':' || uid::text, 120, 600);
  prev := private.pj_idem(p_org, uid, p_idem, 'add_comment', private.pj_hash(array[p_task::text, b]));
  if prev is not null then return (prev ->> 'id')::uuid; end if;
  insert into public.task_comments (organization_id, task_id, author_user_id, body) values (p_org, p_task, uid, b) returning id into cid;
  perform private.pj_task_event(p_org, t.project_id, p_task, 'comment_added', jsonb_build_object('comment_id', cid));
  perform private.pj_notify(p_org, t.project_id, p_task, 'task_comment', array[t.assignee_user_id, t.created_by]);
  perform private.pj_idem_done(p_org, uid, p_idem, jsonb_build_object('id', cid));
  return cid;
end $$;

-- p_files: [{path, mime, size, filename, sha256?}] — arquivos JÁ enviados ao Storage pelo servidor (caminho gerado por ele).
create function public.pj_add_attachments(p_org uuid, p_task uuid, p_idem uuid, p_files jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); t public.tasks; prev jsonb; n integer;
begin
  perform private.pj_guard(p_org, 'member');
  t := private.pj_load_task(p_org, p_task, false, null);
  perform private.pj_require(p_org, t.project_id, 'edit');
  perform private.pj_rate_hit('att:' || p_org::text || ':' || uid::text, 60, 600);
  prev := private.pj_idem(p_org, uid, p_idem, 'add_attachments', private.pj_hash(array[p_task::text, coalesce(p_files::text, '')]));
  if prev is not null then return (prev ->> 'n')::integer; end if;
  n := private.pj_add_attachments(p_org, p_task, p_files, uid);
  if n > 0 then perform private.pj_task_event(p_org, t.project_id, p_task, 'attachment_added', jsonb_build_object('count', n)); end if;
  perform private.pj_idem_done(p_org, uid, p_idem, jsonb_build_object('n', n));
  return n;
end $$;

-- Caminho para o servidor assinar a URL curta: só devolve se o usuário ENXERGA o projeto (leitor incluído).
create function public.pj_attachment_info(p_org uuid, p_attachment uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare a public.task_attachments; t public.tasks;
begin
  perform private.pj_guard(p_org, 'member');
  select * into a from public.task_attachments where id = p_attachment and organization_id = p_org;
  if not found then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;
  select * into t from public.tasks where id = a.task_id;
  if private.pj_project_role(p_org, t.project_id) is null then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', a.storage_path, 'name', a.original_filename, 'mime', a.mime_type, 'size', a.size_bytes);
end $$;

-- ======================================================================= notificações
create function public.pj_mark_notification_read(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  update public.notifications set read_at = clock_timestamp() where id = p_id and organization_id = p_org and user_id = (select auth.uid()) and read_at is null;
end $$;
create function public.pj_mark_all_notifications_read(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.pj_guard(p_org, 'member');
  update public.notifications set read_at = clock_timestamp() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

commit;
