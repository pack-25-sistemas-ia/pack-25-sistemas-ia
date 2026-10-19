-- Gestão de Projetos e Tarefas — GUARDAS: autorização das funções, auditoria (só metadados), imutabilidade do histórico, estados do projeto, regras da tarefa (conclusão com checklist,
-- responsável elegível, execução só em projeto ativo), integridade do quadro e limpeza de atribuições quando alguém sai da empresa.
-- Tudo aqui vale mesmo para quem escreve SQL direto: a interface apenas reflete estas regras.

begin;
set local check_function_bodies = off;

-- ======================================================================= autorização das funções pj_*
-- nível: owner | manager (owner e gestor) | member (qualquer perfil da empresa, inclusive leitor)
create function private.pj_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare prof text; ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  prof := private.pj_profile(p_org);
  ok := prof is not null and case p_level when 'owner' then prof = 'owner' when 'manager' then prof in ('owner', 'manager') else true end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.pj_guard(uuid, text) from public, anon;
grant execute on function private.pj_guard(uuid, text) to authenticated;

create function private.pj_audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_changes jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes) values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id, p_changes);
end $$;
revoke all on function private.pj_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Limite de abuso compartilhado (no banco). Ao estourar, a transação é desfeita.
create function private.pj_rate_hit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); h integer;
begin
  insert into public.pj_rate_limits as r (bucket, window_start, hits) values (left(p_bucket, 120), w, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1 returning hits into h;
  if h > p_max then raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' using errcode = '54000'; end if;
  if random() < 0.02 then
    delete from public.pj_rate_limits where window_start < now() - interval '2 days';
    delete from public.mutation_requests where created_at < now() - interval '2 days';
  end if;
end $$;
revoke all on function private.pj_rate_hit(text, integer, integer) from public, anon, authenticated;

-- ======================================================================= updated_at, auditoria (só metadados) e organização imutável
do $$
declare t text;
begin
  foreach t in array array['pj_settings', 'projects', 'tasks'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['pj_settings', 'projects', 'project_members', 'project_columns'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id', case t when 'pj_settings' then 'organization_id' when 'project_members' then 'user_id' else 'id' end);
  end loop;
end $$;

create function private.pj_org_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.pj_org_immutable() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['pj_settings', 'projects', 'project_columns', 'project_labels', 'tasks', 'task_checklist_items', 'notifications'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.pj_org_immutable()', 'orgimm_' || t, t);
  end loop;
end $$;

-- ======================================================================= imutabilidade: histórico nunca se apaga nem se reescreve
create function private.pj_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro não pode ser apagado (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.pj_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: %', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.pj_no_delete() from public, anon, authenticated;
revoke all on function private.pj_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.pj_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['task_comments', 'project_events', 'task_events'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.pj_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- Anexo: nunca muda (nem sequer a visibilidade existe).
create trigger append_task_attachments before update on public.task_attachments for each row execute function private.pj_append_only();

-- Notificação: só `read_at` muda (marcar como lida), uma vez.
create function private.pj_notification_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') or old.read_at is not null then
    raise exception 'notificação só pode ser marcada como lida' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.pj_notification_guard() from public, anon, authenticated;
create trigger notification_guard before update on public.notifications for each row execute function private.pj_notification_guard();

-- ======================================================================= estado do projeto → o que cada operação pode fazer
--   organize: planejado, ativo ou pausado (e não arquivado)  → editar, criar tarefas, comentar, anexar, organizar o quadro
--   execute : somente ATIVO (e não arquivado)                → mover entre etapas de execução, concluir, marcar checklist
-- Concluído, cancelado e arquivado são só consulta.
create function private.pj_writable(p_project uuid, p_mode text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.archived_at is null and case p_mode when 'execute' then p.status = 'active' else p.status in ('planned', 'active', 'paused') end
    from public.projects p where p.id = p_project), false);
$$;
revoke all on function private.pj_writable(uuid, text) from public, anon, authenticated;

create function private.pj_bypass() returns boolean language sql stable set search_path = '' as $$ select coalesce(current_setting('pj.bypass', true), '') = 'on'; $$;
revoke all on function private.pj_bypass() from public, anon, authenticated;

-- ======================================================================= projeto: estados, conclusão, reabertura, arquivamento
create function private.pj_project_guard() returns trigger language plpgsql set search_path = '' as $$
declare meta text[] := array['version', 'board_version', 'updated_at']; pend integer; content_changed boolean;
begin
  if new.id <> old.id or new.project_number <> old.project_number or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'identidade do projeto (número, autoria) é imutável' using errcode = '23514';
  end if;
  if new.board_version < old.board_version then raise exception 'versão do quadro inválida' using errcode = '23514'; end if;
  if new.status is distinct from old.status and not (
       (old.status = 'planned' and new.status in ('active', 'cancelled'))
    or (old.status = 'active' and new.status in ('paused', 'completed', 'cancelled'))
    or (old.status = 'paused' and new.status in ('active', 'cancelled'))
    or (old.status in ('completed', 'cancelled') and new.status = 'active')) then
    raise exception 'transição de status do projeto inválida: % → %', old.status, new.status using errcode = '23514';
  end if;
  content_changed := (to_jsonb(new) - meta - 'archived_at' - 'completed_at') is distinct from (to_jsonb(old) - meta - 'archived_at' - 'completed_at');
  if old.archived_at is not null and new.archived_at is not null and (content_changed or new.status <> old.status) then
    raise exception 'projeto arquivado é somente para consulta (desarquive para alterar)' using errcode = '23514';
  end if;
  if old.status in ('completed', 'cancelled') and new.status = old.status and content_changed then
    raise exception 'projeto % é somente para consulta (reabra para alterar)', old.status using errcode = '23514';
  end if;
  if new.archived_at is not null and old.archived_at is null and new.status not in ('completed', 'cancelled') then
    raise exception 'só projetos concluídos ou cancelados podem ser arquivados' using errcode = '23514';
  end if;
  if new.archived_at is null and old.archived_at is not null and new.status = 'active' and old.status <> 'active' then
    raise exception 'desarquive e reabra em passos separados' using errcode = '23514';
  end if;
  if new.archived_at is not null and new.status = 'active' then raise exception 'projeto arquivado não pode estar ativo' using errcode = '23514'; end if;
  if new.status = 'completed' and old.status <> 'completed' then
    select count(*) into pend from public.tasks t join public.project_columns c on c.id = t.column_id
      where t.project_id = new.id and t.archived_at is null and c.semantic_status <> 'done';
    if pend > 0 then
      raise exception 'não é possível concluir: % tarefa(s) ainda não concluída(s) — conclua ou arquive cada uma antes', pend using errcode = '23514';
    end if;
    new.completed_at := coalesce(new.completed_at, clock_timestamp());
  end if;
  if new.status <> 'completed' then new.completed_at := null; end if;
  if (to_jsonb(new) - meta) is distinct from (to_jsonb(old) - meta) then new.version := old.version + 1; end if;
  return new;
end $$;
revoke all on function private.pj_project_guard() from public, anon, authenticated;
create trigger project_guard before update on public.projects for each row execute function private.pj_project_guard();

-- ======================================================================= etapas do quadro
create function private.pj_column_guard() returns trigger language plpgsql set search_path = '' as $$
declare pid uuid := coalesce(new.project_id, old.project_id); has_tasks boolean; others_todo integer; others_done integer;
begin
  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.id <> old.id) then raise exception 'a etapa não muda de projeto' using errcode = '23514'; end if;
  if not private.pj_bypass() and not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita alterações no quadro (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  if tg_op = 'UPDATE' then
    if new.semantic_status <> old.semantic_status then
      select exists (select 1 from public.tasks t where t.column_id = old.id) into has_tasks;
      if has_tasks then raise exception 'não é possível mudar o tipo de uma etapa que tem tarefas (mova as tarefas antes)' using errcode = '23514'; end if;
    else
      return new;
    end if;
  end if;
  -- o quadro precisa de pelo menos uma etapa «A fazer» e uma «Concluído» depois desta alteração
  select count(*) filter (where c.semantic_status = 'todo'), count(*) filter (where c.semantic_status = 'done') into others_todo, others_done
    from public.project_columns c where c.project_id = pid and c.id <> old.id;
  if tg_op = 'UPDATE' then
    others_todo := others_todo + (new.semantic_status = 'todo')::int; others_done := others_done + (new.semantic_status = 'done')::int;
  end if;
  if others_todo < 1 or others_done < 1 then raise exception 'o quadro precisa ter ao menos uma etapa do tipo «A fazer» e uma do tipo «Concluído»' using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
revoke all on function private.pj_column_guard() from public, anon, authenticated;
create trigger column_guard before update or delete on public.project_columns for each row execute function private.pj_column_guard();

-- ======================================================================= participantes
create function private.pj_member_guard() returns trigger language plpgsql set search_path = '' as $$
declare pid uuid := coalesce(new.project_id, old.project_id); prof text; open_tasks integer;
begin
  if not private.pj_bypass() and not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita alterações de participantes (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  if tg_op in ('INSERT', 'UPDATE') then
    prof := private.pj_profile_of(new.organization_id, new.user_id);
    if prof in ('owner', 'manager') then raise exception 'proprietário e gestor já têm acesso a todos os projetos' using errcode = '23514'; end if;
    if prof = 'viewer' and new.project_role <> 'reader' then raise exception 'quem tem o papel «Leitor» na empresa só pode ser leitor no projeto' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.project_role = 'reader') then
    select count(*) into open_tasks from public.tasks t where t.project_id = pid and t.assignee_user_id = old.user_id and t.archived_at is null;
    if open_tasks > 0 and not private.pj_bypass() then
      raise exception 'esta pessoa é responsável por % tarefa(s) deste projeto: transfira ou desatribua antes', open_tasks using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.pj_member_guard() from public, anon, authenticated;
create trigger member_guard before insert or update or delete on public.project_members for each row execute function private.pj_member_guard();

-- ======================================================================= tarefa: regras de execução
create function private.pj_task_guard() returns trigger language plpgsql set search_path = '' as $$
declare meta text[] := array['version', 'updated_at', 'priority_rank', 'position']; sem text; oldsem text; pend integer; bypass boolean := private.pj_bypass();
begin
  select c.semantic_status into sem from public.project_columns c where c.id = new.column_id;
  if tg_op = 'INSERT' then
    if not bypass and not private.pj_writable(new.project_id, 'organize') then raise exception 'o projeto não aceita novas tarefas (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
    if new.assignee_user_id is not null and not private.pj_assignable(new.organization_id, new.project_id, new.assignee_user_id) then
      raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '23514';
    end if;
    if sem = 'done' then raise exception 'uma tarefa nova não nasce concluída' using errcode = '23514'; end if;
    new.completed_at := null;
    return new;
  end if;
  if new.id <> old.id or new.project_id <> old.project_id or new.task_number <> old.task_number or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'identidade da tarefa (número, projeto, autoria) é imutável' using errcode = '23514';
  end if;
  select c.semantic_status into oldsem from public.project_columns c where c.id = old.column_id;
  if not bypass then
    if old.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;
    if not private.pj_writable(new.project_id, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
    if new.column_id <> old.column_id and sem is distinct from oldsem and not private.pj_writable(new.project_id, 'execute') then
      raise exception 'só é possível mover tarefas entre etapas de execução com o projeto ativo' using errcode = '23514';
    end if;
    if new.archived_at is null and old.archived_at is not null then raise exception 'tarefa arquivada não volta ao quadro' using errcode = '23514'; end if;
  end if;
  if new.assignee_user_id is not null and new.assignee_user_id is distinct from old.assignee_user_id and not bypass
     and not private.pj_assignable(new.organization_id, new.project_id, new.assignee_user_id) then
    raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '23514';
  end if;
  if sem = 'done' and oldsem is distinct from 'done' then
    select count(*) into pend from public.task_checklist_items i where i.task_id = new.id and i.required and i.completed_at is null;
    if pend > 0 then raise exception 'não é possível concluir: % item(ns) obrigatório(s) do checklist pendente(s)', pend using errcode = '23514'; end if;
    new.completed_at := clock_timestamp();
  elsif sem = 'done' then
    new.completed_at := old.completed_at;
  else
    new.completed_at := null;
  end if;
  if (to_jsonb(new) - meta) is distinct from (to_jsonb(old) - meta) then new.version := old.version + 1; end if;
  return new;
end $$;
revoke all on function private.pj_task_guard() from public, anon, authenticated;
create trigger task_guard before insert or update on public.tasks for each row execute function private.pj_task_guard();

-- ======================================================================= checklist, comentários e anexos
create function private.pj_checklist_guard() returns trigger language plpgsql set search_path = '' as $$
declare tid uuid := coalesce(new.task_id, old.task_id); t public.tasks; sem text;
begin
  select * into t from public.tasks where id = tid;
  select c.semantic_status into sem from public.project_columns c where c.id = t.column_id;
  if not private.pj_bypass() then
    if t.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;
    if sem = 'done' then raise exception 'tarefa concluída: reabra a tarefa para alterar o checklist' using errcode = '23514'; end if;
    if not private.pj_writable(t.project_id, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and (new.completed_at is distinct from old.completed_at) and not private.pj_writable(t.project_id, 'execute') then
      raise exception 'marcar itens do checklist exige o projeto ativo' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'completed_at' - 'completed_by') is distinct from (to_jsonb(old) - 'completed_at' - 'completed_by') then
    raise exception 'o item do checklist só muda de concluído/pendente' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.pj_checklist_guard() from public, anon, authenticated;
create trigger checklist_guard before insert or update or delete on public.task_checklist_items for each row execute function private.pj_checklist_guard();

create function private.pj_note_guard() returns trigger language plpgsql set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;
  if not private.pj_writable(t.project_id, 'comment') then raise exception 'o projeto não aceita comentários nem anexos (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.pj_note_guard() from public, anon, authenticated;
create trigger comment_guard before insert on public.task_comments for each row execute function private.pj_note_guard();
create trigger attachment_guard before insert on public.task_attachments for each row execute function private.pj_note_guard();

-- ======================================================================= quem sai da empresa (ou vira «Leitor») não deixa tarefas penduradas
-- Todas as tarefas dele (inclusive arquivadas) perdem o responsável, com evento de sistema; o acesso aos projetos some junto com a participação.
create function private.pj_release_user(p_org uuid, p_user uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare t record; n integer := 0;
begin
  perform set_config('pj.bypass', 'on', true);
  for t in select id, project_id from public.tasks where organization_id = p_org and assignee_user_id = p_user for update loop
    update public.tasks set assignee_user_id = null where id = t.id;
    insert into public.task_events (organization_id, project_id, task_id, event_type, actor_kind, actor_user_id, data)
      values (p_org, t.project_id, t.id, 'assignee_removed', 'system', (select auth.uid()), jsonb_build_object('reason', p_reason));
    n := n + 1;
  end loop;
  perform set_config('pj.bypass', 'off', true);
  return n;
end $$;
revoke all on function private.pj_release_user(uuid, uuid, text) from public, anon, authenticated;

create function private.pj_member_gone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.role = old.role then return new; end if;
    if new.role <> 'viewer' then return new; end if;
    -- passou a «Leitor» da empresa: perde a responsabilidade e fica só como leitor nos projetos
    perform private.pj_release_user(old.organization_id, old.user_id, 'role_changed_to_viewer');
    perform set_config('pj.bypass', 'on', true);
    update public.project_members set project_role = 'reader' where organization_id = old.organization_id and user_id = old.user_id and project_role <> 'reader';
    perform set_config('pj.bypass', 'off', true);
    return new;
  end if;
  perform private.pj_release_user(old.organization_id, old.user_id, 'member_removed');
  -- remove as participações aqui (com a trava de projetos arquivados/concluídos suspensa) para o acesso sumir na hora; a cascata encontra a tabela vazia
  perform set_config('pj.bypass', 'on', true);
  delete from public.project_members where organization_id = old.organization_id and user_id = old.user_id;
  perform set_config('pj.bypass', 'off', true);
  return old;
end $$;
revoke all on function private.pj_member_gone() from public, anon, authenticated;
create trigger pj_member_gone before delete or update of role on public.organization_members for each row execute function private.pj_member_gone();

-- ======================================================================= configurações e contadores iniciais da empresa
create function private.pj_bootstrap_org() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pj_settings (organization_id) values (new.id) on conflict do nothing;
  insert into public.project_number_counters (organization_id) values (new.id) on conflict do nothing;
  return null;
end $$;
revoke all on function private.pj_bootstrap_org() from public, anon, authenticated;
create trigger pj_bootstrap_org after insert on public.organizations for each row execute function private.pj_bootstrap_org();

insert into public.pj_settings (organization_id) select id from public.organizations on conflict do nothing;
insert into public.project_number_counters (organization_id) select id from public.organizations on conflict do nothing;

commit;
