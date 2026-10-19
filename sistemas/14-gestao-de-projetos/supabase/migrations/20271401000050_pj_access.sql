-- Gestão de Projetos e Tarefas — ACESSO: perfis derivados do papel do Core + papel DENTRO do projeto + RLS somente de LEITURA.
-- Escrita: exclusivamente funções pj_* (SECURITY DEFINER). Perfis da organização:
--   owner (owner/admin do Core)  · manager (gerente: todos os projetos) · collaborator (membro: só projetos de que participa) · viewer (leitor do Core: só consulta, sempre papel «leitor»).
-- Papéis no projeto: lead (líder) · editor · reader (leitor). Proprietário e gestor atuam como líder em TODOS os projetos da empresa.

begin;
set local check_function_bodies = off;

create function private.pj_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;

-- owner | manager | collaborator | viewer | null
create function private.pj_profile(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case private.pj_role(org) when 'owner' then 'owner' when 'admin' then 'owner' when 'manager' then 'manager' when 'member' then 'collaborator' when 'viewer' then 'viewer' else null end;
$$;
create function private.pj_profile_of(p_org uuid, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case m.role when 'owner' then 'owner' when 'admin' then 'owner' when 'manager' then 'manager' when 'member' then 'collaborator' when 'viewer' then 'viewer' end
  from public.organization_members m where m.organization_id = p_org and m.user_id = p_uid;
$$;
create function private.pj_is_owner(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.pj_profile(org) = 'owner', false); $$;
create function private.pj_is_manager(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.pj_profile(org) in ('owner', 'manager'), false); $$;
create function private.pj_is_member(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.pj_profile(org) is not null, false); $$;

-- Papel de um usuário QUALQUER dentro do projeto (gestão = líder em todos; demais: linha em project_members).
create function private.pj_project_role_of(p_org uuid, p_project uuid, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when private.pj_profile_of(p_org, p_uid) in ('owner', 'manager') then 'lead'
    else (select pm.project_role from public.project_members pm where pm.organization_id = p_org and pm.project_id = p_project and pm.user_id = p_uid)
  end;
$$;
create function private.pj_project_role(p_org uuid, p_project uuid) returns text
language sql stable security definer set search_path = '' as $$ select private.pj_project_role_of(p_org, p_project, (select auth.uid())); $$;

-- O projeto existe, é da empresa e o usuário atual participa (ou é gestão). Base de TODAS as políticas de leitura.
create function private.pj_can_see_project(p_org uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p where p.id = p_project and p.organization_id = p_org) and private.pj_project_role(p_org, p_project) is not null;
$$;
create function private.pj_can_edit_project(p_org uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.pj_project_role(p_org, p_project) in ('lead', 'editor'), false); $$;
create function private.pj_can_lead_project(p_org uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.pj_project_role(p_org, p_project) = 'lead', false); $$;

-- Quem pode ser RESPONSÁVEL por tarefa: acesso ao projeto com permissão operacional (gestão, líder ou editor). Leitor nunca.
create function private.pj_assignable(p_org uuid, p_project uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.pj_project_role_of(p_org, p_project, p_uid) in ('lead', 'editor'), false);
$$;

revoke all on function private.pj_role(uuid), private.pj_profile(uuid), private.pj_profile_of(uuid, uuid), private.pj_is_owner(uuid), private.pj_is_manager(uuid), private.pj_is_member(uuid),
  private.pj_project_role_of(uuid, uuid, uuid), private.pj_project_role(uuid, uuid), private.pj_can_see_project(uuid, uuid), private.pj_can_edit_project(uuid, uuid),
  private.pj_can_lead_project(uuid, uuid), private.pj_assignable(uuid, uuid, uuid) from public, anon;
grant execute on function private.pj_role(uuid), private.pj_profile(uuid), private.pj_is_owner(uuid), private.pj_is_manager(uuid), private.pj_is_member(uuid),
  private.pj_project_role(uuid, uuid), private.pj_can_see_project(uuid, uuid), private.pj_can_edit_project(uuid, uuid), private.pj_can_lead_project(uuid, uuid) to authenticated;

-- ======================================================================= RLS: leitura
do $$
declare t text;
begin
  foreach t in array array['pj_settings', 'projects', 'project_members', 'project_columns', 'project_labels', 'tasks', 'task_labels', 'task_checklist_items', 'task_comments', 'task_attachments',
    'project_events', 'task_events', 'notifications', 'project_number_counters', 'task_number_counters', 'mutation_requests', 'pj_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

create policy pj_settings_read on public.pj_settings for select to authenticated using (private.pj_is_member(organization_id));
create policy pj_projects_read on public.projects for select to authenticated using (private.pj_can_see_project(organization_id, id));
create policy pj_members_read on public.project_members for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
create policy pj_columns_read on public.project_columns for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
create policy pj_labels_read on public.project_labels for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
create policy pj_tasks_read on public.tasks for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
create policy pj_task_labels_read on public.task_labels for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
create policy pj_checklist_read on public.task_checklist_items for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and t.organization_id = task_checklist_items.organization_id and private.pj_can_see_project(t.organization_id, t.project_id)));
create policy pj_comments_read on public.task_comments for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and t.organization_id = task_comments.organization_id and private.pj_can_see_project(t.organization_id, t.project_id)));
create policy pj_attachments_read on public.task_attachments for select to authenticated using (
  exists (select 1 from public.tasks t where t.id = task_id and t.organization_id = task_attachments.organization_id and private.pj_can_see_project(t.organization_id, t.project_id)));
create policy pj_project_events_read on public.project_events for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
create policy pj_task_events_read on public.task_events for select to authenticated using (private.pj_can_see_project(organization_id, project_id));
-- Notificação: só a própria, e somente enquanto o usuário ainda enxerga o projeto (não vaza existência de projeto inacessível).
create policy pj_notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()) and private.pj_can_see_project(organization_id, project_id));
-- Contadores, idempotência e limites: SEM política (ninguém lê pela API; só as funções pj_*).

grant select on public.pj_settings, public.projects, public.project_members, public.project_columns, public.project_labels, public.tasks, public.task_labels,
  public.task_checklist_items, public.task_comments, public.project_events, public.task_events, public.notifications to authenticated;
-- storage_path não é segredo (o acesso ao arquivo exige a política do Storage), mas a API só precisa dos metadados.
grant select (id, organization_id, task_id, original_filename, mime_type, size_bytes, uploaded_by, created_at) on public.task_attachments to authenticated;

commit;
