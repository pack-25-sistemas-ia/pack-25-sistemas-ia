-- Gestão de Contratos — domínio no banco: partes (CPF/CNPJ), contrato, numeração, aviso, documentos e versões, renovação, valor e reajuste exatos, ciclo de vida e obrigações.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_rd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a4","aal":"aal1","email":"rd@t.invalid"}'', true); set local role authenticated;'
\set as_out 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a5","aal":"aal1","email":"out@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
create function test.derr(q text) returns text language plpgsql security definer set search_path = '' as $$ begin begin execute q; exception when others then return sqlerrm; end; return null; end $$;
create function test.val(c uuid, d date) returns bigint language sql security definer set search_path = '' as $$ select (private.ct_value_at(c, d)).amount_cents $$;
create function test.addm(d date, n integer) returns date language sql security definer set search_path = '' as $$ select private.ct_add_months(d, n) $$;
create function test.today() returns date language sql security definer set search_path = '' as $$ select private.ct_today(current_setting('t.org')::uuid) $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
create function test.cev(c uuid, ty text) returns bigint language sql security definer set search_path = '' as $$ select count(*) from public.contract_events where contract_id = c and event_type = ty $$;
create function test.file(org uuid, c uuid, ext text default 'pdf', mime text default 'application/pdf') returns jsonb language sql as $$
  select jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || ext, 'mime', mime, 'size', 2048, 'filename', 'contrato.' || ext) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 'ed@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a4', 'rd@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a5', 'out@t.invalid');

-- ===================================================================== (1) empresa, pessoas, categorias e partes
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Contratos Teste', 'contratos-teste'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a4', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a5', 'member');
  assert (select count(*) from public.reminder_rules where organization_id = org) = 4, 'regras de lembrete padrão criadas com a empresa';
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); cat uuid; cp1 uuid; cp2 uuid;
begin
  cat := public.ct_save_category(org, null, 'Prestação de serviços'); perform set_config('t.cat', cat::text, true);
  perform test.has(test.errmsg(format($q$select public.ct_save_category(%L, null, 'prestação de SERVIÇOS')$q$, org)), '%já existe uma categoria%', 'categoria repetida (sem diferenciar caixa)');
  cp1 := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Alfa Serviços Ltda","email":"contato@alfa.example","document_number":"11.222.333/0001-81"}', gen_random_uuid());
  cp2 := public.ct_save_counterparty(org, null, null, '{"person_type":"person","name":"Beatriz Souza","document_number":"529.982.247-25"}', gen_random_uuid());
  perform set_config('t.cp1', cp1::text, true); perform set_config('t.cp2', cp2::text, true);
  perform test.has(test.errmsg(format($q$select public.ct_save_counterparty(%L, null, null, '{"person_type":"person","name":"CPF Falso","document_number":"111.111.111-11"}', gen_random_uuid())$q$, org)), '%CPF/CNPJ inválido%', 'CPF com dígitos repetidos');
  perform test.has(test.errmsg(format($q$select public.ct_save_counterparty(%L, null, null, '{"person_type":"person","name":"CPF Errado","document_number":"529.982.247-26"}', gen_random_uuid())$q$, org)), '%CPF/CNPJ inválido%', 'dígito verificador errado');
  perform test.has(test.errmsg(format($q$select public.ct_save_counterparty(%L, null, null, '{"person_type":"person","name":"Tipo Trocado","document_number":"11.222.333/0001-81"}', gen_random_uuid())$q$, org)), '%não combina com o tipo%', 'CNPJ numa pessoa física');
  perform test.has(test.errmsg(format($q$select public.ct_save_counterparty(%L, null, null, '{"person_type":"company","name":"Alfa Duplicada","document_number":"11222333000181"}', gen_random_uuid())$q$, org)), '%já existe uma parte%', 'documento repetido na empresa');
  assert public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Sem Documento"}', gen_random_uuid()) is not null, 'documento é opcional';
  assert test.cnt(format('select count(*) from public.counterparty_documents where organization_id = %L', org)) = 2, 'documentos guardados à parte';
  raise notice 'PASS: partes e CPF/CNPJ validados (1)';
end $$;
reset role;
:as_ed
do $$
begin
  perform test.has(test.errmsg(format($q$select public.ct_save_counterparty(%L, null, null, '{"person_type":"company","name":"Invasora"}', gen_random_uuid())$q$, test.t('org'))), '%sem permissão%', 'colaborador não cadastra parte');
  assert test.count('select 1 from public.counterparty_documents') = 0, 'colaborador não lê CPF/CNPJ';
  assert test.count('select 1 from public.counterparties') = 0, 'sem contrato vinculado, colaborador não vê partes';
  raise notice 'PASS: colaborador não cadastra parte nem lê documentos pessoais (1)';
end $$;
reset role;

-- ===================================================================== (2) contrato: criação, numeração, prazo de aviso e prazos derivados
:as_m
do $$
declare org uuid := test.t('org'); today date := test.today(); r jsonb; c uuid; c2 uuid; ed uuid := 'ffffffff-0000-4000-8000-0000000000a3'; rd uuid := 'ffffffff-0000-4000-8000-0000000000a4';
begin
  r := public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato de manutenção mensal', 'category_id', test.t('cat'), 'start_date', (today - 100)::text, 'end_date', (today + 45)::text,
    'responsible_user_id', ed, 'notice_days', 30, 'renewal_mode', 'manual',
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', test.t('cp1'), 'role_description', 'Contratada'), jsonb_build_object('counterparty_id', test.t('cp2'), 'role_description', 'Contratante')),
    'access', jsonb_build_array(jsonb_build_object('user_id', ed, 'role', 'editor'), jsonb_build_object('user_id', rd, 'role', 'reader')),
    'value', jsonb_build_object('amount_cents', 100000, 'billing_basis', 'monthly'), 'adjustment_rule', jsonb_build_object('frequency_months', 12, 'next_adjustment_date', (today - 10)::text, 'reference_label', 'IPCA')));
  c := (r ->> 'id')::uuid; perform set_config('t.c', c::text, true);
  assert (r ->> 'contract_number')::int = 1, 'primeiro número do contrato';
  assert (select lifecycle_status from public.contracts where id = c) = 'draft', 'contrato nasce em rascunho';
  assert (select notice_deadline_date from public.contracts where id = c) = today + 15, 'aviso = fim − 30 dias';
  assert (select count(*) from public.contract_deadlines where contract_id = c and superseded_at is null) = 3, 'prazos derivados: fim, aviso e reajuste';
  assert (select identity_snapshot ->> 'document_masked' from public.contract_parties where contract_id = c and counterparty_id = test.t('cp2')) = '***.982.247-**', 'snapshot sem o CPF completo';
  -- idempotência: o mesmo envio não cria outro contrato
  assert public.ct_create_contract(org, test.txt('select idempotency_key::text from public.mutation_requests where scope = ''create_contract'' order by created_at limit 1')::uuid, jsonb_build_object('title', 'Contrato de manutenção mensal', 'category_id', test.t('cat'), 'start_date', (today - 100)::text, 'end_date', (today + 45)::text,
    'responsible_user_id', ed, 'notice_days', 30, 'renewal_mode', 'manual',
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', test.t('cp1'), 'role_description', 'Contratada'), jsonb_build_object('counterparty_id', test.t('cp2'), 'role_description', 'Contratante')),
    'access', jsonb_build_array(jsonb_build_object('user_id', ed, 'role', 'editor'), jsonb_build_object('user_id', rd, 'role', 'reader')),
    'value', jsonb_build_object('amount_cents', 100000, 'billing_basis', 'monthly'), 'adjustment_rule', jsonb_build_object('frequency_months', 12, 'next_adjustment_date', (today - 10)::text, 'reference_label', 'IPCA'))) ->> 'id' = c::text, 'duplo envio devolve o mesmo contrato';
  assert (select count(*) from public.contracts where organization_id = org) = 1, 'duplo envio não duplica';
  -- validações de vigência
  perform test.has(test.errmsg(format($q$select public.ct_create_contract(%L, gen_random_uuid(), jsonb_build_object('title', 'Sem fim', 'start_date', %L))$q$, org, today::text)), '%informe o fim da vigência%', 'prazo determinado exige data final');
  perform test.has(test.errmsg(format($q$select public.ct_create_contract(%L, gen_random_uuid(), jsonb_build_object('title', 'Indeterminado com fim', 'start_date', %L, 'end_date', %L, 'indefinite_term', true))$q$, org, today::text, (today + 5)::text)), '%indeterminado não tem data de fim%', 'indeterminado sem fim');
  perform test.has(test.errmsg(format($q$select public.ct_create_contract(%L, gen_random_uuid(), jsonb_build_object('title', 'Fim antes do início', 'start_date', %L, 'end_date', %L))$q$, org, today::text, (today - 1)::text)), '%anterior ao início%', 'fim antes do início');
  perform test.has(test.errmsg(format($q$select public.ct_create_contract(%L, gen_random_uuid(), jsonb_build_object('title', 'Aviso sem referência', 'start_date', %L, 'indefinite_term', true, 'notice_days', 30))$q$, org, today::text)), '%data de referência do prazo de aviso%', 'indeterminado com aviso exige referência');
  perform test.has(test.errmsg(format($q$select public.ct_create_contract(%L, gen_random_uuid(), jsonb_build_object('title', 'Responsável de fora', 'start_date', %L, 'end_date', %L, 'responsible_user_id', gen_random_uuid()))$q$, org, today::text, (today + 9)::text)), '%membro da empresa%', 'responsável de fora');
  perform test.has(test.errmsg(format($q$select public.ct_create_contract(%L, gen_random_uuid(), jsonb_build_object('title', 'Responsável leitor', 'start_date', %L, 'end_date', %L, 'responsible_user_id', %L, 'access', jsonb_build_array(jsonb_build_object('user_id', %L, 'role', 'reader'))))$q$, org, today::text, (today + 9)::text, rd, rd)), '%responsável inválido%', 'leitor não pode ser responsável');
  -- segundo contrato (indeterminado, com aviso e referência explícita)
  r := public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato de fornecimento contínuo', 'start_date', (today - 30)::text, 'indefinite_term', true, 'notice_days', 60, 'notice_reference_date', (today + 120)::text,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', test.t('cp1'), 'role_description', 'Fornecedora'))));
  c2 := (r ->> 'id')::uuid; perform set_config('t.c2', c2::text, true);
  assert (r ->> 'contract_number')::int = 2, 'numeração sequencial';
  assert (select notice_deadline_date from public.contracts where id = c2) = today + 60, 'aviso do indeterminado usa a referência explícita';
  assert (select end_date from public.contracts where id = c2) is null, 'indeterminado sem data final';
  raise notice 'PASS: criação, numeração, validações de vigência e aviso (2)';
end $$;
reset role;

-- ===================================================================== (3) ativação e papéis
:as_m
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); today date := test.today(); v integer; blank uuid;
begin
  blank := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Sem partes', 'start_date', today::text, 'end_date', (today + 9)::text)) ->> 'id')::uuid;
  perform test.has(test.errmsg(format($q$select public.ct_activate_contract(%L, %L, %s)$q$, org, blank, test.cv(blank))), '%ao menos uma parte%', 'ativar exige parte');
  perform public.ct_delete_draft(org, blank, test.cv(blank));
  assert not exists (select 1 from public.contracts where id = blank), 'rascunho sem histórico pode ser excluído';
  v := public.ct_activate_contract(org, c, test.cv(c));
  assert (select lifecycle_status from public.contracts where id = c) = 'active', 'ativado';
  perform test.has(test.errmsg(format($q$select public.ct_delete_draft(%L, %L, %s)$q$, org, c, test.cv(c))), '%só um rascunho%', 'contrato ativo não se exclui');
  perform test.has(test.errmsg(format($q$select public.ct_activate_contract(%L, %L, %s)$q$, org, c, test.cv(c))), '%só um rascunho%', 'já ativo');
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, %s, '{"title":"Outro"}')$q$, org, c, v - 1)), '%Outra pessoa alterou%', 'versão antiga é recusada');
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, %s, '{"end_date":"2099-01-01"}')$q$, org, c, test.cv(c))), '%renovação ou aditivo%', 'vigência de contrato ativo não muda por edição');
  raise notice 'PASS: ativação e exclusão de rascunho (3)';
end $$;
reset role;
:as_ed
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); today date := test.today(); v integer; d0 date;
begin
  v := public.ct_update_contract(org, c, test.cv(c), '{"title":"Contrato de manutenção mensal (atualizado)"}');
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, %s, '{"renewal_mode":"none"}')$q$, org, c, test.cv(c))), '%sem permissão%', 'editor não altera o modo de renovação');
  perform test.has(test.errmsg(format($q$select public.ct_set_responsible(%L, %L, %s, null)$q$, org, c, test.cv(c))), '%sem permissão%', 'editor não troca o responsável');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, %L, false, null, 'Renovação do editor')$q$, org, c, test.cv(c), (today + 400)::text)), '%sem permissão%', 'editor não renova');
  perform test.has(test.errmsg(format($q$select public.ct_terminate_contract(%L, %L, %s, %L, 'Quero rescindir')$q$, org, c, test.cv(c), today::text)), '%sem permissão%', 'editor não rescinde');
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, gen_random_uuid())$q$, org)), '%sem permissão%', 'editor não aplica reajuste');
  -- aviso: ajuste manual exige justificativa e fica marcado
  perform test.has(test.errmsg(format($q$select public.ct_set_notice(%L, %L, %s, jsonb_build_object('notice_days', 30, 'manual_deadline', %L))$q$, org, c, test.cv(c), (today + 10)::text)), '%justificativa do ajuste manual%', 'ajuste manual sem justificativa');
  d0 := (select notice_deadline_date from public.contracts where id = c);
  perform public.ct_set_notice(org, c, test.cv(c), jsonb_build_object('notice_days', 30, 'manual_deadline', (today + 10)::text, 'justification', 'Cláusula 7 conta 35 dias úteis'));
  assert (select notice_adjusted from public.contracts where id = c), 'aviso marcado como ajustado';
  assert (select notice_deadline_date from public.contracts where id = c) = today + 10 and d0 = today + 15, 'prazo ajustado manualmente';
  assert (select count(*) from public.contract_deadlines where contract_id = c and deadline_type = 'notice') = 2, 'a revisão anterior do aviso foi preservada';
  assert (select count(*) from public.contract_deadlines where contract_id = c and deadline_type = 'notice' and superseded_at is null) = 1, 'só um aviso corrente';
  -- volta ao cálculo automático
  perform public.ct_set_notice(org, c, test.cv(c), '{"notice_days":30}');
  assert (select notice_adjusted from public.contracts where id = c) = false and (select notice_deadline_date from public.contracts where id = c) = today + 15, 'recalculado: fim − dias';
  assert (select count(*) from public.contract_deadlines where contract_id = c and deadline_type = 'notice') = 3, 'três revisões do aviso no histórico';
  raise notice 'PASS: editor atua nos dados permitidos e não nas decisões da gestão; aviso recalculado com revisões (3)';
end $$;
reset role;
:as_rd
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); q text;
begin
  foreach q in array array[
    format($q$select public.ct_update_contract(%L, %L, null, '{"title":"Invasão"}')$q$, org, c),
    format($q$select public.ct_set_notice(%L, %L, null, '{"notice_days":10}')$q$, org, c),
    format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Doc', 'other', %L::jsonb)$q$, org, c, test.file(org, c)),
    format($q$select public.ct_save_obligation(%L, %L, null, null, '{"title":"Obrigação","due_date":"2099-01-01"}')$q$, org, c)] loop
    perform test.has(test.errmsg(q), '%sem permissão%', 'leitor não escreve: ' || left(q, 50));
  end loop;
  assert test.count(format('select 1 from public.contracts where id = %L', c)) = 1, 'leitor consulta o contrato';
  raise notice 'PASS: leitor do contrato só consulta (3)';
end $$;
reset role;
:as_out
do $$
begin
  assert test.count('select 1 from public.contracts') = 0, 'colaborador sem vínculo não vê contrato algum';
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, null, '{"title":"Invasão"}')$q$, test.t('org'), test.t('c'))), '%contrato não encontrado%', 'sem vínculo nem sabe que existe');
  raise notice 'PASS: colaborador sem vínculo não enxerga (3)';
end $$;
reset role;

-- ===================================================================== (4) documentos e versões
:as_ed
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); r jsonb; d uuid; v1 uuid; v2 uuid;
begin
  r := public.ct_add_document(org, c, gen_random_uuid(), 'Contrato assinado', 'main', test.file(org, c));
  d := (r ->> 'document_id')::uuid; v1 := (r ->> 'version_id')::uuid; perform set_config('t.d', d::text, true); perform set_config('t.v1', v1::text, true);
  r := public.ct_add_document_version(org, d, gen_random_uuid(), test.file(org, c, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  v2 := (r ->> 'version_id')::uuid; perform set_config('t.v2', v2::text, true);
  assert (r ->> 'version_number')::int = 2, 'versão sequencial';
  assert (select current_version_id from public.contract_documents where id = d) = v2, 'a nova versão passa a ser a atual';
  assert (select count(*) from public.contract_document_versions where document_id = d) = 2, 'a versão anterior continua preservada';
  perform public.ct_set_current_version(org, d, v1);
  assert (select current_version_id from public.contract_documents where id = d) = v1, 'versão atual definida explicitamente';
  assert public.ct_document_info(org, v1) ->> 'name' = 'contrato.pdf', 'quem vê o contrato obtém o caminho do arquivo';
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Outro contrato', 'main', jsonb_build_object('path', %L || '/' || %L || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 10, 'filename', 'x.pdf'))$q$, org, c, org::text, test.t('c2'))), '%arquivo inválido%', 'caminho de outro contrato');
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Executável', 'other', jsonb_build_object('path', %L || '/' || %L || '/' || replace(gen_random_uuid()::text, '-', '') || '.exe', 'mime', 'application/pdf', 'size', 10, 'filename', 'x.exe'))$q$, org, c, org::text, c::text)), '%arquivo inválido%', 'extensão fora da lista');
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'HTML', 'other', jsonb_build_object('path', %L || '/' || %L || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'text/html', 'size', 10, 'filename', 'x.pdf'))$q$, org, c, org::text, c::text)), '%tipo de arquivo não permitido%', 'tipo ativo recusado');
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Grande', 'other', jsonb_build_object('path', %L || '/' || %L || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 999999999, 'filename', 'x.pdf'))$q$, org, c, org::text, c::text)), '%tamanho máximo%', 'arquivo grande demais');
  raise notice 'PASS: documentos privados e versões preservadas (4)';
end $$;
reset role;

-- ===================================================================== (5) aritmética exata: reajuste (meio para cima em centavos) e soma de meses (último dia válido)
do $$
begin
  assert private.ct_apply_percentage(100001, 3.3333) = 103334, 'reajuste arredonda em centavos';
  assert private.ct_apply_percentage(333, -33.3333) = 222, 'reajuste negativo';
  assert private.ct_apply_percentage(1, 50) = 2 and private.ct_apply_percentage(1, -50) = 1, 'meio vai para cima (longe de zero)';
  assert private.ct_apply_percentage(100000, 0) = 100000, 'zero por cento não muda';
  assert private.ct_add_months('2024-01-31', 1) = '2024-02-29' and private.ct_add_months('2023-01-31', 1) = '2023-02-28', 'fim de mês limitado ao último dia válido';
  assert private.ct_add_months('2024-02-29', 12) = '2025-02-28', 'ano bissexto +12 meses';
  assert private.ct_add_months('2024-03-31', -1) = '2024-02-29', 'subtrair meses também limita';
  assert private.ct_notice_deadline('2024-03-01', 1) = '2024-02-29', 'aviso: dias corridos, sem feriados';
  raise notice 'PASS: aritmética exata (5)';
end $$;

-- ===================================================================== (6) valor, simulação e aplicação de reajuste
:as_m
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); today date := test.today(); s jsonb; a1 uuid; a2 uuid; r jsonb; v0 integer;
begin
  assert test.val(c, today) = 100000, 'valor vigente inicial';
  -- simulação NÃO altera o contrato
  s := public.ct_simulate_adjustment(org, c, today - 10, 5.5, 'IPCA', '12 meses até o mês anterior', 'Tabela publicada', null);
  a1 := (s ->> 'id')::uuid;
  assert (s ->> 'new_amount_cents')::bigint = 105500 and (s ->> 'base_amount_cents')::bigint = 100000, 'prévia: base 100000 → 105500';
  assert (select count(*) from public.contract_value_versions where contract_id = c) = 1, 'a simulação não criou versão de valor';
  assert test.val(c, today) = 100000, 'valor vigente intacto após simular';
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, %L, -3, null, null, null, null)$q$, org, c, (today - 5)::text)), '%percentual negativo exige justificativa%', 'negativo sem justificativa');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, %L, -100, null, null, null, 'zerar o contrato')$q$, org, c, (today - 5)::text)), '%percentual fora do permitido%', 'não zera o valor');
  perform test.has(test.errmsg(format($q$select public.ct_simulate_adjustment(%L, %L, %L, 2000, null, null, null, null)$q$, org, c, (today - 5)::text)), '%percentual fora do permitido%', 'limite máximo');
  -- aplicar com data futura é recusado
  s := public.ct_simulate_adjustment(org, c, today + 3, 4, null, null, null, null);
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, %L)$q$, org, (s ->> 'id'))), '%igual ou anterior a hoje%', 'data de efeito futura');
  assert (select status from public.contract_adjustments where id = a1) = 'cancelled', 'nova simulação cancela a proposta anterior em aberto';
  -- nova simulação válida e aplicação
  s := public.ct_simulate_adjustment(org, c, today - 10, 5.5, 'IPCA', '12 meses', 'Tabela publicada', null);
  a1 := (s ->> 'id')::uuid;
  r := public.ct_apply_adjustment(org, a1);
  assert (r ->> 'new_amount_cents')::bigint = 105500, 'novo valor aplicado';
  assert test.val(c, today) = 105500 and (select count(*) from public.contract_value_versions where contract_id = c) = 2, 'nova versão de valor; a anterior preservada';
  assert (select amount_cents from public.contract_value_versions where contract_id = c and effective_from < today - 10) = 100000, 'histórico de valores preservado';
  assert (select next_adjustment_date from public.contract_adjustment_rules where contract_id = c) = test.addm(today - 10, 12), 'próxima data só avança após a aplicação';
  assert (select status from public.contract_adjustments where id = a1) = 'applied', 'reajuste registrado como aplicado';
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, %L)$q$, org, a1)), '%já foi aplicado%', 'aplicar duas vezes');
  perform test.has(test.errmsg(format($q$select public.ct_cancel_adjustment(%L, %L)$q$, org, a1)), '%só uma proposta em aberto%', 'reajuste aplicado não se cancela');
  -- ordem cronológica: data anterior à última versão não pode ser aplicada
  s := public.ct_simulate_adjustment(org, c, today - 20, 1, null, null, null, null);
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, %L)$q$, org, (s ->> 'id'))), '%ordem cronológica%', 'fora da ordem cronológica');
  -- base desatualizada: simula, depois um aditivo muda o valor, e a aplicação é recusada
  s := public.ct_simulate_adjustment(org, c, today, 2, null, null, null, null);
  a2 := (s ->> 'id')::uuid;
  perform public.ct_register_change(org, c, test.cv(c), jsonb_build_object('change_type', 'amendment', 'effective_date', (today - 5)::text, 'description', 'Aditivo de escopo com novo valor', 'new_value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'monthly')));
  perform test.has(test.errmsg(format($q$select public.ct_apply_adjustment(%L, %L)$q$, org, a2)), '%A base do reajuste mudou%', 'base mudou desde a simulação');
  assert (select status from public.contract_adjustments where id = a2) = 'proposed', 'a proposta segue em aberto para nova simulação';
  assert test.val(c, today) = 120000, 'aditivo criou a nova versão de valor';
  perform test.has(test.errmsg(format($q$select public.ct_register_change(%L, %L, %s, jsonb_build_object('change_type', 'amendment', 'effective_date', %L, 'description', 'Fora de ordem', 'new_value', jsonb_build_object('amount_cents', 1, 'billing_basis', 'monthly')))$q$, org, c, test.cv(c), (today - 40)::text)), '%ordem cronológica%', 'aditivo de valor fora de ordem');
  -- negativo com justificativa
  s := public.ct_simulate_adjustment(org, c, today, -10, null, null, null, 'Redução negociada com o cliente');
  assert (s ->> 'new_amount_cents')::bigint = 108000, 'reajuste negativo com justificativa: 120000 → 108000';
  perform public.ct_apply_adjustment(org, (s ->> 'id')::uuid);
  assert test.val(c, today) = 108000, 'negativo aplicado';
  perform test.has(test.derr(format($q$update public.contract_adjustments set percentage_decimal = 50 where id = %L$q$, a1)), '%definitivo%', 'reajuste aplicado é imutável');
  raise notice 'PASS: simulação não altera, aplicação única, cronologia e base conferida (6)';
end $$;
reset role;

-- ===================================================================== (7) renovação manual e auditada
:as_m
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); today date := test.today(); old_end date; v integer; n integer; rev integer;
begin
  old_end := (select end_date from public.contracts where id = c);
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, %L, false, null, 'abc')$q$, org, c, test.cv(c), (old_end + 365)::text)), '%justificativa%', 'renovação exige justificativa');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, %L, false, null, 'Renovação por mais um ano')$q$, org, c, test.cv(c), old_end::text)), '%posterior à atual%', 'nova data precisa ser posterior');
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, null, false, null, 'Renovação por mais um ano')$q$, org, c, test.cv(c))), '%nova data de fim%', 'informe a nova data');
  n := (select count(*) from public.contract_deadlines where contract_id = c);
  perform public.ct_renew_contract(org, c, test.cv(c), old_end + 365, false, null, 'Renovação por mais um ano, conforme cláusula 12');
  assert (select end_date from public.contracts where id = c) = old_end + 365, 'nova data final';
  assert (select notice_deadline_date from public.contracts where id = c) = old_end + 365 - 30, 'aviso recalculado pela nova data';
  assert (select (before_snapshot ->> 'end_date')::date = old_end and (after_snapshot ->> 'end_date')::date = old_end + 365 from public.contract_changes where contract_id = c and change_type = 'renewal'), 'período anterior preservado no histórico (antes/depois)';
  assert (select count(*) from public.contract_deadlines where contract_id = c) > n and (select count(*) from public.contract_deadlines where contract_id = c and deadline_type = 'contract_end' and superseded_at is null) = 1, 'prazo de fim ganhou revisão; só um corrente';
  assert test.cev(c, 'contract_renewed') = 1, 'evento de renovação';
  -- nada renova sozinho: a data final só mudou por esta ação
  perform test.has(test.errmsg(format($q$select public.ct_renew_contract(%L, %L, %s, null, true, null, 'Passar a prazo indeterminado')$q$, org, test.t('c2'), test.cv(test.t('c2')))), '%só um contrato ativo%', 'rascunho não renova');
  raise notice 'PASS: renovação manual preserva o histórico e recalcula prazos (7)';
end $$;
reset role;

-- ===================================================================== (8) obrigações
:as_ed
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); today date := test.today(); o uuid; v integer;
begin
  o := public.ct_save_obligation(org, c, null, null, jsonb_build_object('title', 'Enviar relatório mensal', 'description', 'Relatório de atendimentos', 'responsible_user_id', 'ffffffff-0000-4000-8000-0000000000a3', 'due_date', (today + 3)::text));
  perform set_config('t.o', o::text, true);
  perform test.has(test.errmsg(format($q$select public.ct_save_obligation(%L, %L, null, null, jsonb_build_object('title', 'Responsável leitor', 'responsible_user_id', 'ffffffff-0000-4000-8000-0000000000a4', 'due_date', %L))$q$, org, c, (today + 3)::text)), '%responsável inválido%', 'leitor não pode ser responsável por obrigação');
  perform test.has(test.errmsg(format($q$select public.ct_save_obligation(%L, %L, null, null, jsonb_build_object('title', 'Sem data'))$q$, org, c)), '%informe a data%', 'obrigação exige data');
  v := (select version from public.contract_obligations where id = o);
  perform public.ct_complete_obligation(org, o, v, 'Enviado por e-mail');
  assert (select status from public.contract_obligations where id = o) = 'completed' and (select completed_at from public.contract_obligations where id = o) is not null, 'obrigação concluída';
  perform test.has(test.errmsg(format($q$select public.ct_complete_obligation(%L, %L, null, 'de novo')$q$, org, o)), '%é definitiva%', 'concluída é definitiva');
  perform test.has(test.errmsg(format($q$select public.ct_save_obligation(%L, %L, %L, null, jsonb_build_object('title', 'Editar concluída', 'due_date', %L))$q$, org, c, o, (today + 9)::text)), '%é definitiva%', 'concluída não edita');
  raise notice 'PASS: obrigações simples (8)';
end $$;
reset role;

-- ===================================================================== (9) ciclo de vida: rescindir, reabrir, encerrar e arquivar
:as_m
do $$
declare org uuid := test.t('org'); c uuid := test.t('c2'); today date := test.today(); v integer;
begin
  perform public.ct_activate_contract(org, c, test.cv(c));
  perform test.has(test.errmsg(format($q$select public.ct_terminate_contract(%L, %L, %s, %L, 'abc')$q$, org, c, test.cv(c), today::text)), '%motivo%', 'rescisão exige motivo');
  perform test.has(test.errmsg(format($q$select public.ct_terminate_contract(%L, %L, %s, %L, 'Descumprimento reiterado do prazo')$q$, org, c, test.cv(c), (today + 2)::text)), '%entre o início da vigência e hoje%', 'data da rescisão não pode ser futura');
  assert (select count(*) from public.contract_deadlines where contract_id = c and superseded_at is null) >= 1, 'prazos correntes enquanto ativo';
  v := public.ct_terminate_contract(org, c, test.cv(c), today - 1, 'Descumprimento reiterado do prazo');
  assert (select lifecycle_status from public.contracts where id = c) = 'terminated' and (select ended_on from public.contracts where id = c) = today - 1, 'rescindido, com data';
  assert (select count(*) from public.contract_deadlines where contract_id = c and superseded_at is null) = 0, 'sem prazos correntes depois de rescindir';
  assert exists (select 1 from public.contract_changes where contract_id = c and change_type = 'termination'), 'rescisão registrada no histórico de alterações';
  perform test.has(test.errmsg(format($q$select public.ct_update_contract(%L, %L, %s, '{"title":"Depois da rescisão"}')$q$, org, c, test.cv(c))), '%encerrado%', 'rescindido é somente consulta');
  perform test.has(test.derr(format($q$update public.contracts set title = 'Direto' where id = %L$q$, c)), '%somente para consulta%', 'gatilho: rescindido não edita nem por SQL');
  perform test.has(test.errmsg(format($q$select public.ct_reopen_contract(%L, %L, %s, 'abc')$q$, org, c, test.cv(c))), '%justificativa%', 'reabrir exige justificativa');
  perform public.ct_reopen_contract(org, c, test.cv(c), 'Rescisão registrada por engano');
  assert (select lifecycle_status from public.contracts where id = c) = 'active' and (select ended_on from public.contracts where id = c) is null, 'reaberto';
  assert (select count(*) from public.contract_deadlines where contract_id = c and superseded_at is null) >= 1, 'prazos correntes de novo após reabrir';
  perform public.ct_close_contract(org, c, test.cv(c), 'Objeto cumprido integralmente');
  assert (select lifecycle_status from public.contracts where id = c) = 'closed', 'encerrado administrativamente';
  perform public.ct_archive_contract(org, c, test.cv(c), true);
  assert (select archived_at from public.contracts where id = c) is not null, 'arquivado';
  perform test.has(test.errmsg(format($q$select public.ct_reopen_contract(%L, %L, %s, 'Reabrir arquivado')$q$, org, c, test.cv(c))), '%não arquivado%', 'arquivado não reabre direto');
  assert (select count(*) from public.contract_events where contract_id = c) >= 5, 'histórico de eventos preservado';
  perform test.has(test.errmsg(format($q$select public.ct_archive_contract(%L, %L, %s, true)$q$, org, test.t('c'), test.cv(test.t('c')))), '%rescindidos ou encerrados%', 'contrato ativo não arquiva');
  raise notice 'PASS: rescindir, reabrir, encerrar e arquivar preservando histórico (9)';
end $$;
reset role;

rollback;
