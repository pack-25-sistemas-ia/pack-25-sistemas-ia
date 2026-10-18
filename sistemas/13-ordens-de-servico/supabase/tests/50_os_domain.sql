-- Ordens de Serviço — domínio no banco, parte 1: perfis, cadastros, abertura (numeração e idempotência), snapshots, orçamento versionado (cálculo, publicação, imutabilidade, decisão manual)
-- e a regra «orçamento aprovado para iniciar». A execução, a conclusão e o aceite ficam em 51_os_execution.sql.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_t1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"t1@t.invalid"}'', true); set local role authenticated;'
\set as_t2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"t2@t.invalid"}'', true); set local role authenticated;'
\set as_v 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b1","aal":"aal1","email":"v@t.invalid"}'', true); set local role authenticated;'
\set as_x 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000c0","aal":"aal2","email":"x@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 't1@t.invalid'),
  ('ffffffff-0000-4000-8000-0000000000a3', 't2@t.invalid'), ('ffffffff-0000-4000-8000-0000000000b1', 'v@t.invalid'), ('ffffffff-0000-4000-8000-0000000000c0', 'x@t.invalid');

-- ===================================================================== (1) empresa, pessoas, perfis
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Assistência Teste', 'assistencia-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'),
    (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000b1', 'viewer');
  assert (select count(*) from public.os_settings where organization_id = org) = 1 and test.cnt(format('select count(*) from public.order_number_counters where organization_id = %L', org)) = 1, 'configurações e contador criados com a empresa';
  assert private.os_profile(org) = 'owner', 'dono é proprietário';
  assert (public.os_my_context(org) ->> 'profile') = 'owner', 'contexto do dono';
  raise notice 'PASS: empresa criada com configurações iniciais (1)';
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org');
begin
  assert private.os_profile(org) = 'manager', 'gestor';
  perform test.has(test.errmsg(format($q$select public.os_save_settings(%L, '{"quote_validity_days":10}')$q$, org)), '%sem permissão%', 'gestor não altera configurações');
  assert jsonb_array_length(public.os_people(org)) = 5, 'gestão enxerga as pessoas';
  raise notice 'PASS: gestor opera mas não administra a empresa (1)';
end $$;
reset role;

:as_t1
do $$
declare org uuid := test.t('org');
begin
  assert private.os_profile(org) = 'technician', 'membro é técnico';
  perform test.has(test.errmsg(format($q$select public.os_people(%L)$q$, org)), '%sem permissão%', 'técnico não lista pessoas');
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"Cliente Qualquer"}')$q$, org)), '%sem permissão%', 'técnico não cadastra cliente');
  perform test.has(test.errmsg(format($q$select public.os_save_service(%L, null, '{"name":"Serviço","reference_price_cents":100}')$q$, org)), '%sem permissão%', 'técnico não cadastra serviço');
  raise notice 'PASS: técnico não administra cadastros (1)';
end $$;
reset role;

:as_v
do $$
declare org uuid := test.t('org');
begin
  assert private.os_profile(org) is null, 'leitor sem perfil operacional';
  perform test.has(test.errmsg(format($q$select public.os_dashboard(%L, current_date - 7, current_date)$q$, org)), '%sem permissão%', 'leitor não vê painel');
  assert test.count('select 1 from public.customers') = 0 and test.count('select 1 from public.service_orders') = 0, 'leitor não lê dados operacionais';
  raise notice 'PASS: leitor do Core não acessa ordens (1)';
end $$;
reset role;

-- ===================================================================== (2) cadastros
:as_m
do $$
declare org uuid := test.t('org'); c1 uuid; c2 uuid; ad uuid; eq uuid; ct uuid; sv uuid; pt uuid;
begin
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"Maria Silva","document":"52998224724"}')$q$, org)), '%CPF ou CNPJ inválido%', 'CPF com dígito errado');
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"Maria Silva","document":"11111111111"}')$q$, org)), '%CPF ou CNPJ inválido%', 'CPF repetido');
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"M","phone":"1"}')$q$, org)), '%entre 2 e 160%', 'nome curto');
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"Maria Silva","email":"sem-arroba"}')$q$, org)), '%inválidos%', 'e-mail inválido');
  perform test.has(test.errmsg(format($q$select public.os_save_service(%L, null, '{"name":"Serviço barato demais","unit":"un","reference_price_cents":-1}')$q$, org)), '%preço de referência fora do permitido%', 'preço de referência negativo');
  c1 := public.os_save_customer(org, null, '{"name":"Maria Silva","kind":"person","document":"529.982.247-25","email":"maria@cliente.invalid","phone":"(11) 99999-0001","internal_notes":"paga em dia"}');
  c2 := public.os_save_customer(org, null, '{"name":"Oficina Beta Ltda","kind":"company","document":"11.222.333/0001-81"}');
  perform set_config('t.c1', c1::text, true); perform set_config('t.c2', c2::text, true);
  assert (select document from public.customer_private where customer_id = c1) = '52998224725', 'CPF normalizado em tabela restrita';
  perform test.has(test.errmsg(format($q$select public.os_save_customer(%L, null, '{"name":"Outra Maria","document":"52998224725"}')$q$, org)), '%já existe um cliente com este CPF%', 'documento único por empresa');
  ct := public.os_save_contact(org, c2, null, '{"name":"Carlos Gerente","phone":"(11) 3333-4444","is_primary":true}');
  ad := public.os_save_address(org, c1, null, '{"label":"Casa","street":"Rua das Flores","number":"100","city":"São Paulo","state":"sp","postal_code":"01001-000","is_default":true}');
  perform set_config('t.ad1', ad::text, true);
  perform set_config('t.ad2', public.os_save_address(org, c2, null, '{"label":"Oficina","street":"Av. Brasil","city":"Campinas","state":"SP"}')::text, true);
  perform test.has(test.errmsg(format($q$select public.os_save_address(%L, %L, null, '{"label":"Casa","street":"Rua","city":"Cidade","state":"Sao"}')$q$, org, c1)), '%UF%', 'UF inválida');
  eq := public.os_save_equipment(org, c1, null, '{"kind":"Máquina de lavar","brand":"Marca A","model":"MX-10","serial_number":"SN123"}');
  perform set_config('t.eq1', eq::text, true);
  perform set_config('t.ct2', ct::text, true);
  sv := public.os_save_service(org, null, '{"name":"Diagnóstico","unit":"un","reference_price_cents":8000}');
  perform set_config('t.sv1', sv::text, true);
  perform set_config('t.sv2', public.os_save_service(org, null, '{"name":"Troca de componente","unit":"un","reference_price_cents":15000}')::text, true);
  perform test.has(test.errmsg(format($q$select public.os_save_service(%L, null, '{"name":"diagnóstico","reference_price_cents":1}')$q$, org)), '%já existe um serviço%', 'nome único (sem diferenciar caixa)');
  pt := public.os_save_part(org, null, '{"code":"CAP-40","name":"Capacitor 40uF","unit":"un","reference_price_cents":3500}');
  perform set_config('t.pt1', pt::text, true);
  perform set_config('t.pt2', public.os_save_part(org, null, '{"code":"COR-01","name":"Correia","unit":"un","reference_price_cents":4500}')::text, true);
  perform test.has(test.errmsg(format($q$select public.os_save_part(%L, null, '{"code":"cap-40","name":"Outro","reference_price_cents":1}')$q$, org)), '%já existe uma peça%', 'código único');
  perform test.has(test.errmsg(format($q$select public.os_save_part(%L, null, '{"code":"X1","name":"Peça","reference_price_cents":-5}')$q$, org)), '%fora do permitido%', 'preço negativo');
  perform set_config('t.tp1', public.os_save_template(org, null, 'Inspeção geral', 'Checklist padrão',  true,
    '[{"label":"Equipamento liga normalmente?","kind":"boolean","required":true,"note_rule":"on_negative"},
      {"label":"Tensão medida (V)","kind":"number","required":true},
      {"label":"Estado de conservação","kind":"select","options":["Bom","Regular","Ruim"],"required":false},
      {"label":"Foto do equipamento instalado","kind":"boolean","required":true,"require_photo":true},
      {"label":"Observações finais","kind":"text","required":false,"allow_na":true}]'::jsonb)::text, true);
  perform test.has(test.errmsg(format($q$select public.os_save_template(%L, null, 'Inválido', null, true, '[{"label":"Escolha","kind":"select","options":["só uma"]}]')$q$, org)), '%2 a 20 opções%', 'select exige opções');
  perform test.has(test.errmsg(format($q$select public.os_save_template(%L, null, 'Vazio', null, true, '[]')$q$, org)), '%1 a 100 itens%', 'modelo vazio');
  assert (select count(*) from public.checklist_template_items where template_id = test.t('tp1')) = 5, 'itens do modelo';
  raise notice 'PASS: cadastros (clientes, contatos, endereços, equipamentos, catálogos, modelo) (2)';
end $$;
reset role;

:as_t1
do $$
begin
  assert test.count('select 1 from public.customer_private') = 0, 'técnico não lê CPF/CNPJ';
  assert test.count('select 1 from public.customers') = 0 and test.count('select 1 from public.customer_contacts') = 0, 'técnico não vê clientes sem ordem atribuída';
  assert test.count('select 1 from public.service_catalog') = 2 and test.count('select 1 from public.part_catalog') = 2, 'técnico lê os catálogos';
  assert test.count('select 1 from public.checklist_templates') = 0, 'técnico não lê modelos';
  raise notice 'PASS: técnico lê catálogos mas não CPF/CNPJ nem clientes sem ordem (2)';
end $$;
reset role;

-- ===================================================================== (3) abertura: numeração, idempotência, snapshot, checklist, validações
:as_m
do $$
declare org uuid := test.t('org'); k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); r jsonb; r2 jsonb; o public.service_orders; n integer;
begin
  r := public.os_open_order(org, k1, jsonb_build_object('customer_id', test.t('c1'), 'address_id', test.t('ad1'), 'equipment_id', test.t('eq1'), 'subject', 'Máquina não centrifuga',
    'problem_description', 'Para de centrifugar no meio do ciclo.', 'priority', 'high', 'template_ids', jsonb_build_array(test.t('tp1'))));
  perform set_config('t.o1', (r ->> 'id'), true);
  assert (r ->> 'order_number')::int = 1 and r ->> 'number_text' = 'OS-00001' and r ->> 'status' = 'open', 'primeira ordem: número 1, aberta';
  r2 := public.os_open_order(org, k1, jsonb_build_object('customer_id', test.t('c1'), 'address_id', test.t('ad1'), 'equipment_id', test.t('eq1'), 'subject', 'Máquina não centrifuga',
    'problem_description', 'Para de centrifugar no meio do ciclo.', 'priority', 'high', 'template_ids', jsonb_build_array(test.t('tp1'))));
  assert r2 = r and (select count(*) from public.service_orders where organization_id = org) = 1, 'duplo clique devolve a MESMA ordem e não cria outra';
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, %L, '{"customer_id":"%s","subject":"Outro assunto","problem_description":"texto"}')$q$, org, k1, test.t('c1'))), '%já foi usada com outros dados%', 'mesma chave com outros dados é recusada');
  select * into o from public.service_orders where id = test.t('o1');
  assert o.execution_status = 'open' and o.quote_mode = 'required' and o.version = 1 and o.priority = 'high', 'campos da abertura';
  assert (select count(*) from public.service_order_snapshots where service_order_id = o.id) = 1, 'snapshot de abertura';
  assert (select customer_name from public.service_order_snapshots where service_order_id = o.id) = 'Maria Silva' and (select address ->> 'city' from public.service_order_snapshots where service_order_id = o.id) = 'São Paulo', 'snapshot guarda cliente e endereço';
  assert (select count(*) from public.order_checklist_items where service_order_id = o.id) = 5, 'checklist aplicado como snapshot';
  assert (select count(*) from public.order_events where service_order_id = o.id and event_type = 'opened') = 1, 'evento inicial';
  -- mudar o cadastro do cliente depois NÃO altera o snapshot
  perform public.os_save_customer(org, test.t('c1'), '{"name":"Maria Silva Souza","document":"52998224725","email":"maria@cliente.invalid","phone":"(11) 99999-0001"}');
  assert (select customer_name from public.service_order_snapshots where service_order_id = o.id and snapshot_version = 1) = 'Maria Silva', 'mudança no cadastro não altera o snapshot';
  -- mudar o modelo NÃO altera o checklist da ordem
  perform public.os_save_template(org, test.t('tp1'), 'Inspeção geral', 'Checklist padrão', true, '[{"label":"Novo único item","kind":"text"}]'::jsonb);
  assert (select count(*) from public.order_checklist_items where service_order_id = o.id) = 5, 'mudar o modelo não altera ordens existentes';
  perform public.os_save_template(org, test.t('tp1'), 'Inspeção geral', 'Checklist padrão', true,
    '[{"label":"Equipamento liga normalmente?","kind":"boolean","required":true,"note_rule":"on_negative"},{"label":"Tensão medida (V)","kind":"number","required":true},
      {"label":"Estado de conservação","kind":"select","options":["Bom","Regular","Ruim"]},{"label":"Foto do equipamento instalado","kind":"boolean","required":true,"require_photo":true},
      {"label":"Observações finais","kind":"text","allow_na":true}]'::jsonb);
  -- segunda ordem: número 2
  r := public.os_open_order(org, k2, jsonb_build_object('customer_id', test.t('c2'), 'address_id', test.t('ad2'), 'subject', 'Revisão semestral', 'problem_description', 'Revisão geral dos equipamentos.'));
  perform set_config('t.o2', (r ->> 'id'), true);
  assert (r ->> 'order_number')::int = 2, 'segunda ordem: número 2';
  -- validações
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{"customer_id":"%s","subject":"ab","problem_description":"texto válido"}')$q$, org, test.t('c1'))), '%Assunto%', 'assunto curto');
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{"customer_id":"%s","subject":"Assunto ok","problem_description":"texto válido","priority":"x"}')$q$, org, test.t('c1'))), '%prioridade inválida%', 'prioridade inválida');
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{"customer_id":"%s","address_id":"%s","subject":"Assunto ok","problem_description":"texto válido"}')$q$, org, test.t('c1'), test.t('ad2'))), '%endereço inválido para este cliente%', 'endereço de outro cliente');
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{"customer_id":"%s","subject":"Assunto ok","problem_description":"texto válido","quote_mode":"authorized"}')$q$, org, test.t('c1'))), '%justificativa%', 'execução sem orçamento exige justificativa');
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{"customer_id":"%s","subject":"Assunto ok","problem_description":"texto válido","technician_id":"ffffffff-0000-4000-8000-0000000000b1"}')$q$, org, test.t('c1'))), '%responsável inválido%', 'leitor não pode ser responsável');
  -- com técnico e janela: nasce agendada, com alerta de sobreposição na segunda
  r := public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', test.t('c1'), 'subject', 'Instalação de ponto', 'problem_description', 'Instalar novo ponto.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a2',
    'scheduled_start_at', date_trunc('hour', now()) + interval '2 days', 'scheduled_end_at', date_trunc('hour', now()) + interval '2 days 2 hours'));
  perform set_config('t.o3', (r ->> 'id'), true);
  assert r ->> 'status' = 'scheduled' and jsonb_array_length(r -> 'conflicts') = 0, 'com técnico e janela nasce agendada';
  r := public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', test.t('c1'), 'subject', 'Outra instalação', 'problem_description', 'Outra.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a2',
    'scheduled_start_at', date_trunc('hour', now()) + interval '2 days 1 hour', 'scheduled_end_at', date_trunc('hour', now()) + interval '2 days 3 hours'));
  perform set_config('t.o4', (r ->> 'id'), true);
  assert jsonb_array_length(r -> 'conflicts') = 1, 'sobreposição do mesmo técnico gera ALERTA (não bloqueia)';
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), jsonb_build_object('customer_id', %L::uuid, 'subject', 'Janela ruim', 'problem_description', 'x y z', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a2',
    'scheduled_start_at', now(), 'scheduled_end_at', now() - interval '1 hour'))$q$, org, test.t('c1'))), '%depois do início%', 'fim antes do início');
  -- rascunho e confirmação
  r := public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', test.t('c2'), 'subject', 'Rascunho de ordem', 'problem_description', 'A confirmar.', 'as_draft', true));
  assert r ->> 'status' = 'draft', 'rascunho';
  select count(*) into n from public.service_orders where organization_id = org;
  assert n = 5, 'cinco ordens, números sem buracos: ' || n;
  assert (select array_agg(order_number order by order_number) from public.service_orders where organization_id = org) = array[1,2,3,4,5]::bigint[], 'numeração sequencial sem repetição';
  n := public.os_confirm_draft(org, (r ->> 'id')::uuid, 1);
  assert n = 2 and (select execution_status from public.service_orders where id = (r ->> 'id')::uuid) = 'open', 'confirmar rascunho';
  raise notice 'PASS: abertura (numeração, idempotência, snapshot, checklist, janela e alerta) (3)';
end $$;
reset role;

-- ===================================================================== (4) snapshot só muda por atualização explícita e auditada
:as_m
do $$
declare org uuid := test.t('org'); r jsonb; v integer;
begin
  select version into v from public.service_orders where id = test.t('o1');
  perform test.has(test.errmsg(format($q$select public.os_update_snapshot(%L, %L, %s, '{"address_id":"%s"}')$q$, org, test.t('o1'), v, test.t('ad1'))), '%Motivo da atualização%', 'motivo obrigatório');
  r := public.os_update_snapshot(org, test.t('o1'), v, jsonb_build_object('address_id', test.t('ad1'), 'reason', 'Cliente atualizou o nome no cadastro'));
  assert (r ->> 'snapshot_version')::int = 2 and (select customer_name from public.service_order_snapshots where service_order_id = test.t('o1') and snapshot_version = 2) = 'Maria Silva Souza', 'atualização explícita cria nova linha com os dados atuais';
  assert (select customer_name from public.service_order_snapshots where service_order_id = test.t('o1') and snapshot_version = 1) = 'Maria Silva', 'a linha antiga permanece';
  assert test.errmsg(format($q$update public.service_order_snapshots set customer_name = 'x' where service_order_id = %L$q$, test.t('o1'))) is not null, 'snapshots não são editáveis pela API';
  raise notice 'PASS: snapshot só muda por atualização explícita (4)';
end $$;
reset role;

-- ===================================================================== (5) orçamento: cálculo, rascunho, conflito, publicação, imutabilidade
:as_m
do $$
declare org uuid := test.t('org'); q uuid; r jsonb; qv public.quote_versions; v integer;
begin
  q := public.os_quote_new_draft(org, test.t('o1'));
  perform set_config('t.q1', q::text, true);
  perform test.has(test.errmsg(format($q$select public.os_quote_new_draft(%L, %L)$q$, org, test.t('o1'))), '%já existe um rascunho%', 'um rascunho por vez');
  perform test.has(test.errmsg(format($q$select public.os_quote_publish(%L, %L, 1)$q$, org, q)), '%ao menos um item%', 'não publica vazio');
  -- 0,333 × R$ 10,00 = 3,33 · 1,005 × R$ 1,00 = 1,005 → 1,01 (meio para cima) · 2 × R$ 80,00 = 160,00
  r := public.os_quote_save_draft(org, q, 1, jsonb_build_object('discount_cents', 100, 'valid_date', (current_date + 10)::text, 'terms', 'Pagamento na entrega.',
    'items', jsonb_build_array(
      jsonb_build_object('kind', 'service', 'service_id', test.t('sv1'), 'description', 'Diagnóstico', 'unit', 'un', 'quantity', 2, 'unit_price_cents', 8000),
      jsonb_build_object('kind', 'part', 'part_id', test.t('pt1'), 'description', 'Capacitor 40uF', 'unit', 'un', 'quantity', 0.333, 'unit_price_cents', 1000),
      jsonb_build_object('kind', 'part', 'description', 'Parafuso especial', 'unit', 'un', 'quantity', 1.005, 'unit_price_cents', 100))));
  assert (r ->> 'subtotal_cents')::bigint = 16000 + 333 + 101 and (r ->> 'total_cents')::bigint = 16434 - 100, 'subtotal e total recalculados no servidor (arredondamento meio para cima)';
  assert (select array_agg(line_total_cents order by position) from public.quote_items where quote_version_id = q) = array[16000, 333, 101]::bigint[], 'total de cada linha arredondado a centavos';
  -- conflito de edição: versão antiga do rascunho
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, 1, '{"items":[{"kind":"service","description":"Qualquer","unit":"un","quantity":1,"unit_price_cents":100}]}')$q$, org, q)), '%alterada por outra pessoa%', 'rascunho desatualizado é recusado');
  select version into v from public.quote_versions where id = q;
  -- validações
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, '{"discount_cents":999999,"items":[{"kind":"service","description":"Item","unit":"un","quantity":1,"unit_price_cents":100}]}')$q$, org, q, v)), '%desconto%maior que o subtotal%', 'desconto maior que o subtotal');
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, '{"items":[{"kind":"service","description":"Item","unit":"un","quantity":1.2345,"unit_price_cents":100}]}')$q$, org, q, v)), '%3 casas decimais%', 'quantidade com mais de 3 casas');
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, '{"items":[{"kind":"service","description":"Item","unit":"un","quantity":0,"unit_price_cents":100}]}')$q$, org, q, v)), '%quantidade%fora do permitido%', 'quantidade zero');
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, '{"items":[{"kind":"service","description":"Item","unit":"un","quantity":1,"unit_price_cents":-1}]}')$q$, org, q, v)), '%preço%fora do permitido%', 'preço negativo');
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, '{"items":[{"kind":"part","part_id":"%s","description":"Item","unit":"un","quantity":1,"unit_price_cents":1}]}')$q$, org, q, v, gen_random_uuid())), '%peça do catálogo inválida%', 'peça inexistente');
  assert (select total_cents from public.quote_versions where id = q) = 16334, 'tentativas inválidas não alteram o rascunho (a transação interna foi desfeita)';
  select version into v from public.quote_versions where id = q;
  r := public.os_quote_publish(org, q, v);
  select * into qv from public.quote_versions where id = q;
  assert qv.status = 'published' and qv.published_at is not null and qv.terms_snapshot = 'Pagamento na entrega.' and qv.snapshot_version = 2, 'publicada: congelada, com condições e snapshot do cliente vigente';
  -- publicado é imutável (nem a gestão, nem direto)
  perform test.has(test.errmsg(format($q$select public.os_quote_save_draft(%L, %L, %s, '{"items":[]}')$q$, org, q, qv.version)), '%só rascunhos%', 'publicada não é editada pela API');
  perform test.has(test.errmsg(format($q$select test.sql('update public.quote_versions set total_cents = 1, subtotal_cents = 1, discount_cents = 0 where id = ''%s''')$q$, q)), '%imutável%', 'publicada não é editada nem por SQL direto');
  perform test.has(test.errmsg(format($q$select test.sql('update public.quote_items set unit_price_cents = 1, line_total_cents = round(quantity) where quote_version_id = ''%s''')$q$, q)), '%imutáveis%', 'itens publicados são imutáveis');
  perform test.has(test.errmsg(format($q$select test.sql('delete from public.quote_items where quote_version_id = ''%s''')$q$, q)), '%imutáveis%', 'itens publicados não são apagados');
  assert test.errmsg(format($q$update public.quote_versions set total_cents = 1 where id = %L$q$, q)) is not null, 'authenticated não escreve direto no orçamento';
  raise notice 'PASS: orçamento (cálculo exato, validações, conflito, publicação congela) (5)';
end $$;
reset role;

-- ===================================================================== (6) iniciar exige orçamento aprovado; decisão manual aparece como tal
:as_m
do $$
declare org uuid := test.t('org'); v integer; q uuid := test.t('q1'); d public.quote_decisions;
begin
  select version into v from public.service_orders where id = test.t('o1');
  perform public.os_assign(org, test.t('o1'), v, 'ffffffff-0000-4000-8000-0000000000a2');
  select version into v from public.service_orders where id = test.t('o1');
  perform test.has(test.errmsg(format($q$select public.os_start(%L, %L, %s)$q$, org, test.t('o1'), v)), '%aguardando a decisão do cliente%', 'orçamento publicado e sem decisão bloqueia o início');
  perform test.has(test.errmsg(format($q$select public.os_quote_decide_manual(%L, %L, 'approved', 'Maria', 'curto', null, null)$q$, org, q)), '%Justificativa%', 'justificativa obrigatória');
  perform public.os_quote_decide_manual(org, q, 'approved', 'Maria Silva Souza', 'Cliente aprovou por telefone, conforme conversa registrada.', 'Aprovou também o prazo.', null);
  select * into d from public.quote_decisions where quote_version_id = q;
  assert d.channel = 'staff_manual' and d.operator_user_id = 'ffffffff-0000-4000-8000-0000000000a1' and d.justification is not null and d.decision = 'approved', 'decisão manual registra operador e justificativa';
  assert d.accepted_text like 'Registro manual pela equipe (não é uma ação autenticada do cliente): APROVAÇÃO da versão 1 do orçamento da ordem de serviço OS-00001, no valor total de R$ 163,34%', 'texto montado no banco e identifica registro manual: ' || d.accepted_text;
  assert (select status from public.quote_versions where id = q) = 'approved', 'versão aprovada';
  perform test.has(test.errmsg(format($q$select public.os_quote_decide_manual(%L, %L, 'rejected', 'Maria', 'Mudou de ideia depois.', null, null)$q$, org, q)), '%já recebeu uma decisão%', 'uma decisão por versão');
  assert test.errmsg(format($q$select test.sql('update public.quote_decisions set decision = ''rejected'' where quote_version_id = ''%s''')$q$, q)) like '%imutável%', 'decisão é imutável';
  assert test.errmsg(format($q$select test.sql('delete from public.quote_decisions where quote_version_id = ''%s''')$q$, q)) like '%não pode ser apagado%', 'decisão não é apagada';
  select version into v from public.service_orders where id = test.t('o1');
  v := public.os_start(org, test.t('o1'), v);
  assert (select execution_status from public.service_orders where id = test.t('o1')) = 'in_progress', 'com orçamento aprovado, inicia';
  assert (select started_at from public.service_orders where id = test.t('o1')) is not null, 'horário real de início registrado';
  raise notice 'PASS: decisão manual identificada como tal; início só com orçamento aprovado (6)';
end $$;
reset role;

-- ===================================================================== (7) execução autorizada sem orçamento; nova versão pendente bloqueia a retomada
:as_m
do $$
declare org uuid := test.t('org'); v integer; q2 uuid; q3 uuid; r jsonb;
begin
  -- ordem 2 sem orçamento aprovado não inicia
  perform public.os_assign(org, test.t('o2'), 1, 'ffffffff-0000-4000-8000-0000000000a3');
  select version into v from public.service_orders where id = test.t('o2');
  perform test.has(test.errmsg(format($q$select public.os_start(%L, %L, %s)$q$, org, test.t('o2'), v)), '%exige orçamento aprovado%', 'sem orçamento aprovado não inicia');
  -- autorizar execução sem orçamento (justificativa)
  perform test.has(test.errmsg(format($q$select public.os_update_order(%L, %L, %s, '{"quote_mode":"authorized"}')$q$, org, test.t('o2'), v)), '%justificativa%', 'justificativa obrigatória');
  perform public.os_update_order(org, test.t('o2'), v, '{"quote_mode":"authorized","authorization_justification":"Urgência: cliente com equipamento parado, autorizou por telefone."}');
  select version into v from public.service_orders where id = test.t('o2');
  assert (select authorized_by from public.service_orders where id = test.t('o2')) = 'ffffffff-0000-4000-8000-0000000000a1' and (select authorized_at from public.service_orders where id = test.t('o2')) is not null, 'quem autorizou fica registrado';
  perform public.os_start(org, test.t('o2'), v);
  -- ordem 1: pausa exige motivo; nova versão publicada bloqueia retomada
  select version into v from public.service_orders where id = test.t('o1');
  perform test.has(test.errmsg(format($q$select public.os_pause(%L, %L, %s, ' ')$q$, org, test.t('o1'), v)), '%Motivo da pausa%', 'pausa exige motivo');
  v := public.os_pause(org, test.t('o1'), v, 'Aguardando peça do fornecedor');
  assert (select count(*) from public.order_pauses where service_order_id = test.t('o1') and ended_at is null) = 1, 'pausa registrada com início';
  perform test.has(test.errmsg(format($q$select public.os_start(%L, %L, %s)$q$, org, test.t('o1'), v)), '%abertas ou agendadas podem ser iniciadas%', 'ordem pausada não é iniciada de novo');
  q2 := public.os_quote_new_draft(org, test.t('o1'));
  assert (select version_number from public.quote_versions where id = q2) = 2 and (select count(*) from public.quote_items where quote_version_id = q2) = 3 and (select discount_cents from public.quote_versions where id = q2) = 100, 'nova versão copia a anterior';
  select version into v from public.quote_versions where id = q2;
  r := public.os_quote_save_draft(org, q2, v, jsonb_build_object('discount_cents', 0, 'valid_date', (current_date + 5)::text,
    'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Diagnóstico', 'unit', 'un', 'quantity', 2, 'unit_price_cents', 8000),
      jsonb_build_object('kind', 'part', 'description', 'Peça adicional encontrada', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 9000))));
  select version into v from public.quote_versions where id = q2;
  perform public.os_quote_publish(org, q2, v);
  perform set_config('t.q2', q2::text, true);
  assert (select status from public.quote_versions where id = test.t('q1')) = 'approved', 'versão antiga aprovada permanece no histórico';
  select version into v from public.service_orders where id = test.t('o1');
  perform test.has(test.errmsg(format($q$select public.os_resume(%L, %L, %s)$q$, org, test.t('o1'), v)), '%aguardando a decisão do cliente%', 'versão pendente impede a retomada');
  -- recusar a nova versão libera a retomada (a aprovada anterior continua valendo)
  perform public.os_quote_decide_manual(org, q2, 'rejected', 'Maria Silva Souza', 'Cliente recusou o adicional por telefone.', null, null);
  select version into v from public.service_orders where id = test.t('o1');
  perform public.os_resume(org, test.t('o1'), v);
  assert (select count(*) from public.order_pauses where service_order_id = test.t('o1') and ended_at is not null) = 1, 'pausa encerrada ao retomar';
  assert (select count(*) from public.order_events where service_order_id = test.t('o1') and event_type in ('quote_published', 'quote_approved', 'quote_rejected', 'paused', 'resumed')) = 6, 'eventos da ordem 1';
  -- publicar uma nova versão substitui a publicada anterior (ainda sem decisão)
  q2 := public.os_quote_new_draft(org, test.t('o3'));
  select version into v from public.quote_versions where id = q2;
  perform public.os_quote_save_draft(org, q2, v, '{"items":[{"kind":"service","description":"Instalação","unit":"un","quantity":1,"unit_price_cents":20000}]}');
  select version into v from public.quote_versions where id = q2;
  perform public.os_quote_publish(org, q2, v);
  q3 := public.os_quote_new_draft(org, test.t('o3'));
  select version into v from public.quote_versions where id = q3;
  perform public.os_quote_save_draft(org, q3, v, '{"items":[{"kind":"service","description":"Instalação revisada","unit":"un","quantity":1,"unit_price_cents":22000}]}');
  select version into v from public.quote_versions where id = q3;
  perform public.os_quote_publish(org, q3, v);
  assert (select status from public.quote_versions where id = q2) = 'superseded' and (select count(*) from public.quote_versions where service_order_id = test.t('o3') and status = 'published') = 1, 'nova publicação substitui a anterior';
  perform test.has(test.errmsg(format($q$select public.os_quote_decide_manual(%L, %L, 'approved', 'Maria', 'Tentativa na versão antiga.', null, null)$q$, org, q2)), '%substituída%', 'decidir versão substituída é recusado');
  raise notice 'PASS: execução autorizada sem orçamento; versão pendente bloqueia retomada; publicação substitui a anterior (7)';
end $$;
reset role;

-- ===================================================================== (8) máquina de estados e travas de edição
:as_m
do $$
declare org uuid := test.t('org'); v integer; q4 uuid; cx uuid; ox uuid;
begin
  -- cliente inativo não recebe ordem; ordem sem responsável não inicia
  cx := public.os_save_customer(org, null, '{"name":"Cliente Arquivado","kind":"person"}');
  ox := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', cx, 'subject', 'Ordem sem responsável', 'problem_description', 'Ainda sem técnico definido.')) ->> 'id')::uuid;
  select version into v from public.service_orders where id = ox;
  perform test.has(test.errmsg(format($q$select public.os_start(%L, %L, %s)$q$, org, ox, v)), '%defina o técnico responsável antes de iniciar%', 'iniciar exige técnico responsável');
  perform public.os_save_customer(org, cx, '{"name":"Cliente Arquivado","kind":"person","active":false}');
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), jsonb_build_object('customer_id', %L::uuid, 'subject', 'Para cliente inativo', 'problem_description', 'Não deve abrir.'))$q$, org, cx)), '%cliente não encontrado ou inativo%', 'cliente inativo não recebe ordem');
  -- orçamento publicado na ordem 4: validade futura, evidência da própria ordem e, depois do cancelamento, nenhuma decisão
  q4 := public.os_quote_new_draft(org, test.t('o4'));
  select version into v from public.quote_versions where id = q4;
  perform public.os_quote_save_draft(org, q4, v, '{"items":[{"kind":"service","description":"Visita","unit":"un","quantity":1,"unit_price_cents":5000}]}');
  perform test.sql(format($s$update public.quote_versions set valid_until = now() - interval '1 day' where id = '%s'$s$, q4));
  select version into v from public.quote_versions where id = q4;
  perform test.has(test.errmsg(format($s$select public.os_quote_publish(%L, %L, %s)$s$, org, q4, v)), '%validade%futura%', 'validade do orçamento precisa ser futura');
  perform test.sql(format($s$update public.quote_versions set valid_until = now() + interval '3 days' where id = '%s'$s$, q4));
  select version into v from public.quote_versions where id = q4;
  perform public.os_quote_publish(org, q4, v);
  perform test.has(test.errmsg(format($s$select public.os_quote_decide_manual(%L, %L, 'approved', 'Maria Silva', 'Aprovou por telefone, conforme conversa.', null, %L)$s$, org, q4, gen_random_uuid())), '%evidência%arquivo desta ordem%', 'evidência precisa ser da própria ordem');
  select version into v from public.service_orders where id = test.t('o4');
  perform test.has(test.errmsg(format($q$select public.os_pause(%L, %L, %s, 'motivo')$q$, org, test.t('o4'), v)), '%só ordens em execução%', 'não pausa o que não iniciou');
  perform test.has(test.errmsg(format($q$select public.os_complete(%L, %L, %s, 'Resumo do serviço', null)$q$, org, test.t('o4'), v)), '%só ordens em execução%', 'não conclui o que não iniciou');
  perform test.has(test.errmsg(format($q$select public.os_close(%L, %L, %s)$q$, org, test.t('o4'), v)), '%só ordens concluídas%', 'não encerra o que não concluiu');
  perform test.has(test.errmsg(format($q$select test.sql('update public.service_orders set execution_status = ''closed'', closed_at = now() where id = ''%s''')$q$, test.t('o4'))), '%transição de status inválida%', 'transição inválida barrada no banco');
  perform test.has(test.errmsg(format($q$select test.sql('update public.service_orders set customer_id = ''%s'' where id = ''%s''')$q$, test.t('c2'), test.t('o4'))), '%identidade da ordem%', 'cliente da ordem é imutável');
  perform test.has(test.errmsg(format($q$select public.os_update_order(%L, %L, 99, '{"subject":"Nova"}')$q$, org, test.t('o4'))), '%alterada por outra pessoa%', 'versão antiga da ordem é recusada');
  perform test.has(test.errmsg(format($q$select public.os_cancel(%L, %L, %s, 'x')$q$, org, test.t('o4'), v)), '%Motivo do cancelamento%', 'cancelar exige motivo');
  perform public.os_cancel(org, test.t('o4'), v, 'Cliente desistiu da instalação');
  perform test.has(test.errmsg(format($s$select public.os_quote_decide_manual(%L, %L, 'approved', 'Maria Silva', 'Tentativa depois do cancelamento.', null, null)$s$, org, q4)), '%não aceita mais decisões%', 'ordem cancelada não recebe decisão de orçamento');
  select version into v from public.service_orders where id = test.t('o4');
  assert (select execution_status from public.service_orders where id = test.t('o4')) = 'cancelled' and (select cancel_reason from public.service_orders where id = test.t('o4')) is not null, 'cancelada com motivo';
  perform test.has(test.errmsg(format($q$select public.os_update_order(%L, %L, %s, '{"subject":"Editar cancelada"}')$q$, org, test.t('o4'), v)), '%não pode ser editada%', 'cancelada não é editada');
  perform test.has(test.errmsg(format($q$select public.os_add_update(%L, %L, gen_random_uuid(), 'internal', 'nota em ordem cancelada', null)$q$, org, test.t('o4'))), '%não aceita novas notas%', 'cancelada não aceita notas');
  perform test.has(test.errmsg(format($q$select public.os_cancel(%L, %L, %s, 'de novo')$q$, org, test.t('o4'), v)), '%não pode mais ser cancelada%', 'não cancela duas vezes');
  perform test.has(test.errmsg(format($q$select public.os_assign(%L, %L, %s, null)$q$, org, test.t('o4'), v)), '%não pode ser editada%', 'cancelada não muda responsável');
  raise notice 'PASS: máquina de estados e travas de edição (8)';
end $$;
reset role;

rollback;
