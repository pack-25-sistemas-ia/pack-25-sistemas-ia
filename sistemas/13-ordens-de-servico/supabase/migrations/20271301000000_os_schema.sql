-- Gestão de Ordens de Serviço — MODELO DE DADOS.
-- O Core já possui `organization_settings` (nome de exibição e tema do painel); as políticas do sistema ficam em `os_settings`.
-- Convenções: valores em CENTAVOS (bigint); quantidades em numeric(12,3); instantes em timestamptz; relacionamentos por chave composta
-- (id, organization_id): nenhum registro referencia outra empresa. Escrita só por funções os_* (migrações seguintes).
-- Histórico nunca se apaga: eventos, notas, anexos, versões de orçamento, decisões, conclusões e aceites são imutáveis (ver 000100).
-- Dados comerciais sensíveis em tabelas separadas (RLS por linha não protege colunas): custos internos e documento (CPF/CNPJ) do cliente.

begin;
set local check_function_bodies = off;

-- ======================================================================= identidade e políticas da empresa
create table public.os_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  public_display_name text check (char_length(btrim(public_display_name)) between 2 and 80),
  logo_path text check (char_length(logo_path) <= 200),
  primary_color text not null default '#2563eb' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  timezone text not null default 'America/Sao_Paulo' check (timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' and char_length(timezone) <= 60),
  order_prefix text not null default 'OS' check (order_prefix ~ '^[A-Z0-9]{1,6}$'),
  quote_validity_days integer not null default 15 check (quote_validity_days between 1 and 365),
  default_quote_terms text check (char_length(default_quote_terms) <= 2000),
  link_ttl_days integer not null default 30 check (link_ttl_days between 1 and 180),
  attachment_max_size_bytes integer not null default 5242880 check (attachment_max_size_bytes between 10240 and 10485760),
  retention_policy_text text check (char_length(retention_policy_text) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Técnico desativado: preserva a autoria histórica; deixa de ser atribuível e de acessar as ordens.
create table public.technician_status (
  organization_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  deactivated_at timestamptz,
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade
);

-- ======================================================================= clientes
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  kind text not null default 'person' check (kind in ('person', 'company')),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  phone text check (phone is null or phone ~ '^[0-9+()\s.-]{8,20}$'),
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index customers_org_name_idx on public.customers (organization_id, lower(name));

-- CPF/CNPJ e observações internas: só a gestão lê (o técnico lê o cliente, nunca esta tabela).
create table public.customer_private (
  customer_id uuid primary key,
  organization_id uuid not null,
  document text check (document is null or document ~ '^([0-9]{11}|[0-9]{14})$'),
  internal_notes text check (char_length(internal_notes) <= 2000),
  updated_at timestamptz not null default now(),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create unique index customer_private_doc_uq on public.customer_private (organization_id, document) where document is not null;

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  role_label text check (char_length(role_label) <= 60),
  phone text check (phone is null or phone ~ '^[0-9+()\s.-]{8,20}$'),
  email text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index customer_contacts_customer_idx on public.customer_contacts (organization_id, customer_id);
create unique index customer_contacts_primary_uq on public.customer_contacts (customer_id) where is_primary and active;

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  label text not null check (char_length(btrim(label)) between 2 and 60),
  street text not null check (char_length(btrim(street)) between 2 and 160),
  number text check (char_length(number) <= 20),
  complement text check (char_length(complement) <= 80),
  district text check (char_length(district) <= 80),
  city text not null check (char_length(btrim(city)) between 2 and 80),
  state text not null check (state ~ '^[A-Z]{2}$'),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  reference text check (char_length(reference) <= 200),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, customer_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index customer_addresses_customer_idx on public.customer_addresses (organization_id, customer_id);
create unique index customer_addresses_default_uq on public.customer_addresses (customer_id) where is_default and active;

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  brand text check (char_length(brand) <= 80),
  model text check (char_length(model) <= 80),
  serial_number text check (char_length(serial_number) <= 80),
  notes text check (char_length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, organization_id, customer_id),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id) on delete cascade
);
create index equipment_customer_idx on public.equipment (organization_id, customer_id);

-- ======================================================================= catálogos (preço de REFERÊNCIA; o orçamento guarda o próprio snapshot)
create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text check (char_length(description) <= 500),
  unit text not null default 'un' check (char_length(btrim(unit)) between 1 and 16),
  reference_price_cents bigint not null default 0 check (reference_price_cents between 0 and 1000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index service_catalog_org_name_uq on public.service_catalog (organization_id, lower(btrim(name)));

create table public.part_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (char_length(btrim(code)) between 1 and 40),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  unit text not null default 'un' check (char_length(btrim(unit)) between 1 and 16),
  reference_price_cents bigint not null default 0 check (reference_price_cents between 0 and 1000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index part_catalog_org_code_uq on public.part_catalog (organization_id, lower(btrim(code)));

-- ======================================================================= modelos de checklist
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  description text check (char_length(description) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index checklist_templates_org_name_uq on public.checklist_templates (organization_id, lower(btrim(name)));

-- kind: boolean (sim/não) · text · number · select (options = lista de textos).  note_rule: quando a justificativa é obrigatória.
create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  position integer not null check (position between 1 and 100),
  label text not null check (char_length(btrim(label)) between 2 and 200),
  kind text not null check (kind in ('boolean', 'text', 'number', 'select')),
  options jsonb check (options is null or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 20 and pg_column_size(options) <= 2000)),
  required boolean not null default false,
  allow_na boolean not null default false,
  require_photo boolean not null default false,
  note_rule text not null default 'never' check (note_rule in ('never', 'on_negative', 'always')),
  unique (template_id, position),
  check ((kind = 'select') = (options is not null)),
  foreign key (template_id, organization_id) references public.checklist_templates (id, organization_id) on delete cascade
);

-- ======================================================================= ordens de serviço
create table public.service_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_number bigint not null check (order_number > 0),
  customer_id uuid not null,
  address_id uuid,
  equipment_id uuid,
  execution_status text not null default 'open' check (execution_status in ('draft', 'open', 'scheduled', 'in_progress', 'paused', 'completed', 'closed', 'cancelled')),
  -- required = exige orçamento aprovado para iniciar · authorized = execução autorizada SEM orçamento, com justificativa da gestão
  quote_mode text not null default 'required' check (quote_mode in ('required', 'authorized')),
  authorization_justification text check (char_length(authorization_justification) between 10 and 1000),
  authorized_by uuid,
  authorized_at timestamptz,
  assigned_technician_user_id uuid,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  subject text not null check (char_length(btrim(subject)) between 3 and 160),
  problem_description text not null check (char_length(btrim(problem_description)) between 3 and 4000),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) between 5 and 500),
  completion_version integer not null default 0 check (completion_version >= 0),
  version integer not null default 1 check (version >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, order_number),
  check ((quote_mode = 'authorized') = (authorization_justification is not null)),
  check ((scheduled_start_at is null) = (scheduled_end_at is null)),
  check (scheduled_end_at is null or (scheduled_end_at > scheduled_start_at and scheduled_end_at <= scheduled_start_at + interval '14 days')),
  check ((execution_status = 'cancelled') = (cancelled_at is not null)),
  check (execution_status <> 'scheduled' or (assigned_technician_user_id is not null and scheduled_start_at is not null)),
  check (execution_status <> 'closed' or closed_at is not null),
  foreign key (customer_id, organization_id) references public.customers (id, organization_id),
  foreign key (address_id, organization_id, customer_id) references public.customer_addresses (id, organization_id, customer_id),
  foreign key (equipment_id, organization_id, customer_id) references public.equipment (id, organization_id, customer_id),
  foreign key (organization_id, assigned_technician_user_id) references public.organization_members (organization_id, user_id) on delete set null (assigned_technician_user_id)
);
create index service_orders_org_status_idx on public.service_orders (organization_id, execution_status, created_at desc);
create index service_orders_tech_idx on public.service_orders (organization_id, assigned_technician_user_id, execution_status);
create index service_orders_customer_idx on public.service_orders (organization_id, customer_id);
create index service_orders_window_idx on public.service_orders (organization_id, scheduled_start_at) where scheduled_start_at is not null;

-- Dados do cliente/endereço/equipamento no momento da abertura; mudanças posteriores só por atualização explícita (nova linha, com motivo).
create table public.service_order_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  snapshot_version integer not null check (snapshot_version >= 1),
  reason text check (char_length(reason) between 5 and 300),
  customer_name text not null,
  customer_phone text,
  customer_email text,
  contact_name text,
  contact_phone text,
  address jsonb check (address is null or (jsonb_typeof(address) = 'object' and pg_column_size(address) <= 2048)),
  equipment jsonb check (equipment is null or (jsonb_typeof(equipment) = 'object' and pg_column_size(equipment) <= 2048)),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (service_order_id, snapshot_version),
  unique (id, organization_id),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);

create table public.order_pauses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 3 and 300),
  started_by uuid,
  ended_by uuid,
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);
create index order_pauses_order_idx on public.order_pauses (service_order_id, started_at);
create unique index order_pauses_open_uq on public.order_pauses (service_order_id) where ended_at is null;

-- ======================================================================= orçamento versionado
create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  version_number integer not null check (version_number >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'approved', 'rejected', 'superseded')),
  subtotal_cents bigint not null default 0 check (subtotal_cents between 0 and 100000000000),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  valid_until timestamptz,
  terms_snapshot text check (char_length(terms_snapshot) <= 2000),
  notes text check (char_length(notes) <= 1000),
  published_at timestamptz,
  published_by uuid,
  -- versão do snapshot de cliente/endereço/equipamento vigente ao publicar: o PDF e a aprovação usam ESTES dados, mesmo que o cadastro mude depois
  snapshot_version integer,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (service_order_id, version_number),
  unique (id, organization_id),
  check (discount_cents <= subtotal_cents and total_cents = subtotal_cents - discount_cents),
  check ((status = 'draft') = (published_at is null)),
  check (status = 'draft' or valid_until is not null),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);
create unique index quote_versions_one_draft_uq on public.quote_versions (service_order_id) where status = 'draft';
create unique index quote_versions_one_published_uq on public.quote_versions (service_order_id) where status = 'published';

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  quote_version_id uuid not null,
  position integer not null check (position between 1 and 200),
  kind text not null check (kind in ('service', 'part')),
  service_id uuid,
  part_id uuid,
  description text not null check (char_length(btrim(description)) between 2 and 200),
  unit text not null check (char_length(btrim(unit)) between 1 and 16),
  quantity numeric(12,3) not null check (quantity > 0 and quantity <= 1000000),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 1000000000),
  -- arredondamento documentado: total da linha = quantidade × preço unitário, arredondado a centavos «meio para cima» (round() do numeric)
  line_total_cents bigint not null,
  unique (quote_version_id, position),
  check (line_total_cents = round(quantity * unit_price_cents)),
  check ((kind = 'service' and part_id is null) or (kind = 'part' and service_id is null)),
  foreign key (quote_version_id, organization_id) references public.quote_versions (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references public.service_catalog (id, organization_id),
  foreign key (part_id, organization_id) references public.part_catalog (id, organization_id)
);

-- Uma decisão por versão (aprovar/recusar). channel = customer_link (cliente, pelo link) | staff_manual (equipe registrou; operador e justificativa obrigatórios).
create table public.quote_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  quote_version_id uuid not null unique,
  decision text not null check (decision in ('approved', 'rejected')),
  channel text not null check (channel in ('customer_link', 'staff_manual')),
  declared_name text not null check (char_length(btrim(declared_name)) between 2 and 120),
  note text check (char_length(note) <= 1000),
  accepted_text text not null check (char_length(accepted_text) between 20 and 2000),
  decided_at timestamptz not null default now(),
  operator_user_id uuid,
  justification text check (char_length(justification) between 10 and 500),
  evidence_attachment_id uuid,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 1024),
  check ((channel = 'staff_manual') = (operator_user_id is not null)),
  check ((channel = 'staff_manual') = (justification is not null)),
  foreign key (quote_version_id, organization_id) references public.quote_versions (id, organization_id) on delete cascade,
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);

-- ======================================================================= peças utilizadas e custos internos
-- Registro de USO (não é estoque). Correção por estorno (quantidade negativa) ou ajuste, sempre referenciando o registro original.
create table public.order_part_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  part_id uuid,
  description text not null check (char_length(btrim(description)) between 2 and 200),
  unit text not null check (char_length(btrim(unit)) between 1 and 16),
  quantity numeric(12,3) not null check (quantity <> 0 and abs(quantity) <= 1000000),
  entry_kind text not null default 'usage' check (entry_kind in ('usage', 'reversal', 'adjustment')),
  reference_usage_id uuid,
  reason text check (char_length(reason) between 3 and 300),
  used_at timestamptz not null default now(),
  registered_by uuid,
  registered_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  check ((entry_kind = 'usage' and quantity > 0 and reference_usage_id is null)
      or (entry_kind = 'reversal' and quantity < 0 and reference_usage_id is not null and reason is not null)
      or (entry_kind = 'adjustment' and reference_usage_id is not null and reason is not null)),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade,
  foreign key (part_id, organization_id) references public.part_catalog (id, organization_id),
  foreign key (reference_usage_id, organization_id) references public.order_part_usage (id, organization_id)
);
create index order_part_usage_order_idx on public.order_part_usage (service_order_id, registered_at);

-- Valores internos: só a gestão lê. Nunca no técnico, no cliente nem em PDF.
create table public.order_internal_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  category text not null check (category in ('labor', 'part', 'travel', 'other')),
  description text not null check (char_length(btrim(description)) between 2 and 200),
  amount_cents bigint not null check (amount_cents between -1000000000 and 1000000000 and amount_cents <> 0),
  corrects_cost_id uuid,
  recorded_by uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  check (amount_cents > 0 or corrects_cost_id is not null),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade,
  foreign key (corrects_cost_id, organization_id) references public.order_internal_costs (id, organization_id)
);
create index order_internal_costs_order_idx on public.order_internal_costs (service_order_id);

-- ======================================================================= checklist da ordem (SNAPSHOT dos itens do modelo)
create table public.order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  source_template_id uuid,
  group_name text not null check (char_length(group_name) between 1 and 100),
  position integer not null check (position between 1 and 500),
  label text not null check (char_length(btrim(label)) between 2 and 200),
  kind text not null check (kind in ('boolean', 'text', 'number', 'select')),
  options jsonb,
  required boolean not null default false,
  allow_na boolean not null default false,
  require_photo boolean not null default false,
  note_rule text not null default 'never' check (note_rule in ('never', 'on_negative', 'always')),
  answer_bool boolean,
  answer_text text check (char_length(answer_text) <= 1000),
  answer_number numeric(14,3),
  answer_option text check (char_length(answer_option) <= 100),
  not_applicable boolean not null default false,
  note text check (char_length(note) <= 500),
  answered_by uuid,
  answered_at timestamptz,
  unique (id, organization_id),
  unique (service_order_id, position),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade,
  foreign key (source_template_id, organization_id) references public.checklist_templates (id, organization_id)
);
create index order_checklist_order_idx on public.order_checklist_items (service_order_id, position);

-- ======================================================================= notas, anexos
create table public.order_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  author_user_id uuid,
  visibility text not null check (visibility in ('internal', 'customer')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);
create index order_updates_order_idx on public.order_updates (service_order_id, created_at);

create table public.order_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  update_id uuid,
  checklist_item_id uuid,
  category text not null check (category in ('before', 'during', 'after', 'document')),
  visibility text not null default 'internal' check (visibility in ('internal', 'customer')),
  storage_path text not null unique check (char_length(storage_path) <= 200),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade,
  foreign key (update_id, organization_id) references public.order_updates (id, organization_id),
  foreign key (checklist_item_id, organization_id) references public.order_checklist_items (id, organization_id)
);
create index order_attachments_order_idx on public.order_attachments (service_order_id, created_at);

-- ======================================================================= conclusão versionada e aceite
-- Cada conclusão congela resumo, checklist, peças e orçamento-base. Reabrir e concluir de novo cria a versão seguinte.
create table public.order_completions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  completion_version integer not null check (completion_version >= 1),
  snapshot_version integer not null,
  summary text not null check (char_length(btrim(summary)) between 5 and 4000),
  divergence_note text check (char_length(divergence_note) <= 1000),
  checklist_snapshot jsonb not null check (jsonb_typeof(checklist_snapshot) = 'array' and pg_column_size(checklist_snapshot) <= 200000),
  parts_snapshot jsonb not null check (jsonb_typeof(parts_snapshot) = 'array' and pg_column_size(parts_snapshot) <= 100000),
  quote_snapshot jsonb check (quote_snapshot is null or jsonb_typeof(quote_snapshot) = 'object'),
  completed_by uuid,
  completed_at timestamptz not null default clock_timestamp(),
  unique (service_order_id, completion_version),
  unique (id, organization_id),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);

create table public.completion_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  completion_version integer not null,
  decision text not null check (decision in ('accepted', 'contested')),
  channel text not null check (channel in ('customer_link', 'staff_manual')),
  declared_name text not null check (char_length(btrim(declared_name)) between 2 and 120),
  accepted_text text not null check (char_length(accepted_text) between 20 and 2000),
  note text check (char_length(note) <= 1000),
  decided_at timestamptz not null default now(),
  operator_user_id uuid,
  justification text check (char_length(justification) between 10 and 500),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 1024),
  unique (service_order_id, completion_version),
  check (decision = 'accepted' or note is not null),
  check ((channel = 'staff_manual') = (operator_user_id is not null)),
  check ((channel = 'staff_manual') = (justification is not null)),
  foreign key (service_order_id, completion_version) references public.order_completions (service_order_id, completion_version) on delete cascade,
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);

-- ======================================================================= eventos, links, contadores, idempotência, limites
create table public.order_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  service_order_id uuid not null,
  event_type text not null check (char_length(event_type) between 2 and 60),
  actor_kind text not null default 'user' check (actor_kind in ('user', 'customer_link', 'system')),
  actor_user_id uuid,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);
create index order_events_order_idx on public.order_events (service_order_id, id);

-- Só o HASH do token é guardado. O token em si aparece uma única vez, para quem o gerou.
create table public.public_access_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_order_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  foreign key (service_order_id, organization_id) references public.service_orders (id, organization_id) on delete cascade
);
create unique index public_access_tokens_active_uq on public.public_access_tokens (service_order_id) where revoked_at is null;

create table public.order_number_counters (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number bigint not null default 0
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

create table public.os_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- A evidência opcional da decisão manual referencia um anexo da mesma ordem.
alter table public.quote_decisions add foreign key (evidence_attachment_id, organization_id) references public.order_attachments (id, organization_id);

commit;
