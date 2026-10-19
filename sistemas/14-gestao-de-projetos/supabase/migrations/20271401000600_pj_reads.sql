-- Gestão de Projetos e Tarefas — LEITURAS agregadas: painel operacional (todos os números vêm do banco e respeitam o acesso do usuário) e auditoria de exportações.
-- Definições (também exibidas na tela):
--   Tarefas abertas      = não arquivadas, em etapa diferente de «Concluído», em projetos não cancelados e não arquivados.
--   Atrasadas            = abertas com vencimento ANTERIOR à data de hoje no fuso da empresa.
--   Progresso do projeto = tarefas não arquivadas em «Concluído» ÷ total de tarefas não arquivadas (sem tarefas → «Sem tarefas», nunca 100%).
--   Concluídas no período= tarefas que estão em «Concluído» agora e cujo completed_at cai no intervalo (fuso da empresa).
-- Distribuição de tarefas NÃO é produtividade: não há pontuação de desempenho.

begin;
set local check_function_bodies = off;

create function public.pj_dashboard(p_org uuid, p_from date, p_to date, p_project uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tz text; f timestamptz; t timestamptz; today date; res jsonb;
begin
  perform private.pj_guard(p_org, 'member');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception 'período inválido (no máximo 366 dias)' using errcode = '22023'; end if;
  if p_project is not null and not private.pj_can_see_project(p_org, p_project) then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;
  select timezone into tz from public.pj_settings where organization_id = p_org;
  f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;
  today := (now() at time zone tz)::date;
  with vis as (
    select p.id, p.name, p.status, p.archived_at from public.projects p
    where p.organization_id = p_org and private.pj_can_see_project(p_org, p.id) and (p_project is null or p.id = p_project)),
  base as (
    select tk.id, tk.project_id, tk.assignee_user_id, tk.priority, tk.due_date, tk.blocked_at, tk.completed_at, c.semantic_status as sem, v.status as pstatus, v.archived_at as parch
    from public.tasks tk join vis v on v.id = tk.project_id join public.project_columns c on c.id = tk.column_id
    where tk.archived_at is null),
  opened as (select * from base where sem <> 'done' and pstatus <> 'cancelled' and parch is null),
  live as (select * from base where pstatus <> 'cancelled' and parch is null)
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', tz, 'today', today),
    'active_projects', (select count(*) from vis where status = 'active' and archived_at is null),
    'open_tasks', (select count(*) from opened),
    'overdue', (select count(*) from opened where due_date < today),
    'blocked', (select count(*) from opened where blocked_at is not null),
    'unassigned', (select count(*) from opened where assignee_user_id is null),
    'completed_in_period', (select count(*) from base where sem = 'done' and parch is null and completed_at >= f and completed_at < t),
    'by_stage', jsonb_build_object('todo', (select count(*) from live where sem = 'todo'), 'in_progress', (select count(*) from live where sem = 'in_progress'),
      'review', (select count(*) from live where sem = 'review'), 'done', (select count(*) from live where sem = 'done')),
    'by_priority', jsonb_build_object('urgent', (select count(*) from opened where priority = 'urgent'), 'high', (select count(*) from opened where priority = 'high'),
      'normal', (select count(*) from opened where priority = 'normal'), 'low', (select count(*) from opened where priority = 'low')),
    'load', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.u, 'name', case when x.u is null then null else coalesce(nullif(btrim(pr.full_name), ''), 'Pessoa') end,
        'open', x.n, 'overdue', x.od, 'blocked', x.bl) order by x.n desc, coalesce(pr.full_name, '')), '[]'::jsonb)
      from (select assignee_user_id as u, count(*) n, count(*) filter (where due_date < today) od, count(*) filter (where blocked_at is not null) bl from opened group by 1) x
      left join public.profiles pr on pr.id = x.u),
    'progress', (select coalesce(jsonb_agg(jsonb_build_object('project_id', v.id, 'name', v.name, 'status', v.status, 'total', coalesce(s.total, 0), 'done', coalesce(s.done, 0),
        'percent', case when coalesce(s.total, 0) = 0 then null else round(100.0 * s.done / s.total) end) order by v.name), '[]'::jsonb)
      from vis v left join (select project_id, count(*) total, count(*) filter (where sem = 'done') done from base group by 1) s on s.project_id = v.id
      where v.archived_at is null and v.status <> 'cancelled')
  ) into res;
  return res;
end $$;

-- Exportações ficam na auditoria (tipo e quantidade de linhas, nunca o conteúdo).
create function public.pj_audit_export(p_org uuid, p_kind text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_guard(p_org, 'member');
  if p_kind is null or p_kind !~ '^[a-z_]{2,40}$' then raise exception 'tipo de exportação inválido' using errcode = '22023'; end if;
  perform private.pj_rate_hit('exp:' || p_org::text || ':' || (select auth.uid())::text, 30, 600);
  perform private.pj_audit(p_org, 'export', 'export_' || p_kind, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;

commit;
