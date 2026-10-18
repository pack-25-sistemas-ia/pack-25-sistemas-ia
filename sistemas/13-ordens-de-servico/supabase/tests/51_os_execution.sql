-- Ordens de Serviço — domínio no banco, parte 2: execução pelo técnico, checklist validado no servidor, peças (uso, divergência, estorno), conclusão versionada,
-- aceite manual, reabertura, encerramento, custos internos, notas e liberação das ordens de quem sai.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_t1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"t1@t.invalid"}'', true); set local role authenticated;'
\set as_t2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"t2@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.ver(o uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.service_orders where id = o $$;
create function test.path(org uuid, ord uuid, ext text) returns text language sql as $$ select org::text || '/' || ord::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || ext $$;
create function test.div(o uuid) returns jsonb language sql security definer set search_path = '' as $$ select private.os_parts_divergence(o) $$;
create function test.probs(o uuid) returns integer language sql security definer set search_path = '' as $$ select cardinality(private.os_checklist_problems(o)) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 't1@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 't2@t.invalid');

-- ===================================================================== (1) preparação: empresa, cadastros e uma ordem com orçamento aprovado
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Manutenção Teste', 'manutencao-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member');
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); c uuid; ad uuid; eq uuid; q uuid; v integer; o uuid;
begin
  c := public.os_save_customer(org, null, '{"name":"Padaria Central","kind":"company"}'); perform set_config('t.c', c::text, true);
  ad := public.os_save_address(org, c, null, '{"label":"Loja","street":"Rua do Pão","number":"5","city":"Santos","state":"SP"}'); perform set_config('t.ad', ad::text, true);
  eq := public.os_save_equipment(org, c, null, '{"kind":"Forno industrial","brand":"Forno SA","model":"F-200"}'); perform set_config('t.eq', eq::text, true);
  perform set_config('t.pt1', public.os_save_part(org, null, '{"code":"RES-1","name":"Resistência 3000W","reference_price_cents":12000}')::text, true);
  perform set_config('t.pt2', public.os_save_part(org, null, '{"code":"TER-1","name":"Termostato","reference_price_cents":8000}')::text, true);
  perform set_config('t.tp', public.os_save_template(org, null, 'Manutenção de forno', null, true,
    '[{"label":"Forno liga?","kind":"boolean","required":true,"note_rule":"on_negative"},{"label":"Temperatura medida (°C)","kind":"number","required":true},
      {"label":"Foto do forno","kind":"boolean","required":true,"require_photo":true},{"label":"Limpeza feita","kind":"boolean","required":false,"allow_na":true},
      {"label":"Condição","kind":"select","options":["Boa","Ruim"],"required":false,"note_rule":"always"}]'::jsonb)::text, true);
  o := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'address_id', ad, 'equipment_id', eq, 'subject', 'Forno não esquenta', 'problem_description', 'Resistência parece queimada.',
    'technician_id', 'ffffffff-0000-4000-8000-0000000000a2', 'template_ids', jsonb_build_array(test.t('tp'))))::jsonb ->> 'id')::uuid;
  perform set_config('t.o', o::text, true);
  q := public.os_quote_new_draft(org, o); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 7)::text, 'items', jsonb_build_array(
    jsonb_build_object('kind', 'service', 'description', 'Manutenção corretiva', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 30000),
    jsonb_build_object('kind', 'part', 'part_id', test.t('pt1'), 'description', 'Resistência 3000W', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 12000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform public.os_quote_decide_manual(org, q, 'approved', 'Dono da Padaria', 'Aprovou pelo WhatsApp, print anexado ao atendimento.', null, null);
  perform set_config('t.q', q::text, true);
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) o técnico só enxerga o que é dele
:as_t1
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); v integer;
begin
  assert test.count('select 1 from public.service_orders') = 1, 'técnico vê a ordem atribuída';
  assert test.count('select 1 from public.customers') = 1 and test.count('select 1 from public.customer_addresses') = 1 and test.count('select 1 from public.equipment') = 1, 'técnico vê cliente, endereço e equipamento da ordem dele';
  assert test.count('select 1 from public.quote_versions') = 1 and test.count('select 1 from public.quote_items') = 2, 'técnico lê o orçamento publicado (escopo)';
  assert test.count('select 1 from public.order_internal_costs') = 0 and test.count('select 1 from public.customer_private') = 0 and test.count('select 1 from public.customer_contacts') = 0, 'técnico não lê custos nem dados restritos';
  assert test.count('select 1 from public.public_access_tokens') = 0, 'técnico não lê links';
  v := test.ver(o);
  perform test.has(test.errmsg(format($q$select public.os_quote_new_draft(%L, %L)$q$, org, o)), '%sem permissão%', 'técnico não cria orçamento');
  perform test.has(test.errmsg(format($q$select public.os_assign(%L, %L, %s, null)$q$, org, o, v)), '%sem permissão%', 'técnico não atribui');
  perform test.has(test.errmsg(format($q$select public.os_cancel(%L, %L, %s, 'não quero')$q$, org, o, v)), '%sem permissão%', 'técnico não cancela');
  perform test.has(test.errmsg(format($q$select public.os_add_cost(%L, %L, gen_random_uuid(), '{"category":"labor","description":"Horas","amount_cents":1000}')$q$, org, o)), '%sem permissão%', 'técnico não registra custos');
  perform test.has(test.errmsg(format($q$select public.os_open_order(%L, gen_random_uuid(), '{}')$q$, org)), '%sem permissão%', 'técnico não abre ordem');
  perform test.has(test.errmsg(format($q$select public.os_quote_decide_manual(%L, %L, 'approved', 'Eu', 'Aprovação indevida do técnico.', null, null)$q$, org, test.t('q'))), '%sem permissão%', 'técnico não aprova orçamento pelo cliente');
  perform test.has(test.errmsg(format($q$select public.os_create_link(%L, %L, repeat('a', 64))$q$, org, o)), '%sem permissão%', 'técnico não gera link');
  v := public.os_start(org, o, v);
  assert (select execution_status from public.service_orders where id = o) = 'in_progress', 'técnico responsável inicia';
  raise notice 'PASS: técnico: acesso restrito e início pela própria ordem (2)';
end $$;
reset role;

:as_t2
do $$
declare org uuid := test.t('org'); o uuid := test.t('o');
begin
  assert test.count('select 1 from public.service_orders') = 0 and test.count('select 1 from public.customers') = 0 and test.count('select 1 from public.order_events') = 0, 'outro técnico não vê a ordem';
  perform test.has(test.errmsg(format($q$select public.os_pause(%L, %L, 1, 'tentando')$q$, org, o)), '%não encontrada%', 'outro técnico não pausa');
  perform test.has(test.errmsg(format($q$select public.os_add_update(%L, %L, gen_random_uuid(), 'internal', 'xx', null)$q$, org, o)), '%não encontrada%', 'outro técnico não escreve nota');
  perform test.has(test.errmsg(format($q$select public.os_document(%L, %L, 'summary', 0)$q$, org, o)), '%não encontrada%', 'outro técnico não gera documento');
  raise notice 'PASS: outro técnico não enxerga nem age na ordem (2)';
end $$;
reset role;

-- ===================================================================== (3) checklist validado no servidor
:as_t1
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; v integer; msg text;
begin
  select id into i1 from public.order_checklist_items where service_order_id = o and label = 'Forno liga?';
  select id into i2 from public.order_checklist_items where service_order_id = o and label like 'Temperatura%';
  select id into i3 from public.order_checklist_items where service_order_id = o and label = 'Foto do forno';
  select id into i4 from public.order_checklist_items where service_order_id = o and label = 'Limpeza feita';
  select id into i5 from public.order_checklist_items where service_order_id = o and label = 'Condição';
  perform set_config('t.i3', i3::text, true);
  v := test.ver(o);
  perform test.has(test.errmsg(format($q$select public.os_complete(%L, %L, %s, 'Troquei a resistência e testei.', null)$q$, org, o, v)), '%checklist incompleto%', 'checklist obrigatório vazio bloqueia a conclusão');
  -- respostas inválidas
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"text":"sim"}')$q$, org, o, i1)), '%sim ou não%', 'tipo errado');
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"boolean":false}')$q$, org, o, i1)), '%exigem justificativa%', 'resposta negativa exige justificativa');
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"not_applicable":true}')$q$, org, o, i1)), '%não admite%', 'N/A só quando o item permite');
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"number":"abc"}')$q$, org, o, i2)), '%número%', 'número inválido');
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"option":"Péssima"}')$q$, org, o, i5)), '%opções%', 'opção fora da lista');
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"option":"Boa"}')$q$, org, o, i5)), '%exige justificativa%', 'justificativa sempre');
  perform public.os_answer_checklist(org, o, i1, '{"boolean":false,"note":"Resistência queimada"}');
  perform public.os_answer_checklist(org, o, i1, '{"boolean":true}');
  perform public.os_answer_checklist(org, o, i2, '{"number":210.5}');
  perform public.os_answer_checklist(org, o, i3, '{"boolean":true}');
  perform public.os_answer_checklist(org, o, i4, '{"not_applicable":true}');
  assert (select answered_by from public.order_checklist_items where id = i2) = 'ffffffff-0000-4000-8000-0000000000a2' and (select answer_number from public.order_checklist_items where id = i2) = 210.5, 'autoria e valor da resposta';
  assert (select answer_bool is not null and not_applicable = false from public.order_checklist_items where id = i1), 'regravar a resposta limpa o N/A';
  v := test.ver(o);
  msg := test.errmsg(format($q$select public.os_complete(%L, %L, %s, 'Troquei a resistência e testei.', null)$q$, org, o, v));
  perform test.has(msg, '%Foto obrigatória pendente: Foto do forno%', 'item que exige foto sem foto bloqueia: ' || coalesce(msg, ''));
  -- estrutura do snapshot não muda
  perform test.has(test.errmsg(format($q$select test.sql('update public.order_checklist_items set required = false where id = ''%s''')$q$, i1)), '%snapshot%', 'estrutura do item é snapshot');
  -- foto: caminhos fora do padrão são recusados; o correto vincula ao item
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), %L, '[{"path":"%s/%s/../x.jpg","mime":"image/jpeg","size":1000,"filename":"a.jpg"}]')$q$, org, o, i3, org, o)), '%arquivo inválido%', 'caminho adulterado');
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('path', '%s/%s/%s.jpg', 'mime', 'image/jpeg', 'size', 1000, 'filename', 'a.jpg')))$q$, org, o, i3, org, gen_random_uuid(), replace(gen_random_uuid()::text, '-', ''))), '%arquivo inválido%', 'caminho de OUTRA ordem');
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('path', test.path(%L, %L, 'pdf'), 'mime', 'application/pdf', 'size', 1000, 'filename', 'laudo.pdf', 'category', 'during')))$q$, org, o, org, o)), '%PDF só pode ser enviado como documento%', 'PDF só como documento');
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('path', test.path(%L, %L, 'jpg'), 'mime', 'image/svg+xml', 'size', 1000, 'filename', 'a.svg')))$q$, org, o, i3, org, o)), '%tipo de arquivo não permitido%', 'SVG recusado');
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), %L, jsonb_build_array(jsonb_build_object('path', test.path(%L, %L, 'jpg'), 'mime', 'image/jpeg', 'size', 99999999, 'filename', 'a.jpg')))$q$, org, o, i3, org, o)), '%tamanho máximo%', 'arquivo grande demais');
  perform public.os_add_files(org, o, gen_random_uuid(), i3, jsonb_build_array(jsonb_build_object('path', test.path(org, o, 'jpg'), 'mime', 'image/jpeg', 'size', 123456, 'filename', 'forno.jpg', 'category', 'after')));
  assert (select count(*) from public.order_attachments where service_order_id = o and checklist_item_id = i3 and visibility = 'internal') = 1, 'foto vinculada ao item, interna por padrão';
  assert test.probs(o) = 0, 'sem pendências de checklist';
  raise notice 'PASS: checklist validado no servidor (3)';
end $$;
reset role;

-- ===================================================================== (4) peças: uso, divergência com o orçamento, estorno e ajuste referenciado
:as_t1
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); u1 uuid; u2 uuid; u3 uuid; k uuid := gen_random_uuid(); r jsonb; v integer; div jsonb;
begin
  r := public.os_add_part_usage(org, o, k, jsonb_build_object('part_id', test.t('pt1'), 'quantity', 1));
  u1 := (r ->> 'id')::uuid;
  assert public.os_add_part_usage(org, o, k, jsonb_build_object('part_id', test.t('pt1'), 'quantity', 1)) = r and (select count(*) from public.order_part_usage where service_order_id = o) = 1, 'duplo clique não duplica o uso';
  div := test.div(o);
  assert div = '[]'::jsonb, 'uso igual ao orçado: sem divergência: ' || div::text;
  u2 := (public.os_add_part_usage(org, o, gen_random_uuid(), jsonb_build_object('part_id', test.t('pt2'), 'quantity', 2)))->>'id';
  div := test.div(o);
  assert jsonb_array_length(div) = 1 and (div -> 0 ->> 'relevant')::boolean and (div -> 0 ->> 'used_qty')::numeric = 2 and (div -> 0 ->> 'quoted_qty')::numeric = 0, 'peça não orçada é divergência relevante';
  v := test.ver(o);
  perform test.has(test.errmsg(format($q$select public.os_complete(%L, %L, %s, 'Troquei a resistência e o termostato.', null)$q$, org, o, v)), '%divergência relevante de peças%', 'divergência exige justificativa ou nova versão do orçamento');
  perform test.has(test.errmsg(format($q$select public.os_complete(%L, %L, %s, 'Troquei a resistência e o termostato.', 'curta')$q$, org, o, v)), '%divergência relevante de peças%', 'justificativa de divergência com menos de 10 caracteres não vale');
  perform test.has(test.errmsg(format($q$select public.os_add_part_usage(%L, %L, gen_random_uuid(), jsonb_build_object('part_id', %L::uuid, 'quantity', 1, 'used_at', now() + interval '3 days'))$q$, org, o, test.t('pt1'))), '%não pode estar no futuro%', 'uso de peça no futuro');
  -- estorno e ajuste (sempre referenciando o original, com motivo)
  perform test.has(test.errmsg(format($q$select public.os_correct_part_usage(%L, %L, gen_random_uuid(), %L, 'reversal', 5, 'devolvi')$q$, org, o, u2)), '%saldo%negativo%', 'estorno não passa do saldo');
  perform test.has(test.errmsg(format($q$select public.os_correct_part_usage(%L, %L, gen_random_uuid(), %L, 'reversal', 1, ' ')$q$, org, o, u2)), '%Motivo da correção%', 'motivo obrigatório');
  u3 := (public.os_correct_part_usage(org, o, gen_random_uuid(), u2, 'reversal', 1, 'Uma unidade foi devolvida ao veículo'))->>'id';
  assert (select quantity from public.order_part_usage where id = u3) = -1 and (select reference_usage_id from public.order_part_usage where id = u3) = u2 and (select registered_by from public.order_part_usage where id = u3) is not null, 'estorno referencia o original, com autoria';
  assert (select used_qty from jsonb_to_recordset(test.div(o)) as x(used_qty numeric, relevant boolean)) = 1, 'divergência considera o saldo líquido';
  perform public.os_correct_part_usage(org, o, gen_random_uuid(), u2, 'reversal', 1, 'A outra unidade também voltou');
  assert test.div(o) = '[]'::jsonb, 'depois dos estornos, sem divergência';
  assert test.errmsg(format($q$select test.sql('update public.order_part_usage set quantity = 9 where id = ''%s''')$q$, u1)) like '%imutável%', 'registros de uso são imutáveis (correção só por estorno)';
  assert test.errmsg(format($q$select test.sql('delete from public.order_part_usage where id = ''%s''')$q$, u1)) like '%não pode ser apagado%', 'registros de uso não são apagados';
  raise notice 'PASS: peças utilizadas (idempotência, divergência, estorno referenciado) (4)';
end $$;
reset role;

-- ===================================================================== (5) conclusão versionada
:as_t1
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); v integer; r jsonb; cp public.order_completions;
begin
  v := test.ver(o);
  perform test.has(test.errmsg(format($q$select public.os_complete(%L, %L, %s, 'ok', null)$q$, org, o, v)), '%Resumo do serviço%', 'resumo precisa ter conteúdo');
  r := public.os_complete(org, o, v, 'Troquei a resistência queimada e testei o forno por 30 minutos.', null);
  assert (r ->> 'completion_version')::int = 1 and (select execution_status from public.service_orders where id = o) = 'completed', 'conclusão v1';
  select * into cp from public.order_completions where service_order_id = o and completion_version = 1;
  assert jsonb_array_length(cp.checklist_snapshot) = 5 and jsonb_array_length(cp.parts_snapshot) = 1 and (cp.quote_snapshot ->> 'total_cents')::bigint = 42000 and cp.snapshot_version = 1, 'conclusão congela checklist, peças e orçamento-base';
  assert (select (c ->> 'photos')::int from jsonb_array_elements(cp.checklist_snapshot) c where c ->> 'label' = 'Foto do forno') = 1, 'contagem de fotos no snapshot';
  assert test.errmsg(format($q$select test.sql('update public.order_completions set summary = ''outro'' where id = ''%s''')$q$, cp.id)) like '%imutável%', 'conclusão é imutável';
  v := test.ver(o);
  perform test.has(test.errmsg(format($q$select public.os_pause(%L, %L, %s, 'x y z')$q$, org, o, v)), '%só ordens em execução%', 'concluída não pausa');
  perform test.has(test.errmsg(format($q$select public.os_add_part_usage(%L, %L, gen_random_uuid(), '{"description":"Peça extra","quantity":1}')$q$, org, o)), '%durante a execução%', 'concluída não recebe peças');
  perform test.has(test.errmsg(format($q$select public.os_answer_checklist(%L, %L, %L, '{"boolean":true}')$q$, org, o, (select id from public.order_checklist_items where service_order_id = o limit 1))), '%durante a execução%', 'concluída não recebe respostas');
  perform test.has(test.errmsg(format($q$select test.sql('update public.service_orders set subject = ''Alterado'' where id = ''%s''')$q$, o)), '%não pode ser editada%', 'concluída não é editada por SQL direto');
  perform test.has(test.errmsg(format($q$select public.os_close(%L, %L, %s)$q$, org, o, v)), '%sem permissão%', 'técnico não encerra');
  raise notice 'PASS: conclusão versionada e congelada (5)';
end $$;
reset role;

-- ===================================================================== (6) aceite, reabertura e encerramento: aceite antigo não encerra conclusão nova
:as_m
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); v integer; a public.completion_acceptances;
begin
  v := test.ver(o);
  perform test.has(test.errmsg(format($q$select public.os_close(%L, %L, %s)$q$, org, o, v)), '%exige o aceite da conclusão atual (versão 1)%', 'encerrar exige aceite');
  perform test.has(test.errmsg(format($q$select public.os_completion_decide_manual(%L, %L, %s, 'contested', 'Dono', 'Ligou reclamando.', null)$q$, org, o, v)), '%motivo da contestação%', 'contestação exige motivo');
  perform test.has(test.errmsg(format($q$select public.os_completion_decide_manual(%L, %L, %s, 'accepted', 'Dono', 'curta', null)$q$, org, o, v)), '%Justificativa%', 'registro manual exige justificativa de verdade');
  perform public.os_completion_decide_manual(org, o, v, 'accepted', 'Dono da Padaria', 'Aceitou presencialmente na entrega.', 'Tudo certo.');
  select * into a from public.completion_acceptances where service_order_id = o and completion_version = 1;
  assert a.channel = 'staff_manual' and a.operator_user_id is not null and a.accepted_text like 'Registro manual pela equipe (não é uma ação autenticada do cliente): ACEITE da conclusão (versão 1)%', 'aceite manual identificado como tal: ' || a.accepted_text;
  perform test.has(test.errmsg(format($q$select public.os_completion_decide_manual(%L, %L, %s, 'accepted', 'Dono', 'Duplicado por engano.', null)$q$, org, o, v)), '%já recebeu uma resposta%', 'uma resposta por versão');
  -- reabrir (mesmo com aceite) → nova conclusão exige novo aceite
  perform test.has(test.errmsg(format($q$select public.os_reopen(%L, %L, %s, 'curto', null)$q$, org, o, v)), '%Motivo da reabertura%', 'reabrir exige motivo');
  v := public.os_reopen(org, o, v, 'Cliente pediu ajuste na vedação da porta.', null);
  assert (select execution_status from public.service_orders where id = o) = 'in_progress' and (select completion_version from public.service_orders where id = o) = 1, 'reaberta para execução';
  assert (select count(*) from public.order_updates where service_order_id = o and visibility = 'internal' and body like 'Ordem reaberta para execução.%') = 1, 'reabertura registrada como nota interna';
  v := (public.os_complete(org, o, v, 'Ajustei a vedação da porta; forno testado novamente.', null) ->> 'version')::int;
  assert (select completion_version from public.service_orders where id = o) = 2, 'nova conclusão = versão 2';
  perform test.has(test.errmsg(format($q$select public.os_close(%L, %L, %s)$q$, org, o, v)), '%aceite da conclusão atual (versão 2)%', 'aceite da versão 1 NÃO encerra a versão 2');
  -- contestação da v2 → reabrir → v3 → aceite → encerrar
  perform public.os_completion_decide_manual(org, o, v, 'contested', 'Dono da Padaria', 'Cliente ligou: o ajuste não resolveu.', 'Ainda vaza calor pela porta.');
  perform test.has(test.errmsg(format($q$select public.os_close(%L, %L, %s)$q$, org, o, v)), '%exige o aceite%', 'contestação não encerra');
  v := public.os_reopen(org, o, v, 'Contestação registrada: refazer a vedação.', null);
  v := (public.os_complete(org, o, v, 'Troquei a borracha de vedação completa e testei.', null) ->> 'version')::int;
  perform public.os_completion_decide_manual(org, o, v, 'accepted', 'Dono da Padaria', 'Aceitou após ver o resultado.', null);
  v := public.os_close(org, o, v);
  assert (select execution_status from public.service_orders where id = o) = 'closed' and (select closed_at from public.service_orders where id = o) is not null and (select completion_version from public.service_orders where id = o) = 3, 'encerrada na versão 3';
  assert (select count(*) from public.completion_acceptances where service_order_id = o) = 3 and (select count(*) from public.order_completions where service_order_id = o) = 3, 'histórico de conclusões e aceites preservado';
  perform test.has(test.errmsg(format($q$select public.os_update_order(%L, %L, %s, '{"subject":"Editar encerrada"}')$q$, org, o, v)), '%não pode ser editada%', 'encerrada não é editada livremente');
  perform test.has(test.errmsg(format($q$select public.os_quote_new_draft(%L, %L)$q$, org, o)), '%não aceita novo orçamento%', 'encerrada não recebe orçamento');
  perform test.has(test.errmsg(format($q$select public.os_add_files(%L, %L, gen_random_uuid(), null, '[]')$q$, org, o)), '%não aceita novos arquivos%', 'encerrada não recebe arquivos');
  perform test.has(test.errmsg(format($q$select public.os_reopen(%L, %L, %s, 'Gestor tentando reabrir encerrada.', null)$q$, org, o, v)), '%só o proprietário%', 'só o proprietário reabre encerrada');
  perform set_config('t.vclosed', v::text, true);
  raise notice 'PASS: aceite por versão, reabertura e encerramento (6)';
end $$;
reset role;

:as_o
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); v integer := current_setting('t.vclosed')::integer;
begin
  v := public.os_reopen(org, o, v, 'Garantia: o cliente voltou com o mesmo defeito.', null);
  assert (select execution_status from public.service_orders where id = o) = 'in_progress' and (select closed_at from public.service_orders where id = o) is null, 'proprietário reabre encerrada de forma explícita';
  assert (select count(*) from public.order_events where service_order_id = o and event_type = 'reopened_after_close') = 1, 'evento de reabertura após encerramento';
  raise notice 'PASS: reabertura de ordem encerrada só pelo proprietário e auditada (6)';
end $$;
reset role;

-- ===================================================================== (7) custos internos e notas
:as_m
do $$
declare org uuid := test.t('org'); o uuid := test.t('o'); c1 uuid; k uuid := gen_random_uuid(); r jsonb;
begin
  r := public.os_add_cost(org, o, k, '{"category":"labor","description":"3 horas de mão de obra","amount_cents":18000}');
  c1 := (r ->> 'id')::uuid;
  assert public.os_add_cost(org, o, k, '{"category":"labor","description":"3 horas de mão de obra","amount_cents":18000}') = r, 'custo idempotente';
  perform test.has(test.errmsg(format($q$select public.os_add_cost(%L, %L, gen_random_uuid(), '{"category":"labor","description":"Estorno solto","amount_cents":-500}')$q$, org, o)), '%só corrigem um custo anterior%', 'negativo só corrige custo');
  perform public.os_add_cost(org, o, gen_random_uuid(), jsonb_build_object('category', 'labor', 'description', 'Correção de horas', 'amount_cents', -6000, 'corrects_cost_id', c1));
  assert test.cnt(format('select sum(amount_cents) from public.order_internal_costs where service_order_id = %L', o)) = 12000, 'soma dos custos com correção';
  assert test.errmsg(format($q$select test.sql('update public.order_internal_costs set amount_cents = 1 where id = ''%s''')$q$, c1)) like '%imutável%', 'custos são imutáveis';
  r := public.os_add_update(org, o, gen_random_uuid(), 'customer', 'Peça chega amanhã; atendimento retomado na quinta.', null);
  perform public.os_add_update(org, o, gen_random_uuid(), 'internal', 'Cliente é exigente; combinar valores antes.', null);
  assert (select count(*) from public.order_updates where service_order_id = o and visibility = 'customer') = 1, 'nota compartilhável separada da interna';
  perform test.has(test.errmsg(format($q$select public.os_add_update(%L, %L, gen_random_uuid(), 'publica', 'texto', null)$q$, org, o)), '%visibilidade inválida%', 'visibilidade inválida');
  assert test.errmsg(format($q$select test.sql('update public.order_updates set body = ''x'' where service_order_id = ''%s''')$q$, o)) like '%imutável%', 'notas são imutáveis';
  raise notice 'PASS: custos internos e notas (7)';
end $$;
reset role;

:as_t1
do $$
declare org uuid := test.t('org'); o uuid := test.t('o');
begin
  assert test.count('select 1 from public.order_events where event_type like ''cost%''') = 0 and test.count('select 1 from public.order_internal_costs') = 0, 'técnico não vê custos nem eventos de custo';
  assert test.count('select 1 from public.order_updates') >= 2, 'técnico lê as notas da ordem dele';
  raise notice 'PASS: custos invisíveis ao técnico (7)';
end $$;
reset role;

-- ===================================================================== (8) quem é desativado ou sai da empresa deixa as ordens em estado coerente
:as_m
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); a uuid; b uuid; r jsonb; res jsonb;
begin
  r := public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Visita agendada', 'problem_description', 'Visita de revisão.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a3',
    'scheduled_start_at', now() + interval '1 day', 'scheduled_end_at', now() + interval '1 day 2 hours'));
  a := (r ->> 'id')::uuid;
  r := public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Serviço em andamento', 'problem_description', 'Em andamento.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a3',
    'quote_mode', 'authorized', 'authorization_justification', 'Autorizado por telefone pelo responsável.'));
  b := (r ->> 'id')::uuid;
  perform public.os_start(org, b, 1);
  perform test.has(test.errmsg(format($q$select public.os_set_technician_active(%L, 'ffffffff-0000-4000-8000-0000000000a1', false)$q$, org)), '%próprio acesso%', 'ninguém desativa o próprio acesso');
  res := public.os_set_technician_active(org, 'ffffffff-0000-4000-8000-0000000000a3', false);
  assert (res ->> 'orders_released')::int = 2, 'duas ordens liberadas';
  assert (select execution_status from public.service_orders where id = a) = 'open' and (select assigned_technician_user_id from public.service_orders where id = a) is null and (select scheduled_start_at from public.service_orders where id = a) is null, 'agendada volta a aberta, sem janela';
  assert (select execution_status from public.service_orders where id = b) = 'paused' and (select assigned_technician_user_id from public.service_orders where id = b) is null, 'em execução fica pausada, sem responsável';
  assert (select count(*) from public.order_pauses where service_order_id = b and ended_at is null) = 1, 'pausa registrada';
  perform test.has(test.errmsg(format($q$select public.os_assign(%L, %L, %s, 'ffffffff-0000-4000-8000-0000000000a3')$q$, org, a, test.ver(a))), '%responsável inválido%', 'desativado não pode ser atribuído');
  perform set_config('t.b', b::text, true);
  raise notice 'PASS: desativar técnico devolve as ordens à fila (8)';
end $$;
reset role;
:as_t2
do $$
begin
  assert test.count('select 1 from public.service_orders') = 0 and private.os_profile(test.t('org')) is null, 'técnico desativado perde o acesso';
  raise notice 'PASS: técnico desativado perde o acesso (8)';
end $$;
reset role;

:as_o
do $$
declare org uuid := test.t('org'); b uuid := test.t('b');
begin
  perform public.os_set_technician_active(org, 'ffffffff-0000-4000-8000-0000000000a3', true);
  perform public.os_assign(org, b, test.ver(b), 'ffffffff-0000-4000-8000-0000000000a2');
  perform public.os_resume(org, b, test.ver(b));
  delete from public.organization_members where organization_id = org and user_id = 'ffffffff-0000-4000-8000-0000000000a2';
  assert (select assigned_technician_user_id from public.service_orders where id = b) is null and (select execution_status from public.service_orders where id = b) = 'paused', 'remover o membro libera a ordem (pausada, sem responsável)';
  assert (select assigned_technician_user_id from public.service_orders where id = test.t('o')) is null, 'ordens concluídas/encerradas também perdem o vínculo pela chave estrangeira';
  assert (select count(*) from public.order_events where service_order_id = b and event_type = 'unassigned' and actor_kind = 'system') >= 1, 'evento do sistema registrado';
  raise notice 'PASS: remover membro não deixa ordem pendurada (8)';
end $$;
reset role;

rollback;
