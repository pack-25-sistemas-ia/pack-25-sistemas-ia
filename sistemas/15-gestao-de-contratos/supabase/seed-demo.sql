-- DEMONSTRAÇÃO «Consultoria Meridiano» — dados 100% fictícios, determinísticos e RELATIVOS à data de execução (nada no futuro impossível).
-- Aplicado por `node scripts/seed-demo.mjs` (senha aleatória gerada na hora e exibida só no seu terminal; nenhuma credencial fixa é publicada).
-- Somente para uso LOCAL. NUNCA aplique em produção. Variável psql: pw (senha dos usuários @demo.exemplo).
-- Usuários: dono (proprietário), gestor, ana/carla (colaboradoras), bruno/diego (colaboradores sem vínculo na maioria) e leitor (Leitor da empresa) @demo.exemplo. O proprietário cadastra o 2º fator (TOTP) no primeiro acesso.
-- Tudo é criado pelas MESMAS funções ct_* que o aplicativo usa (com a identidade de cada pessoa), então regras, histórico e notificações são reais.
-- Os documentos (PDF) são enviados pelo script seed-demo.mjs pelo próprio caminho do aplicativo (Storage + ct_add_document), para existirem de verdade.

select set_config('demo.pw', :'pw', false);
select set_config('request.jwt.claims', '', false);
begin;

do $$
declare pw text := extensions.crypt(current_setting('demo.pw'), extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where slug = 'consultoria-meridiano') then raise exception 'a demonstração já existe neste banco (rode supabase db reset antes)'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', e.nome), now(), now(), '', '', '', ''
  from (values ('dono@demo.exemplo', 'Helena Costa'), ('gestor@demo.exemplo', 'Marcos Almeida'), ('ana@demo.exemplo', 'Ana Ribeiro'), ('bruno@demo.exemplo', 'Bruno Tavares'),
    ('carla@demo.exemplo', 'Carla Nogueira'), ('diego@demo.exemplo', 'Diego Ferraz'), ('leitor@demo.exemplo', 'Eduardo Leitor')) as e(email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'dono@demo.exemplo'), 'aal', 'aal2', 'role', 'authenticated')::text, false);
select public.create_organization('Consultoria Meridiano (demonstração)', 'consultoria-meridiano') as org \gset
insert into public.organization_members (organization_id, user_id, role)
select :'org', u.id, case when u.email = 'gestor@demo.exemplo' then 'manager'::public.org_role when u.email = 'leitor@demo.exemplo' then 'viewer'::public.org_role else 'member'::public.org_role end
from auth.users u where u.email like '%@demo.exemplo' and u.email <> 'dono@demo.exemplo';
select set_config('demo.org', :'org', false);
select public.ct_save_settings(:'org', '{"primary_color":"#1d4ed8","contract_prefix":"CTR","retention_policy_text":"DEMONSTRAÇÃO: dados fictícios, sem prazo de retenção definido."}'::jsonb);
update public.organization_settings set display_name = 'Consultoria Meridiano (demonstração)', theme = jsonb_build_object('primary', '#1d4ed8') where organization_id = :'org';

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = p_email), 'aal', case when p_email = 'dono@demo.exemplo' then 'aal2' else 'aal1' end, 'role', 'authenticated')::text, false);
end $$;
create function pg_temp.u(p_email text) returns uuid language sql stable as $$ select id from auth.users where email = p_email $$;
create function pg_temp.d(n integer) returns text language sql stable as $$ select to_char((now() at time zone 'America/Sao_Paulo')::date + n, 'YYYY-MM-DD') $$;
create function pg_temp.cv(c uuid) returns integer language sql stable as $$ select version from public.contracts where id = c $$;
create function pg_temp.acc(p_email text, p_role text) returns jsonb language sql stable as $$ select jsonb_build_object('user_id', pg_temp.u(p_email), 'role', p_role) $$;
create function pg_temp.party(p_cp uuid, p_role text) returns jsonb language sql stable as $$ select jsonb_build_object('counterparty_id', p_cp, 'role_description', p_role) $$;

do $$
declare org uuid := current_setting('demo.org')::uuid; cat_ti uuid; cat_forn uuid; cat_cons uuid; cat_lic uuid;
  cp_alfa uuid; cp_beta uuid; cp_gama uuid; cp_beatriz uuid; cp_delta uuid; cp_self uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; s jsonb; o uuid;
begin
  perform pg_temp.as_user('gestor@demo.exemplo');
  cat_ti := public.ct_save_category(org, null, 'Tecnologia e suporte'); cat_forn := public.ct_save_category(org, null, 'Fornecimento'); cat_cons := public.ct_save_category(org, null, 'Consultoria'); cat_lic := public.ct_save_category(org, null, 'Licenciamento');
  cp_self := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Consultoria Meridiano Ltda (nossa empresa)","document_number":"12.345.678/0001-95","email":"contratos@meridiano.example"}', gen_random_uuid());
  cp_alfa := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Alfa Tecnologia Ltda","document_number":"11.222.333/0001-81","email":"comercial@alfa.example","phone":"(11) 4000-0001","address":"Av. Exemplo, 100, São Paulo/SP"}', gen_random_uuid());
  cp_beta := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Beta Suprimentos S.A.","document_number":"45.723.174/0001-10","email":"vendas@beta.example"}', gen_random_uuid());
  cp_gama := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Gama Software Ltda","email":"contato@gama.example"}', gen_random_uuid());
  cp_beatriz := public.ct_save_counterparty(org, null, null, '{"person_type":"person","name":"Beatriz Souza (consultora)","document_number":"529.982.247-25","email":"beatriz@exemplo.example"}', gen_random_uuid());
  cp_delta := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Delta Serviços Gerais Ltda","email":"adm@delta.example"}', gen_random_uuid());

  -- 1) Manutenção de TI: vigente, perto do fim, aviso em 15 dias, reajuste pronto para simular (simulação em aberto)
  c1 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Manutenção e suporte de TI', 'description', 'Suporte mensal à infraestrutura e ao parque de computadores.', 'category_id', cat_ti,
    'start_date', pg_temp.d(-320), 'end_date', pg_temp.d(45), 'notice_days', 30, 'renewal_mode', 'manual', 'responsible_user_id', pg_temp.u('ana@demo.exemplo'),
    'parties', jsonb_build_array(pg_temp.party(cp_alfa, 'Contratada'), pg_temp.party(cp_self, 'Contratante')),
    'access', jsonb_build_array(pg_temp.acc('ana@demo.exemplo', 'editor'), pg_temp.acc('carla@demo.exemplo', 'reader'), pg_temp.acc('leitor@demo.exemplo', 'reader')),
    'value', jsonb_build_object('amount_cents', 350000, 'billing_basis', 'monthly'), 'adjustment_rule', jsonb_build_object('frequency_months', 12, 'next_adjustment_date', pg_temp.d(-5), 'reference_label', 'IPCA'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c1, pg_temp.cv(c1));
  perform public.ct_simulate_adjustment(org, c1, pg_temp.d(0)::date, 5.2, 'IPCA', '12 meses até o mês anterior', 'Percentual informado pela gestão (tabela oficial consultada manualmente)', null);

  -- 2) Fornecimento contínuo: prazo indeterminado, aviso com referência explícita, sem responsável
  c2 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Fornecimento contínuo de material de escritório', 'category_id', cat_forn, 'start_date', pg_temp.d(-150), 'indefinite_term', true,
    'notice_days', 60, 'notice_reference_date', pg_temp.d(120), 'parties', jsonb_build_array(pg_temp.party(cp_beta, 'Fornecedora'), pg_temp.party(cp_self, 'Contratante')),
    'access', jsonb_build_array(pg_temp.acc('carla@demo.exemplo', 'editor')), 'value', jsonb_build_object('amount_cents', 1800000, 'billing_basis', 'annual'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c2, pg_temp.cv(c2));

  -- 3) Licenciamento: ainda NÃO começou («A iniciar»)
  c3 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Licenciamento de software de gestão', 'category_id', cat_lic, 'start_date', pg_temp.d(10), 'end_date', pg_temp.d(375), 'notice_days', 45,
    'responsible_user_id', pg_temp.u('gestor@demo.exemplo'), 'parties', jsonb_build_array(pg_temp.party(cp_gama, 'Licenciante')), 'value', jsonb_build_object('amount_cents', 480000, 'billing_basis', 'annual'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c3, pg_temp.cv(c3));

  -- 4) Consultoria: prazo de AVISO ULTRAPASSADO (fim em 20 dias, aviso de 30), reajuste já aplicado no passado
  c4 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Consultoria em processos', 'category_id', cat_cons, 'start_date', pg_temp.d(-345), 'end_date', pg_temp.d(20), 'notice_days', 30, 'renewal_mode', 'manual',
    'responsible_user_id', pg_temp.u('gestor@demo.exemplo'), 'parties', jsonb_build_array(pg_temp.party(cp_beatriz, 'Consultora'), pg_temp.party(cp_self, 'Contratante')),
    'access', jsonb_build_array(pg_temp.acc('ana@demo.exemplo', 'editor')), 'value', jsonb_build_object('amount_cents', 120000, 'billing_basis', 'monthly'),
    'adjustment_rule', jsonb_build_object('frequency_months', 12, 'next_adjustment_date', pg_temp.d(-40), 'reference_label', 'INPC'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c4, pg_temp.cv(c4));
  s := public.ct_simulate_adjustment(org, c4, pg_temp.d(-40)::date, 4.5, 'INPC', '12 meses', 'Aplicado conforme cláusula de reajuste', null);
  perform public.ct_apply_adjustment(org, (s ->> 'id')::uuid);

  -- 5) Contrato RENOVADO (fim prorrogado) com aviso ajustado manualmente
  c5 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Limpeza e conservação predial', 'category_id', cat_forn, 'start_date', pg_temp.d(-200), 'end_date', pg_temp.d(5), 'notice_days', 20, 'renewal_mode', 'manual',
    'responsible_user_id', pg_temp.u('gestor@demo.exemplo'), 'parties', jsonb_build_array(pg_temp.party(cp_delta, 'Contratada'), pg_temp.party(cp_self, 'Contratante')), 'value', jsonb_build_object('amount_cents', 260000, 'billing_basis', 'monthly'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c5, pg_temp.cv(c5));
  perform public.ct_renew_contract(org, c5, pg_temp.cv(c5), (pg_temp.d(335))::date, false, null, 'Renovação por 12 meses, conforme cláusula 9 e aceite das partes');
  perform public.ct_set_notice(org, c5, pg_temp.cv(c5), jsonb_build_object('notice_days', 20, 'manual_deadline', pg_temp.d(300), 'justification', 'A cláusula conta 20 dias úteis, não corridos'));

  -- 6) Contrato RESCINDIDO (histórico preservado)
  c6 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Serviço de impressão gerenciada', 'category_id', cat_ti, 'start_date', pg_temp.d(-300), 'end_date', pg_temp.d(65),
    'parties', jsonb_build_array(pg_temp.party(cp_alfa, 'Contratada')), 'value', jsonb_build_object('amount_cents', 90000, 'billing_basis', 'monthly'))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c6, pg_temp.cv(c6));
  perform public.ct_terminate_contract(org, c6, pg_temp.cv(c6), pg_temp.d(-20)::date, 'Rescisão por acordo entre as partes após mudança de fornecedor');

  -- 7) Fim de vigência ATINGIDO, mas ainda ativo (o sistema só sinaliza)
  c7 := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Locação de equipamentos de som', 'category_id', cat_forn, 'start_date', pg_temp.d(-100), 'end_date', pg_temp.d(-3),
    'parties', jsonb_build_array(pg_temp.party(cp_delta, 'Locadora')))) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c7, pg_temp.cv(c7));

  -- 8) Rascunho ainda em elaboração (não ativado)
  perform public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato de patrocínio (em elaboração)', 'category_id', cat_cons, 'start_date', pg_temp.d(30), 'end_date', pg_temp.d(395),
    'parties', jsonb_build_array(pg_temp.party(cp_gama, 'Patrocinada'))));

  -- obrigações (pendentes, atrasada e concluída)
  perform pg_temp.as_user('ana@demo.exemplo');
  o := public.ct_save_obligation(org, c1, null, null, jsonb_build_object('title', 'Conferir o relatório mensal de chamados', 'responsible_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(4)));
  o := public.ct_save_obligation(org, c1, null, null, jsonb_build_object('title', 'Renovar o certificado digital da Alfa', 'responsible_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(-2)));
  o := public.ct_save_obligation(org, c4, null, null, jsonb_build_object('title', 'Receber o relatório final da consultoria', 'responsible_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(-12)));
  perform public.ct_complete_obligation(org, o, (select version from public.contract_obligations where id = o), 'Recebido por e-mail e arquivado');
  perform pg_temp.as_user('gestor@demo.exemplo');
  perform public.ct_save_obligation(org, c3, null, null, jsonb_build_object('title', 'Revisar a minuta antes do início da vigência', 'responsible_user_id', pg_temp.u('gestor@demo.exemplo'), 'due_date', pg_temp.d(6)));
  perform public.ct_run_reminders_now(org);
end $$;

commit;
