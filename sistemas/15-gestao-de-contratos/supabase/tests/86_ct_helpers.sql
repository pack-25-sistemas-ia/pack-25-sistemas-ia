-- Gestão de Contratos — funções auxiliares testadas diretamente: textos, datas, conflito de versão, idempotência, exigência de papel, estados editáveis e validação de arquivos.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000f0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000f3","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'
\set as_rd 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000f4","aal":"aal1","email":"rd@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.errstate(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.req_text(p text, a int, b int) returns text language sql security definer set search_path = '' as $$ select private.ct_req_text(p, a, b, 'Campo') $$;
create function test.opt_text(p text, b int) returns text language sql security definer set search_path = '' as $$ select private.ct_opt_text(p, b, 'Campo') $$;
create function test.opt_date(p text) returns date language sql security definer set search_path = '' as $$ select private.ct_opt_date(p, 'Data') $$;
create function test.conflict() returns void language sql security definer set search_path = '' as $$ select private.ct_conflict('este item') $$;
create function test.require(org uuid, c uuid, lvl text) returns void language sql security definer set search_path = '' as $$ select private.ct_require(org, c, lvl) $$;
create function test.open_for_edit(c uuid) returns void language plpgsql security definer set search_path = '' as $$ declare r public.contracts; begin select * into r from public.contracts where id = c; perform private.ct_open_for_edit(r); end $$;
create function test.idem(org uuid, u uuid, k uuid, sc text, h text) returns jsonb language sql security definer set search_path = '' as $$ select private.ct_idem(org, u, k, sc, h) $$;
create function test.idem_done(org uuid, u uuid, k uuid, r jsonb) returns void language sql security definer set search_path = '' as $$ select private.ct_idem_done(org, u, k, r) $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000f0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000f3', 'ed@t.invalid'), ('ffffffff-0000-4000-8000-0000000000f4', 'rd@t.invalid');

:as_o
do $$
declare org uuid; c uuid;
begin
  org := public.create_organization('Empresa Auxiliares', 'empresa-auxiliares'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000f3', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000f4', 'member');
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato auxiliar', 'start_date', (current_date - 20)::text, 'end_date', (current_date + 90)::text,
    'access', jsonb_build_array(jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000f3', 'role', 'editor'), jsonb_build_object('user_id', 'ffffffff-0000-4000-8000-0000000000f4', 'role', 'reader')))) ->> 'id')::uuid;
  perform set_config('t.c', c::text, true);
  raise notice 'PASS: preparação (1)';
end $$;

-- ===================================================================== (2) textos, datas e conflito
do $$
begin
  assert test.req_text('  abc  ', 2, 5) = 'abc', 'texto obrigatório é aparado';
  perform test.has(test.errmsg($q$select test.req_text('a', 2, 5)$q$), '%entre 2 e 5%', 'texto curto demais');
  perform test.has(test.errmsg($q$select test.req_text('abcdef', 2, 5)$q$), '%entre 2 e 5%', 'texto longo demais');
  assert test.req_text('ab', 2, 5) = 'ab' and test.req_text('abcde', 2, 5) = 'abcde', 'limites do texto obrigatório são inclusivos';
  assert test.opt_text('   ', 5) is null and test.opt_text(null, 5) is null, 'texto opcional vazio vira nulo';
  assert test.opt_text(' abcde ', 5) = 'abcde', 'texto opcional no limite passa';
  perform test.has(test.errmsg($q$select test.opt_text('abcdef', 5)$q$), '%no máximo 5%', 'texto opcional longo demais');
  assert test.opt_date('2026-02-28') = '2026-02-28' and test.opt_date('') is null and test.opt_date(null) is null, 'data opcional';
  perform test.has(test.errmsg($q$select test.opt_date('28/02/2026')$q$), '%formato AAAA-MM-DD%', 'data em outro formato');
  perform test.has(test.errmsg($q$select test.opt_date('2026-02-30')$q$), '%data inválida%', 'data inexistente');
  assert test.errstate($q$select test.conflict()$q$) = '40001', 'conflito de versão usa o código 40001';
  perform test.has(test.errmsg($q$select test.conflict()$q$), '%Outra pessoa alterou este item antes de você%', 'mensagem do conflito');
  raise notice 'PASS: textos, datas e conflito (2)';
end $$;

-- ===================================================================== (3) idempotência
do $$
declare org uuid := test.t('org'); u uuid := 'ffffffff-0000-4000-8000-0000000000f0'; k uuid := gen_random_uuid(); r jsonb;
begin
  assert test.idem(org, u, k, 'escopo', 'h1') is null, 'primeira chamada reserva a chave';
  perform test.has(test.errmsg(format($q$select test.idem(%L, %L, %L, 'escopo', 'h1')$q$, org, u, k)), '%em andamento%', 'segunda chamada antes do resultado');
  perform test.idem_done(org, u, k, '{"ok":true}');
  r := test.idem(org, u, k, 'escopo', 'h1');
  assert r = '{"ok":true}'::jsonb, 'repetição devolve o resultado guardado';
  perform test.has(test.errmsg(format($q$select test.idem(%L, %L, %L, 'escopo', 'h2')$q$, org, u, k)), '%já foi usada com outros dados%', 'mesma chave com dados diferentes');
  perform test.has(test.errmsg(format($q$select test.idem(%L, %L, %L, 'outro', 'h1')$q$, org, u, k)), '%já foi usada com outros dados%', 'mesma chave em outro escopo');
  perform test.has(test.errmsg(format($q$select test.idem(%L, %L, null, 'escopo', 'h1')$q$, org, u)), '%chave ausente%', 'chave ausente');
  raise notice 'PASS: idempotência (3)';
end $$;
reset role;

-- ===================================================================== (4) papel exigido e estados editáveis
:as_ed
do $$
declare org uuid := test.t('org'); c uuid := test.t('c');
begin
  perform test.require(org, c, 'edit');
  perform test.has(test.errmsg(format($q$select test.require(%L, %L, 'manage')$q$, org, c)), '%sem permissão%', 'editor não exerce a gestão');
  raise notice 'PASS: editor edita mas não gere (4)';
end $$;
reset role;
:as_rd
do $$
declare org uuid := test.t('org'); c uuid := test.t('c');
begin
  perform test.has(test.errmsg(format($q$select test.require(%L, %L, 'edit')$q$, org, c)), '%sem permissão%', 'leitor não edita');
  perform test.has(test.errmsg(format($q$select test.require(%L, %L, 'manage')$q$, org, c)), '%sem permissão%', 'leitor não gere');
  raise notice 'PASS: leitor só consulta (4)';
end $$;
reset role;
:as_o
do $$
declare org uuid := test.t('org'); c uuid := test.t('c'); cp uuid; d jsonb; f jsonb;
begin
  perform test.open_for_edit(c); -- rascunho é editável
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte Auxiliar"}', gen_random_uuid());
  perform public.ct_add_party(org, c, cp, 'Contratada');
  perform public.ct_activate_contract(org, c, (select version from public.contracts where id = c));
  perform test.open_for_edit(c); -- ativo é editável
  -- validação de arquivos pelo caminho pronto
  f := jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 0, 'filename', 'vazio.pdf');
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Vazio', 'other', %L::jsonb)$q$, org, c, f::text)), '%tamanho máximo%', 'arquivo vazio recusado');
  f := jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.docx', 'mime', 'application/pdf', 'size', 100, 'filename', 'trocado.docx');
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Trocado', 'other', %L::jsonb)$q$, org, c, f::text)), '%arquivo inválido%', 'tipo diferente da extensão');
  f := jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', 'a/b\c.pdf', 'sha256', 'zzz');
  perform test.has(test.errmsg(format($q$select public.ct_add_document(%L, %L, gen_random_uuid(), 'Digital ruim', 'other', %L::jsonb)$q$, org, c, f::text)), '%arquivo inválido%', 'impressão digital fora do padrão');
  f := f - 'sha256';
  d := public.ct_add_document(org, c, gen_random_uuid(), 'Nome com barra', 'other', f);
  assert (select original_filename from public.contract_document_versions where id = (d ->> 'version_id')::uuid) = 'a_b_c.pdf', 'barras do nome do arquivo viram sublinhado';
  f := jsonb_build_object('path', org::text || '/' || c::text || '/' || replace(gen_random_uuid()::text, '-', '') || '.pdf', 'mime', 'application/pdf', 'size', 100, 'filename', '   ');
  d := public.ct_add_document(org, c, gen_random_uuid(), 'Nome vazio', 'other', f);
  assert (select original_filename from public.contract_document_versions where id = (d ->> 'version_id')::uuid) = 'arquivo', 'nome vazio vira «arquivo»';
  -- estados que não aceitam edição
  perform public.ct_close_contract(org, c, (select version from public.contracts where id = c), 'Encerramento normal do contrato');
  perform test.has(test.errmsg(format($q$select test.open_for_edit(%L)$q$, c)), '%encerrado é somente para consulta%', 'encerrado não aceita edição');
  perform public.ct_archive_contract(org, c, (select version from public.contracts where id = c), true);
  perform test.has(test.errmsg(format($q$select test.open_for_edit(%L)$q$, c)), '%arquivado é somente para consulta%', 'arquivado não aceita edição');
  raise notice 'PASS: arquivos e estados editáveis (4)';
end $$;
reset role;

rollback;
