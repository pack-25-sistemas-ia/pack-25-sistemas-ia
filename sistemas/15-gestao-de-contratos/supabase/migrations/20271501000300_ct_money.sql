-- Gestão de Contratos — VALORES, ADITIVOS, RENOVAÇÃO e REAJUSTES. Nada aqui gera cobrança, recebível ou lançamento contábil.
-- Valor vigente = versão de valor com maior `effective_from` até a data consultada. Versões de valor são append-only (histórico de valores).
-- Reajuste: SIMULAR (grava uma proposta, não altera o contrato) e APLICAR (explícito, transacional, uma única vez, conferindo que a base não mudou).

begin;
set local check_function_bodies = off;

create function private.ct_money_args(p_amount jsonb, p_basis text, out amt bigint, out basis text)
language plpgsql immutable set search_path = '' as $$
begin
  if p_amount is null or jsonb_typeof(p_amount) is distinct from 'number' then raise exception 'informe o valor' using errcode = '22023'; end if;
  amt := (p_amount #>> '{}')::bigint;
  if amt < 0 or amt > 99999999999999 then raise exception 'valor fora do permitido' using errcode = '22023'; end if;
  basis := coalesce(p_basis, '');
  if basis not in ('monthly', 'annual', 'one_time', 'reference') then raise exception 'informe a periodicidade do valor (mensal, anual, único ou referência)' using errcode = '22023'; end if;
end $$;
revoke all on function private.ct_money_args(jsonb, text) from public, anon, authenticated;

-- Valor inicial (contrato criado sem valor). Vigora desde o início da vigência do contrato.
create function public.ct_set_initial_value(p_org uuid, p_contract uuid, p_expected integer, p_amount_cents jsonb, p_basis text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; m record;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  perform private.ct_open_for_edit(c);
  if exists (select 1 from public.contract_value_versions where contract_id = p_contract) then raise exception 'o contrato já tem valor: registre um aditivo, uma correção ou um reajuste' using errcode = '23514'; end if;
  select * into m from private.ct_money_args(p_amount_cents, p_basis);
  insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from, created_by) values (p_org, p_contract, m.amt, m.basis, c.start_date, (select auth.uid()));
  perform private.ct_event(p_org, p_contract, 'value_set', jsonb_build_object('basis', m.basis));
end $$;

-- Aditivo ou correção. p: change_type (amendment|correction), effective_date (até hoje), description, document_version_id (opcional), new_value {amount_cents, billing_basis} (opcional).
-- O valor anterior NUNCA é editado: nasce uma nova versão de valor, em ordem cronológica.
create function public.ct_register_change(p_org uuid, p_contract uuid, p_expected integer, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; ct text; eff date; descr text; dv uuid; m record; cur public.contract_value_versions; cid uuid; vid uuid; before_s jsonb; after_s jsonb;
begin
  perform private.ct_guard(p_org, 'manager');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'active' or c.archived_at is not null then raise exception 'aditivos e correções só em contrato ativo' using errcode = '23514'; end if;
  ct := coalesce(p ->> 'change_type', ''); if ct not in ('amendment', 'correction') then raise exception 'tipo de alteração inválido' using errcode = '22023'; end if;
  eff := private.ct_opt_date(p ->> 'effective_date', 'Data de efeito'); descr := private.ct_req_text(p ->> 'description', 2, 2000, 'Descrição');
  if eff is null then raise exception 'informe a data de efeito' using errcode = '22023'; end if;
  dv := nullif(p ->> 'document_version_id', '')::uuid;
  if dv is not null and not exists (select 1 from public.contract_document_versions v join public.contract_documents d on d.id = v.document_id where v.id = dv and d.contract_id = p_contract and v.organization_id = p_org) then
    raise exception 'o documento precisa ser deste contrato' using errcode = '22023';
  end if;
  cur := private.ct_value_at(p_contract, private.ct_today(p_org));
  before_s := jsonb_build_object('amount_cents', cur.amount_cents, 'billing_basis', cur.billing_basis, 'end_date', c.end_date);
  after_s := before_s;
  if jsonb_typeof(p -> 'new_value') = 'object' then
    if eff > private.ct_today(p_org) then raise exception 'a alteração de valor só pode ter data de efeito até hoje; registre quando entrar em vigor' using errcode = '22023'; end if;
    select * into m from private.ct_money_args(p -> 'new_value' -> 'amount_cents', p -> 'new_value' ->> 'billing_basis');
    if exists (select 1 from public.contract_value_versions where contract_id = p_contract and effective_from >= eff) then raise exception 'a data de efeito precisa ser posterior à última versão de valor (histórico em ordem cronológica)' using errcode = '23514'; end if;
    after_s := jsonb_build_object('amount_cents', m.amt, 'billing_basis', m.basis, 'end_date', c.end_date);
  end if;
  insert into public.contract_changes (organization_id, contract_id, change_type, effective_date, description, document_version_id, before_snapshot, after_snapshot, created_by)
    values (p_org, p_contract, ct, eff, descr, dv, before_s, after_s, (select auth.uid())) returning id into cid;
  if jsonb_typeof(p -> 'new_value') = 'object' then
    insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from, source_change_id, created_by) values (p_org, p_contract, m.amt, m.basis, eff, cid, (select auth.uid())) returning id into vid;
  end if;
  update public.contracts set updated_at = now() where id = p_contract;
  perform private.ct_event(p_org, p_contract, case ct when 'amendment' then 'amendment_registered' else 'correction_registered' end, jsonb_build_object('change_id', cid, 'value_changed', vid is not null));
  return jsonb_build_object('change_id', cid, 'value_version_id', vid);
end $$;

-- Renovação MANUAL e auditada: nova data final (posterior à atual) ou prazo indeterminado, com justificativa. Nunca automática.
create function public.ct_renew_contract(p_org uuid, p_contract uuid, p_expected integer, p_new_end date, p_indefinite boolean, p_effective date, p_reason text, p_document_version uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer; rsn text := private.ct_opt_text(p_reason, 500, 'Justificativa'); nr record; nd integer; before_s jsonb; after_s jsonb; eff date;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'active' or c.archived_at is not null then raise exception 'só um contrato ativo pode ser renovado' using errcode = '23514'; end if;
  if rsn is null or char_length(rsn) < 5 then raise exception 'informe a justificativa (mínimo 5 caracteres)' using errcode = '22023'; end if;
  if coalesce(p_indefinite, false) then
    if p_new_end is not null then raise exception 'prazo indeterminado não tem data de fim' using errcode = '22023'; end if;
    if c.indefinite_term then raise exception 'o contrato já é por prazo indeterminado' using errcode = '23514'; end if;
  else
    if p_new_end is null then raise exception 'informe a nova data de fim ou marque prazo indeterminado' using errcode = '22023'; end if;
    if c.end_date is not null and p_new_end <= c.end_date then raise exception 'a nova data de fim precisa ser posterior à atual' using errcode = '22023'; end if;
  end if;
  eff := coalesce(p_effective, private.ct_today(p_org));
  if p_document_version is not null and not exists (select 1 from public.contract_document_versions v2 join public.contract_documents d on d.id = v2.document_id where v2.id = p_document_version and d.contract_id = p_contract and v2.organization_id = p_org) then
    raise exception 'o documento precisa ser deste contrato' using errcode = '22023';
  end if;
  before_s := jsonb_build_object('end_date', c.end_date, 'indefinite_term', c.indefinite_term, 'notice_deadline_date', c.notice_deadline_date);
  nd := c.notice_days;
  if coalesce(p_indefinite, false) then
    -- prazo indeterminado: o aviso precisaria de referência explícita; fica removido até ser informado de novo
    update public.contracts set indefinite_term = true, end_date = null, notice_days = null, notice_reference_date = null, notice_deadline_date = null, notice_adjusted = false, notice_adjust_reason = null where id = p_contract returning version into v;
  else
    select * into nr from private.ct_compute_notice(p_new_end, false, nd, null);
    update public.contracts set end_date = p_new_end, notice_reference_date = nr.ref, notice_deadline_date = nr.deadline, notice_adjusted = false, notice_adjust_reason = null where id = p_contract returning version into v;
  end if;
  select jsonb_build_object('end_date', end_date, 'indefinite_term', indefinite_term, 'notice_deadline_date', notice_deadline_date) into after_s from public.contracts where id = p_contract;
  insert into public.contract_changes (organization_id, contract_id, change_type, effective_date, description, document_version_id, before_snapshot, after_snapshot, created_by)
    values (p_org, p_contract, 'renewal', eff, rsn, p_document_version, before_s, after_s, (select auth.uid()));
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'contract_renewed', jsonb_build_object('indefinite', coalesce(p_indefinite, false)));
  return v;
end $$;

-- ======================================================================= reajuste
create function public.ct_set_adjustment_rule(p_org uuid, p_contract uuid, p_frequency integer, p_next date, p_label text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contracts;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'manage');
  perform private.ct_open_for_edit(c);
  if p_frequency is null or p_frequency < 1 or p_frequency > 120 then raise exception 'a frequência deve ser de 1 a 120 meses' using errcode = '22023'; end if;
  if p_next is null then raise exception 'informe a próxima data de reajuste' using errcode = '22023'; end if;
  insert into public.contract_adjustment_rules (contract_id, organization_id, frequency_months, next_adjustment_date, reference_label, active)
    values (p_contract, p_org, p_frequency, p_next, private.ct_opt_text(p_label, 80, 'Referência do reajuste'), coalesce(p_active, true))
  on conflict (contract_id) do update set frequency_months = excluded.frequency_months, next_adjustment_date = excluded.next_adjustment_date, reference_label = excluded.reference_label, active = excluded.active;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'adjustment_rule_set', jsonb_build_object('frequency_months', p_frequency, 'next', p_next));
end $$;

-- SIMULAÇÃO: grava uma proposta (não altera o contrato nem o valor vigente). Uma nova simulação cancela a proposta anterior em aberto.
create function public.ct_simulate_adjustment(p_org uuid, p_contract uuid, p_effective date, p_pct numeric, p_label text, p_period text, p_note text, p_justification text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; base public.contract_value_versions; newamt bigint; aid uuid; just text := private.ct_opt_text(p_justification, 500, 'Justificativa');
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'active' or c.archived_at is not null then raise exception 'reajuste só em contrato ativo' using errcode = '23514'; end if;
  if p_effective is null then raise exception 'informe a data de efeito' using errcode = '22023'; end if;
  if p_pct is null or p_pct <= -100 or p_pct > 1000 then raise exception 'percentual fora do permitido (maior que -100 e até 1000)' using errcode = '22023'; end if;
  if p_pct < 0 and (just is null or char_length(just) < 5) then raise exception 'percentual negativo exige justificativa (mínimo 5 caracteres)' using errcode = '22023'; end if;
  base := private.ct_value_at(p_contract, p_effective);
  if base.id is null then raise exception 'o contrato não tem valor vigente nesta data: cadastre o valor antes' using errcode = '23514'; end if;
  newamt := private.ct_apply_percentage(base.amount_cents, p_pct);
  if newamt < 0 or newamt > 99999999999999 then raise exception 'o resultado do reajuste fica fora do permitido' using errcode = '22023'; end if;
  update public.contract_adjustments set status = 'cancelled' where contract_id = p_contract and status = 'proposed';
  insert into public.contract_adjustments (organization_id, contract_id, effective_date, base_value_version_id, percentage_decimal, new_amount_cents, reference_label, reference_period, source_note, justification, proposed_by)
    values (p_org, p_contract, p_effective, base.id, p_pct, newamt, private.ct_opt_text(p_label, 80, 'Referência'), private.ct_opt_text(p_period, 60, 'Período de referência'), private.ct_opt_text(p_note, 500, 'Fonte ou observação'), just, (select auth.uid()))
    returning id into aid;
  return jsonb_build_object('id', aid, 'base_amount_cents', base.amount_cents, 'new_amount_cents', newamt, 'percentage', p_pct, 'billing_basis', base.billing_basis, 'effective_date', p_effective);
end $$;

-- APLICAÇÃO: confirma a proposta. Só uma operação vence; confere ordem cronológica, data (até hoje) e que a base não mudou desde a simulação.
create function public.ct_apply_adjustment(p_org uuid, p_adjustment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.contract_adjustments; c public.contracts; base public.contract_value_versions; newamt bigint; vid uuid; r public.contract_adjustment_rules; nextd date;
begin
  perform private.ct_guard(p_org, 'manager');
  select * into a from public.contract_adjustments where id = p_adjustment and organization_id = p_org;
  if not found then raise exception 'reajuste não encontrado' using errcode = 'P0002'; end if;
  c := private.ct_load_contract(p_org, a.contract_id, true, null);   -- trava do contrato PRIMEIRO: aplicações simultâneas se enfileiram
  perform private.ct_require(p_org, a.contract_id, 'manage');
  select * into a from public.contract_adjustments where id = p_adjustment for update;
  if a.status <> 'proposed' then raise exception 'este reajuste já foi % e não pode ser aplicado de novo', case a.status when 'applied' then 'aplicado' else 'cancelado' end using errcode = '23514'; end if;
  if c.lifecycle_status <> 'active' or c.archived_at is not null then raise exception 'reajuste só em contrato ativo' using errcode = '23514'; end if;
  if a.effective_date > private.ct_today(p_org) then raise exception 'só é possível aplicar o reajuste com data de efeito igual ou anterior a hoje' using errcode = '23514'; end if;
  if exists (select 1 from public.contract_value_versions where contract_id = a.contract_id and effective_from >= a.effective_date) then
    raise exception 'o histórico de valores precisa seguir a ordem cronológica: já existe valor a partir desta data' using errcode = '23514';
  end if;
  base := private.ct_value_at(a.contract_id, a.effective_date);
  newamt := private.ct_apply_percentage(coalesce(base.amount_cents, 0), a.percentage_decimal);
  if base.id is distinct from a.base_value_version_id or newamt <> a.new_amount_cents then
    raise exception 'A base do reajuste mudou desde a simulação. Simule novamente antes de aplicar.' using errcode = '40001';
  end if;
  insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from, source_adjustment_id, created_by)
    values (p_org, a.contract_id, newamt, base.billing_basis, a.effective_date, a.id, (select auth.uid())) returning id into vid;
  update public.contract_adjustments set status = 'applied', applied_by = (select auth.uid()), applied_at = clock_timestamp() where id = a.id;
  select * into r from public.contract_adjustment_rules where contract_id = a.contract_id;
  if found then
    nextd := private.ct_add_months(a.effective_date, r.frequency_months);
    update public.contract_adjustment_rules set next_adjustment_date = nextd where contract_id = a.contract_id;
  end if;
  update public.contracts set updated_at = now() where id = a.contract_id;
  perform private.ct_sync_deadlines(a.contract_id);
  perform private.ct_event(p_org, a.contract_id, 'adjustment_applied', jsonb_build_object('adjustment_id', a.id, 'percentage', a.percentage_decimal, 'from', base.amount_cents, 'to', newamt));
  perform private.ct_audit(p_org, 'update', 'contract_adjustment', a.id::text, jsonb_build_object('percentage', a.percentage_decimal));
  return jsonb_build_object('value_version_id', vid, 'new_amount_cents', newamt, 'next_adjustment_date', nextd);
end $$;

create function public.ct_cancel_adjustment(p_org uuid, p_adjustment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.contract_adjustments;
begin
  perform private.ct_guard(p_org, 'manager');
  select * into a from public.contract_adjustments where id = p_adjustment and organization_id = p_org;
  if not found then raise exception 'reajuste não encontrado' using errcode = 'P0002'; end if;
  perform private.ct_load_contract(p_org, a.contract_id, true, null);
  perform private.ct_require(p_org, a.contract_id, 'manage');
  select * into a from public.contract_adjustments where id = p_adjustment for update;
  if a.status <> 'proposed' then raise exception 'só uma proposta em aberto pode ser cancelada' using errcode = '23514'; end if;
  update public.contract_adjustments set status = 'cancelled' where id = p_adjustment;
end $$;

commit;
