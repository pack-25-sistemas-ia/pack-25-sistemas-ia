-- Gestão de Ordens de Serviço — ACESSO: perfis derivados do papel do Core + RLS somente de LEITURA. Escrita: exclusivamente funções os_* (SECURITY DEFINER).
-- Perfis: owner (owner/admin do Core) · manager (gestor/atendimento) · technician (member ativo: só as ordens atribuídas a ele). Leitor (viewer) do Core não tem acesso às ordens.
-- O técnico NÃO é um gestor com menus ocultos: o banco nunca lhe entrega custos internos, CPF/CNPJ, rascunhos de orçamento nem ordens de outras pessoas.
-- O cliente por link não é usuário: acessa apenas as funções públicas os_public_* (migração 000500), que devolvem uma projeção limitada.

begin;
set local check_function_bodies = off;

create function private.os_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;

create function private.os_tech_active(org uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.technician_status s where s.organization_id = org and s.user_id = uid and not s.active);
$$;

-- owner | manager | technician | null
create function private.os_profile(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case private.os_role(org)
    when 'owner' then 'owner' when 'admin' then 'owner'
    when 'manager' then case when private.os_tech_active(org, (select auth.uid())) then 'manager' end
    when 'member' then case when private.os_tech_active(org, (select auth.uid())) then 'technician' end
    else null end;
$$;
create function private.os_is_owner(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.os_profile(org) = 'owner', false); $$;
create function private.os_is_manager(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.os_profile(org) in ('owner', 'manager'), false); $$;
create function private.os_is_staff(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.os_profile(org) is not null, false); $$;

-- Perfil de um usuário QUALQUER (as helpers de RLS usam auth.uid(); validações de atribuição precisam olhar para outras pessoas).
create function private.os_profile_of(p_org uuid, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case m.role
    when 'owner' then 'owner' when 'admin' then 'owner'
    when 'manager' then case when private.os_tech_active(p_org, p_uid) then 'manager' end
    when 'member' then case when private.os_tech_active(p_org, p_uid) then 'technician' end
    else null end
  from public.organization_members m where m.organization_id = p_org and m.user_id = p_uid;
$$;

-- Quem pode ser responsável técnico: membro ATIVO de perfil operacional (proprietário, gestor ou técnico).
create function private.os_assignable(p_org uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.os_profile_of(p_org, p_uid) is not null, false);
$$;

-- Gestão vê todas as ordens; técnico, só as atribuídas a ele.
create function private.os_order_visible(org uuid, tech uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(case private.os_profile(org)
    when 'owner' then true when 'manager' then true
    when 'technician' then coalesce(tech = (select auth.uid()), false)
    else false end, false);
$$;

-- A ordem existe, é da empresa e o usuário atual pode vê-la.
create function private.os_can_see_order(org uuid, ord uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.service_orders o where o.id = ord and o.organization_id = org and private.os_order_visible(o.organization_id, o.assigned_technician_user_id));
$$;

-- Técnico: o cliente/endereço/equipamento só aparece se houver ordem atribuída a ele que o use.
create function private.os_customer_visible(org uuid, cust uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.os_profile(org)
    when 'owner' then true when 'manager' then true
    when 'technician' then exists (select 1 from public.service_orders o where o.organization_id = org and o.customer_id = cust and o.assigned_technician_user_id = (select auth.uid()))
    else false end;
$$;
create function private.os_address_visible(org uuid, addr uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.os_profile(org)
    when 'owner' then true when 'manager' then true
    when 'technician' then exists (select 1 from public.service_orders o where o.organization_id = org and o.address_id = addr and o.assigned_technician_user_id = (select auth.uid()))
    else false end;
$$;
create function private.os_equipment_visible(org uuid, eq uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case private.os_profile(org)
    when 'owner' then true when 'manager' then true
    when 'technician' then exists (select 1 from public.service_orders o where o.organization_id = org and o.equipment_id = eq and o.assigned_technician_user_id = (select auth.uid()))
    else false end;
$$;

revoke all on function private.os_role(uuid), private.os_tech_active(uuid, uuid), private.os_profile(uuid), private.os_is_owner(uuid), private.os_is_manager(uuid), private.os_is_staff(uuid),
  private.os_profile_of(uuid, uuid), private.os_assignable(uuid, uuid), private.os_order_visible(uuid, uuid), private.os_can_see_order(uuid, uuid),
  private.os_customer_visible(uuid, uuid), private.os_address_visible(uuid, uuid), private.os_equipment_visible(uuid, uuid) from public, anon;
grant execute on function private.os_role(uuid), private.os_tech_active(uuid, uuid), private.os_profile(uuid), private.os_is_owner(uuid), private.os_is_manager(uuid), private.os_is_staff(uuid),
  private.os_order_visible(uuid, uuid), private.os_can_see_order(uuid, uuid),
  private.os_customer_visible(uuid, uuid), private.os_address_visible(uuid, uuid), private.os_equipment_visible(uuid, uuid) to authenticated;

-- ======================================================================= RLS: leitura por perfil
do $$
declare t text;
begin
  foreach t in array array['os_settings', 'technician_status', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog',
    'checklist_templates', 'checklist_template_items', 'service_orders', 'service_order_snapshots', 'order_pauses', 'quote_versions', 'quote_items', 'quote_decisions', 'order_part_usage',
    'order_internal_costs', 'order_checklist_items', 'order_updates', 'order_attachments', 'order_completions', 'completion_acceptances', 'order_events', 'public_access_tokens',
    'order_number_counters', 'mutation_requests', 'os_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy os_settings_read on public.os_settings for select to authenticated using (private.os_is_staff(organization_id));
create policy os_tech_status_read on public.technician_status for select to authenticated using (private.os_is_manager(organization_id));
create policy os_customers_read on public.customers for select to authenticated using (private.os_customer_visible(organization_id, id));
create policy os_customer_private_read on public.customer_private for select to authenticated using (private.os_is_manager(organization_id));
create policy os_contacts_read on public.customer_contacts for select to authenticated using (private.os_is_manager(organization_id));
create policy os_addresses_read on public.customer_addresses for select to authenticated using (private.os_address_visible(organization_id, id));
create policy os_equipment_read on public.equipment for select to authenticated using (private.os_equipment_visible(organization_id, id));
create policy os_services_read on public.service_catalog for select to authenticated using (private.os_is_staff(organization_id));
create policy os_parts_read on public.part_catalog for select to authenticated using (private.os_is_staff(organization_id));
create policy os_templates_read on public.checklist_templates for select to authenticated using (private.os_is_manager(organization_id));
create policy os_template_items_read on public.checklist_template_items for select to authenticated using (private.os_is_manager(organization_id));

create policy os_orders_read on public.service_orders for select to authenticated using (private.os_order_visible(organization_id, assigned_technician_user_id));
create policy os_snapshots_read on public.service_order_snapshots for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
create policy os_pauses_read on public.order_pauses for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
-- Rascunho de orçamento é trabalho da gestão; o técnico lê as versões já publicadas (escopo e quantidades) das ordens dele.
create policy os_quotes_read on public.quote_versions for select to authenticated using (
  private.os_can_see_order(organization_id, service_order_id) and (status <> 'draft' or private.os_is_manager(organization_id)));
create policy os_quote_items_read on public.quote_items for select to authenticated using (
  exists (select 1 from public.quote_versions q where q.id = quote_version_id and q.organization_id = quote_items.organization_id
    and private.os_can_see_order(q.organization_id, q.service_order_id) and (q.status <> 'draft' or private.os_is_manager(q.organization_id))));
create policy os_quote_decisions_read on public.quote_decisions for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
create policy os_part_usage_read on public.order_part_usage for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
-- Custos internos: SOMENTE gestão. (Tabela separada: RLS por linha não protegeria colunas de uma linha autorizada.)
create policy os_costs_read on public.order_internal_costs for select to authenticated using (private.os_is_manager(organization_id));
create policy os_checklist_read on public.order_checklist_items for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
create policy os_updates_read on public.order_updates for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
create policy os_attachments_read on public.order_attachments for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
create policy os_completions_read on public.order_completions for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
create policy os_acceptances_read on public.completion_acceptances for select to authenticated using (private.os_can_see_order(organization_id, service_order_id));
-- Eventos de custo não aparecem ao técnico.
create policy os_events_read on public.order_events for select to authenticated using (
  private.os_can_see_order(organization_id, service_order_id) and (event_type not like 'cost%' or private.os_is_manager(organization_id)));
create policy os_tokens_read on public.public_access_tokens for select to authenticated using (private.os_is_manager(organization_id));
-- order_number_counters, mutation_requests e os_rate_limits: SEM política (ninguém lê pela API; só as funções os_*).

-- Nenhum privilégio de escrita direta; leitura só nas tabelas com política (o hash do token nunca é legível pela API).
do $$
declare t text;
begin
  foreach t in array array['os_settings', 'technician_status', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog',
    'checklist_templates', 'checklist_template_items', 'service_orders', 'service_order_snapshots', 'order_pauses', 'quote_versions', 'quote_items', 'quote_decisions', 'order_part_usage',
    'order_internal_costs', 'order_checklist_items', 'order_updates', 'order_attachments', 'order_completions', 'completion_acceptances', 'order_events', 'public_access_tokens',
    'order_number_counters', 'mutation_requests', 'os_rate_limits'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  foreach t in array array['os_settings', 'technician_status', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog',
    'checklist_templates', 'checklist_template_items', 'service_orders', 'service_order_snapshots', 'order_pauses', 'quote_versions', 'quote_items', 'quote_decisions', 'order_part_usage',
    'order_internal_costs', 'order_checklist_items', 'order_updates', 'order_attachments', 'order_completions', 'completion_acceptances', 'order_events'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant select (id, organization_id, service_order_id, expires_at, revoked_at, created_at, last_used_at) on public.public_access_tokens to authenticated;

commit;
