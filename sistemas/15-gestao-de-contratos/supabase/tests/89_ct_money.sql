-- Gestão de Contratos — valores, aditivos, renovação e reajuste: cada recusa tem o seu teste (mensagem exata), e os limites são conferidos nos dois lados.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
grant execute on all functions in schema test to anon, authenticated;
-- cria (e opcionalmente ativa) um contrato de teste: com parte, com ou sem valor, determinado ou indeterminado
create function test.mk(org uuid, cp uuid, title text, amount bigint, indefinite boolean, activate boolean) returns uuid language plpgsql as $$
declare c uuid; p jsonb;
begin
  p := jsonb_build_object('title', title, 'start_date', (current_date - 30)::text, 'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Contratada')));
  if indefinite then p := p || jsonb_build_object('indefinite_term', true); else p := p || jsonb_build_object('end_date', (current_date + 120)::text); end if;
  if amount is not null then p := p || jsonb_build_object('value', jsonb_build_object('amount_cents', amount, 'billing_basis', 'monthly')); end if;
  c := (public.ct_create_contract(org, gen_random_uuid(), p) ->> 'id')::uuid;
  if activate then perform public.ct_activate_contract(org, c, test.cv(c)); end if;
  return c;
end $$;
create function test.doc_version(org uuid, c uuid) returns uuid language plpgsql as $$
declare d jsonb;
begin
  d := public.ct_add_document(org, c, gen_random_uuid(), 'Documento', 'other', jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'doc.pdf'));
  return (d ->> 'version_id')::uuid;
end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid');

:as_o
do $$
declare org uuid; cp uuid;
begin
  org := public.create_organization('Empresa Valores', 'empresa-valores'); perform set_config('t.org', org::text, true);
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte de Valores"}', gen_random_uuid());
  perform set_config('t.cp', cp::text, true);
  perform set_config('t.c_novalue', test.mk(org, cp, 'Sem valor', null, false, false)::text, true);
  perform set_config('t.c_draft_value', test.mk(org, cp, 'Rascunho com valor', 50000, false, false)::text, true);
  perform set_config('t.c', test.mk(org, cp, 'Ativo com valor', 100000, false, true)::text, true);
  perform set_config('t.c_other', test.mk(org, cp, 'Outro ativo', 100000, false, true)::text, true);
  perform set_config('t.c_indef', test.mk(org, cp, 'Indeterminado', 100000, true, true)::text, true);
  perform set_config('t.c_huge', test.mk(org, cp, 'Valor máximo', 99999999999999, false, true)::text, true);
  raise notice 'PASS: preparação (1)';
end $$;

-- ===================================================================== (2) valor inicial
do $$
declare org uuid := test.t('org'); c uuid := test.t('c_novalue');
begin
  perform test.has(test.errmsg(format($q$select public.ct_set_initial_value(%L, %L, %s, to_jsonb(-1), 'monthly')$q$, org, c, test.cv(c))), '%valor fora do permitido%', 'valor negativo');
  perform test.has(test.errmsg(format($q$select public.ct_set_initial_value(%L, %L, %s, to_jsonb(100000000000000::bigint), 'monthly')$q$, org, c, test.cv(c))), '%valor fora do permitido%', 'valor acima do máximo');
  perform test.has(test.errmsg(format($q$select public.ct_set_initial_value(%L, %L, %s, to_jsonb(1000), 'weekly')$q$, org, c, test.cv(c))), '%periodicidade%', 'periodicidade inválida');
  perform test.has(test.errmsg(format($q$select public.ct_set_initial_value(%L, %L, %s, '"mil"'::jsonb, 'monthly')$q$, org, c, test.cv(c))), '%informe o valor%', 'valor não numérico');
  perform public.ct_set_initial_value(org, c, test.cv(c), to_jsonb(0), 'one_time');
  assert test.cnt(format($q$select count(*) from public.contract_value_versions where contract_id = %L and amount_cents = 0$q$, c)) = 1, 'valor zero é aceito';
  perform test.has(test.errmsg(format($q$select public.ct_set_initial_value(%L, %L, %s, to_jsonb(500), 'monthly')$q$, org, c, test.cv(c))), '%já tem valor%', 'valor inicial só uma vez');
  raise notice 'PASS: valor inicial (2)';
end $$;

-- ===================================================================== (3) aditivos e correções
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); dv_other uuid; r jsonb; start_d text := (current_date - 30)::text;
begin
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'effective_date', %L, 'description', 'Aditivo em rascunho'))$q$, org, test.t('c_draft_value'), test.cv(test.t('c_draft_value')), current_date::text)), '%só em contrato ativo%', 'aditivo em rascunho');
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'outro', 'effective_date', %L, 'description', 'Tipo errado'))$q$, org, c, test.cv(c), current_date::text)), '%tipo de alteração inválido%', 'tipo inválido');
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'description', 'Sem data'))$q$, org, c, test.cv(c))), '%informe a data de efeito%', 'sem data de efeito');
  dv_other := test.doc_version(org, test.t('c_other'));
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'effective_date', %L, 'description', 'Documento de outro contrato', 'document_version_id', %L))$q$, org, c, test.cv(c), current_date::text, dv_other)), '%documento precisa ser deste contrato%', 'documento de outro contrato');
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'effective_date', %L, 'description', 'Valor no futuro', 'new_value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'monthly')))$q$, org, c, test.cv(c), (current_date + 5)::text)), '%até hoje%', 'valor com efeito futuro');
  -- a data de efeito precisa ser POSTERIOR à última versão de valor (a inicial vale desde o início da vigência)
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'effective_date', %L, 'description', 'Mesma data do valor inicial', 'new_value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'monthly')))$q$, org, c, test.cv(c), start_d)), '%posterior à última versão%', 'mesma data da última versão');
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'effective_date', %L, 'description', 'Data anterior ao valor inicial', 'new_value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'monthly')))$q$, org, c, test.cv(c), (current_date - 40)::text)), '%posterior à última versão%', 'data anterior à última versão');
  -- aditivo sem valor não mexe no histórico; com valor cria a versão ligada ao aditivo
  r := public.ct_register_change(org, c, test.cv(c), jsonb_build_object('change_type', 'correction', 'effective_date', current_date::text, 'description', 'Correção de texto, sem valor'));
  assert (r ->> 'value_version_id') is null and test.cnt(format($q$select count(*) from public.contract_value_versions where contract_id = %L$q$, c)) = 1, 'correção sem valor não cria versão de valor';
  r := public.ct_register_change(org, c, test.cv(c), jsonb_build_object('change_type', 'amendment', 'effective_date', (current_date - 5)::text, 'description', 'Aditivo com novo valor', 'new_value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'monthly')));
  assert (r ->> 'value_version_id') is not null, 'aditivo com valor devolve a nova versão';
  assert test.cnt(format($q$select count(*) from public.contract_value_versions where id = %L and source_change_id = %L and amount_cents = 120000$q$, (r ->> 'value_version_id')::uuid, (r ->> 'change_id')::uuid)) = 1, 'a versão de valor aponta para o aditivo que a originou';
  raise notice 'PASS: aditivos e correções (3)';
end $$;

-- ===================================================================== (4) renovação
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); ci uuid := test.t('c_indef'); dv_other uuid; cd uuid := test.t('c_draft_value');
begin
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, current_date + 400, false, null, 'Renovação em rascunho', null)$q$, org, cd, test.cv(cd))), '%só um contrato ativo pode ser renovado%', 'renovar rascunho');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, current_date + 400, true, null, 'Indeterminado e com data', null)$q$, org, c, test.cv(c))), '%prazo indeterminado não tem data de fim%', 'indeterminado com data final');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, null, true, null, 'Já era indeterminado', null)$q$, org, ci, test.cv(ci))), '%já é por prazo indeterminado%', 'renovar o que já é indeterminado');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, null, false, null, 'Sem nova data nem indeterminado', null)$q$, org, c, test.cv(c))), '%informe a nova data de fim%', 'sem nova data');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, current_date + 120, false, null, 'Mesma data final do contrato', null)$q$, org, c, test.cv(c))), '%posterior à atual%', 'data final igual à atual');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, current_date + 400, false, null, 'abc', null)$q$, org, c, test.cv(c))), '%justificativa%', 'justificativa curta');
  dv_other := test.doc_version(org, test.t('c_other'));
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, current_date + 400, false, null, 'Documento de outro contrato', %L)$q$, org, c, test.cv(c), dv_other)), '%documento precisa ser deste contrato%', 'documento de outro contrato');
  perform public.ct_renew_contract(org, c, test.cv(c), current_date + 121, false, null, 'Um dia a mais já é renovação', null);
  assert (select end_date from public.contracts where id = c) = current_date + 121, 'a nova data final vale a partir da renovação';
  assert test.cnt(format($q$select count(*) from public.contract_changes where contract_id = %L and change_type = 'renewal'$q$, c)) = 1, 'a renovação fica registrada como renovação';
  raise notice 'PASS: renovação (4)';
end $$;

-- ===================================================================== (5) regra e reajuste
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); cn uuid := test.t('c_novalue'); ch uuid := test.t('c_huge'); cd uuid := test.t('c_draft_value'); s jsonb; closed uuid;
begin
  perform test.has(test.errmsg(format($q$select public.ct_set_adjustment_rule(%L, %L, 0, current_date + 30, 'IPCA', true)$q$, org, c)), '%de 1 a 120 meses%', 'frequência zero');
  perform test.has(test.errmsg(format($q$select public.ct_set_adjustment_rule(%L, %L, 121, current_date + 30, 'IPCA', true)$q$, org, c)), '%de 1 a 120 meses%', 'frequência acima de 120');
  perform public.ct_set_adjustment_rule(org, c, 120, current_date + 30, 'IPCA', true);
  perform public.ct_set_adjustment_rule(org, c, 1, current_date + 30, 'IPCA', true);
  perform test.has(test.errmsg(format($q$select public.ct_set_adjustment_rule(%L, %L, 12, null, 'IPCA', true)$q$, org, c)), '%próxima data de reajuste%', 'regra sem próxima data');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, null, 5, null, null, null, null)$q$, org, c)), '%data de efeito%', 'simulação sem data de efeito');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, 1001, null, null, null, null)$q$, org, c)), '%fora do permitido%', 'percentual acima de 1000');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, -100, null, null, null, 'Justificativa suficiente')$q$, org, c)), '%fora do permitido%', 'percentual de -100');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, -5, null, null, null, 'abc')$q$, org, c)), '%exige justificativa%', 'negativo com justificativa curta');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, -5, null, null, null, null)$q$, org, c)), '%exige justificativa%', 'negativo sem justificativa');
  s := public.ct_simulate_adjustment(org, c, current_date, 1000, null, null, null, null);
  assert (s ->> 'new_amount_cents')::bigint = (s ->> 'base_amount_cents')::bigint * 11, '+1000% multiplica por 11';
  s := public.ct_simulate_adjustment(org, c, current_date, -5, null, null, null, 'Redução acordada');
  assert (s ->> 'new_amount_cents')::bigint = (s ->> 'base_amount_cents')::bigint * 95 / 100, 'percentual negativo com justificativa';
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, 5, null, null, null, null)$q$, org, cd)), '%só em contrato ativo%', 'simular em rascunho');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, 5, null, null, null, null)$q$, org, cn)), '%só em contrato ativo%', 'simular em rascunho sem valor');
  closed := test.mk(org, test.t('cp'), 'Encerrado com valor', 100000, false, true);
  perform public.ct_close_contract(org, closed, test.cv(closed), 'Encerramento normal do contrato');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, 5, null, null, null, null)$q$, org, closed)), '%só em contrato ativo%', 'simular em contrato encerrado');
  -- ativo sem valor vigente
  cn := test.mk(org, test.t('cp'), 'Ativo sem valor', null, false, true);
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, 5, null, null, null, null)$q$, org, cn)), '%não tem valor vigente%', 'sem valor vigente');
  -- resultado acima do máximo
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, current_date, 10, null, null, null, null)$q$, org, ch)), '%resultado do reajuste fica fora do permitido%', 'resultado acima do máximo');
  raise notice 'PASS: regra e reajuste (5)';
end $$;

-- ===================================================================== (6) aplicar: contrato encerrado depois da simulação e valor com a mesma data de efeito
do $$
declare org uuid := test.t('org'); cp uuid := test.t('cp'); a1 uuid; a2 uuid; s jsonb; r jsonb;
begin
  a1 := test.mk(org, cp, 'Encerrado depois de simular', 100000, false, true);
  s := public.ct_simulate_adjustment(org, a1, current_date - 1, 10, null, null, null, null);
  perform public.ct_close_contract(org, a1, test.cv(a1), 'Encerramento normal do contrato');
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, %L)$q$, org, (s ->> 'id')::uuid)), '%só em contrato ativo%', 'aplicar em contrato encerrado');
  a2 := test.mk(org, cp, 'Valor na mesma data da proposta', 100000, false, true);
  s := public.ct_simulate_adjustment(org, a2, current_date - 3, 10, null, null, null, null);
  r := public.ct_register_change(org, a2, test.cv(a2), jsonb_build_object('change_type', 'amendment', 'effective_date', (current_date - 3)::text, 'description', 'Aditivo na mesma data', 'new_value', jsonb_build_object('amount_cents', 90000, 'billing_basis', 'monthly')));
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, %L)$q$, org, (s ->> 'id')::uuid)), '%ordem cronológica%', 'valor com a mesma data de efeito');
  raise notice 'PASS: aplicar reajuste (6)';
end $$;

-- ===================================================================== (7) aplicar: a nova versão mantém a periodicidade e a regra avança a partir da data de efeito
do $$
declare org uuid := test.t('org'); cp uuid := test.t('cp'); c uuid; s jsonb; r jsonb; eff date := current_date - 1;
begin
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Anual com regra', 'start_date', (current_date - 30)::text, 'end_date', (current_date + 300)::text,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Contratada')),
    'value', jsonb_build_object('amount_cents', 1200000, 'billing_basis', 'annual'),
    'adjustment_rule', jsonb_build_object('frequency_months', 6, 'next_adjustment_date', (current_date + 20)::text, 'reference_label', 'IPCA'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c, test.cv(c));
  s := public.ct_simulate_adjustment(org, c, eff, 10, 'IPCA', null, null, null);
  r := public.ct_apply_adjustment(org, (s ->> 'id')::uuid);
  assert test.cnt(format($q$select count(*) from public.contract_value_versions where id = %L and billing_basis = 'annual' and amount_cents = 1320000$q$, (r ->> 'value_version_id')::uuid)) = 1, 'a nova versão mantém a periodicidade (anual) e o valor exato';
  assert (r ->> 'next_adjustment_date')::date = (eff + interval '6 months')::date, 'a próxima data parte da data de efeito, e não da data prevista antes';
  assert (select next_adjustment_date from public.contract_adjustment_rules where contract_id = c) = (eff + interval '6 months')::date, 'a regra guarda a nova próxima data';
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and deadline_type = 'adjustment' and superseded_at is null and due_date = %L$q$, c, (eff + interval '6 months')::date)) = 1, 'o prazo de reajuste acompanha a nova data';
  raise notice 'PASS: aplicar reajuste e avançar a regra (7)';
end $$;
reset role;

rollback;
