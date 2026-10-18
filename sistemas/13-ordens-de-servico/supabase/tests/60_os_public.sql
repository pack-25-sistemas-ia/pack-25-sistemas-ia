-- Ordens de Serviço — acesso público por link: token (hash, validade, revogação, limite), projeção sem dados internos, decisão do orçamento (versão vigente), aceite/contestação da conclusão
-- (só a versão corrente), arquivos compartilhados, documentos e a prova de que o anônimo não alcança nenhuma tabela nem função administrativa.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_t1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"t1@t.invalid"}'', true); set local role authenticated;'
\set as_anon 'select set_config(''request.jwt.claims'', ''{}'', true); set local role anon;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.txt(q text) returns text language plpgsql security definer set search_path = '' as $$ declare s text; begin execute q into s; return s; end $$;
create function test.ver(o uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.service_orders where id = o $$;
create function test.path(org uuid, ord uuid, ext text) returns text language sql as $$ select org::text || '/' || ord::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || ext $$;
create function test.tok() returns text language sql as $$ select left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 43) $$;
create function test.hash(tok text) returns text language sql as $$ select encode(sha256(convert_to(tok, 'UTF8')), 'hex') $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 't1@t.invalid');

-- ===================================================================== (1) preparação: duas ordens (A com orçamento publicado e arquivos; B para provar isolamento)
:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Serviços Públicos Teste', 'servicos-publicos-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member');
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); c uuid; ad uuid; a uuid; b uuid; q uuid; v integer; r jsonb; att jsonb;
begin
  c := public.os_save_customer(org, null, '{"name":"Cliente Link","document":"52998224725","internal_notes":"NOTA-RESTRITA-CLIENTE"}'); perform set_config('t.c', c::text, true);
  ad := public.os_save_address(org, c, null, '{"label":"Casa","street":"Rua Um","number":"1","city":"Recife","state":"PE"}');
  a := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'address_id', ad, 'subject', 'Ar-condicionado sem gelar', 'problem_description', 'Não gela.', 'technician_id', 'ffffffff-0000-4000-8000-0000000000a2')) ->> 'id')::uuid;
  b := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Outra ordem do mesmo cliente', 'problem_description', 'Outra.')) ->> 'id')::uuid;
  perform set_config('t.a', a::text, true); perform set_config('t.b', b::text, true);
  perform public.os_add_update(org, a, gen_random_uuid(), 'internal', 'NOTA-INTERNA-SECRETA: cliente costuma atrasar pagamento', null);
  perform public.os_add_update(org, a, gen_random_uuid(), 'customer', 'Técnico a caminho amanhã de manhã.', null);
  perform public.os_add_cost(org, a, gen_random_uuid(), '{"category":"labor","description":"CUSTO-INTERNO-SECRETO","amount_cents":7777}');
  -- um arquivo interno e um compartilhado
  perform public.os_add_files(org, a, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('path', test.path(org, a, 'jpg'), 'mime', 'image/jpeg', 'size', 5000, 'filename', 'interna.jpg', 'category', 'before', 'visibility', 'internal')));
  perform public.os_add_files(org, a, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('path', test.path(org, a, 'jpg'), 'mime', 'image/jpeg', 'size', 6000, 'filename', 'compartilhada.jpg', 'category', 'after', 'visibility', 'customer')));
  perform set_config('t.f_int', (select id::text from public.order_attachments where service_order_id = a and visibility = 'internal'), true);
  perform set_config('t.f_cli', (select id::text from public.order_attachments where service_order_id = a and visibility = 'customer'), true);
  -- orçamento v1 publicado e v2 em rascunho (rascunho nunca aparece)
  q := public.os_quote_new_draft(org, a); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 7)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Limpeza e recarga de gás', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 25000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform set_config('t.q1', q::text, true);
  q := public.os_quote_new_draft(org, a); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, '{"items":[{"kind":"service","description":"RASCUNHO-NAO-PUBLICADO","unit":"un","quantity":1,"unit_price_cents":99999}]}');
  perform set_config('t.q2', q::text, true);
  raise notice 'PASS: preparação (1)';
end $$;
reset role;

-- ===================================================================== (2) gestão do link: só o hash é guardado; um link ativo por ordem
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); tk1 text := test.tok(); tk2 text := test.tok(); r jsonb;
begin
  perform test.has(test.errmsg(format($q$select public.os_create_link(%L, %L, 'curto')$q$, org, a)), '%token inválido%', 'hash inválido');
  r := public.os_create_link(org, a, test.hash(tk1));
  perform set_config('t.tk1', tk1, true);
  assert (select count(*) from public.public_access_tokens where service_order_id = a and revoked_at is null) = 1, 'um link ativo';
  assert test.cnt(format('select count(*) from public.public_access_tokens where token_hash = sha256(convert_to(%L, ''UTF8''))', tk1)) = 1, 'o banco guarda o hash do token';
  assert test.cnt(format('select count(*) from public.public_access_tokens where encode(token_hash, ''escape'') like %L', '%' || left(tk1, 12) || '%')) = 0, 'o token em si não é guardado';
  perform test.has(test.errmsg(format($q$select token_hash from public.public_access_tokens$q$)), '%permission denied%', 'a coluna do hash não é legível pela API');
  assert (select expires_at from public.public_access_tokens where service_order_id = a and revoked_at is null) > now() + interval '29 days', 'validade de 30 dias';
  r := public.os_create_link(org, a, test.hash(tk2));
  assert (select count(*) from public.public_access_tokens where service_order_id = a and revoked_at is null) = 1 and (select count(*) from public.public_access_tokens where service_order_id = a) = 2, 'gerar outro link revoga o anterior';
  perform set_config('t.tk2', tk2, true);
  assert test.errmsg(format($q$select test.sql('update public.public_access_tokens set expires_at = now() + interval ''400 days'' where service_order_id = ''%s''')$q$, a)) like '%só pode ser revogado%', 'link não pode ser estendido';
  assert test.errmsg(format($q$select test.sql('delete from public.public_access_tokens where service_order_id = ''%s''')$q$, a)) like '%não pode ser apagado%', 'link não é apagado';
  raise notice 'PASS: gestão do link (2)';
end $$;
reset role;

-- ===================================================================== (3) projeção pública: o que aparece e o que NUNCA aparece
:as_anon
do $$
declare tk text := current_setting('t.tk2'); v jsonb; txt text; old text := current_setting('t.tk1'); k int;
begin
  v := public.os_public_view(tk, 'src-teste');
  txt := v::text;
  assert v #>> '{order,number_text}' = 'OS-00001' and v #>> '{order,subject}' = 'Ar-condicionado sem gelar' and v #>> '{customer,name}' = 'Cliente Link', 'resumo público';
  assert v #>> '{quote,version_number}' = '1' and v #>> '{quote,status}' = 'published' and (v #>> '{quote,total_cents}')::bigint = 25000 and v #>> '{quote,items,0,description}' = 'Limpeza e recarga de gás', 'orçamento publicado e total';
  assert v #>> '{quote,text_to_accept}' like 'Declaro, em nome próprio ou como representante do cliente, que li e APROVO a versão 1%' and v #>> '{quote,text_to_accept}' like '%sem verificação certificada de identidade.', 'texto de aceite montado no banco, com o aviso do aceite simples';
  assert jsonb_array_length(v -> 'updates') = 1 and v #>> '{updates,0,body}' = 'Técnico a caminho amanhã de manhã.', 'só atualização compartilhada';
  assert jsonb_array_length(v -> 'files') = 1 and v #>> '{files,0,name}' = 'compartilhada.jpg', 'só arquivo compartilhado';
  assert txt not like '%NOTA-INTERNA-SECRETA%' and txt not like '%CUSTO-INTERNO-SECRETO%' and txt not like '%RASCUNHO-NAO-PUBLICADO%' and txt not like '%NOTA-RESTRITA-CLIENTE%' and txt not like '%52998224725%', 'nada interno vaza: nota interna, custo, rascunho, nota do cliente, CPF';
  assert txt not like '%storage_path%' and txt not like '%interna.jpg%' and txt not like '%assigned%' and txt not like '%ffffffff-0000-4000-8000-0000000000a2%' and txt not like '%technician%', 'sem caminho de storage, arquivo interno nem técnico';
  assert not (v -> 'order') ? 'assigned_technician_user_id' and not (v -> 'order') ? 'id' and not (v -> 'order') ? 'version', 'sem ids internos';
  -- link antigo (revogado) e inventado dão a MESMA resposta
  assert public.os_public_view(old, 'src-teste') = '{"error":"invalid_link"}'::jsonb, 'link revogado';
  assert public.os_public_view(test.tok(), 'src-teste') = '{"error":"invalid_link"}'::jsonb, 'link inexistente: mesma resposta';
  assert public.os_public_view('curto', 'src-teste') = '{"error":"invalid_link"}'::jsonb, 'formato inválido: mesma resposta';
  assert public.os_public_view(repeat('é', 43), 'src-teste') = '{"error":"invalid_link"}'::jsonb, 'caracteres fora do alfabeto: mesma resposta';
  raise notice 'PASS: projeção pública sem dados internos; erros indistinguíveis (3)';
end $$;
reset role;

-- limite de tentativas inválidas por origem
:as_anon
do $$
declare i int; msg text;
begin
  for i in 1..25 loop
    msg := test.errmsg(format($q$select public.os_public_view(%L, 'src-abusiva')$q$, test.tok()));
    assert i <= 20 or msg is not null, 'a 21ª falha já deve ser barrada';
  end loop;
  assert msg like '%Muitas tentativas%', 'depois de 20 falhas a origem é limitada: ' || coalesce(msg, '(sem erro)');
  -- a origem abusiva fica bloqueada até para o link correto; outra origem segue normal
  perform test.has(test.errmsg(format($q$select public.os_public_view(%L, 'src-abusiva')$q$, current_setting('t.tk2'))), '%Muitas tentativas%', 'origem limitada');
  assert public.os_public_view(current_setting('t.tk2'), 'src-normal') is not null, 'outra origem não é afetada';
  raise notice 'PASS: limite de tentativas por origem no banco (3)';
end $$;
reset role;

-- ===================================================================== (4) decisão do orçamento: só a versão vigente, expirada ou antiga é recusada
:as_anon
do $$
declare tk text := current_setting('t.tk2'); q1 uuid := test.t('q1'); q2 uuid := test.t('q2');
begin
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-d', %L, 'approved', 'A', null, '{}')$q$, tk, q1)), '%Seu nome%', 'nome obrigatório');
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-d', %L, 'approved', 'Cliente Link', null, '{}')$q$, tk, q2)), '%não foi publicado%', 'rascunho não pode ser decidido pelo cliente');
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-d', %L, 'approved', 'Cliente Link', null, '{}')$q$, tk, gen_random_uuid())), '%Orçamento não encontrado%', 'versão inexistente');
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-d', %L, 'talvez', 'Cliente Link', null, '{}')$q$, tk, q1)), '%decisão inválida%', 'decisão inválida');
  raise notice 'PASS: validações da decisão pública (4)';
end $$;
reset role;

-- orçamento expirado: fabricado desligando o gatilho SÓ no teste
select test.sql($q$alter table public.quote_versions disable trigger quote_guard$q$);
select test.sql(format($q$update public.quote_versions set valid_until = now() - interval '1 hour' where id = '%s'$q$, current_setting('t.q1')));
select test.sql($q$alter table public.quote_versions enable trigger quote_guard$q$);
:as_anon
do $$
declare tk text := current_setting('t.tk2'); v jsonb;
begin
  v := public.os_public_view(tk, 'src-e');
  assert (v #>> '{quote,expired}')::boolean and v #>> '{quote,text_to_accept}' is null, 'expirado aparece como tal, sem texto para aceitar';
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-e', %L, 'approved', 'Cliente Link', null, '{}')$q$, tk, test.t('q1'))), '%expirou%', 'versão expirada não é aceita');
  raise notice 'PASS: orçamento expirado não é aceito (4)';
end $$;
reset role;

-- republicar: nova versão vigente; a antiga fica substituída e o cliente não consegue decidi-la
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); q uuid := test.t('q2'); v integer;
begin
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 7)::text, 'discount_cents', 1000,
    'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Limpeza e recarga de gás', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 25000), jsonb_build_object('kind', 'part', 'description', 'Sensor de temperatura', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 9000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  assert (select status from public.quote_versions where id = test.t('q1')) = 'superseded', 'versão anterior substituída';
end $$;
reset role;
:as_anon
do $$
declare tk text := current_setting('t.tk2'); v jsonb;
begin
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-f', %L, 'approved', 'Cliente Link', null, '{}')$q$, tk, test.t('q1'))), '%substituída%', 'aprovação de versão antiga é rejeitada');
  v := public.os_public_view(tk, 'src-f');
  assert v #>> '{quote,version_number}' = '2' and (v #>> '{quote,total_cents}')::bigint = 33000, 'o link passa a mostrar a versão vigente (2) com desconto';
  assert public.os_public_quote_decide(tk, 'src-f', test.t('q2'), 'approved', 'Cliente Link', 'Pode fazer.', '{"user_agent":"Teste/1.0"}') ->> 'decision' = 'approved', 'cliente aprova a versão vigente';
  raise notice 'PASS: versão antiga recusada; vigente aprovada pelo link (4)';
end $$;
reset role;
:as_m
do $$
declare d public.quote_decisions;
begin
  select * into d from public.quote_decisions where quote_version_id = test.t('q2');
  assert d.channel = 'customer_link' and d.operator_user_id is null and d.justification is null and d.declared_name = 'Cliente Link' and d.note = 'Pode fazer.', 'decisão do cliente: canal link, sem operador';
  assert d.accepted_text like '%APROVO a versão 2 do orçamento da ordem de serviço OS-00001, no valor total de R$ 330,00%', 'texto aceito gravado: ' || d.accepted_text;
  assert d.evidence ->> 'user_agent' = 'Teste/1.0' and d.evidence ->> 'source' = 'src-f' and d.evidence ? 'token_id', 'evidências mínimas (token, origem, agente)';
  assert d.evidence::text not like '%' || current_setting('t.tk2') || '%', 'o token nunca é gravado como evidência';
  perform test.has(test.errmsg(format($q$select public.os_quote_decide_manual(%L, %L, 'rejected', 'Maria', 'Tentando desfazer a aprovação.', null, null)$q$, test.t('org'), test.t('q2'))), '%já recebeu uma decisão%', 'decisão do cliente não é desfeita');
  raise notice 'PASS: decisão do cliente registra texto, versão e evidências mínimas (4)';
  perform public.os_quote_new_draft(test.t('org'), test.t('a')); -- um rascunho novo (versão 3) não pode aparecer para o cliente
end $$;
reset role;
:as_anon
do $$
declare v jsonb := public.os_public_view(current_setting('t.tk2'), 'src-f2');
begin
  assert v #>> '{quote,version_number}' = '2' and v #>> '{quote,status}' = 'approved', 'rascunho posterior nunca é exibido: o cliente segue vendo a versão decidida';
end $$;
reset role;

-- ===================================================================== (5) conclusão: aceite/contestação só da versão corrente
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); v integer;
begin
  v := test.ver(a);
  perform public.os_start(org, a, v);
  v := test.ver(a);
  v := (public.os_complete(org, a, v, 'Limpei a unidade, recarreguei o gás e testei a refrigeração.', null) ->> 'version')::int;
  perform set_config('t.v1', v::text, true);
end $$;
reset role;
:as_anon
do $$
declare tk text := current_setting('t.tk2'); v jsonb;
begin
  v := public.os_public_view(tk, 'src-g');
  assert (v #>> '{completion,version}') = '1' and (v #>> '{completion,can_decide}')::boolean and v #>> '{completion,acceptance,decision}' = 'pending', 'conclusão aguardando aceite';
  assert v #>> '{completion,text_to_accept}' like 'Declaro%ACEITO a conclusão (versão 1) do serviço da ordem OS-00001.%sem verificação certificada de identidade.', 'texto de aceite da conclusão: ' || (v #>> '{completion,text_to_accept}');
  perform test.has(test.errmsg(format($q$select public.os_public_completion_decide(%L, 'src-g', 1, 'contested', 'Cliente Link', 'ruim', '{}')$q$, tk)), '%mínimo 5%', 'contestação precisa de motivo');
  perform test.has(test.errmsg(format($q$select public.os_public_completion_decide(%L, 'src-g', 7, 'accepted', 'Cliente Link', null, '{}')$q$, tk)), '%substituída%', 'versão errada da conclusão');
  assert public.os_public_completion_decide(tk, 'src-g', 1, 'contested', 'Cliente Link', 'O ar continua fraco no quarto.', '{}') ->> 'decision' = 'contested', 'cliente contesta';
  perform test.has(test.errmsg(format($q$select public.os_public_completion_decide(%L, 'src-g', 1, 'accepted', 'Cliente Link', null, '{}')$q$, tk)), '%já recebeu uma resposta%', 'uma resposta por versão');
  raise notice 'PASS: contestação pelo link (5)';
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); v integer;
begin
  v := test.ver(a);
  perform test.has(test.errmsg(format($q$select public.os_close(%L, %L, %s)$q$, org, a, v)), '%exige o aceite da conclusão atual (versão 1)%', 'contestada não encerra');
  assert (select count(*) from public.order_events where service_order_id = a and event_type = 'completion_contested' and actor_kind = 'customer_link') = 1, 'evento do cliente identificado como link';
  v := public.os_reopen(org, a, v, 'Cliente contestou: ar fraco no quarto. Revisar tubulação.', null);
  v := (public.os_complete(org, a, v, 'Revisei a tubulação e corrigi o vazamento de gás.', null) ->> 'version')::int;
  assert (select completion_version from public.service_orders where id = a) = 2, 'nova conclusão v2';
end $$;
reset role;
:as_anon
do $$
declare tk text := current_setting('t.tk2'); v jsonb;
begin
  v := public.os_public_view(tk, 'src-h');
  assert (v #>> '{completion,version}') = '2' and (v #>> '{completion,can_decide}')::boolean, 'link mostra a conclusão 2 aguardando aceite';
  perform test.has(test.errmsg(format($q$select public.os_public_completion_decide(%L, 'src-h', 1, 'accepted', 'Cliente Link', null, '{}')$q$, tk)), '%substituída%', 'aceite da versão antiga não vale para a nova');
  assert public.os_public_completion_decide(tk, 'src-h', 2, 'accepted', 'Cliente Link', 'Agora gela bem.', '{}') ->> 'decision' = 'accepted', 'cliente aceita a v2';
  assert test.txt(format($q$select accepted_text from public.completion_acceptances where service_order_id = (select service_order_id from public.public_access_tokens where token_hash = sha256(convert_to(%L, 'UTF8'))) and completion_version = 2$q$, tk)) like 'Declaro, em nome próprio ou como representante do cliente, que ACEITO a conclusão (versão 2) do serviço da ordem OS-%', 'texto do aceite é montado no banco, não vem do navegador';
  raise notice 'PASS: aceite só vale para a versão corrente (5)';
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); a uuid := test.t('a'); v integer;
begin
  v := test.ver(a);
  v := public.os_close(org, a, v);
  assert (select execution_status from public.service_orders where id = a) = 'closed', 'encerrada depois do aceite da versão corrente';
end $$;
reset role;
:as_anon
do $$
declare tk text := current_setting('t.tk2');
begin
  perform test.has(test.errmsg(format($q$select public.os_public_completion_decide(%L, 'src-i', 2, 'contested', 'Cliente Link', 'tarde demais', '{}')$q$, tk)), '%não está aguardando%', 'ordem encerrada não recebe nova decisão pelo link');
  assert public.os_public_view(tk, 'src-i') #>> '{order,status}' = 'closed', 'o link segue mostrando o estado final';
  raise notice 'PASS: ordem encerrada não aceita decisões novas (5)';
end $$;
reset role;

-- ===================================================================== (6) arquivos compartilhados e documentos
:as_anon
do $$
declare tk text := current_setting('t.tk2'); f jsonb; d jsonb; txt text;
begin
  f := public.os_public_file(tk, 'src-j', test.t('f_cli'));
  assert f ->> 'path' like test.t('org')::text || '/' || test.t('a')::text || '/%' and f ->> 'content_type' = 'image/jpeg', 'arquivo compartilhado devolve o caminho para assinar';
  perform test.has(test.errmsg(format($q$select public.os_public_file(%L, 'src-j', %L)$q$, tk, test.t('f_int'))), '%Arquivo não encontrado%', 'arquivo interno é inexistente para o cliente');
  -- política do Storage (lê o token do cabeçalho repassado pelo servidor)
  perform set_config('request.headers', json_build_object('x-os-token', tk)::text, true);
  assert public.os_public_object_ok(f ->> 'path'), 'a política libera o arquivo COMPARTILHADO da ordem do token';
  assert not public.os_public_object_ok(test.txt(format('select storage_path from public.order_attachments where id = %L', test.t('f_int')))), 'a política nega o arquivo interno';
  perform set_config('request.headers', json_build_object('x-os-token', test.tok())::text, true);
  assert not public.os_public_object_ok(f ->> 'path'), 'token desconhecido não libera nada';
  perform set_config('request.headers', '{"x-os-token":"curto"}', true);
  assert not public.os_public_object_ok(f ->> 'path'), 'token em formato inválido não libera nada';
  perform set_config('request.headers', '{}', true);
  assert not public.os_public_object_ok(f ->> 'path'), 'sem cabeçalho não libera nada';
  perform set_config('request.headers', 'isso não é json', true);
  assert not public.os_public_object_ok(f ->> 'path'), 'cabeçalho malformado não derruba nem libera';
  perform test.has(test.errmsg(format($q$select public.os_public_file(%L, 'src-j', %L)$q$, tk, gen_random_uuid())), '%Arquivo não encontrado%', 'arquivo desconhecido');
  d := public.os_public_document(tk, 'src-j', 'quote', 2);
  txt := d::text;
  assert d #>> '{quote,decision,decision}' = 'approved' and d #>> '{customer,name}' = 'Cliente Link' and d #>> '{order,number_text}' = 'OS-00001', 'documento do orçamento 2 com a decisão';
  assert txt not like '%NOTA-INTERNA%' and txt not like '%CUSTO-INTERNO%' and txt not like '%52998224725%' and txt not like '%NOTA-RESTRITA%', 'documento do cliente sem dados internos';
  perform test.has(test.errmsg(format($q$select public.os_public_document(%L, 'src-j', 'quote', 99)$q$, tk)), '%Documento não encontrado%', 'versão inexistente');
  d := public.os_public_document(tk, 'src-j', 'completion', 2);
  assert d #>> '{completion,acceptance,decision}' = 'accepted' and d #>> '{completion,summary}' like 'Revisei a tubulação%', 'documento de conclusão com o aceite da versão';
  assert not (d -> 'completion') ? 'divergence_note', 'sem justificativa interna de divergência';
  raise notice 'PASS: arquivos e documentos do cliente (6)';
end $$;
reset role;

-- ===================================================================== (7) o anônimo não alcança nada além das portas públicas
:as_anon
do $$
declare t text;
begin
  foreach t in array array['service_orders', 'customers', 'customer_private', 'quote_versions', 'quote_items', 'quote_decisions', 'order_updates', 'order_attachments', 'order_internal_costs', 'order_events', 'public_access_tokens', 'completion_acceptances', 'mutation_requests', 'os_rate_limits', 'os_settings'] loop
    perform test.has(test.errmsg(format('select 1 from public.%I', t)), '%permission denied%', 'anon não lê ' || t);
  end loop;
  perform test.has(test.errmsg($q$select public.os_open_order(gen_random_uuid(), gen_random_uuid(), '{}')$q$), '%permission denied%', 'anon não abre ordem');
  perform test.has(test.errmsg($q$select public.os_dashboard(gen_random_uuid(), current_date, current_date)$q$), '%permission denied%', 'anon não vê painel');
  perform test.has(test.errmsg($q$select public.os_create_link(gen_random_uuid(), gen_random_uuid(), repeat('a', 64))$q$), '%permission denied%', 'anon não cria link');
  perform test.has(test.errmsg($q$select private.os_token_check('x', 'y')$q$), '%permission denied%', 'anon não chama funções internas');
  perform test.has(test.errmsg($q$select private.os_document_data(gen_random_uuid(), 'summary', 0)$q$), '%permission denied%', 'anon não chama dados de documento');
  raise notice 'PASS: o anônimo só alcança as funções os_public_* (7)';
end $$;
reset role;

-- ===================================================================== (8) cancelar revoga o link e retira a proposta pendente
:as_m
do $$
declare org uuid := test.t('org'); b uuid := test.t('b'); tkb text := test.tok(); q uuid; v integer;
begin
  perform public.os_create_link(org, b, test.hash(tkb));
  q := public.os_quote_new_draft(org, b); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 3)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Serviço B', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 1000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform set_config('t.tkb', tkb, true); perform set_config('t.qb', q::text, true);
  perform public.os_cancel(org, b, test.ver(b), 'Cliente desistiu do serviço');
  assert (select count(*) from public.public_access_tokens where service_order_id = b and revoked_at is null) = 0 and (select status from public.quote_versions where id = q) = 'superseded', 'cancelar revoga o link e retira a proposta pendente';
  perform test.has(test.errmsg(format($q$select public.os_create_link(%L, %L, %L)$q$, org, b, test.hash(test.tok()))), '%canceladas%', 'ordem cancelada não gera link');
end $$;
reset role;
:as_anon
do $$
begin
  assert public.os_public_view(current_setting('t.tkb'), 'src-k') = '{"error":"invalid_link"}'::jsonb, 'link de ordem cancelada';
  raise notice 'PASS: cancelamento revoga o acesso público (8)';
end $$;
reset role;

-- ===================================================================== (9) isolamento entre ordens do mesmo cliente, validade do link e limite por formato inválido
:as_m
do $$
declare org uuid := test.t('org'); x uuid; q uuid; v integer; tkx text := test.tok();
begin
  x := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', test.t('c'), 'subject', 'Terceira ordem do cliente', 'problem_description', 'Outra ordem, outro link.')) ->> 'id')::uuid;
  q := public.os_quote_new_draft(org, x); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 3)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Serviço X', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 1000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform public.os_add_files(org, x, gen_random_uuid(), null, jsonb_build_array(jsonb_build_object('path', test.path(org, x, 'jpg'), 'mime', 'image/jpeg', 'size', 4000, 'filename', 'x.jpg', 'category', 'after', 'visibility', 'customer')));
  perform public.os_create_link(org, x, test.hash(tkx));
  perform set_config('t.x', x::text, true); perform set_config('t.qx', q::text, true); perform set_config('t.tkx', tkx, true);
  perform set_config('t.fx', (select id::text from public.order_attachments where service_order_id = x), true);
  perform set_config('t.px', (select storage_path from public.order_attachments where service_order_id = x), true);
end $$;
reset role;
:as_anon
do $$
begin
  assert public.os_public_view(current_setting('t.tkx'), 'src-x') ->> 'error' is null, 'link novo vale';
  perform set_config('request.headers', json_build_object('x-os-token', current_setting('t.tkx'))::text, true);
  assert public.os_public_object_ok(current_setting('t.px')), 'a política libera o arquivo compartilhado enquanto o link vale';
  -- o link de UMA ordem não decide orçamento nem entrega arquivo de OUTRA ordem do mesmo cliente
  perform test.has(test.errmsg(format($q$select public.os_public_quote_decide(%L, 'src-x', %L, 'approved', 'Cliente Link', null, '{}')$q$, current_setting('t.tk2'), current_setting('t.qx'))), '%Orçamento não encontrado%', 'orçamento de outra ordem');
  perform test.has(test.errmsg(format($q$select public.os_public_file(%L, 'src-x', %L)$q$, current_setting('t.tk2'), current_setting('t.fx'))), '%Arquivo não encontrado%', 'arquivo de outra ordem');
  perform set_config('request.headers', json_build_object('x-os-token', current_setting('t.tk2'))::text, true);
  assert not public.os_public_object_ok(current_setting('t.px')), 'a política não libera arquivo de outra ordem';
  perform set_config('request.headers', '{}', true);
end $$;
reset role;
-- expira o link (gatilho desligado SÓ no teste)
select test.sql($q$alter table public.public_access_tokens disable trigger token_guard$q$);
select test.sql(format($q$update public.public_access_tokens set expires_at = now() - interval '1 hour' where service_order_id = '%s'$q$, current_setting('t.x')));
select test.sql($q$alter table public.public_access_tokens enable trigger token_guard$q$);
:as_anon
do $$
begin
  assert public.os_public_view(current_setting('t.tkx'), 'src-x') = '{"error":"invalid_link"}'::jsonb, 'link expirado responde como inválido';
  perform set_config('request.headers', json_build_object('x-os-token', current_setting('t.tkx'))::text, true);
  assert not public.os_public_object_ok(current_setting('t.px')), 'link expirado não libera o arquivo no Storage';
  perform set_config('request.headers', '{}', true);
  -- tokens de formato inválido também contam como tentativa falha
  for i in 1..20 loop perform public.os_public_view('curto', 'src-fmt'); end loop;
  perform test.has(test.errmsg(format($q$select public.os_public_view(%L, 'src-fmt')$q$, current_setting('t.tk2'))), '%Muitas tentativas%', 'falhas de formato acumulam e bloqueiam a origem');
  raise notice 'PASS: isolamento entre ordens, expiração do link e limite por formato inválido (9)';
end $$;
reset role;

rollback;

