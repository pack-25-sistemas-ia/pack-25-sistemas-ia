-- Gestão de Contratos — integridade por SQL DIRETO (sem passar pelas funções): restrições, histórico imutável, transições de estado e vínculos entre empresas.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_x 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"x@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.derr(q text) returns text language plpgsql security definer set search_path = '' as $$ begin begin execute q; exception when others then return sqlerrm; end; return null; end $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c0', 'x@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Integridade', 'integridade'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager');
end $$;
reset role;
:as_x
select set_config('t.orgb', public.create_organization('Outra', 'outra-integridade')::text, true);
select set_config('t.cpb', public.ct_save_counterparty(current_setting('t.orgb')::uuid, null, null, '{"person_type":"company","name":"Parte da B"}', gen_random_uuid())::text, true);
reset role;
:as_m
do $$
declare org uuid := test.t('org'); cp uuid; c uuid; r jsonb; today date := current_date;
begin
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte"}', gen_random_uuid()); perform set_config('t.cp', cp::text, true);
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato', 'start_date', (today - 30)::text, 'end_date', (today + 60)::text, 'notice_days', 10,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Parte')), 'value', jsonb_build_object('amount_cents', 10000, 'billing_basis', 'monthly'))) ->> 'id')::uuid;
  perform set_config('t.c', c::text, true);
  r := public.ct_add_document(org, c, gen_random_uuid(), 'Contrato', 'main', jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 10, 'filename', 'a.pdf'));
  perform set_config('t.d', r ->> 'document_id', true); perform set_config('t.v', r ->> 'version_id', true);
  perform public.ct_activate_contract(org, c, test.cv(c));
  perform public.ct_register_change(org, c, test.cv(c), jsonb_build_object('change_type', 'amendment', 'effective_date', today::text, 'description', 'Aditivo de teste'));
  perform public.ct_save_obligation(org, c, null, null, jsonb_build_object('title', 'Obrigação', 'due_date', (today + 5)::text));
end $$;
reset role;

do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); today date := current_date; m uuid := 'ffffffff-0000-4000-8000-0000000000a1'; o uuid;
begin
  -- restrições do esquema
  perform test.has(test.derr(format($q$update public.contracts set indefinite_term = true where id = %L$q$, c)), '%check%', 'indeterminado com data final');
  perform test.has(test.derr(format($q$update public.contracts set end_date = start_date - 1 where id = %L$q$, c)), '%check%', 'fim antes do início');
  perform test.has(test.derr(format($q$update public.contracts set notice_adjusted = true where id = %L$q$, c)), '%check%', 'ajuste do aviso exige justificativa');
  perform test.has(test.derr(format($q$insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from) values (%L, %L, -1, 'monthly', %L)$q$, org, c, (today + 1)::text)), '%check%', 'valor negativo');
  perform test.has(test.derr(format($q$insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from) values (%L, %L, 1, 'diario', %L)$q$, org, c, (today + 1)::text)), '%check%', 'periodicidade fora da lista');
  perform test.has(test.derr(format($q$insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from) select organization_id, contract_id, 5, 'monthly', effective_from from public.contract_value_versions where contract_id = %L limit 1$q$, c)), '%duplicate%', 'duas versões de valor na mesma data');
  perform test.has(test.derr(format($q$insert into public.reminder_rules (organization_id, event_type, offsets_days) values (%L, 'obligation', '{1}')$q$, org)), '%duplicate%', 'uma regra por tipo');
  perform test.has(test.derr(format($q$update public.reminder_rules set offsets_days = '{400}' where organization_id = %L and event_type = 'notice'$q$, org)), '%check%', 'antecedência fora de 0 a 365');
  perform test.has(test.derr(format($q$update public.reminder_rules set offsets_days = '{}' where organization_id = %L and event_type = 'notice'$q$, org)), '%check%', 'ao menos uma antecedência');
  -- vínculos entre empresas
  perform test.has(test.derr(format($q$insert into public.contract_parties (organization_id, contract_id, counterparty_id, role_description, identity_snapshot) values (%L, %L, %L, 'Intrusa', '{}')$q$, org, c, test.t('cpb'))), '%violates foreign key%', 'parte de outra empresa');
  perform test.has(test.derr(format($q$update public.contracts set organization_id = %L where id = %L$q$, test.t('orgb'), c)), '%organização%', 'organização imutável');
  perform test.has(test.derr(format($q$update public.contracts set responsible_user_id = %L where id = %L$q$, 'ffffffff-0000-4000-8000-0000000000c0', c)), '%responsável inválido%', 'responsável de outra empresa');
  -- histórico imutável
  perform test.has(test.derr(format($q$delete from public.contract_events where contract_id = %L$q$, c)), '%não pode ser apagado%', 'evento não se apaga');
  perform test.has(test.derr(format($q$update public.contract_events set event_type = 'x1' where contract_id = %L$q$, c)), '%imutável%', 'evento não se reescreve');
  perform test.has(test.derr(format($q$delete from public.contract_document_versions where document_id = %L$q$, test.t('d'))), '%não pode ser apagado%', 'versão de documento não se apaga');
  perform test.has(test.derr(format($q$update public.contract_document_versions set original_filename = 'outro.pdf' where document_id = %L$q$, test.t('d'))), '%imutável%', 'versão de documento não se reescreve');
  perform test.has(test.derr(format($q$update public.contract_value_versions set amount_cents = 1 where contract_id = %L$q$, c)), '%imutável%', 'versão de valor não se reescreve');
  perform test.has(test.derr(format($q$delete from public.contract_value_versions where contract_id = %L$q$, c)), '%não pode ser apagado%', 'versão de valor não se apaga');
  perform test.has(test.derr(format($q$update public.contract_changes set description = 'reescrito' where contract_id = %L$q$, c)), '%imutável%', 'aditivo não se reescreve');
  perform test.has(test.derr(format($q$delete from public.contract_changes where contract_id = %L$q$, c)), '%não pode ser apagado%', 'aditivo não se apaga');
  perform test.has(test.derr(format($q$update public.contract_documents set title = 'Outro título' where id = %L$q$, test.t('d'))), '%só muda de versão atual%', 'documento só troca a versão atual');
  perform test.has(test.derr(format($q$delete from public.contracts where id = %L$q$, c)), '%não pode ser apagado%', 'contrato não se apaga');
  perform test.has(test.derr(format($q$update public.contract_deadlines set due_date = due_date + 1 where contract_id = %L$q$, c)), '%nova revisão%', 'prazo registrado não muda');
  perform test.has(test.derr(format($q$delete from public.contract_deadlines where contract_id = %L$q$, c)), '%não pode ser apagado%', 'prazo não se apaga');
  perform test.has(test.derr(format($q$delete from public.counterparties where id = %L$q$, test.t('cp'))), '%não pode ser apagado%', 'parte não se apaga (só inativa)');
  -- estados e identidade do contrato
  perform test.has(test.derr(format($q$update public.contracts set lifecycle_status = 'draft' where id = %L$q$, c)), '%transição do contrato inválida%', 'ativo não volta a rascunho');
  perform test.has(test.derr(format($q$update public.contracts set contract_number = 99 where id = %L$q$, c)), '%identidade%', 'número do contrato é imutável');
  perform test.has(test.derr(format($q$update public.contracts set archived_at = now() where id = %L$q$, c)), '%rescindidos ou encerrados%', 'ativo não arquiva');
  perform test.has(test.derr(format($q$update public.contracts set lifecycle_status = 'terminated' where id = %L$q$, c)), '%check%', 'rescindido exige a data de encerramento');
  -- acesso por contrato
  perform test.has(test.derr(format($q$insert into public.contract_access (organization_id, contract_id, user_id, contract_role) values (%L, %L, %L, 'editor')$q$, org, c, m)), '%já têm acesso%', 'gestão não vira participante');
  -- obrigação
  o := (select id from public.contract_obligations where contract_id = c limit 1);
  perform test.derr(format($q$update public.contract_obligations set status = 'completed', completed_at = now() where id = %L$q$, o));
  perform test.has(test.derr(format($q$update public.contract_obligations set title = 'Reescrita' where id = %L$q$, o)), '%definitiva%', 'obrigação concluída é definitiva');
  perform test.has(test.derr(format($q$update public.contract_obligations set status = 'completed' where id = (select id from public.contract_obligations where contract_id = %L limit 1)$q$, c)), '%definitiva%', 'sem reabrir obrigação');
  -- reajuste
  perform test.has(test.derr(format($q$insert into public.contract_adjustments (organization_id, contract_id, effective_date, base_value_version_id, percentage_decimal, new_amount_cents) select organization_id, contract_id, current_date, id, -5, 1 from public.contract_value_versions where contract_id = %L limit 1$q$, c)), '%check%', 'percentual negativo exige justificativa');
  perform test.has(test.derr(format($q$insert into public.contract_adjustments (organization_id, contract_id, effective_date, base_value_version_id, percentage_decimal, new_amount_cents, status) select organization_id, contract_id, current_date, id, 5, 1, 'applied' from public.contract_value_versions where contract_id = %L limit 1$q$, c)), '%check%', 'aplicado exige data de aplicação');
  -- documentos fora do padrão
  perform test.has(test.derr(format($q$insert into public.contract_document_versions (organization_id, document_id, version_number, storage_path, original_filename, mime_type, size_bytes) values (%L, %L, 9, 'x/y.html', 'a.html', 'text/html', 10)$q$, org, test.t('d'))), '%check%', 'tipo ativo fora da lista no esquema');
  -- notificação: só marcar como lida
  insert into public.notifications (organization_id, user_id, kind, contract_id) values (org, m, 'contract_assigned', c);
  perform test.has(test.derr(format($q$update public.notifications set kind = 'reminder_notice' where user_id = %L$q$, m)), '%só pode ser marcada como lida%', 'notificação não muda de conteúdo');
  raise notice 'PASS: integridade por SQL direto — restrições, histórico, vínculos entre empresas e estados (1)';
end $$;

rollback;
