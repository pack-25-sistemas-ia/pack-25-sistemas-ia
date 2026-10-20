-- Gestão de Contratos — ACESSO: perfis derivados do papel do Core + papel DENTRO do contrato + RLS somente de LEITURA.
-- Escrita: exclusivamente funções ct_* (SECURITY DEFINER). Perfis da organização:
--   owner (owner/admin do Core) · manager (gerente: todos os contratos) · collaborator (membro: só contratos a que foi vinculado) · viewer (leitor do Core: só consulta, sempre «leitor»).
-- Papéis no contrato: editor · leitor. Proprietário e gestor atuam como «gestão» em TODOS os contratos da empresa.

begin;
set local check_function_bodies = off;

create function private.ct_role(org uuid) returns public.org_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.organization_members m where m.organization_id = org and m.user_id = (select auth.uid());
$$;
create function private.ct_profile_of(p_org uuid, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case m.role when 'owner' then 'owner' when 'admin' then 'owner' when 'manager' then 'manager' when 'member' then 'collaborator' when 'viewer' then 'viewer' end
  from public.organization_members m where m.organization_id = p_org and m.user_id = p_uid;
$$;
create function private.ct_profile(org uuid) returns text
language sql stable security definer set search_path = '' as $$ select private.ct_profile_of(org, (select auth.uid())); $$;
create function private.ct_is_owner(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.ct_profile(org) = 'owner', false); $$;
create function private.ct_is_manager(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.ct_profile(org) in ('owner', 'manager'), false); $$;
create function private.ct_is_member(org uuid) returns boolean language sql stable security definer set search_path = '' as $$ select coalesce(private.ct_profile(org) is not null, false); $$;

-- Papel de um usuário QUALQUER no contrato: 'manager' (gestão), 'editor', 'reader' ou nulo (sem acesso).
create function private.ct_contract_role_of(p_org uuid, p_contract uuid, p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.contracts c where c.id = p_contract and c.organization_id = p_org) then null
    when private.ct_profile_of(p_org, p_uid) in ('owner', 'manager') then 'manager'
    else (select a.contract_role from public.contract_access a where a.organization_id = p_org and a.contract_id = p_contract and a.user_id = p_uid
          and private.ct_profile_of(p_org, p_uid) is not null)
  end;
$$;
create function private.ct_contract_role(p_org uuid, p_contract uuid) returns text
language sql stable security definer set search_path = '' as $$ select private.ct_contract_role_of(p_org, p_contract, (select auth.uid())); $$;

create function private.ct_can_see_contract(p_org uuid, p_contract uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select private.ct_contract_role(p_org, p_contract) is not null; $$;
create function private.ct_can_edit_contract(p_org uuid, p_contract uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.ct_contract_role(p_org, p_contract) in ('manager', 'editor'), false); $$;
create function private.ct_can_manage_contract(p_org uuid, p_contract uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.ct_contract_role(p_org, p_contract) = 'manager', false); $$;
-- Quem pode ser RESPONSÁVEL: membro com acesso ao contrato E permissão de edição (gestão ou editor). Leitor nunca.
create function private.ct_assignable(p_org uuid, p_contract uuid, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select coalesce(private.ct_contract_role_of(p_org, p_contract, p_uid) in ('manager', 'editor'), false); $$;
-- Parte visível: a gestão vê todas; os demais, só as de contratos que enxergam.
create function private.ct_can_see_counterparty(p_org uuid, p_cp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ct_is_manager(p_org) or exists (select 1 from public.contract_parties p where p.organization_id = p_org and p.counterparty_id = p_cp and private.ct_can_see_contract(p_org, p.contract_id));
$$;

revoke all on function private.ct_role(uuid), private.ct_profile(uuid), private.ct_profile_of(uuid, uuid), private.ct_is_owner(uuid), private.ct_is_manager(uuid), private.ct_is_member(uuid),
  private.ct_contract_role_of(uuid, uuid, uuid), private.ct_contract_role(uuid, uuid), private.ct_can_see_contract(uuid, uuid), private.ct_can_edit_contract(uuid, uuid),
  private.ct_can_manage_contract(uuid, uuid), private.ct_assignable(uuid, uuid, uuid), private.ct_can_see_counterparty(uuid, uuid) from public, anon;
grant execute on function private.ct_role(uuid), private.ct_profile(uuid), private.ct_is_owner(uuid), private.ct_is_manager(uuid), private.ct_is_member(uuid),
  private.ct_contract_role(uuid, uuid), private.ct_can_see_contract(uuid, uuid), private.ct_can_edit_contract(uuid, uuid), private.ct_can_manage_contract(uuid, uuid),
  private.ct_can_see_counterparty(uuid, uuid) to authenticated;

-- ======================================================================= RLS: leitura
do $$
declare t text;
begin
  foreach t in array array['ct_settings', 'counterparties', 'counterparty_documents', 'contract_categories', 'contracts', 'contract_access', 'contract_parties', 'contract_documents',
    'contract_document_versions', 'contract_changes', 'contract_value_versions', 'contract_adjustment_rules', 'contract_adjustments', 'contract_obligations', 'contract_deadlines',
    'reminder_rules', 'reminder_deliveries', 'notifications', 'contract_events', 'contract_number_counters', 'mutation_requests', 'ct_rate_limits', 'ct_job_tokens', 'ct_job_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

create policy ct_settings_read on public.ct_settings for select to authenticated using (private.ct_is_member(organization_id));
create policy ct_categories_read on public.contract_categories for select to authenticated using (private.ct_is_member(organization_id));
create policy ct_reminder_rules_read on public.reminder_rules for select to authenticated using (private.ct_is_member(organization_id));
create policy ct_counterparties_read on public.counterparties for select to authenticated using (private.ct_can_see_counterparty(organization_id, id));
create policy ct_counterparty_documents_read on public.counterparty_documents for select to authenticated using (private.ct_is_manager(organization_id));
create policy ct_contracts_read on public.contracts for select to authenticated using (private.ct_can_see_contract(organization_id, id));
create policy ct_access_read on public.contract_access for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_parties_read on public.contract_parties for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_documents_read on public.contract_documents for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_doc_versions_read on public.contract_document_versions for select to authenticated using (
  exists (select 1 from public.contract_documents d where d.id = document_id and d.organization_id = contract_document_versions.organization_id and private.ct_can_see_contract(d.organization_id, d.contract_id)));
create policy ct_changes_read on public.contract_changes for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_values_read on public.contract_value_versions for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_rules_read on public.contract_adjustment_rules for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_adjustments_read on public.contract_adjustments for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_obligations_read on public.contract_obligations for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_deadlines_read on public.contract_deadlines for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
create policy ct_events_read on public.contract_events for select to authenticated using (private.ct_can_see_contract(organization_id, contract_id));
-- Notificação: só a própria, e somente enquanto o usuário ainda enxerga o contrato.
create policy ct_notifications_read on public.notifications for select to authenticated using (user_id = (select auth.uid()) and private.ct_can_see_contract(organization_id, contract_id));
create policy ct_job_runs_read on public.ct_job_runs for select to authenticated using (private.ct_is_manager(organization_id));
-- Contadores, idempotência, limites, entregas de lembretes e token do agendador: SEM política (só as funções ct_*).

grant select on public.ct_settings, public.counterparties, public.counterparty_documents, public.contract_categories, public.contracts, public.contract_access, public.contract_parties,
  public.contract_documents, public.contract_changes, public.contract_value_versions, public.contract_adjustment_rules, public.contract_adjustments, public.contract_obligations,
  public.contract_deadlines, public.reminder_rules, public.notifications, public.contract_events, public.ct_job_runs to authenticated;
-- storage_path não é legível pela API: o download passa por ct_document_info + URL assinada curta.
grant select (id, organization_id, document_id, version_number, original_filename, mime_type, size_bytes, sha256, uploaded_by, created_at) on public.contract_document_versions to authenticated;

commit;
