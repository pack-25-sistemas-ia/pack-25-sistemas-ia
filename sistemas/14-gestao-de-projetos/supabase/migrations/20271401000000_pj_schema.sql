-- Gestão de Projetos e Tarefas — SCHEMA (sobre o Core: organizations, organization_members, organization_settings, audit_log, profiles).
-- Toda tabela de negócio tem organization_id. Referências usam chaves COMPOSTAS (id, organization_id [, project_id]): uma tarefa nunca aponta para coluna, etiqueta
-- ou projeto de outra empresa/projeto. O organization_id nunca vem do navegador: as funções pj_* o conferem contra a sessão.
-- Datas de planejamento são `date` (sem fuso); eventos usam timestamptz. O status funcional da tarefa é DERIVADO da coluna (project_columns.semantic_status).

begin;
set local check_function_bodies = off;

-- ======================================================================= configurações do sistema (por empresa)
create table public.pj_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  logo_path text check (char_length(logo_path) <= 200),
  primary_color text not null default '#0f766e' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  timezone text not null default 'America/Sao_Paulo' check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and char_length(timezone) <= 60),
  project_prefix text not null default 'PRJ' check (project_prefix ~ '^[A-Z0-9]{1,6}$'),
  attachment_max_size_bytes integer not null default 5242880 check (attachment_max_size_bytes between 10240 and 10485760),
  retention_policy_text text check (char_length(retention_policy_text) <= 1000),
  updated_at timestamptz not null default now()
);

-- ======================================================================= projetos
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_number bigint not null check (project_number > 0),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (char_length(description) <= 4000),
  status text not null default 'planned' check (status in ('planned', 'active', 'paused', 'completed', 'cancelled')),
  start_date date,
  due_date date,
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  version integer not null default 1 check (version >= 1),
  board_version integer not null default 1 check (board_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_number),
  unique (id, organization_id),
  check (start_date is null or due_date is null or start_date <= due_date),
  check ((status = 'completed') = (completed_at is not null))
);
create index projects_org_status_idx on public.projects (organization_id, status) where archived_at is null;

-- Participantes. O usuário precisa ser membro da empresa; sair da empresa remove a linha (revoga o acesso na hora).
create table public.project_members (
  organization_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  project_role text not null check (project_role in ('lead', 'editor', 'reader')),
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index project_members_user_idx on public.project_members (user_id, organization_id);

-- Etapas do quadro. A semântica (todo, in_progress, review, done) é o status funcional das tarefas que estão nela.
create table public.project_columns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  semantic_status text not null check (semantic_status in ('todo', 'in_progress', 'review', 'done')),
  position integer not null check (position >= 1),
  created_at timestamptz not null default now(),
  unique (id, project_id, organization_id),
  unique (project_id, position) deferrable initially deferred,
  foreign key (project_id, organization_id) references public.projects (id, organization_id)
);

create table public.project_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 30),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (id, project_id, organization_id),
  foreign key (project_id, organization_id) references public.projects (id, organization_id)
);
create unique index project_labels_name_uq on public.project_labels (project_id, lower(btrim(name)));

-- ======================================================================= tarefas
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  task_number bigint not null check (task_number > 0),
  column_id uuid not null,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  description text check (char_length(description) <= 8000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  priority_rank smallint generated always as (case priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end) stored,
  assignee_user_id uuid,
  start_date date,
  due_date date,
  completed_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text check (char_length(blocked_reason) between 3 and 500),
  position integer not null check (position >= 1),
  archived_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id, organization_id),
  unique (id, organization_id),
  unique (project_id, task_number),
  check (start_date is null or due_date is null or start_date <= due_date),
  check ((blocked_at is null) = (blocked_reason is null)),
  foreign key (project_id, organization_id) references public.projects (id, organization_id),
  foreign key (column_id, project_id, organization_id) references public.project_columns (id, project_id, organization_id),
  foreign key (organization_id, assignee_user_id) references public.organization_members (organization_id, user_id)
);
-- Ordem determinística dentro da etapa: posições 1..n sem repetição entre as tarefas ativas (reindexação sob trava do projeto).
create unique index tasks_column_position_uq on public.tasks (column_id, position) where archived_at is null;
create index tasks_project_idx on public.tasks (project_id, archived_at, due_date);
create index tasks_assignee_idx on public.tasks (organization_id, assignee_user_id, due_date) where archived_at is null;

create table public.task_labels (
  organization_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  label_id uuid not null,
  primary key (task_id, label_id),
  foreign key (task_id, project_id, organization_id) references public.tasks (id, project_id, organization_id),
  foreign key (label_id, project_id, organization_id) references public.project_labels (id, project_id, organization_id)
);
create index task_labels_label_idx on public.task_labels (label_id);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  required boolean not null default false,
  completed_at timestamptz,
  completed_by uuid,
  position integer not null check (position >= 1),
  check ((completed_at is null) = (completed_by is null)),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
create index task_checklist_task_idx on public.task_checklist_items (task_id, position);

-- Comentários: texto simples (renderização segura na interface, sem HTML). Append-only.
create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  author_user_id uuid,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null,
  storage_path text not null unique check (char_length(storage_path) <= 200),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  foreign key (task_id, organization_id) references public.tasks (id, organization_id)
);
create index task_attachments_task_idx on public.task_attachments (task_id, created_at);

-- ======================================================================= histórico e notificações
-- Eventos imutáveis. O campo `data` leva só ids, valores de planejamento e nomes de etapas — nunca o texto de comentários nem URLs assinadas.
create table public.project_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  project_id uuid not null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system')),
  actor_user_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (project_id, organization_id) references public.projects (id, organization_id)
);
create index project_events_project_idx on public.project_events (project_id, id desc);

create table public.task_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  project_id uuid not null,
  task_id uuid not null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system')),
  actor_user_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (task_id, project_id, organization_id) references public.tasks (id, project_id, organization_id)
);
create index task_events_task_idx on public.task_events (task_id, id desc);

-- Notificações internas. Não guardam títulos nem texto: a interface lê o recurso pela RLS atual (quem perdeu o acesso deixa de ver a notificação).
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('task_assigned', 'task_comment', 'task_reopened', 'project_reopened')),
  project_id uuid not null,
  task_id uuid,
  actor_user_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  read_at timestamptz,
  foreign key (project_id, organization_id) references public.projects (id, organization_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index notifications_user_idx on public.notifications (user_id, organization_id, read_at, created_at desc);

-- ======================================================================= contadores, idempotência e limite de abuso
create table public.project_number_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0
);
create table public.task_number_counters (
  project_id uuid primary key,
  organization_id uuid not null,
  last_number bigint not null default 0,
  foreign key (project_id, organization_id) references public.projects (id, organization_id)
);
create table public.mutation_requests (
  organization_id uuid not null,
  user_id uuid not null,
  idempotency_key uuid not null,
  scope text not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, idempotency_key)
);
create table public.pj_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

commit;
