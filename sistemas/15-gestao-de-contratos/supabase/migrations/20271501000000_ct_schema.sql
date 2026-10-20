-- Gestão de Contratos e Vencimentos — ESQUEMA. Ferramenta administrativa: não produz parecer jurídico, não valida cláusulas e não é assinatura.
-- Todas as tabelas levam organization_id; FKs compostas impedem vínculos entre empresas. Datas de vigência/prazo são `date` (sem fuso); «hoje» é calculado no fuso da empresa.
-- Escrita somente pelas funções ct_* (SECURITY DEFINER); a RLS (arquivo seguinte) só concede LEITURA.

begin;

-- antecedências dos lembretes (dias): 1 a 8 valores entre 0 e 365 (função porque CHECK não aceita subconsulta)
create function private.ct_offsets_ok(p integer[]) returns boolean language sql immutable set search_path = '' as $$
  select p is not null and cardinality(p) between 1 and 8 and coalesce((select bool_and(x between 0 and 365) from unnest(p) x), false);
$$;
create table public.ct_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  logo_path text check (char_length(logo_path) <= 200),
  primary_color text not null default '#1d4ed8' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  timezone text not null default 'America/Sao_Paulo' check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and char_length(timezone) <= 60),
  contract_prefix text not null default 'CTR' check (contract_prefix ~ '^[A-Z0-9]{1,6}$'),
  attachment_max_size_bytes integer not null default 10485760 check (attachment_max_size_bytes between 10240 and 20971520),
  near_end_days integer not null default 60 check (near_end_days between 1 and 365),
  retention_policy_text text check (char_length(retention_policy_text) <= 1000),
  updated_at timestamptz not null default now()
);

-- ======================================================================= partes e categorias
create table public.counterparties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_type text not null check (person_type in ('person', 'company')),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  email text check (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (char_length(phone) <= 40),
  address text check (char_length(address) <= 400),
  active boolean not null default true,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index counterparties_org_name_idx on public.counterparties (organization_id, lower(name));

-- CPF/CNPJ é dado pessoal: fica em tabela à parte, legível só pela gestão.
create table public.counterparty_documents (
  counterparty_id uuid primary key,
  organization_id uuid not null,
  document_number text not null check (document_number ~ '^\d{11}$' or document_number ~ '^\d{14}$'),
  foreign key (counterparty_id, organization_id) references public.counterparties (id, organization_id) on delete cascade
);
create unique index counterparty_documents_uq on public.counterparty_documents (organization_id, document_number);

create table public.contract_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index contract_categories_name_uq on public.contract_categories (organization_id, lower(btrim(name)));

-- ======================================================================= contratos
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_number bigint not null,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  description text check (char_length(description) <= 4000),
  category_id uuid,
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft', 'active', 'terminated', 'closed')),
  responsible_user_id uuid,
  start_date date not null,
  end_date date,
  indefinite_term boolean not null default false,
  notice_days integer check (notice_days between 0 and 3650),
  notice_reference_date date,
  notice_deadline_date date,
  notice_adjusted boolean not null default false,
  notice_adjust_reason text check (char_length(notice_adjust_reason) <= 500),
  renewal_mode text not null default 'none' check (renewal_mode in ('none', 'manual')),
  ended_on date,
  end_reason text check (char_length(end_reason) <= 500),
  archived_at timestamptz,
  deadline_revision integer not null default 1,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contract_number),
  unique (id, organization_id),
  check ((indefinite_term and end_date is null) or (not indefinite_term and end_date is not null)),
  check (end_date is null or end_date >= start_date),
  check ((notice_days is null) = (notice_deadline_date is null) or notice_adjusted),
  check ((lifecycle_status in ('terminated', 'closed')) = (ended_on is not null)),
  check ((not notice_adjusted) or notice_adjust_reason is not null),
  foreign key (category_id, organization_id) references public.contract_categories (id, organization_id),
  foreign key (organization_id, responsible_user_id) references public.organization_members (organization_id, user_id) on delete set null (responsible_user_id)
);
create index contracts_org_status_idx on public.contracts (organization_id, lifecycle_status) where archived_at is null;
create index contracts_org_end_idx on public.contracts (organization_id, end_date) where archived_at is null;
create index contracts_responsible_idx on public.contracts (responsible_user_id);

create table public.contract_access (
  organization_id uuid not null,
  contract_id uuid not null,
  user_id uuid not null,
  contract_role text not null check (contract_role in ('editor', 'reader')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (contract_id, user_id),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index contract_access_user_idx on public.contract_access (user_id);

create table public.contract_parties (
  organization_id uuid not null,
  contract_id uuid not null,
  counterparty_id uuid not null,
  role_description text not null check (char_length(btrim(role_description)) between 2 and 120),
  identity_snapshot jsonb not null check (jsonb_typeof(identity_snapshot) = 'object' and pg_column_size(identity_snapshot) <= 2048),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (contract_id, counterparty_id),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (counterparty_id, organization_id) references public.counterparties (id, organization_id)
);

-- ======================================================================= documentos e versões (nunca sobrescreve bytes)
create table public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid not null,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  document_type text not null check (document_type in ('main', 'amendment', 'attachment', 'proof', 'other')),
  current_version_id uuid,
  version_counter integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id)
);
create index contract_documents_contract_idx on public.contract_documents (contract_id);

create table public.contract_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_number integer not null check (version_number >= 1),
  storage_path text not null unique check (char_length(storage_path) <= 200),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 20971520),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (id, organization_id),
  foreign key (document_id, organization_id) references public.contract_documents (id, organization_id)
);

-- ======================================================================= aditivos, valores e reajustes
create table public.contract_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid not null,
  change_type text not null check (change_type in ('amendment', 'renewal', 'correction', 'termination')),
  effective_date date not null,
  description text not null check (char_length(btrim(description)) between 2 and 2000),
  document_version_id uuid,
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot) = 'object' and pg_column_size(before_snapshot) <= 4096),
  after_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(after_snapshot) = 'object' and pg_column_size(after_snapshot) <= 4096),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (document_version_id, organization_id) references public.contract_document_versions (id, organization_id)
);
create index contract_changes_contract_idx on public.contract_changes (contract_id, created_at desc);

create table public.contract_value_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid not null,
  amount_cents bigint not null check (amount_cents between 0 and 99999999999999),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_basis text not null check (billing_basis in ('monthly', 'annual', 'one_time', 'reference')),
  effective_from date not null,
  source_change_id uuid,
  source_adjustment_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (contract_id, effective_from),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (source_change_id, organization_id) references public.contract_changes (id, organization_id)
);

create table public.contract_adjustment_rules (
  contract_id uuid primary key,
  organization_id uuid not null,
  frequency_months integer not null check (frequency_months between 1 and 120),
  next_adjustment_date date not null,
  reference_label text check (char_length(reference_label) <= 80),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id)
);

create table public.contract_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid not null,
  effective_date date not null,
  base_value_version_id uuid not null,
  percentage_decimal numeric(9, 4) not null check (percentage_decimal between -100 and 1000),
  new_amount_cents bigint not null check (new_amount_cents between 0 and 99999999999999),
  reference_label text check (char_length(reference_label) <= 80),
  reference_period text check (char_length(reference_period) <= 60),
  source_note text check (char_length(source_note) <= 500),
  justification text check (char_length(justification) <= 500),
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'cancelled')),
  proposed_by uuid references auth.users(id) on delete set null,
  proposed_at timestamptz not null default now(),
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  unique (id, organization_id),
  check ((status = 'applied') = (applied_at is not null)),
  check (percentage_decimal >= 0 or justification is not null),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (base_value_version_id, organization_id) references public.contract_value_versions (id, organization_id)
);
create unique index contract_adjustments_applied_uq on public.contract_adjustments (contract_id, effective_date) where status = 'applied';
alter table public.contract_value_versions add foreign key (source_adjustment_id, organization_id) references public.contract_adjustments (id, organization_id);

-- ======================================================================= obrigações e prazos
create table public.contract_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid not null,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  description text check (char_length(description) <= 2000),
  responsible_user_id uuid,
  due_date date not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completion_note text check (char_length(completion_note) <= 500),
  revision integer not null default 1,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null)),
  unique (id, organization_id),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (organization_id, responsible_user_id) references public.organization_members (organization_id, user_id) on delete set null (responsible_user_id)
);
create index contract_obligations_due_idx on public.contract_obligations (organization_id, due_date) where status = 'pending';

-- Prazos derivados do contrato (fim da vigência, aviso, reajuste): cada mudança de data cria nova REVISÃO e marca a anterior como substituída.
create table public.contract_deadlines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contract_id uuid not null,
  deadline_type text not null check (deadline_type in ('contract_end', 'notice', 'adjustment')),
  due_date date not null,
  source_reference text check (char_length(source_reference) <= 200),
  revision integer not null check (revision >= 1),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id)
);
create unique index contract_deadlines_current_uq on public.contract_deadlines (contract_id, deadline_type) where superseded_at is null;
create index contract_deadlines_due_idx on public.contract_deadlines (organization_id, due_date) where superseded_at is null;

-- ======================================================================= lembretes, notificações, histórico
create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check (event_type in ('contract_end', 'notice', 'adjustment', 'obligation')),
  offsets_days integer[] not null check (private.ct_offsets_ok(offsets_days)),
  active boolean not null default true,
  unique (organization_id, event_type)
);

create table public.reminder_deliveries (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  contract_id uuid not null,
  user_id uuid not null,
  event_type text not null,
  source_id uuid not null,
  source_revision integer not null,
  offset_days integer not null,
  status text not null check (status in ('sent', 'consolidated')),
  dedupe_key text not null unique,
  notification_id uuid,
  created_at timestamptz not null default now(),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id)
);

-- Notificações guardam só ids e tipo (nunca título ou texto): a interface lê o recurso sob a RLS atual.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('reminder_contract_end', 'reminder_notice', 'reminder_adjustment', 'reminder_obligation', 'contract_assigned', 'obligation_assigned')),
  contract_id uuid not null,
  source_id uuid,
  due_date date,
  offset_days integer,
  actor_user_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.contract_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  contract_id uuid not null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system')),
  actor_user_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (contract_id, organization_id) references public.contracts (id, organization_id)
);
create index contract_events_contract_idx on public.contract_events (contract_id, id desc);

-- ======================================================================= contadores, idempotência, limites, agendador
create table public.contract_number_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0
);
create table public.mutation_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  idempotency_key uuid not null,
  scope text not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, idempotency_key)
);
create table public.ct_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
-- Token do agendador: só o hash fica no banco; o texto é mostrado uma única vez ao proprietário.
create table public.ct_job_tokens (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  token_hash text not null,
  rotated_by uuid references auth.users(id) on delete set null,
  rotated_at timestamptz not null default now()
);
create table public.ct_job_runs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger text not null check (trigger in ('scheduler', 'manual')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  contracts_checked integer not null default 0,
  reminders_sent integer not null default 0,
  reminders_consolidated integer not null default 0,
  errors integer not null default 0
);
create index ct_job_runs_org_idx on public.ct_job_runs (organization_id, started_at desc);

commit;
