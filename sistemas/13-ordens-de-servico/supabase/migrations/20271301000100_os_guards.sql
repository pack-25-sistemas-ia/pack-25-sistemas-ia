-- Gestão de Ordens de Serviço — GUARDAS: autorização das funções, auditoria (só metadados), imutabilidade do histórico, máquina de estados, orçamento congelado,
-- limpeza de atribuições quando alguém sai da empresa e criação automática das configurações iniciais junto com cada empresa.
-- A interface só reflete estas regras: elas valem mesmo para quem falar direto com a API.

begin;
set local check_function_bodies = off;

-- ======================================================================= autorização das funções os_*
-- nível: owner | manager (owner e gestor) | staff (qualquer perfil operacional) | any
create function private.os_guard(p_org uuid, p_level text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare prof text; ok boolean;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;
  prof := private.os_profile(p_org);
  ok := prof is not null and case p_level
    when 'owner' then prof = 'owner'
    when 'manager' then prof in ('owner', 'manager')
    else true end;
  if not ok then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.os_guard(uuid, text) from public, anon;
grant execute on function private.os_guard(uuid, text) to authenticated;

create function private.os_audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_changes jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, changes) values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id, p_changes);
end $$;
revoke all on function private.os_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Limite de abuso compartilhado (no banco). Ao estourar, a transação é desfeita.
create function private.os_rate_hit(p_bucket text, p_max integer, p_window_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); h integer;
begin
  insert into public.os_rate_limits as r (bucket, window_start, hits) values (left(p_bucket, 120), w, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1 returning hits into h;
  if h > p_max then raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' using errcode = '54000'; end if;
  if random() < 0.02 then
    delete from public.os_rate_limits where window_start < now() - interval '2 days';
    delete from public.mutation_requests where created_at < now() - interval '2 days';
  end if;
end $$;
revoke all on function private.os_rate_hit(text, integer, integer) from public, anon, authenticated;

-- Contador SEM exceção (para falhas): o chamador responde normalmente e a transação confirma o incremento. `os_rate_peek` lê o contador atual sem alterá-lo.
create function private.os_rate_bump(p_bucket text, p_window_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
begin
  insert into public.os_rate_limits as r (bucket, window_start, hits) values (left(p_bucket, 120), w, 1) on conflict (bucket, window_start) do update set hits = r.hits + 1;
end $$;
create function private.os_rate_peek(p_bucket text, p_window_seconds integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select hits from public.os_rate_limits where bucket = left(p_bucket, 120) and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)), 0);
$$;
revoke all on function private.os_rate_bump(text, integer), private.os_rate_peek(text, integer) from public, anon, authenticated;

-- ======================================================================= updated_at, auditoria (só metadados) e organização imutável
do $$
declare t text;
begin
  foreach t in array array['os_settings', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog', 'checklist_templates',
    'service_orders', 'quote_versions'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', 'upd_' || t, t);
  end loop;
  foreach t in array array['os_settings', 'technician_status', 'customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog',
    'checklist_templates', 'service_orders', 'quote_versions', 'quote_decisions', 'completion_acceptances', 'order_completions', 'public_access_tokens'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_trigger(%L, %L)',
      'audit_' || t, t, 'organization_id',
      case t when 'os_settings' then 'organization_id' when 'technician_status' then 'user_id' when 'customer_private' then 'customer_id' else 'id' end);
  end loop;
end $$;

create function private.os_org_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar' using errcode = '23514'; end if;
  return new;
end $$;
revoke all on function private.os_org_immutable() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_private', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog', 'checklist_templates',
    'service_orders', 'quote_versions', 'order_checklist_items', 'order_pauses', 'order_attachments', 'public_access_tokens'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.os_org_immutable()', 'orgimm_' || t, t);
  end loop;
end $$;

-- ======================================================================= imutabilidade: histórico nunca se apaga nem se reescreve
create function private.os_no_delete() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro não pode ser apagado (histórico preservado): %', tg_table_name using errcode = '23514'; end $$;
create function private.os_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'registro imutável: %', tg_table_name using errcode = '23514'; end $$;
revoke all on function private.os_no_delete() from public, anon, authenticated;
revoke all on function private.os_append_only() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['customers', 'customer_contacts', 'customer_addresses', 'equipment', 'service_catalog', 'part_catalog', 'checklist_templates', 'service_orders', 'service_order_snapshots',
    'order_pauses', 'quote_versions', 'quote_decisions', 'order_part_usage', 'order_internal_costs', 'order_checklist_items', 'order_updates', 'order_attachments', 'order_completions',
    'completion_acceptances', 'order_events', 'public_access_tokens'] loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.os_no_delete()', 'nodel_' || t, t);
  end loop;
  foreach t in array array['service_order_snapshots', 'quote_decisions', 'order_part_usage', 'order_internal_costs', 'order_updates', 'order_completions', 'completion_acceptances', 'order_events'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.os_append_only()', 'append_' || t, t);
  end loop;
end $$;

-- Pausa: só pode ser encerrada, uma vez.
create function private.os_pause_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.service_order_id <> old.service_order_id or new.started_at <> old.started_at or new.reason <> old.reason or old.ended_at is not null then
    raise exception 'pausa só pode ser encerrada, uma vez' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.os_pause_guard() from public, anon, authenticated;
create trigger pause_guard before update on public.order_pauses for each row execute function private.os_pause_guard();

-- Anexo: só a visibilidade pode mudar (compartilhar/ocultar do cliente), e isso fica no evento da ordem.
create function private.os_attachment_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'visibility') is distinct from (to_jsonb(old) - 'visibility') then
    raise exception 'anexo é imutável (só a visibilidade pode mudar)' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.os_attachment_guard() from public, anon, authenticated;
create trigger attachment_guard before update on public.order_attachments for each row execute function private.os_attachment_guard();

-- Link público: só pode ser revogado (uma vez) ou registrar o último uso.
create function private.os_token_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'revoked_at' - 'last_used_at') is distinct from (to_jsonb(old) - 'revoked_at' - 'last_used_at')
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'link de acompanhamento só pode ser revogado' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.os_token_guard() from public, anon, authenticated;
create trigger token_guard before update on public.public_access_tokens for each row execute function private.os_token_guard();

-- Item de checklist: a estrutura vem do SNAPSHOT do modelo e não muda; só a resposta muda.
create function private.os_checklist_guard() returns trigger language plpgsql set search_path = '' as $$
declare answer text[] := array['answer_bool', 'answer_text', 'answer_number', 'answer_option', 'not_applicable', 'note', 'answered_by', 'answered_at'];
begin
  if (to_jsonb(new) - answer) is distinct from (to_jsonb(old) - answer) then
    raise exception 'a estrutura do item de checklist é um snapshot e não muda' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.os_checklist_guard() from public, anon, authenticated;
create trigger checklist_guard before update on public.order_checklist_items for each row execute function private.os_checklist_guard();

-- ======================================================================= ordem: identidade, estados, versão, responsável
create function private.os_order_guard() returns trigger language plpgsql set search_path = '' as $$
declare meta text[] := array['version', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.assigned_technician_user_id is not null and not private.os_assignable(new.organization_id, new.assigned_technician_user_id) then
      raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.order_number <> old.order_number or new.customer_id <> old.customer_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'identidade da ordem (número, cliente, autoria) é imutável' using errcode = '23514';
  end if;
  if new.execution_status is distinct from old.execution_status and not (
       (old.execution_status = 'draft' and new.execution_status in ('open', 'cancelled'))
    or (old.execution_status = 'open' and new.execution_status in ('scheduled', 'in_progress', 'cancelled'))
    or (old.execution_status = 'scheduled' and new.execution_status in ('open', 'in_progress', 'cancelled'))
    or (old.execution_status = 'in_progress' and new.execution_status in ('paused', 'completed', 'cancelled'))
    or (old.execution_status = 'paused' and new.execution_status in ('in_progress', 'cancelled'))
    or (old.execution_status = 'completed' and new.execution_status in ('closed', 'in_progress'))
    or (old.execution_status = 'closed' and new.execution_status = 'in_progress')) then
    raise exception 'transição de status inválida: % → %', old.execution_status, new.execution_status using errcode = '23514';
  end if;
  -- ordem concluída (aguardando aceite), encerrada ou cancelada não é editada livremente: só muda de estado por fluxo explícito.
  if old.execution_status in ('completed', 'closed', 'cancelled') and new.execution_status = old.execution_status
     and (to_jsonb(new) - meta) is distinct from (to_jsonb(old) - meta) then
    raise exception 'ordem % não pode ser editada (correções exigem reabertura auditada)', old.execution_status using errcode = '23514';
  end if;
  if new.execution_status = 'in_progress' and old.execution_status <> 'in_progress' and new.assigned_technician_user_id is null then
    raise exception 'iniciar a execução exige um responsável técnico' using errcode = '23514';
  end if;
  if new.assigned_technician_user_id is not null and new.assigned_technician_user_id is distinct from old.assigned_technician_user_id
     and not private.os_assignable(new.organization_id, new.assigned_technician_user_id) then
    raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '23514';
  end if;
  if new.completion_version < old.completion_version or new.completion_version > old.completion_version + 1 then
    raise exception 'versão de conclusão inválida' using errcode = '23514';
  end if;
  if old.quote_mode = 'authorized' and new.quote_mode = 'required' and old.execution_status not in ('draft', 'open') then
    raise exception 'a autorização sem orçamento não pode ser desfeita depois do agendamento' using errcode = '23514';
  end if;
  if (to_jsonb(new) - meta) is distinct from (to_jsonb(old) - meta) then new.version := old.version + 1; end if;
  return new;
end $$;
revoke all on function private.os_order_guard() from public, anon, authenticated;
create trigger order_guard before insert or update on public.service_orders for each row execute function private.os_order_guard();

-- ======================================================================= orçamento: versões congeladas ao publicar
create function private.os_quote_guard() returns trigger language plpgsql set search_path = '' as $$
declare content text[] := array['subtotal_cents', 'discount_cents', 'total_cents', 'valid_until', 'terms_snapshot', 'notes', 'published_at', 'published_by', 'snapshot_version'];
begin
  if new.service_order_id <> old.service_order_id or new.version_number <> old.version_number or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'identidade da versão do orçamento é imutável' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'published')
    or (old.status = 'published' and new.status in ('approved', 'rejected', 'superseded'))) then
    raise exception 'transição de orçamento inválida: % → %', old.status, new.status using errcode = '23514';
  end if;
  if old.status <> 'draft'
     and (to_jsonb(new) - 'status' - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'version' - 'updated_at') then
    raise exception 'orçamento publicado é imutável: crie uma nova versão' using errcode = '23514';
  end if;
  if (to_jsonb(new) - 'version' - 'updated_at') is distinct from (to_jsonb(old) - 'version' - 'updated_at') then new.version := old.version + 1; end if;
  return new;
end $$;
revoke all on function private.os_quote_guard() from public, anon, authenticated;
create trigger quote_guard before update on public.quote_versions for each row execute function private.os_quote_guard();

create function private.os_quote_items_guard() returns trigger language plpgsql set search_path = '' as $$
declare qid uuid := coalesce(new.quote_version_id, old.quote_version_id); st text;
begin
  select status into st from public.quote_versions where id = qid;
  if st is not null and st <> 'draft' then raise exception 'itens de orçamento publicado são imutáveis: crie uma nova versão' using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
revoke all on function private.os_quote_items_guard() from public, anon, authenticated;
create trigger quote_items_guard before insert or update or delete on public.quote_items for each row execute function private.os_quote_items_guard();

-- ======================================================================= quem sai da empresa (ou é desativado) não deixa ordens penduradas
-- Ordens abertas do responsável voltam à fila: agendada → aberta (sem janela); em execução → pausada (com pausa registrada); demais só perdem o responsável.
create function private.os_release_orders(p_org uuid, p_user uuid, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare o record; n integer := 0;
begin
  for o in select id, execution_status from public.service_orders
    where organization_id = p_org and assigned_technician_user_id = p_user and execution_status in ('draft', 'open', 'scheduled', 'in_progress', 'paused') for update loop
    if o.execution_status = 'in_progress' then
      insert into public.order_pauses (organization_id, service_order_id, reason) values (p_org, o.id, 'Responsável deixou de atuar na empresa');
      update public.service_orders set execution_status = 'paused', assigned_technician_user_id = null where id = o.id;
    elsif o.execution_status = 'scheduled' then
      update public.service_orders set execution_status = 'open', assigned_technician_user_id = null, scheduled_start_at = null, scheduled_end_at = null where id = o.id;
    else
      update public.service_orders set assigned_technician_user_id = null where id = o.id;
    end if;
    insert into public.order_events (organization_id, service_order_id, event_type, actor_kind, actor_user_id, data)
      values (p_org, o.id, 'unassigned', 'system', (select auth.uid()), jsonb_build_object('reason', p_reason));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.os_release_orders(uuid, uuid, text) from public, anon, authenticated;

create function private.os_member_gone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.role in ('owner', 'admin', 'manager', 'member') then return new; end if;
  perform private.os_release_orders(old.organization_id, old.user_id, 'member_removed');
  return coalesce(new, old);
end $$;
revoke all on function private.os_member_gone() from public, anon, authenticated;
create trigger os_member_gone before delete or update of role on public.organization_members for each row execute function private.os_member_gone();

-- ======================================================================= configurações iniciais da empresa
create function private.os_bootstrap_org() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.os_settings (organization_id) values (new.id) on conflict do nothing;
  insert into public.order_number_counters (organization_id) values (new.id) on conflict do nothing;
  return null;
end $$;
revoke all on function private.os_bootstrap_org() from public, anon, authenticated;
create trigger os_bootstrap_org after insert on public.organizations for each row execute function private.os_bootstrap_org();

-- Empresas que já existiam antes da migração (ex.: criadas pelo Core) também recebem as configurações.
insert into public.os_settings (organization_id) select id from public.organizations on conflict do nothing;
insert into public.order_number_counters (organization_id) select id from public.organizations on conflict do nothing;

commit;
