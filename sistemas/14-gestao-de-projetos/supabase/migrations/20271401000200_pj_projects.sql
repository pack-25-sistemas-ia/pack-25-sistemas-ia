-- Gestão de Projetos e Tarefas — PROJETOS: contexto, pessoas, configurações, projetos, participantes, etapas do quadro e etiquetas.
-- Toda escrita passa por estas funções (SECURITY DEFINER, search_path vazio): validam sessão, MFA, perfil, papel no projeto, que os ids são da MESMA empresa e a versão lida.

begin;
set local check_function_bodies = off;

-- ======================================================================= contexto e pessoas
create function public.pj_my_context(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.pj_settings;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  select * into s from public.pj_settings where organization_id = p_org;
  return jsonb_build_object('profile', private.pj_profile(p_org), 'user_id', (select auth.uid()),
    'timezone', s.timezone, 'project_prefix', s.project_prefix, 'attachment_max_size_bytes', s.attachment_max_size_bytes,
    'unread_notifications', (select count(*) from public.notifications n where n.organization_id = p_org and n.user_id = (select auth.uid()) and n.read_at is null
      and private.pj_can_see_project(n.organization_id, n.project_id)));
end $$;

-- Pessoas da empresa (com e-mail) para escolher participantes. Gestão sempre; líder só no contexto do próprio projeto.
create function public.pj_people(p_org uuid, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  if not private.pj_is_manager(p_org) and (p_project is null or not private.pj_can_lead_project(p_org, p_project)) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'profile', private.pj_profile_of(p_org, m.user_id), 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email)
      order by coalesce(nullif(btrim(p.full_name), ''), p.email))
    from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org), '[]'::jsonb);
end $$;

-- Nomes (sem e-mail) das pessoas que aparecem em UM projeto que o usuário enxerga: participantes, gestão, responsáveis, autores e atores do histórico.
create function public.pj_project_people(p_org uuid, p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  if not private.pj_can_see_project(p_org, p_project) then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'), 'project_role', private.pj_project_role_of(p_org, p_project, u.id),
      'assignable', private.pj_assignable(p_org, p_project, u.id), 'member', exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = u.id))
      order by coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'))
    from (select user_id as id from public.project_members where project_id = p_project
          union select user_id from public.organization_members where organization_id = p_org and role in ('owner', 'admin', 'manager')
          union select assignee_user_id from public.tasks where project_id = p_project
          union select created_by from public.tasks where project_id = p_project
          union select author_user_id from public.task_comments c join public.tasks t on t.id = c.task_id where t.project_id = p_project
          union select actor_user_id from public.task_events where project_id = p_project
          union select actor_user_id from public.project_events where project_id = p_project
          union select created_by from public.projects where id = p_project) u
    left join public.profiles p on p.id = u.id where u.id is not null), '[]'::jsonb);
end $$;

-- Nomes de pessoas citadas nas tarefas/notificações das visões globais (Minhas tarefas, Todas): só quem aparece em projetos que o usuário enxerga.
create function public.pj_people_names(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  return coalesce((
    select jsonb_object_agg(u.id, coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'))
    from (select distinct t.assignee_user_id as id from public.tasks t where t.organization_id = p_org and t.assignee_user_id is not null and private.pj_can_see_project(t.organization_id, t.project_id)
          union select distinct n.actor_user_id from public.notifications n where n.organization_id = p_org and n.user_id = (select auth.uid()) and n.actor_user_id is not null) u
    left join public.profiles p on p.id = u.id), '{}'::jsonb);
end $$;

-- ======================================================================= configurações e marca (proprietário)
create function public.pj_save_settings(p_org uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'owner');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p ->> 'timezone') then raise exception 'fuso horário desconhecido' using errcode = '22023'; end if;
  update public.pj_settings set
    primary_color = coalesce(p ->> 'primary_color', primary_color),
    timezone = coalesce(p ->> 'timezone', timezone),
    project_prefix = coalesce(upper(p ->> 'project_prefix'), project_prefix),
    attachment_max_size_bytes = coalesce((p ->> 'attachment_max_size_bytes')::integer, attachment_max_size_bytes),
    retention_policy_text = case when p ? 'retention_policy_text' then private.pj_opt_text(p ->> 'retention_policy_text', 1000, 'Política de retenção') else retention_policy_text end
  where organization_id = p_org;
exception when check_violation then raise exception 'valor fora do permitido (cor #RRGGBB, prefixo de até 6 letras/números, arquivos 10 KB–10 MB)' using errcode = '22023';
end $$;

create function public.pj_set_logo(p_org uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'owner');
  if p_path is not null and (p_path !~ ('^' || p_org::text || '/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$')) then raise exception 'caminho de logotipo inválido' using errcode = '22023'; end if;
  update public.pj_settings set logo_path = p_path where organization_id = p_org;
end $$;

-- ======================================================================= projetos
-- p: name, description, start_date, due_date, status ('planned'|'active'), members [{user_id, role}]
create function public.pj_create_project(p_org uuid, p_idem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); nm text; ds text; sd date; dd date; st text; num bigint; pid uuid; prev jsonb; res jsonb; m jsonb; mrole text; muser uuid; hash text;
begin
  perform private.pj_guard(p_org, 'manager');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  perform private.pj_rate_hit('proj:' || p_org::text || ':' || uid::text, 60, 600);
  nm := private.pj_req_text(p ->> 'name', 2, 120, 'Nome do projeto'); ds := private.pj_opt_text(p ->> 'description', 4000, 'Descrição');
  sd := private.pj_opt_date(p ->> 'start_date', 'Data de início'); dd := private.pj_opt_date(p ->> 'due_date', 'Data de entrega');
  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois da data de entrega' using errcode = '22023'; end if;
  st := coalesce(nullif(p ->> 'status', ''), 'planned');
  if st not in ('planned', 'active') then raise exception 'um projeto novo começa planejado ou ativo' using errcode = '22023'; end if;
  hash := private.pj_hash(array[nm, coalesce(ds, ''), coalesce(sd::text, ''), coalesce(dd::text, ''), st, coalesce((p -> 'members')::text, '')]);
  prev := private.pj_idem(p_org, uid, p_idem, 'create_project', hash);
  if prev is not null then return prev; end if;
  num := private.pj_next_project_number(p_org);
  insert into public.projects (organization_id, project_number, name, description, status, start_date, due_date, created_by) values (p_org, num, nm, ds, st, sd, dd, uid) returning id into pid;
  insert into public.project_columns (organization_id, project_id, name, semantic_status, position) values
    (p_org, pid, 'A fazer', 'todo', 1), (p_org, pid, 'Em andamento', 'in_progress', 2), (p_org, pid, 'Em revisão', 'review', 3), (p_org, pid, 'Concluído', 'done', 4);
  if p ? 'members' then
    if jsonb_typeof(p -> 'members') is distinct from 'array' or jsonb_array_length(p -> 'members') > 100 then raise exception 'lista de participantes inválida' using errcode = '22023'; end if;
    for m in select value from jsonb_array_elements(p -> 'members') loop
      muser := (m ->> 'user_id')::uuid; mrole := coalesce(m ->> 'role', 'editor');
      if mrole not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;
      if private.pj_profile_of(p_org, muser) is null then raise exception 'participante precisa ser membro da empresa' using errcode = '22023'; end if;
      if private.pj_profile_of(p_org, muser) in ('owner', 'manager') then continue; end if; -- gestão já enxerga todos os projetos
      insert into public.project_members (organization_id, project_id, user_id, project_role, added_by) values (p_org, pid, muser, mrole, uid) on conflict do nothing;
    end loop;
  end if;
  perform private.pj_project_event(p_org, pid, 'project_created', jsonb_build_object('project_number', num, 'status', st));
  res := jsonb_build_object('id', pid, 'project_number', num);
  perform private.pj_idem_done(p_org, uid, p_idem, res);
  return res;
exception when invalid_text_representation then raise exception 'identificador inválido na lista de participantes' using errcode = '22023';
end $$;

-- p: name, description, start_date, due_date (só os campos informados mudam)
create function public.pj_update_project(p_org uuid, p_project uuid, p_expected integer, p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare pr public.projects; changed text[] := '{}'; v integer; nm text; ds text; sd date; dd date;
begin
  perform private.pj_guard(p_org, 'member');
  pr := private.pj_load_project(p_org, p_project, true, p_expected);
  perform private.pj_require(p_org, p_project, 'lead');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  if not private.pj_writable(p_project, 'organize') then raise exception 'projeto % é somente para consulta (arquivado, concluído ou cancelado)', coalesce(pr.status, '') using errcode = '23514'; end if;
  nm := case when p ? 'name' then private.pj_req_text(p ->> 'name', 2, 120, 'Nome do projeto') else pr.name end;
  ds := case when p ? 'description' then private.pj_opt_text(p ->> 'description', 4000, 'Descrição') else pr.description end;
  sd := case when p ? 'start_date' then private.pj_opt_date(p ->> 'start_date', 'Data de início') else pr.start_date end;
  dd := case when p ? 'due_date' then private.pj_opt_date(p ->> 'due_date', 'Data de entrega') else pr.due_date end;
  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois da data de entrega' using errcode = '22023'; end if;
  if nm is distinct from pr.name then changed := array_append(changed, 'name'); end if;
  if ds is distinct from pr.description then changed := array_append(changed, 'description'); end if;
  if sd is distinct from pr.start_date then changed := array_append(changed, 'start_date'); end if;
  if dd is distinct from pr.due_date then changed := array_append(changed, 'due_date'); end if;
  if cardinality(changed) = 0 then return pr.version; end if;
  update public.projects set name = nm, description = ds, start_date = sd, due_date = dd where id = p_project returning version into v;
  perform private.pj_project_event(p_org, p_project, 'project_updated', jsonb_build_object('fields', to_jsonb(changed), 'start_date', sd, 'due_date', dd));
  return v;
end $$;

-- Estados: planned→active|cancelled · active→paused|completed|cancelled · paused→active|cancelled · completed|cancelled→active (reabertura, só liderança, com motivo).
create function public.pj_set_project_status(p_org uuid, p_project uuid, p_expected integer, p_status text, p_reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare pr public.projects; rsn text := private.pj_opt_text(p_reason, 500, 'Motivo'); v integer; reopen boolean;
begin
  perform private.pj_guard(p_org, 'member');
  pr := private.pj_load_project(p_org, p_project, true, p_expected);
  perform private.pj_require(p_org, p_project, 'lead');
  if p_status is null or p_status not in ('planned', 'active', 'paused', 'completed', 'cancelled') then raise exception 'status inválido' using errcode = '22023'; end if;
  if pr.archived_at is not null then raise exception 'projeto arquivado: desarquive antes de alterar o status' using errcode = '23514'; end if;
  reopen := pr.status in ('completed', 'cancelled') and p_status = 'active';
  if (reopen or p_status = 'cancelled') and (rsn is null or char_length(rsn) < 5) then raise exception 'informe o motivo (mínimo 5 caracteres)' using errcode = '22023'; end if;
  if p_status = pr.status then return pr.version; end if;
  update public.projects set status = p_status where id = p_project returning version into v;
  perform private.pj_project_event(p_org, p_project, case when reopen then 'project_reopened' else 'status_changed' end, jsonb_build_object('from', pr.status, 'to', p_status, 'reason', rsn));
  if reopen then
    perform private.pj_notify(p_org, p_project, null, 'project_reopened', (select coalesce(array_agg(user_id), '{}') from public.project_members where project_id = p_project));
  end if;
  return v;
end $$;

create function public.pj_archive_project(p_org uuid, p_project uuid, p_expected integer, p_archive boolean, p_reason text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare pr public.projects; v integer; rsn text := private.pj_opt_text(p_reason, 500, 'Motivo');
begin
  perform private.pj_guard(p_org, 'member');
  pr := private.pj_load_project(p_org, p_project, true, p_expected);
  perform private.pj_require(p_org, p_project, 'lead');
  if p_archive is null then raise exception 'informe se é para arquivar ou desarquivar' using errcode = '22023'; end if;
  if p_archive = (pr.archived_at is not null) then return pr.version; end if;
  update public.projects set archived_at = case when p_archive then clock_timestamp() end where id = p_project returning version into v;
  perform private.pj_project_event(p_org, p_project, case when p_archive then 'project_archived' else 'project_unarchived' end, jsonb_build_object('reason', rsn));
  return v;
end $$;

-- ======================================================================= participantes
-- Trata as tarefas abertas de quem sai do projeto (ou vira leitor): `unassign` (sem responsável) ou `transfer` (para outra pessoa elegível). Sem escolha explícita, recusa.
create function private.pj_handle_assigned(p_org uuid, p_project uuid, p_user uuid, p_action text, p_transfer_to uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; t record;
begin
  select count(*) into n from public.tasks where project_id = p_project and assignee_user_id = p_user and archived_at is null;
  if n = 0 then return 0; end if;
  if p_action is null or p_action not in ('unassign', 'transfer') then
    raise exception 'esta pessoa é responsável por % tarefa(s) abertas: escolha desatribuir ou transferir', n using errcode = '23514';
  end if;
  if p_action = 'transfer' then
    if p_transfer_to is null or p_transfer_to = p_user or not private.pj_assignable(p_org, p_project, p_transfer_to) then
      raise exception 'escolha, para a transferência, outra pessoa do projeto com permissão de edição' using errcode = '23514';
    end if;
  end if;
  for t in select id from public.tasks where project_id = p_project and assignee_user_id = p_user and archived_at is null order by id for update loop
    update public.tasks set assignee_user_id = case when p_action = 'transfer' then p_transfer_to end where id = t.id;
    perform private.pj_task_event(p_org, p_project, t.id, case when p_action = 'transfer' then 'assignee_changed' else 'assignee_removed' end,
      jsonb_build_object('from', p_user, 'to', case when p_action = 'transfer' then p_transfer_to end, 'reason', 'member_change'));
    if p_action = 'transfer' then perform private.pj_notify(p_org, p_project, t.id, 'task_assigned', array[p_transfer_to]); end if;
  end loop;
  return n;
end $$;
revoke all on function private.pj_handle_assigned(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

create function public.pj_add_member(p_org uuid, p_project uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_load_project(p_org, p_project, true, null);
  perform private.pj_require(p_org, p_project, 'lead');
  if p_role is null or p_role not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;
  if p_user is null or private.pj_profile_of(p_org, p_user) is null then raise exception 'a pessoa precisa ser membro da empresa' using errcode = '22023'; end if;
  if exists (select 1 from public.project_members where project_id = p_project and user_id = p_user) then raise exception 'esta pessoa já participa do projeto' using errcode = '23505'; end if;
  insert into public.project_members (organization_id, project_id, user_id, project_role, added_by) values (p_org, p_project, p_user, p_role, (select auth.uid()));
  perform private.pj_project_event(p_org, p_project, 'member_added', jsonb_build_object('user_id', p_user, 'role', p_role));
end $$;

create function public.pj_set_member_role(p_org uuid, p_project uuid, p_user uuid, p_role text, p_task_action text default null, p_transfer_to uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare old_role text; n integer := 0;
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_load_project(p_org, p_project, true, null);
  perform private.pj_require(p_org, p_project, 'lead');
  if p_role is null or p_role not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;
  select project_role into old_role from public.project_members where project_id = p_project and user_id = p_user;
  if old_role is null then raise exception 'esta pessoa não participa do projeto' using errcode = 'P0002'; end if;
  if old_role = p_role then return 0; end if;
  if p_role = 'reader' then n := private.pj_handle_assigned(p_org, p_project, p_user, p_task_action, p_transfer_to); end if;
  update public.project_members set project_role = p_role where project_id = p_project and user_id = p_user;
  perform private.pj_project_event(p_org, p_project, 'member_role_changed', jsonb_build_object('user_id', p_user, 'from', old_role, 'to', p_role));
  return n;
end $$;

create function public.pj_remove_member(p_org uuid, p_project uuid, p_user uuid, p_task_action text default null, p_transfer_to uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_load_project(p_org, p_project, true, null);
  perform private.pj_require(p_org, p_project, 'lead');
  if not exists (select 1 from public.project_members where project_id = p_project and user_id = p_user) then raise exception 'esta pessoa não participa do projeto' using errcode = 'P0002'; end if;
  n := private.pj_handle_assigned(p_org, p_project, p_user, p_task_action, p_transfer_to);
  delete from public.project_members where project_id = p_project and user_id = p_user;
  perform private.pj_project_event(p_org, p_project, 'member_removed', jsonb_build_object('user_id', p_user, 'tasks_handled', n, 'action', p_task_action));
  return n;
end $$;

-- ======================================================================= etapas do quadro
create function private.pj_bump_board(p_project uuid) returns integer
language sql security definer set search_path = '' as $$
  update public.projects set board_version = board_version + 1 where id = p_project returning board_version;
$$;
revoke all on function private.pj_bump_board(uuid) from public, anon, authenticated;

-- Carrega o projeto para uma operação de quadro: trava, líder, estado que permite organizar, versão do quadro (conflito = 40001).
create function private.pj_board_op(p_org uuid, p_project uuid, p_expected_board integer, p_level text) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare pr public.projects;
begin
  pr := private.pj_load_project(p_org, p_project, true, null);
  perform private.pj_require(p_org, p_project, p_level);
  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações no quadro (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  if p_expected_board is not null and pr.board_version <> p_expected_board then perform private.pj_conflict('o quadro'); end if;
  return pr;
end $$;
revoke all on function private.pj_board_op(uuid, uuid, integer, text) from public, anon, authenticated;

create function public.pj_add_column(p_org uuid, p_project uuid, p_expected_board integer, p_name text, p_semantic text, p_position integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text := private.pj_req_text(p_name, 1, 40, 'Nome da etapa'); cid uuid; n integer; pos integer;
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_board_op(p_org, p_project, p_expected_board, 'lead');
  if p_semantic is null or p_semantic not in ('todo', 'in_progress', 'review', 'done') then raise exception 'tipo de etapa inválido' using errcode = '22023'; end if;
  select count(*) into n from public.project_columns where project_id = p_project;
  if n >= 12 then raise exception 'o quadro aceita até 12 etapas' using errcode = '22023'; end if;
  pos := least(greatest(coalesce(p_position, n + 1), 1), n + 1);
  update public.project_columns set position = position + 1 where project_id = p_project and position >= pos;
  insert into public.project_columns (organization_id, project_id, name, semantic_status, position) values (p_org, p_project, nm, p_semantic, pos) returning id into cid;
  perform private.pj_bump_board(p_project);
  perform private.pj_project_event(p_org, p_project, 'column_added', jsonb_build_object('column_id', cid, 'name', nm, 'semantic', p_semantic));
  return cid;
end $$;

-- Renomear não muda a semântica (o tipo da etapa não é editável aqui).
create function public.pj_rename_column(p_org uuid, p_project uuid, p_column uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text := private.pj_req_text(p_name, 1, 40, 'Nome da etapa'); old text;
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_board_op(p_org, p_project, null, 'lead');
  select name into old from public.project_columns where id = p_column and project_id = p_project and organization_id = p_org for update;
  if not found then raise exception 'etapa não encontrada' using errcode = 'P0002'; end if;
  if old = nm then return; end if;
  update public.project_columns set name = nm where id = p_column;
  perform private.pj_project_event(p_org, p_project, 'column_renamed', jsonb_build_object('column_id', p_column, 'from', old, 'to', nm));
end $$;

create function public.pj_reorder_columns(p_org uuid, p_project uuid, p_expected_board integer, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; v integer;
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_board_op(p_org, p_project, p_expected_board, 'lead');
  select count(*) into n from public.project_columns where project_id = p_project;
  if p_ids is null or cardinality(p_ids) <> n or (select count(distinct x) from unnest(p_ids) x) <> n
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.project_columns c where c.id = x and c.project_id = p_project)) then
    raise exception 'ordem das etapas inválida: informe todas as etapas do projeto, uma vez cada' using errcode = '22023';
  end if;
  update public.project_columns c set position = u.ord from unnest(p_ids) with ordinality as u(id, ord) where c.id = u.id and c.project_id = p_project;
  v := private.pj_bump_board(p_project);
  perform private.pj_project_event(p_org, p_project, 'columns_reordered', '{}'::jsonb);
  return v;
end $$;

-- Exclusão: se houver tarefas (inclusive arquivadas), exige realocação EXPLÍCITA para etapa do MESMO tipo. Tudo numa transação.
create function public.pj_delete_column(p_org uuid, p_project uuid, p_expected_board integer, p_column uuid, p_move_to uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare col public.project_columns; dest public.project_columns; n integer; base integer; v integer;
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_board_op(p_org, p_project, p_expected_board, 'lead');
  select * into col from public.project_columns where id = p_column and project_id = p_project and organization_id = p_org for update;
  if not found then raise exception 'etapa não encontrada' using errcode = 'P0002'; end if;
  select count(*) into n from public.tasks where column_id = p_column;
  if n > 0 then
    if p_move_to is null then raise exception 'a etapa tem % tarefa(s): escolha para qual etapa do mesmo tipo elas serão movidas', n using errcode = '23514'; end if;
    select * into dest from public.project_columns where id = p_move_to and project_id = p_project and organization_id = p_org for update;
    if not found or dest.id = col.id then raise exception 'etapa de destino inválida' using errcode = '22023'; end if;
    if dest.semantic_status <> col.semantic_status then raise exception 'a realocação precisa ser para uma etapa do mesmo tipo (%)', col.semantic_status using errcode = '23514'; end if;
    select coalesce(max(position), 0) into base from public.tasks where column_id = dest.id and archived_at is null;
    update public.tasks t set column_id = dest.id, position = base + r.rn
      from (select id, row_number() over (order by position, id) rn from public.tasks where column_id = col.id and archived_at is null) r where t.id = r.id;
    perform set_config('pj.bypass', 'on', true);
    update public.tasks set column_id = dest.id where column_id = col.id; -- arquivadas: só trocam de etapa, sem mudar o conteúdo
    perform set_config('pj.bypass', 'off', true);
  end if;
  delete from public.project_columns where id = col.id;
  update public.project_columns c set position = r.rn from (select id, row_number() over (order by position) rn from public.project_columns where project_id = p_project) r where c.id = r.id;
  v := private.pj_bump_board(p_project);
  perform private.pj_project_event(p_org, p_project, 'column_deleted', jsonb_build_object('name', col.name, 'semantic', col.semantic_status, 'moved_tasks', n, 'moved_to', p_move_to));
  return v;
end $$;

-- ======================================================================= etiquetas
create function public.pj_save_label(p_org uuid, p_project uuid, p_id uuid, p_name text, p_color text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text := private.pj_req_text(p_name, 1, 30, 'Nome da etiqueta'); rid uuid; col text := coalesce(p_color, '#64748b');
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_load_project(p_org, p_project, false, null);
  perform private.pj_require(p_org, p_project, case when p_id is null then 'edit' else 'lead' end);
  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  if col !~ '^#[0-9a-fA-F]{6}$' then raise exception 'cor inválida (use #RRGGBB)' using errcode = '22023'; end if;
  if p_id is null then
    if (select count(*) from public.project_labels where project_id = p_project) >= 40 then raise exception 'o projeto aceita até 40 etiquetas' using errcode = '22023'; end if;
    insert into public.project_labels (organization_id, project_id, name, color) values (p_org, p_project, nm, col) returning id into rid;
  else
    update public.project_labels set name = nm, color = col where id = p_id and project_id = p_project and organization_id = p_org returning id into rid;
    if rid is null then raise exception 'etiqueta não encontrada' using errcode = 'P0002'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'já existe uma etiqueta com esse nome neste projeto' using errcode = '23505';
end $$;

create function public.pj_delete_label(p_org uuid, p_project uuid, p_label uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  perform private.pj_load_project(p_org, p_project, false, null);
  perform private.pj_require(p_org, p_project, 'lead');
  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  if not exists (select 1 from public.project_labels where id = p_label and project_id = p_project and organization_id = p_org) then raise exception 'etiqueta não encontrada' using errcode = 'P0002'; end if;
  delete from public.task_labels where label_id = p_label;
  delete from public.project_labels where id = p_label;
  perform private.pj_project_event(p_org, p_project, 'label_deleted', jsonb_build_object('label_id', p_label));
end $$;

commit;
