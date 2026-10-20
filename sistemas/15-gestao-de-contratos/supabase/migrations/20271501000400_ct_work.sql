-- Gestão de Contratos — OBRIGAÇÕES, NOTIFICAÇÕES, LEMBRETES (processamento idempotente), PAINEL e auditoria de exportações.
-- Lembretes: o painel e o calendário mostram os prazos corretos SEM o agendador; o agendador só gera notificações internas. Sem recorrência e sem canal externo no MVP.

begin;
set local check_function_bodies = off;

-- ======================================================================= obrigações administrativas simples
-- p: title, description, responsible_user_id, due_date
create function public.ct_save_obligation(p_org uuid, p_contract uuid, p_id uuid, p_expected integer, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; o public.contract_obligations; ttl text; ds text; resp uuid; due date; rid uuid;
begin
  perform private.ct_guard(p_org, 'member');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'edit');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  perform private.ct_rate_hit('obl:' || p_org::text || ':' || (select auth.uid())::text, 240, 600);
  if c.archived_at is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
  ttl := private.ct_req_text(p ->> 'title', 2, 200, 'Título'); ds := private.ct_opt_text(p ->> 'description', 2000, 'Descrição');
  resp := nullif(p ->> 'responsible_user_id', '')::uuid; due := private.ct_opt_date(p ->> 'due_date', 'Data');
  if due is null then raise exception 'informe a data da obrigação' using errcode = '22023'; end if;
  if resp is not null and not private.ct_assignable(p_org, p_contract, resp) then raise exception 'responsável inválido: precisa ter acesso ao contrato com permissão de edição' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.contract_obligations (organization_id, contract_id, title, description, responsible_user_id, due_date, created_by) values (p_org, p_contract, ttl, ds, resp, due, (select auth.uid())) returning id into rid;
    perform private.ct_event(p_org, p_contract, 'obligation_created', jsonb_build_object('obligation_id', rid, 'due_date', due));
  else
    select * into o from public.contract_obligations where id = p_id and contract_id = p_contract and organization_id = p_org for update;
    if not found then raise exception 'obrigação não encontrada' using errcode = 'P0002'; end if;
    if p_expected is not null and o.version <> p_expected then perform private.ct_conflict('esta obrigação'); end if;
    if o.status <> 'pending' then raise exception 'obrigação % é definitiva', o.status using errcode = '23514'; end if;
    update public.contract_obligations set title = ttl, description = ds, responsible_user_id = resp, due_date = due where id = p_id returning id into rid;
    perform private.ct_event(p_org, p_contract, 'obligation_updated', jsonb_build_object('obligation_id', rid, 'due_date', due));
    if resp is not distinct from o.responsible_user_id then return rid; end if;
  end if;
  if resp is not null then perform private.ct_notify(p_org, p_contract, 'obligation_assigned', array[resp], rid, due); end if;
  return rid;
end $$;

create function public.ct_complete_obligation(p_org uuid, p_obligation uuid, p_expected integer, p_note text) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.contract_obligations; v integer;
begin
  perform private.ct_guard(p_org, 'member');
  select * into o from public.contract_obligations where id = p_obligation and organization_id = p_org;
  if not found then raise exception 'obrigação não encontrada' using errcode = 'P0002'; end if;
  perform private.ct_load_contract(p_org, o.contract_id, true, null);
  perform private.ct_require(p_org, o.contract_id, 'edit');
  select * into o from public.contract_obligations where id = p_obligation for update;
  if p_expected is not null and o.version <> p_expected then perform private.ct_conflict('esta obrigação'); end if;
  if o.status <> 'pending' then raise exception 'obrigação % é definitiva', o.status using errcode = '23514'; end if;
  update public.contract_obligations set status = 'completed', completed_at = clock_timestamp(), completed_by = (select auth.uid()), completion_note = private.ct_opt_text(p_note, 500, 'Nota de conclusão') where id = p_obligation returning version into v;
  perform private.ct_event(p_org, o.contract_id, 'obligation_completed', jsonb_build_object('obligation_id', p_obligation));
  return v;
end $$;

create function public.ct_cancel_obligation(p_org uuid, p_obligation uuid, p_expected integer, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare o public.contract_obligations; v integer; rsn text := private.ct_opt_text(p_reason, 500, 'Motivo');
begin
  perform private.ct_guard(p_org, 'member');
  select * into o from public.contract_obligations where id = p_obligation and organization_id = p_org;
  if not found then raise exception 'obrigação não encontrada' using errcode = 'P0002'; end if;
  perform private.ct_load_contract(p_org, o.contract_id, true, null);
  perform private.ct_require(p_org, o.contract_id, 'edit');
  select * into o from public.contract_obligations where id = p_obligation for update;
  if p_expected is not null and o.version <> p_expected then perform private.ct_conflict('esta obrigação'); end if;
  if o.status <> 'pending' then raise exception 'obrigação % é definitiva', o.status using errcode = '23514'; end if;
  if rsn is null or char_length(rsn) < 3 then raise exception 'informe o motivo do cancelamento (mínimo 3 caracteres)' using errcode = '22023'; end if;
  update public.contract_obligations set status = 'cancelled', completion_note = rsn where id = p_obligation returning version into v;
  perform private.ct_event(p_org, o.contract_id, 'obligation_cancelled', jsonb_build_object('obligation_id', p_obligation));
  return v;
end $$;

-- ======================================================================= notificações
create function public.ct_mark_notification_read(p_org uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'member');
  update public.notifications set read_at = clock_timestamp() where id = p_id and organization_id = p_org and user_id = (select auth.uid()) and read_at is null;
end $$;
create function public.ct_mark_all_notifications_read(p_org uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.ct_guard(p_org, 'member');
  update public.notifications set read_at = clock_timestamp() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ======================================================================= lembretes (idempotentes)
-- Para cada evento (prazo corrente de contrato ativo, ou obrigação pendente) e cada antecedência já ALCANÇADA no fuso da empresa, entrega UMA notificação por destinatário.
-- Chave de deduplicação: tipo|origem|revisão|antecedência|destinatário. Execução atrasada: entrega só a antecedência mais recente e marca as anteriores como «consolidadas».
-- Não notifica: quem perdeu o acesso, evento substituído (revisão antiga), obrigação concluída/cancelada, contrato encerrado/arquivado, data já passada.
create function private.ct_process_reminders(p_org uuid, p_now timestamptz, p_trigger text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tz text; today date; run bigint; ev record; offs int[]; recips uuid[]; recip uuid; d int; undeliv int[]; chosen int; min_sent int; nid uuid; key text; ins integer;
  checked integer := 0; sent integer := 0; cons integer := 0; errs integer := 0; kind text;
begin
  select timezone into tz from public.ct_settings where organization_id = p_org;
  today := (p_now at time zone coalesce(tz, 'America/Sao_Paulo'))::date;
  insert into public.ct_job_runs (organization_id, trigger) values (p_org, p_trigger) returning id into run;
  for ev in
    select 'deadline'::text as src, d1.deadline_type as etype, d1.id as sid, d1.revision as rev, d1.contract_id, d1.due_date, c.responsible_user_id as resp, null::uuid as obl_resp
      from public.contract_deadlines d1 join public.contracts c on c.id = d1.contract_id
      where d1.organization_id = p_org and d1.superseded_at is null and c.lifecycle_status = 'active' and c.archived_at is null and d1.due_date >= today
    union all
    select 'obligation', 'obligation', o.id, o.revision, o.contract_id, o.due_date, c.responsible_user_id, o.responsible_user_id
      from public.contract_obligations o join public.contracts c on c.id = o.contract_id
      where o.organization_id = p_org and o.status = 'pending' and c.archived_at is null and c.lifecycle_status = 'active' and o.due_date >= today
  loop
    begin
      checked := checked + 1;
      select r.offsets_days into offs from public.reminder_rules r where r.organization_id = p_org and r.event_type = ev.etype and r.active;
      if offs is null then continue; end if;
      recips := case when ev.src = 'obligation' and ev.obl_resp is not null then array[ev.obl_resp]
                     when ev.resp is not null then array[ev.resp]
                     else (select coalesce(array_agg(m.user_id), '{}') from public.organization_members m where m.organization_id = p_org and m.role in ('owner', 'admin', 'manager')) end;
      kind := case ev.etype when 'contract_end' then 'reminder_contract_end' when 'notice' then 'reminder_notice' when 'adjustment' then 'reminder_adjustment' else 'reminder_obligation' end;
      foreach recip in array recips loop
        if private.ct_contract_role_of(p_org, ev.contract_id, recip) is null then continue; end if;
        undeliv := '{}';
        foreach d in array offs loop
          if ev.due_date - d <= today and not exists (select 1 from public.reminder_deliveries x where x.dedupe_key = ev.etype || '|' || ev.sid || '|' || ev.rev || '|' || d || '|' || recip) then undeliv := undeliv || d; end if;
        end loop;
        if cardinality(undeliv) = 0 then continue; end if;
        select min(x.offset_days) into min_sent from public.reminder_deliveries x where x.status = 'sent' and x.event_type = ev.etype and x.source_id = ev.sid and x.source_revision = ev.rev and x.user_id = recip;
        select min(x) into chosen from unnest(undeliv) x where min_sent is null or x < min_sent;
        foreach d in array undeliv loop
          key := ev.etype || '|' || ev.sid || '|' || ev.rev || '|' || d || '|' || recip;
          if d = chosen then
            insert into public.notifications (organization_id, user_id, kind, contract_id, source_id, due_date, offset_days) values (p_org, recip, kind, ev.contract_id, ev.sid, ev.due_date, d) returning id into nid;
            insert into public.reminder_deliveries (organization_id, contract_id, user_id, event_type, source_id, source_revision, offset_days, status, dedupe_key, notification_id)
              values (p_org, ev.contract_id, recip, ev.etype, ev.sid, ev.rev, d, 'sent', key, nid) on conflict (dedupe_key) do nothing;
            get diagnostics ins = row_count;
            if ins = 1 then sent := sent + 1; else delete from public.notifications where id = nid; end if;
          else
            insert into public.reminder_deliveries (organization_id, contract_id, user_id, event_type, source_id, source_revision, offset_days, status, dedupe_key)
              values (p_org, ev.contract_id, recip, ev.etype, ev.sid, ev.rev, d, 'consolidated', key) on conflict (dedupe_key) do nothing;
            get diagnostics ins = row_count;
            cons := cons + ins;
          end if;
        end loop;
      end loop;
    exception when others then
      errs := errs + 1;
    end;
  end loop;
  update public.ct_job_runs set finished_at = clock_timestamp(), status = case when errs = 0 then 'ok' else 'partial' end, contracts_checked = checked, reminders_sent = sent, reminders_consolidated = cons, errors = errs where id = run;
  return jsonb_build_object('run_id', run, 'checked', checked, 'sent', sent, 'consolidated', cons, 'errors', errs, 'today', today);
end $$;
revoke all on function private.ct_process_reminders(uuid, timestamptz, text) from public, anon, authenticated;

-- Execução manual pela gestão (útil para conferir e para quem ainda não configurou o agendador).
create function public.ct_run_reminders_now(p_org uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'manager');
  perform private.ct_rate_hit('rem:' || p_org::text, 30, 600);
  return private.ct_process_reminders(p_org, now(), 'manual');
end $$;

-- PONTO PÚBLICO (PUBLIC_ENDPOINT): o agendador externo chama com o token da empresa (só o hash fica no banco). Idempotente: repetir não duplica nada.
create function public.ct_run_reminders(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'token inválido' using errcode = '28000'; end if;
  select organization_id into org from public.ct_job_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if org is null then raise exception 'token inválido' using errcode = '28000'; end if;
  perform private.ct_rate_hit('job:' || org::text, 120, 3600);
  return private.ct_process_reminders(org, now(), 'scheduler');
end $$;

-- ======================================================================= painel (tudo vem do banco e respeita o acesso de quem consulta)
-- Datas inclusivas: «próximos N dias» = de hoje até hoje + N, ambos incluídos. Valores NÃO são somados entre periodicidades diferentes e não são faturamento.
create function public.ct_dashboard(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare today date := private.ct_today(p_org); tz text; near integer; res jsonb;
begin
  perform private.ct_guard(p_org, 'member');
  select timezone, near_end_days into tz, near from public.ct_settings where organization_id = p_org;
  with vis as (
    select c.* from public.contracts c where c.organization_id = p_org and c.archived_at is null and private.ct_can_see_contract(p_org, c.id)),
  act as (select * from vis where lifecycle_status = 'active'),
  cur_val as (
    select a.id as cid, (select v.billing_basis from public.contract_value_versions v where v.contract_id = a.id and v.effective_from <= today order by v.effective_from desc limit 1) as basis,
           (select v.amount_cents from public.contract_value_versions v where v.contract_id = a.id and v.effective_from <= today order by v.effective_from desc limit 1) as amt from act a),
  obl as (select o.* from public.contract_obligations o join vis v on v.id = o.contract_id where o.status = 'pending')
  select jsonb_build_object(
    'period', jsonb_build_object('today', today, 'timezone', tz, 'near_end_days', near),
    'active', (select count(*) from act),
    'drafts', (select count(*) from vis where lifecycle_status = 'draft'),
    'valid_today', (select count(*) from act where start_date <= today and (indefinite_term or end_date >= today)),
    'ending_30', (select count(*) from act where end_date between today and today + 30),
    'ending_60', (select count(*) from act where end_date between today and today + 60),
    'ending_90', (select count(*) from act where end_date between today and today + 90),
    'end_reached', (select count(*) from act where end_date < today),
    'notice_soon', (select count(*) from act where notice_deadline_date between today and today + 30),
    'notice_overdue', (select count(*) from act where notice_deadline_date < today and (indefinite_term or end_date >= today)),
    'obligations_pending', (select count(*) from obl),
    'obligations_overdue', (select count(*) from obl where due_date < today),
    'adjustments_expected', (select count(*) from public.contract_adjustment_rules r join act a on a.id = r.contract_id where r.active and r.next_adjustment_date <= today + 60),
    'without_responsible', (select count(*) from act where responsible_user_id is null),
    'renewals_12m', (select count(*) from public.contract_changes ch join vis v on v.id = ch.contract_id where ch.change_type = 'renewal' and ch.effective_date > today - 365),
    'without_value', (select count(*) from cur_val where amt is null),
    'values_by_basis', (select coalesce(jsonb_object_agg(basis, jsonb_build_object('contracts', n, 'amount_cents', total)), '{}'::jsonb)
                          from (select basis, count(*) as n, sum(amt) as total from cur_val where amt is not null group by basis) x),
    'documents_by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(cat.name, 'Sem categoria'), 'documents', n) order by n desc), '[]'::jsonb)
                          from (select v.category_id, count(d.id) as n from vis v join public.contract_documents d on d.contract_id = v.id group by v.category_id) g left join public.contract_categories cat on cat.id = g.category_id)
  ) into res;
  return res;
end $$;

-- Exportações ficam na auditoria (tipo e quantidade de linhas, nunca o conteúdo).
create function public.ct_audit_export(p_org uuid, p_kind text, p_rows integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'member');
  if p_kind is null or p_kind !~ '^[a-z_]{2,40}$' then raise exception 'tipo de exportação inválido' using errcode = '22023'; end if;
  perform private.ct_rate_hit('exp:' || p_org::text || ':' || (select auth.uid())::text, 30, 600);
  perform private.ct_audit(p_org, 'export', 'export_' || p_kind, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));
end $$;

commit;
