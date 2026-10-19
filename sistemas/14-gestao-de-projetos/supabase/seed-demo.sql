-- DEMONSTRAÇÃO «Agência Prisma» — dados 100% fictícios, determinísticos e RELATIVOS à data de execução (nenhuma data de tarefa fica «no passado impossível»; nada no futuro).
-- Aplicado por `node scripts/seed-demo.mjs` (senha aleatória gerada na hora e exibida só no seu terminal; nenhuma credencial fixa é publicada).
-- Somente para uso LOCAL. NUNCA aplique em produção. Variável psql: pw (senha dos usuários @demo.exemplo).
-- Usuários: dono (proprietário), gestor, ana/bruno/carla/diego (colaboradores) e leitor (Leitor da empresa) @demo.exemplo. O proprietário cadastra o 2º fator (TOTP) no primeiro acesso.
-- Tudo é criado pelas MESMAS funções pj_* que o aplicativo usa (com a identidade de cada pessoa), então regras, histórico e notificações são reais.
-- Não há anexos na demonstração (arquivos precisam existir no Storage): envie pelo próprio sistema.

select set_config('demo.pw', :'pw', false);
select set_config('request.jwt.claims', '', false);
begin;

do $$
declare pw text := extensions.crypt(current_setting('demo.pw'), extensions.gen_salt('bf'));
begin
  if exists (select 1 from public.organizations where slug = 'agencia-prisma') then raise exception 'a demonstração já existe neste banco (rode supabase db reset antes)'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', e.email, pw, now(), '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', e.nome), now(), now(), '', '', '', ''
  from (values ('dono@demo.exemplo', 'Helena Costa'), ('gestor@demo.exemplo', 'Marcos Almeida'), ('ana@demo.exemplo', 'Ana Ribeiro'), ('bruno@demo.exemplo', 'Bruno Tavares'),
    ('carla@demo.exemplo', 'Carla Nogueira'), ('diego@demo.exemplo', 'Diego Ferraz'), ('leitor@demo.exemplo', 'Eduardo Leitor')) as e(email, nome);
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.email, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now() from auth.users u where u.email like '%@demo.exemplo';
  update public.profiles p set full_name = u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p.id and u.email like '%@demo.exemplo';
end $$;

-- empresa e papéis (a partir daqui o proprietário «assina» como AAL2, como faria no app depois de cadastrar o 2º fator)
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = 'dono@demo.exemplo'), 'aal', 'aal2', 'role', 'authenticated')::text, false);
select public.create_organization('Agência Prisma (demonstração)', 'agencia-prisma') as org \gset
insert into public.organization_members (organization_id, user_id, role)
select :'org', u.id, case when u.email = 'gestor@demo.exemplo' then 'manager'::public.org_role when u.email = 'leitor@demo.exemplo' then 'viewer'::public.org_role else 'member'::public.org_role end
from auth.users u where u.email like '%@demo.exemplo' and u.email <> 'dono@demo.exemplo';
select set_config('demo.org', :'org', false);
select public.pj_save_settings(:'org', '{"primary_color":"#0f766e","project_prefix":"PRJ","retention_policy_text":"DEMONSTRAÇÃO: dados fictícios, sem prazo de retenção definido."}'::jsonb);
update public.organization_settings set display_name = 'Agência Prisma (demonstração)', theme = jsonb_build_object('primary', '#0f766e') where organization_id = :'org';

-- ===================================================================== projetos, pessoas e tarefas (sempre com a identidade de quem faria a ação)
create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users where email = p_email), 'aal', case when p_email = 'dono@demo.exemplo' then 'aal2' else 'aal1' end, 'role', 'authenticated')::text, false);
end $$;
create function pg_temp.u(p_email text) returns uuid language sql stable as $$ select id from auth.users where email = p_email $$;
create function pg_temp.d(n integer) returns text language sql stable as $$ select to_char((now() at time zone 'America/Sao_Paulo')::date + n, 'YYYY-MM-DD') $$;
create function pg_temp.col(p uuid, sem text) returns uuid language sql stable as $$ select id from public.project_columns where project_id = p and semantic_status = sem order by position limit 1 $$;
create function pg_temp.pv(p uuid) returns integer language sql stable as $$ select version from public.projects where id = p $$;
create function pg_temp.tv(t uuid) returns integer language sql stable as $$ select version from public.tasks where id = t $$;
create function pg_temp.mem(p_email text, p_role text) returns jsonb language sql stable as $$ select jsonb_build_object('user_id', pg_temp.u(p_email), 'role', p_role) $$;
create function pg_temp.task(p_org uuid, p_project uuid, p jsonb) returns uuid language plpgsql as $$
begin return (public.pj_create_task(p_org, p_project, gen_random_uuid(), p) ->> 'id')::uuid; end $$;
create function pg_temp.mv(p_org uuid, t uuid, sem text) returns void language plpgsql as $$
declare pid uuid := (select project_id from public.tasks where id = t);
begin perform public.pj_move_task(p_org, t, pg_temp.col(pid, sem), null, null); end $$;

do $$
declare org uuid := current_setting('demo.org')::uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; l_design uuid; l_cont uuid; l_dev uuid; l_midia uuid; l_criativo uuid; t uuid; it uuid;
begin
  perform pg_temp.as_user('gestor@demo.exemplo');
  p1 := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Site institucional Prisma', 'description', 'Redesenho completo do site da agência: estrutura, design, conteúdo e publicação.', 'status', 'active',
    'start_date', pg_temp.d(-30), 'due_date', pg_temp.d(60), 'members', jsonb_build_array(pg_temp.mem('carla@demo.exemplo', 'lead'), pg_temp.mem('ana@demo.exemplo', 'editor'), pg_temp.mem('bruno@demo.exemplo', 'editor'),
      pg_temp.mem('diego@demo.exemplo', 'editor'), pg_temp.mem('leitor@demo.exemplo', 'reader')))) ->> 'id')::uuid;
  p2 := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Campanha de lançamento — Verão', 'description', 'Campanha integrada para o lançamento da coleção de verão do cliente.', 'status', 'active',
    'start_date', pg_temp.d(-10), 'due_date', pg_temp.d(45), 'members', jsonb_build_array(pg_temp.mem('ana@demo.exemplo', 'lead'), pg_temp.mem('bruno@demo.exemplo', 'editor'), pg_temp.mem('diego@demo.exemplo', 'editor'),
      pg_temp.mem('leitor@demo.exemplo', 'reader')))) ->> 'id')::uuid;
  p3 := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Relatório trimestral de clientes', 'description', 'Planejamento do relatório do próximo trimestre (ainda em preparação).', 'status', 'planned',
    'start_date', pg_temp.d(7), 'due_date', pg_temp.d(40), 'members', jsonb_build_array(pg_temp.mem('carla@demo.exemplo', 'lead'), pg_temp.mem('ana@demo.exemplo', 'editor')))) ->> 'id')::uuid;
  p4 := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Rebranding — Cliente Horizonte', 'description', 'Nova identidade visual entregue e aprovada.', 'status', 'active',
    'start_date', pg_temp.d(-50), 'due_date', pg_temp.d(-5), 'members', jsonb_build_array(pg_temp.mem('carla@demo.exemplo', 'lead'), pg_temp.mem('bruno@demo.exemplo', 'editor')))) ->> 'id')::uuid;
  p5 := (public.pj_create_project(org, gen_random_uuid(), jsonb_build_object('name', 'Migração do blog antigo', 'description', 'Cancelado: o cliente decidiu manter a plataforma atual.', 'status', 'active',
    'start_date', pg_temp.d(-40), 'due_date', pg_temp.d(-10), 'members', jsonb_build_array(pg_temp.mem('diego@demo.exemplo', 'lead')))) ->> 'id')::uuid;

  -- ---------------------------------------------------------------- Projeto 1 — Site institucional (liderado por Carla)
  perform pg_temp.as_user('carla@demo.exemplo');
  l_design := public.pj_save_label(org, p1, null, 'Design', '#2563eb'); l_cont := public.pj_save_label(org, p1, null, 'Conteúdo', '#16a34a'); l_dev := public.pj_save_label(org, p1, null, 'Desenvolvimento', '#9333ea');
  t := pg_temp.task(org, p1, jsonb_build_object('title', 'Mapa do site', 'description', 'Árvore de páginas e navegação aprovadas.', 'priority', 'normal', 'assignee_user_id', pg_temp.u('bruno@demo.exemplo'), 'due_date', pg_temp.d(-10), 'label_ids', jsonb_build_array(l_cont),
    'checklist', jsonb_build_array(jsonb_build_object('title', 'Aprovar com o cliente', 'required', true))));
  perform pg_temp.as_user('bruno@demo.exemplo');
  select id into it from public.task_checklist_items where task_id = t and required; perform public.pj_toggle_checklist_item(org, it, true); perform pg_temp.mv(org, t, 'done');
  perform public.pj_add_comment(org, t, gen_random_uuid(), 'Mapa aprovado pelo cliente. Segue para os **wireframes**.');

  perform pg_temp.as_user('carla@demo.exemplo');
  t := pg_temp.task(org, p1, jsonb_build_object('title', 'Wireframes da home', 'description', 'Primeira versão navegável da página inicial.', 'priority', 'high', 'assignee_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(-2),
    'label_ids', jsonb_build_array(l_design), 'checklist', jsonb_build_array(jsonb_build_object('title', 'Revisar com o cliente', 'required', true), jsonb_build_object('title', 'Exportar PDF', 'required', false))));
  perform pg_temp.as_user('ana@demo.exemplo'); perform pg_temp.mv(org, t, 'in_progress');
  perform public.pj_add_comment(org, t, gen_random_uuid(), E'Primeira rodada pronta. Pendências:\n- ajustar o **menu**\n- revisar o rodapé');
  perform pg_temp.as_user('carla@demo.exemplo'); perform public.pj_add_comment(org, t, gen_random_uuid(), 'Obrigada, Ana. Vamos revisar com o cliente amanhã.');

  t := pg_temp.task(org, p1, jsonb_build_object('title', 'Design da home', 'priority', 'urgent', 'assignee_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(3), 'label_ids', jsonb_build_array(l_design),
    'checklist', jsonb_build_array(jsonb_build_object('title', 'Versão mobile', 'required', true))));
  perform pg_temp.as_user('ana@demo.exemplo'); perform pg_temp.mv(org, t, 'in_progress'); perform pg_temp.mv(org, t, 'review');

  perform pg_temp.as_user('carla@demo.exemplo');
  perform pg_temp.task(org, p1, jsonb_build_object('title', 'Textos da página Sobre', 'priority', 'normal', 'assignee_user_id', pg_temp.u('bruno@demo.exemplo'), 'due_date', pg_temp.d(5), 'label_ids', jsonb_build_array(l_cont)));
  t := pg_temp.task(org, p1, jsonb_build_object('title', 'Formulário de contato', 'description', 'Formulário com validação e envio por e-mail.', 'priority', 'high', 'assignee_user_id', pg_temp.u('diego@demo.exemplo'), 'due_date', pg_temp.d(-1), 'label_ids', jsonb_build_array(l_dev)));
  perform pg_temp.as_user('diego@demo.exemplo'); perform pg_temp.mv(org, t, 'in_progress');
  perform public.pj_set_blocked(org, t, pg_temp.tv(t), 'Aguardando as credenciais do servidor de e-mail do cliente');
  perform public.pj_add_comment(org, t, gen_random_uuid(), 'Cobrei as credenciais do cliente de novo. Sem elas não consigo testar o envio.');
  perform pg_temp.as_user('carla@demo.exemplo');
  perform pg_temp.task(org, p1, jsonb_build_object('title', 'Banco de imagens', 'priority', 'low'));
  perform pg_temp.task(org, p1, jsonb_build_object('title', 'Política de privacidade', 'priority', 'normal', 'assignee_user_id', pg_temp.u('carla@demo.exemplo'), 'due_date', pg_temp.d(14),
    'checklist', jsonb_build_array(jsonb_build_object('title', 'Texto revisado pelo jurídico do cliente', 'required', true), jsonb_build_object('title', 'Publicar no rodapé', 'required', false))));
  t := pg_temp.task(org, p1, jsonb_build_object('title', 'Configurar hospedagem', 'priority', 'high', 'assignee_user_id', pg_temp.u('diego@demo.exemplo'), 'due_date', pg_temp.d(0), 'label_ids', jsonb_build_array(l_dev)));
  perform pg_temp.as_user('diego@demo.exemplo'); perform pg_temp.mv(org, t, 'in_progress');
  perform pg_temp.as_user('carla@demo.exemplo');
  perform pg_temp.task(org, p1, jsonb_build_object('title', 'Revisão de acessibilidade', 'priority', 'normal', 'assignee_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(20)));
  perform pg_temp.task(org, p1, jsonb_build_object('title', 'SEO básico', 'priority', 'low', 'assignee_user_id', pg_temp.u('bruno@demo.exemplo')));
  t := pg_temp.task(org, p1, jsonb_build_object('title', 'Ideia descartada: animação de abertura', 'priority', 'low'));
  perform public.pj_archive_task(org, t, pg_temp.tv(t), 'Fora do escopo acordado com o cliente');

  -- ---------------------------------------------------------------- Projeto 2 — Campanha (liderada por Ana)
  perform pg_temp.as_user('ana@demo.exemplo');
  l_midia := public.pj_save_label(org, p2, null, 'Mídia paga', '#ea580c'); l_criativo := public.pj_save_label(org, p2, null, 'Criativo', '#db2777');
  t := pg_temp.task(org, p2, jsonb_build_object('title', 'Briefing da campanha', 'priority', 'high', 'assignee_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(-8)));
  perform pg_temp.mv(org, t, 'in_progress'); perform pg_temp.mv(org, t, 'done');
  t := pg_temp.task(org, p2, jsonb_build_object('title', 'Roteiro do vídeo', 'priority', 'high', 'assignee_user_id', pg_temp.u('bruno@demo.exemplo'), 'due_date', pg_temp.d(2), 'label_ids', jsonb_build_array(l_criativo)));
  perform pg_temp.as_user('bruno@demo.exemplo'); perform pg_temp.mv(org, t, 'in_progress');
  perform public.pj_add_comment(org, t, gen_random_uuid(), 'Roteiro v1 no ar. Preciso do **briefing de tom de voz** para fechar a v2.');
  perform pg_temp.as_user('ana@demo.exemplo');
  perform pg_temp.task(org, p2, jsonb_build_object('title', 'Peças para redes sociais', 'priority', 'normal', 'assignee_user_id', pg_temp.u('diego@demo.exemplo'), 'due_date', pg_temp.d(7), 'label_ids', jsonb_build_array(l_criativo),
    'checklist', jsonb_build_array(jsonb_build_object('title', 'Formato feed', 'required', true), jsonb_build_object('title', 'Formato stories', 'required', true))));
  t := pg_temp.task(org, p2, jsonb_build_object('title', 'Orçamento de mídia', 'priority', 'urgent', 'assignee_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(-1), 'label_ids', jsonb_build_array(l_midia)));
  perform pg_temp.mv(org, t, 'in_progress'); perform pg_temp.mv(org, t, 'review');
  perform pg_temp.task(org, p2, jsonb_build_object('title', 'Landing page da campanha', 'priority', 'high', 'due_date', pg_temp.d(12), 'label_ids', jsonb_build_array(l_midia)));
  perform pg_temp.task(org, p2, jsonb_build_object('title', 'Relatório de resultados', 'priority', 'low'));

  -- ---------------------------------------------------------------- Projeto 3 — planejado (só preparação)
  perform pg_temp.as_user('carla@demo.exemplo');
  perform pg_temp.task(org, p3, jsonb_build_object('title', 'Definir indicadores do relatório', 'priority', 'normal', 'assignee_user_id', pg_temp.u('ana@demo.exemplo'), 'due_date', pg_temp.d(10)));
  perform pg_temp.task(org, p3, jsonb_build_object('title', 'Coletar dados dos clientes', 'priority', 'normal', 'due_date', pg_temp.d(20)));
  perform pg_temp.task(org, p3, jsonb_build_object('title', 'Modelo do documento', 'priority', 'low'));

  -- ---------------------------------------------------------------- Projeto 4 — concluído (todas as tarefas concluídas)
  perform pg_temp.as_user('carla@demo.exemplo');
  t := pg_temp.task(org, p4, jsonb_build_object('title', 'Logotipo e variações', 'priority', 'high', 'assignee_user_id', pg_temp.u('bruno@demo.exemplo'), 'due_date', pg_temp.d(-20)));
  perform pg_temp.mv(org, t, 'in_progress'); perform pg_temp.mv(org, t, 'done');
  t := pg_temp.task(org, p4, jsonb_build_object('title', 'Manual de marca', 'priority', 'normal', 'assignee_user_id', pg_temp.u('carla@demo.exemplo'), 'due_date', pg_temp.d(-8)));
  perform pg_temp.mv(org, t, 'in_progress'); perform pg_temp.mv(org, t, 'done');
  perform public.pj_add_comment(org, t, gen_random_uuid(), 'Manual entregue e aprovado. Projeto pronto para encerrar.');
  perform public.pj_set_project_status(org, p4, pg_temp.pv(p4), 'completed');

  -- ---------------------------------------------------------------- Projeto 5 — cancelado e arquivado
  perform pg_temp.as_user('diego@demo.exemplo');
  t := pg_temp.task(org, p5, jsonb_build_object('title', 'Levantamento de conteúdo do blog', 'priority', 'normal', 'assignee_user_id', pg_temp.u('diego@demo.exemplo'), 'due_date', pg_temp.d(-20)));
  perform pg_temp.mv(org, t, 'in_progress'); perform pg_temp.mv(org, t, 'done');
  t := pg_temp.task(org, p5, jsonb_build_object('title', 'Redirecionamentos 301', 'priority', 'low'));
  perform public.pj_set_project_status(org, p5, pg_temp.pv(p5), 'cancelled', 'Cliente decidiu manter a plataforma atual');
  perform public.pj_archive_project(org, p5, pg_temp.pv(p5), true, 'Projeto cancelado e arquivado');
end $$;

commit;
