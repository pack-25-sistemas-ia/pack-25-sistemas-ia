-- Ordens de Serviço — integridade NO BANCO, mesmo para quem escreve SQL direto (como dono das tabelas, sem passar pelas funções os_*):
-- gatilhos de estado/versão/responsável, orçamento congelado, histórico imutável, restrições de unicidade e de cálculo, e o limite de tentativas.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_t1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"t1@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
-- executa SQL como dono (sem RLS) e devolve a mensagem do erro, ou null se funcionou
create function test.bad(q text) returns text language plpgsql as $$ begin perform test.sql(q); return null; exception when others then return sqlerrm; end $$;
create function test.ver(o uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.service_orders where id = o $$;
create function test.path(org uuid, ord uuid, ext text) returns text language sql as $$ select org::text || '/' || ord::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || ext $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 't1@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a9', 'fora@t.invalid');

-- ===================================================================== (1) preparação
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Integridade Teste', 'integridade-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member');
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); c uuid; oa uuid; ob uuid; oc uuid; q uuid; v integer;
  just text := 'Autorizado por telefone pelo responsável da empresa.';
begin
  c := public.os_save_customer(org, null, '{"name":"Cliente Integridade"}'); perform set_config('t.c', c::text, true);
  oa := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Ordem A em execução', 'problem_description', 'Ordem para testes de gatilho.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a2',
    'quote_mode', 'authorized', 'authorization_justification', just)) ->> 'id')::uuid;
  ob := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Ordem B sem responsável', 'problem_description', 'Sem técnico e exigindo orçamento.')) ->> 'id')::uuid;
  oc := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Ordem C concluída', 'problem_description', 'Concluída e aceita.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a2',
    'quote_mode', 'authorized', 'authorization_justification', just)) ->> 'id')::uuid;
  perform set_config('t.oa', oa::text, true); perform set_config('t.ob', ob::text, true); perform set_config('t.oc', oc::text, true);
  -- A: em execução, com orçamento aprovado e um rascunho novo
  perform public.os_start(org, oa, test.ver(oa));
  q := public.os_quote_new_draft(org, oa); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 5)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Serviço A', 'unit', 'un', 'quantity', 2, 'unit_price_cents', 5000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform public.os_quote_decide_manual(org, q, 'approved', 'Cliente Integridade', 'Aprovou por telefone, conforme conversa registrada.', null, null);
  perform set_config('t.qa', q::text, true);
  q := public.os_quote_new_draft(org, oa); perform set_config('t.qa2', q::text, true);
  -- B: orçamento publicado e ainda sem decisão
  q := public.os_quote_new_draft(org, ob); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 5)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Serviço B', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 3000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform set_config('t.qb', q::text, true);
  -- C: concluída e aceita
  perform public.os_start(org, oc, test.ver(oc));
  perform public.os_complete(org, oc, test.ver(oc), 'Serviço concluído sem intercorrências.', null);
  perform public.os_completion_decide_manual(org, oc, test.ver(oc), 'accepted', 'Cliente Integridade', 'Aceitou presencialmente.', null);
  -- um arquivo na ordem A
  perform public.os_add_files(org, oa, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('path', test.path(org, oa, 'jpg'), 'mime', 'image/jpeg', 'size', 3000, 'filename', 'a.jpg', 'category', 'during')));
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) gatilhos da ordem (estado, versão de conclusão, responsável)
do $$
declare org uuid := test.t('org'); oa uuid := test.t('oa'); ob uuid := test.t('ob'); oc uuid := test.t('oc');
begin
  perform test.has(test.bad(format($q$update public.service_orders set execution_status = 'open' where id = '%s'$q$, oc)), '%transição de status inválida%', 'concluída não volta para «aberta»');
  perform test.has(test.bad(format($q$update public.service_orders set execution_status = 'in_progress' where id = '%s'$q$, ob)), '%exige um responsável%', 'iniciar sem responsável é barrado no banco');
  perform test.has(test.bad(format($q$update public.service_orders set completion_version = 5 where id = '%s'$q$, oa)), '%versão de conclusão inválida%', 'a versão da conclusão não pula');
  perform test.has(test.bad(format($q$update public.service_orders set assigned_technician_user_id = 'ffffffff-0000-4000-8000-0000000000a9' where id = '%s'$q$, oa)), '%responsável inválido%', 'responsável precisa ser membro operacional');
  perform test.has(test.bad(format($q$update public.service_orders set subject = 'Editada à força' where id = '%s'$q$, oc)), '%não pode ser editada%', 'concluída não é editada');
  perform test.has(test.bad(format($q$update public.service_orders set order_number = 99 where id = '%s'$q$, oa)), '%identidade da ordem%', 'número da ordem é imutável');
  -- a versão da ordem sobe a cada mudança real
  perform test.sql(format($q$update public.service_orders set priority = 'urgent' where id = '%s'$q$, oa));
  assert (select version from public.service_orders where id = oa) = test.ver(oa) and test.ver(oa) >= 3, 'versão incrementa';
  perform test.sql(format($q$update public.service_orders set priority = 'normal' where id = '%s'$q$, oa));
  raise notice 'PASS: gatilhos da ordem (2)';
end $$;

-- ===================================================================== (3) orçamento congelado e histórico imutável
do $$
declare org uuid := test.t('org'); oa uuid := test.t('oa'); oc uuid := test.t('oc'); qa uuid := test.t('qa'); qb uuid := test.t('qb');
begin
  perform test.has(test.bad(format($q$update public.quote_versions set status = 'published' where id = '%s'$q$, qa)), '%transição de orçamento inválida%', 'aprovado não volta a «publicado»');
  perform test.has(test.bad(format($q$update public.quote_versions set status = 'draft' where id = '%s'$q$, qb)), '%transição de orçamento inválida%', 'publicado não volta a rascunho');
  perform test.has(test.bad(format($q$delete from public.order_completions where service_order_id = '%s'$q$, oc)), '%não pode ser apagado%', 'conclusão não é apagada');
  perform test.has(test.bad(format($q$delete from public.completion_acceptances where service_order_id = '%s'$q$, oc)), '%não pode ser apagado%', 'aceite não é apagado');
  perform test.has(test.bad(format($q$update public.completion_acceptances set note = 'reescrito' where service_order_id = '%s'$q$, oc)), '%registro imutável%', 'aceite não é reescrito');
  perform test.has(test.bad(format($q$update public.quote_decisions set note = 'reescrito' where quote_version_id = '%s'$q$, qa)), '%registro imutável%', 'decisão não é reescrita');
  perform test.has(test.bad(format($q$delete from public.quote_decisions where quote_version_id = '%s'$q$, qa)), '%não pode ser apagado%', 'decisão não é apagada');
  perform test.has(test.bad(format($q$update public.order_attachments set original_filename = 'outro.jpg' where service_order_id = '%s'$q$, oa)), '%anexo é imutável%', 'anexo só muda a visibilidade');
  perform test.sql(format($q$update public.order_attachments set visibility = 'customer' where service_order_id = '%s'$q$, oa));
  assert (select visibility from public.order_attachments where service_order_id = oa) = 'customer', 'visibilidade do anexo pode mudar';
  perform test.has(test.bad(format($q$delete from public.order_attachments where service_order_id = '%s'$q$, oa)), '%não pode ser apagado%', 'anexo não é apagado');
  raise notice 'PASS: orçamento congelado e histórico imutável (3)';
end $$;

-- ===================================================================== (4) pausa só se encerra uma vez; um só registro aberto por ordem
:as_m
do $$
declare org uuid := test.t('org'); oa uuid := test.t('oa');
begin
  perform public.os_pause(org, oa, test.ver(oa), 'Aguardando material do fornecedor');
end $$;
reset role;
do $$
declare org uuid := test.t('org'); oa uuid := test.t('oa');
begin
  perform test.has(test.bad(format($q$insert into public.order_pauses (organization_id, service_order_id, reason) values ('%s', '%s', 'Segunda pausa aberta')$q$, org, oa)), '%duplicate key%', 'uma pausa aberta por ordem');
end $$;
:as_m
do $$
declare org uuid := test.t('org'); oa uuid := test.t('oa');
begin
  perform public.os_resume(org, oa, test.ver(oa));
end $$;
reset role;
do $$
declare oa uuid := test.t('oa');
begin
  perform test.has(test.bad(format($q$update public.order_pauses set ended_at = null where service_order_id = '%s'$q$, oa)), '%pausa só pode ser encerrada%', 'pausa encerrada não reabre');
  raise notice 'PASS: pausas (4)';
end $$;

-- ===================================================================== (5) restrições de unicidade e de cálculo
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); oa uuid := test.t('oa'); ob uuid := test.t('ob'); oc uuid := test.t('oc'); qa uuid := test.t('qa'); qa2 uuid := test.t('qa2'); qb uuid := test.t('qb');
begin
  perform test.has(test.bad(format($q$insert into public.service_orders (organization_id, order_number, customer_id, subject, problem_description) values ('%s', 1, '%s', 'Duplicada', 'Mesmo número')$q$, org, c)), '%duplicate key%', 'número de ordem único por empresa');
  perform test.has(test.bad(format($q$insert into public.quote_versions (organization_id, service_order_id, version_number) values ('%s', '%s', 50)$q$, org, oa)), '%duplicate key%', 'um rascunho por ordem');
  perform test.has(test.bad(format($q$insert into public.quote_versions (organization_id, service_order_id, version_number, status, published_at, valid_until) values ('%s', '%s', 51, 'published', now(), now() + interval '2 days')$q$, org, ob)), '%duplicate key%', 'uma versão publicada por ordem');
  perform test.has(test.bad(format($q$insert into public.quote_decisions (organization_id, service_order_id, quote_version_id, decision, channel, declared_name, accepted_text) values ('%s', '%s', '%s', 'rejected', 'customer_link', 'Cliente', 'Texto de aceite suficientemente longo')$q$, org, oa, qa)), '%duplicate key%', 'uma decisão por versão do orçamento');
  perform test.has(test.bad(format($q$insert into public.completion_acceptances (organization_id, service_order_id, completion_version, decision, channel, declared_name, accepted_text) values ('%s', '%s', 1, 'accepted', 'customer_link', 'Cliente', 'Texto de aceite suficientemente longo')$q$, org, oc)), '%duplicate key%', 'um aceite por versão da conclusão');
  perform test.sql(format($q$insert into public.public_access_tokens (organization_id, service_order_id, token_hash, expires_at) values ('%s', '%s', sha256('a'), now() + interval '1 day')$q$, org, oa));
  perform test.has(test.bad(format($q$insert into public.public_access_tokens (organization_id, service_order_id, token_hash, expires_at) values ('%s', '%s', sha256('b'), now() + interval '1 day')$q$, org, oa)), '%duplicate key%', 'um link ativo por ordem');
  perform test.has(test.bad(format($q$insert into public.quote_items (organization_id, quote_version_id, position, kind, description, unit, quantity, unit_price_cents, line_total_cents) values ('%s', '%s', 9, 'service', 'Item torto', 'un', 2, 1000, 1999)$q$, org, qa2)), '%violates check constraint%', 'total da linha confere com quantidade × preço');
  perform test.sql(format($q$insert into public.quote_items (organization_id, quote_version_id, position, kind, description, unit, quantity, unit_price_cents, line_total_cents) values ('%s', '%s', 9, 'service', 'Item certo', 'un', 1.005, 100, 101)$q$, org, qa2));
  perform test.has(test.bad(format($q$update public.quote_versions set subtotal_cents = 5000, discount_cents = 0, total_cents = 4000 where id = '%s'$q$, qa2)), '%violates check constraint%', 'total do orçamento = subtotal − desconto');
  perform test.has(test.bad(format($q$insert into public.quote_decisions (organization_id, service_order_id, quote_version_id, decision, channel, declared_name, accepted_text, operator_user_id) values ('%s', '%s', '%s', 'approved', 'staff_manual', 'Cliente', 'Texto de aceite suficientemente longo', 'ffffffff-0000-4000-8000-0000000000a1')$q$, org, ob, qb)), '%violates check constraint%', 'registro manual exige justificativa');
  perform test.has(test.bad(format($q$insert into public.order_part_usage (organization_id, service_order_id, description, unit, quantity, entry_kind, reason) values ('%s', '%s', 'Peça', 'un', -1, 'reversal', 'devolvida ao estoque')$q$, org, oa)), '%violates check constraint%', 'estorno referencia o uso original');
  perform test.has(test.bad(format($q$update public.service_orders set execution_status = 'scheduled', scheduled_start_at = now() + interval '1 day', scheduled_end_at = now() + interval '1 day 2 hours' where id = '%s'$q$, ob)), '%violates check constraint%', 'agendada exige técnico');
  perform test.has(test.bad(format($q$update public.service_orders set scheduled_start_at = now() + interval '1 day', scheduled_end_at = now() + interval '20 days' where id = '%s'$q$, ob)), '%violates check constraint%', 'janela de no máximo 14 dias');
  perform test.has(test.bad(format($q$update public.service_orders set quote_mode = 'authorized' where id = '%s'$q$, ob)), '%violates check constraint%', 'execução sem orçamento exige justificativa');
  raise notice 'PASS: unicidade e cálculos no banco (5)';
end $$;

-- ===================================================================== (6) limite de tentativas e leitura do técnico
do $$
declare i int;
begin
  for i in 1..3 loop perform test.sql($q$select private.os_rate_hit('teste-limite', 3, 600)$q$); end loop;
  perform test.has(test.bad($q$select private.os_rate_hit('teste-limite', 3, 600)$q$), '%Muitas tentativas%', 'a 4ª tentativa estoura o limite de 3');
  assert test.errmsg($q$select private.os_rate_hit('outro-balde', 3, 600)$q$) is null, 'outro balde não é afetado';
end $$;

:as_t1
do $$
declare qa2 uuid := test.t('qa2');
begin
  assert test.count('select 1 from public.quote_versions') >= 1, 'técnico lê as versões publicadas/aprovadas da própria ordem';
  assert test.count('select 1 from public.quote_versions where status = ''draft''') = 0, 'técnico NUNCA lê rascunho de orçamento';
  assert test.count(format('select 1 from public.quote_items where quote_version_id = %L', qa2)) = 0, 'nem os itens do rascunho';
  raise notice 'PASS: limite de tentativas e rascunho invisível ao técnico (6)';
end $$;
reset role;

rollback;
