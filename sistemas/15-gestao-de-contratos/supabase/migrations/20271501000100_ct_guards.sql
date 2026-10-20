-- Gestão de Contratos — GUARDAS: autorização das funções, auditoria (só metadados), imutabilidade do histórico, ciclo de vida do contrato, acesso por contrato, obrigações
-- e limpeza de atribuições quando alguém sai da empresa. Tudo aqui vale mesmo para quem escreve SQL direto: a interface apenas reflete estas regras.

begin;
set local check_function_bodies = off;

-- nível: owner | manager (owner e gestor) | member (qualquer perfil da empresa, inclusive leitor)
create function private.ct_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare prof text; ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  prof := private.ct_profile(p_org);
  ok := prof is not null and case p_level when 'owner' then prof = 'owner' when 'manager' then prof in ('owner', 'manager') else true end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.ct_guard(uuid, text) from public, anon;
grant execute on function private.ct_guard(uuid, text) to authenticated;

create function private.ct_audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_changes jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes) values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id, p_changes);
end $$;
revoke all on function private.ct_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

create function private.ct_rate_hit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); h integer;
begin
  insert into public.ct_rate_limits as r (bucket, window_start, hits) values (left(p_bucket, 120), w, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1 returning hits into h;
  if h > p_max then raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' using errcode = '54000'; end if;
  if random() < 0.02 then
    delete from public.ct_rate_limits where window_start < now() - interval '2 days';
    delete from public.mutation_requests where created_at < now() - interval '2 days';
  end if;
end $$;
revoke all on function private.ct_rate_hit(text, integer, integer) from public, anon, authenticated;

-- ======================================================================= updated_at, auditoria (só metadados) e organização imutável
do $$
declare t text;
begin
  foreach t in array array['ct_settings', 'contracts', 'counterparties', 'contract_obligations', 'contract_adjustment_rules'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['ct_settings', 'contracts', 'counterparties', 'contract_access'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id', case t when 'ct_settings' then 'organization_id' when 'contract_access' then 'user_id' else 'id' end);
  end loop;
end $$;

create function private.ct_org_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.ct_org_immutable() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['ct_settings', 'contracts', 'counterparties', 'contract_categories', 'contract_obligations', 'notifications', 'contract_documents'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.ct_org_immutable()', 'orgimm_' || t, t);
  end loop;
end $$;

-- ======================================================================= imutabilidade: histórico nunca se apaga nem se reescreve
create function private.ct_bypass() returns boolean language sql stable set search_path = '' as $$ select coalesce(current_setting('ct.bypass', true), '') = 'on'; $$;
revoke all on function private.ct_bypass() from public, anon, authenticated;
create function private.ct_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  if private.ct_bypass() then return old; end if; -- só a exclusão de rascunho sem histórico (função própria) liga o bypass
  raise exception 'registro não pode ser apagado (histórico preservado): %', tg_table_name using errcode = '23514';
end $$;
create function private.ct_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: %', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.ct_no_delete() from public, anon, authenticated;
revoke all on function private.ct_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['counterparties', 'contract_categories', 'contract_documents', 'contract_document_versions', 'contract_changes', 'contract_value_versions', 'contract_adjustments',
    'contract_deadlines', 'contract_events', 'reminder_deliveries'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.ct_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['contract_document_versions', 'contract_changes', 'contract_value_versions', 'contract_events', 'reminder_deliveries'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.ct_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- contratos: só o rascunho sem histórico pode ser apagado (pela função própria, com bypass)
create function private.ct_contract_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin
  if private.ct_bypass() and old.lifecycle_status = 'draft' then return old; end if;
  raise exception 'contrato não pode ser apagado (histórico preservado); apenas rascunho sem histórico' using errcode = '23514';
end $$;
revoke all on function private.ct_contract_no_delete() from public, anon, authenticated;
create trigger nodel_contracts before delete on public.contracts for each row execute function private.ct_contract_no_delete();

-- documento: só o ponteiro da versão atual e o contador mudam
create function private.ct_document_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'current_version_id' - 'version_counter') is distinct from (to_jsonb(old) - 'current_version_id' - 'version_counter') then
    raise exception 'o documento só muda de versão atual' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ct_document_guard() from public, anon, authenticated;
create trigger document_guard before update on public.contract_documents for each row execute function private.ct_document_guard();

-- prazos derivados: só ganham «substituído em»
create function private.ct_deadline_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.superseded_at is not null or (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception 'prazo registrado não muda: crie uma nova revisão' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ct_deadline_guard() from public, anon, authenticated;
create trigger deadline_guard before update on public.contract_deadlines for each row execute function private.ct_deadline_guard();

-- reajuste: proposto → aplicado | cancelado; depois disso não muda
create function private.ct_adjustment_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'proposed' then raise exception 'reajuste % é definitivo', old.status using errcode = '23514'; end if;
  if new.status not in ('applied', 'cancelled') then raise exception 'transição de reajuste inválida' using errcode = '23514'; end if;
  if (to_jsonb(new) - 'status' - 'applied_by' - 'applied_at') is distinct from (to_jsonb(old) - 'status' - 'applied_by' - 'applied_at') then
    raise exception 'os dados do reajuste proposto não mudam: cancele e simule de novo' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ct_adjustment_guard() from public, anon, authenticated;
create trigger adjustment_guard before update on public.contract_adjustments for each row execute function private.ct_adjustment_guard();

-- notificação: só `read_at` muda (marcar como lida), uma vez
create function private.ct_notification_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') or old.read_at is not null then
    raise exception 'notificação só pode ser marcada como lida' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ct_notification_guard() from public, anon, authenticated;
create trigger notification_guard before update on public.notifications for each row execute function private.ct_notification_guard();

-- ======================================================================= contrato: ciclo de vida, vigência e arquivamento
--   draft → active · active → terminated | closed · terminated | closed → active (reabertura) · arquivar só terminated | closed
create function private.ct_contract_guard() returns trigger language plpgsql set search_path = '' as $$
declare meta text[] := array['version', 'updated_at', 'deadline_revision']; content_changed boolean; parties integer; bypass boolean := private.ct_bypass();
begin
  if new.id <> old.id or new.contract_number <> old.contract_number or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'identidade do contrato (número, autoria) é imutável' using errcode = '23514';
  end if;
  content_changed := (to_jsonb(new) - meta - 'archived_at') is distinct from (to_jsonb(old) - meta - 'archived_at');
  if not bypass then
    if new.lifecycle_status is distinct from old.lifecycle_status and not (
         (old.lifecycle_status = 'draft' and new.lifecycle_status = 'active')
      or (old.lifecycle_status = 'active' and new.lifecycle_status in ('terminated', 'closed'))
      or (old.lifecycle_status in ('terminated', 'closed') and new.lifecycle_status = 'active')) then
      raise exception 'transição do contrato inválida: % → %', old.lifecycle_status, new.lifecycle_status using errcode = '23514';
    end if;
    if old.archived_at is not null and new.archived_at is not null and content_changed then
      raise exception 'contrato arquivado é somente para consulta (desarquive para alterar)' using errcode = '23514';
    end if;
    if old.lifecycle_status in ('terminated', 'closed') and new.lifecycle_status = old.lifecycle_status and content_changed then
      raise exception 'contrato encerrado é somente para consulta (reabra para alterar)' using errcode = '23514';
    end if;
    if new.archived_at is not null and old.archived_at is null and new.lifecycle_status not in ('terminated', 'closed') then
      raise exception 'só contratos rescindidos ou encerrados podem ser arquivados' using errcode = '23514';
    end if;
    if new.archived_at is null and old.archived_at is not null and new.lifecycle_status <> old.lifecycle_status then
      raise exception 'desarquive e reabra em passos separados' using errcode = '23514';
    end if;
    if new.lifecycle_status = 'active' and old.lifecycle_status = 'draft' then
      select count(*) into parties from public.contract_parties where contract_id = new.id;
      if parties < 1 then raise exception 'para ativar, informe ao menos uma parte do contrato' using errcode = '23514'; end if;
    end if;
    if new.responsible_user_id is not null and new.responsible_user_id is distinct from old.responsible_user_id
       and not private.ct_assignable(new.organization_id, new.id, new.responsible_user_id) then
      raise exception 'responsável inválido: precisa ser membro com acesso e permissão de edição ao contrato' using errcode = '23514';
    end if;
  end if;
  if (to_jsonb(new) - meta) is distinct from (to_jsonb(old) - meta) then new.version := old.version + 1; end if;
  return new;
end $$;
revoke all on function private.ct_contract_guard() from public, anon, authenticated;
create trigger contract_guard before update on public.contracts for each row execute function private.ct_contract_guard();

-- ======================================================================= acesso por contrato
create function private.ct_access_guard() returns trigger language plpgsql set search_path = '' as $$
declare cid uuid := coalesce(new.contract_id, old.contract_id); prof text; arch timestamptz;
begin
  if private.ct_bypass() then return coalesce(new, old); end if;
  select archived_at into arch from public.contracts where id = cid;
  if arch is not null then raise exception 'contrato arquivado: acessos não mudam' using errcode = '23514'; end if;
  if tg_op in ('INSERT', 'UPDATE') then
    prof := private.ct_profile_of(new.organization_id, new.user_id);
    if prof in ('owner', 'manager') then raise exception 'proprietário e gestor já têm acesso a todos os contratos' using errcode = '23514'; end if;
    if prof = 'viewer' and new.contract_role <> 'reader' then raise exception 'quem tem o papel «Leitor» na empresa só pode ser leitor no contrato' using errcode = '23514'; end if;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.contract_role = 'reader') then
    if exists (select 1 from public.contracts c where c.id = cid and c.responsible_user_id = old.user_id) then
      raise exception 'esta pessoa é a responsável pelo contrato: troque o responsável antes' using errcode = '23514';
    end if;
    if exists (select 1 from public.contract_obligations o where o.contract_id = cid and o.responsible_user_id = old.user_id and o.status = 'pending') then
      raise exception 'esta pessoa tem obrigações pendentes neste contrato: reatribua antes' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.ct_access_guard() from public, anon, authenticated;
create trigger access_guard before insert or update or delete on public.contract_access for each row execute function private.ct_access_guard();

-- ======================================================================= obrigações
create function private.ct_obligation_guard() returns trigger language plpgsql set search_path = '' as $$
declare arch timestamptz; meta text[] := array['version', 'updated_at', 'revision']; bypass boolean := private.ct_bypass();
begin
  select archived_at into arch from public.contracts where id = new.contract_id;
  if tg_op = 'INSERT' then
    if arch is not null and not bypass then raise exception 'contrato arquivado: não recebe obrigações' using errcode = '23514'; end if;
    if new.status <> 'pending' then raise exception 'uma obrigação nova nasce pendente' using errcode = '23514'; end if;
    if new.responsible_user_id is not null and not private.ct_assignable(new.organization_id, new.contract_id, new.responsible_user_id) then
      raise exception 'responsável inválido: precisa ter acesso ao contrato com permissão de edição' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.contract_id <> old.contract_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'identidade da obrigação é imutável' using errcode = '23514';
  end if;
  if not bypass then
    if old.status <> 'pending' then raise exception 'obrigação % é definitiva', old.status using errcode = '23514'; end if;
    if arch is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
    if new.responsible_user_id is not null and new.responsible_user_id is distinct from old.responsible_user_id
       and not private.ct_assignable(new.organization_id, new.contract_id, new.responsible_user_id) then
      raise exception 'responsável inválido: precisa ter acesso ao contrato com permissão de edição' using errcode = '23514';
    end if;
  end if;
  if new.due_date is distinct from old.due_date then new.revision := old.revision + 1; end if;
  if (to_jsonb(new) - meta) is distinct from (to_jsonb(old) - meta) then new.version := old.version + 1; end if;
  return new;
end $$;
revoke all on function private.ct_obligation_guard() from public, anon, authenticated;
create trigger obligation_guard before insert or update on public.contract_obligations for each row execute function private.ct_obligation_guard();

-- versões de documento só entram em contrato não arquivado
create function private.ct_doc_version_guard() returns trigger language plpgsql set search_path = '' as $$
declare arch timestamptz;
begin
  select c.archived_at into arch from public.contract_documents d join public.contracts c on c.id = d.contract_id where d.id = new.document_id;
  if arch is not null then raise exception 'contrato arquivado: não recebe documentos' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.ct_doc_version_guard() from public, anon, authenticated;
create trigger doc_version_guard before insert on public.contract_document_versions for each row execute function private.ct_doc_version_guard();

-- ======================================================================= quem sai da empresa (ou vira «Leitor») não deixa atribuições penduradas
create function private.ct_member_gone() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'UPDATE' then
    if new.role = old.role then return new; end if;
    if new.role not in ('viewer', 'owner', 'admin', 'manager') then return new; end if;
  end if;
  perform set_config('ct.bypass', 'on', true);
  for r in select id from public.contracts where organization_id = old.organization_id and responsible_user_id = old.user_id for update loop
    update public.contracts set responsible_user_id = null where id = r.id;
    insert into public.contract_events (organization_id, contract_id, event_type, actor_kind, actor_user_id, data)
      values (old.organization_id, r.id, 'responsible_removed', 'system', (select auth.uid()), jsonb_build_object('reason', case when tg_op = 'DELETE' then 'member_removed' else 'role_changed' end));
  end loop;
  update public.contract_obligations set responsible_user_id = null where organization_id = old.organization_id and responsible_user_id = old.user_id and status = 'pending';
  if tg_op = 'DELETE' or new.role in ('owner', 'admin', 'manager') then
    delete from public.contract_access where organization_id = old.organization_id and user_id = old.user_id;
  else
    update public.contract_access set contract_role = 'reader' where organization_id = old.organization_id and user_id = old.user_id and contract_role <> 'reader';
  end if;
  perform set_config('ct.bypass', 'off', true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.ct_member_gone() from public, anon, authenticated;
create trigger ct_member_gone before delete or update of role on public.organization_members for each row execute function private.ct_member_gone();

-- ======================================================================= configurações e contadores iniciais da empresa
create function private.ct_bootstrap_org() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ct_settings (organization_id) values (new.id) on conflict do nothing;
  insert into public.contract_number_counters (organization_id) values (new.id) on conflict do nothing;
  insert into public.reminder_rules (organization_id, event_type, offsets_days) values
    (new.id, 'contract_end', '{60,30,15,7}'), (new.id, 'notice', '{30,15,7,1}'), (new.id, 'adjustment', '{30,15,7}'), (new.id, 'obligation', '{7,3,1,0}') on conflict do nothing;
  return null;
end $$;
revoke all on function private.ct_bootstrap_org() from public, anon, authenticated;
create trigger ct_bootstrap_org after insert on public.organizations for each row execute function private.ct_bootstrap_org();

insert into public.ct_settings (organization_id) select id from public.organizations on conflict do nothing;
insert into public.contract_number_counters (organization_id) select id from public.organizations on conflict do nothing;
insert into public.reminder_rules (organization_id, event_type, offsets_days)
  select o.id, x.t, x.o from public.organizations o cross join (values ('contract_end', '{60,30,15,7}'::int[]), ('notice', '{30,15,7,1}'), ('adjustment', '{30,15,7}'), ('obligation', '{7,3,1,0}')) x(t, o) on conflict do nothing;

commit;
