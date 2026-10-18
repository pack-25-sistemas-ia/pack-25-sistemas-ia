-- Ordens de Serviço — painel (definições e números), escopo do técnico, estado «Sem dados», documentos (snapshot da época, sem dados internos) e agenda (alerta de sobreposição).

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_m 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a1","aal":"aal1","email":"m@t.invalid"}'', true); set local role authenticated;'
\set as_t1 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a2","aal":"aal1","email":"t1@t.invalid"}'', true); set local role authenticated;'
\set as_t2 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000a3","aal":"aal1","email":"t2@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.ver(o uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.service_orders where id = o $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-0000000000a0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a1', 'm@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a2', 't1@t.invalid'), ('ffffffff-0000-4000-8000-0000000000a3', 't2@t.invalid');

:as_o
do $$
declare org uuid;
begin
  org := public.create_organization('Painel Teste', 'painel-teste');
  perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values
    (org, 'ffffffff-0000-4000-8000-0000000000a1', 'manager'), (org, 'ffffffff-0000-4000-8000-0000000000a2', 'member'), (org, 'ffffffff-0000-4000-8000-0000000000a3', 'member');
end $$;
reset role;

-- ===================================================================== (1) sem dados: nada de números fictícios
:as_m
do $$
declare org uuid := test.t('org'); d jsonb;
begin
  d := public.os_dashboard(org, current_date - 2, current_date + 2);
  assert (d ->> 'backlog')::int = 0 and (d ->> 'awaiting_acceptance')::int = 0 and (d #>> '{cycle,count}')::int = 0 and d #> '{cycle,avg_seconds}' = 'null'::jsonb and (d #>> '{approved_value,total_cents}')::bigint = 0 and d -> 'by_service' = '[]'::jsonb, 'sem dados: zeros e médias nulas (a interface mostra «Sem dados»)';
  assert d #>> '{period,timezone}' = 'America/Sao_Paulo', 'o painel informa o fuso';
  perform test.has(test.errmsg(format($q$select public.os_dashboard(%L, current_date - 400, current_date)$q$, org)), '%período inválido%', 'período máximo');
  perform test.has(test.errmsg(format($q$select public.os_dashboard(%L, current_date, current_date - 1)$q$, org)), '%período inválido%', 'período invertido');
  raise notice 'PASS: painel sem dados (1)';
end $$;
reset role;

-- ===================================================================== (2) cenário com todos os estados
:as_m
do $$
declare org uuid := test.t('org'); c uuid; sv uuid; o uuid; q uuid; v integer; n integer; ta text := 'ffffffff-0000-4000-8000-0000000000a2'; tb text := 'ffffffff-0000-4000-8000-0000000000a3';
  names text[] := array['fechada', 'aguardando', 'execucao', 'pausada', 'atrasada', 'aberta', 'cancelada', 'atribuida'];
  i integer; r jsonb;
begin
  c := public.os_save_customer(org, null, '{"name":"Cliente Painel"}'); perform set_config('t.c', c::text, true);
  sv := public.os_save_service(org, null, '{"name":"Manutenção preventiva","reference_price_cents":10000}'); perform set_config('t.sv', sv::text, true);
  for i in 1..8 loop
    r := public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', c, 'subject', 'Ordem ' || names[i], 'problem_description', 'Cenário do painel.',
      'technician_id', case when i in (1, 2, 3, 5) then ta when i in (4, 8) then tb end,
      'scheduled_start_at', case when i = 5 then (now() - interval '5 hours')::text end, 'scheduled_end_at', case when i = 5 then (now() - interval '3 hours')::text end));
    perform set_config('t.o' || i, r ->> 'id', true);
  end loop;
  -- fechada (1), aguardando (2), execução (3), pausada (4) precisam de orçamento aprovado (2 e 1 com valor)
  foreach n in array array[1, 2, 3, 4] loop
    o := test.t('o' || n);
    q := public.os_quote_new_draft(org, o); select version into v from public.quote_versions where id = q;
    perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 5)::text, 'items', jsonb_build_array(
      jsonb_build_object('kind', 'service', 'service_id', sv, 'description', 'Manutenção preventiva', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 10000 * n))));
    select version into v from public.quote_versions where id = q;
    perform public.os_quote_publish(org, q, v);
    perform public.os_quote_decide_manual(org, q, 'approved', 'Cliente Painel', 'Aprovado em conversa registrada.', null, null);
    perform public.os_start(org, o, test.ver(o));
  end loop;
  -- pausada (4)
  perform public.os_pause(org, test.t('o4'), test.ver(test.t('o4')), 'Aguardando peça');
  -- fechada (1) e aguardando (2): concluir; 1 recebe aceite e é encerrada
  perform public.os_complete(org, test.t('o1'), test.ver(test.t('o1')), 'Serviço concluído sem intercorrências.', null);
  perform public.os_complete(org, test.t('o2'), test.ver(test.t('o2')), 'Serviço concluído, aguardando o cliente.', null);
  perform public.os_completion_decide_manual(org, test.t('o1'), test.ver(test.t('o1')), 'accepted', 'Cliente Painel', 'Aceitou presencialmente.', null);
  perform public.os_close(org, test.t('o1'), test.ver(test.t('o1')));
  -- cancelada (7)
  perform public.os_cancel(org, test.t('o7'), test.ver(test.t('o7')), 'Cliente cancelou o pedido');
  raise notice 'PASS: cenário montado (2)';
end $$;
reset role;

:as_m
do $$
declare org uuid := test.t('org'); d jsonb;
begin
  d := public.os_dashboard(org, current_date - 2, current_date + 2);
  -- estados: 1 fechada, 2 concluída, 3 em execução, 4 pausada, 5 agendada(atrasada), 6 aberta, 7 cancelada, 8 aberta com técnico
  assert (d -> 'by_status' ->> 'closed')::int = 1 and (d -> 'by_status' ->> 'completed')::int = 1 and (d -> 'by_status' ->> 'in_progress')::int = 1 and (d -> 'by_status' ->> 'paused')::int = 1
     and (d -> 'by_status' ->> 'scheduled')::int = 1 and (d -> 'by_status' ->> 'open')::int = 2 and (d -> 'by_status' ->> 'cancelled')::int = 1, 'distribuição por estado: ' || (d -> 'by_status')::text;
  assert (d ->> 'backlog')::int = 5, 'backlog = aberta(2) + agendada(1) + em execução(1) + pausada(1) = 5';
  assert (d ->> 'open')::int = 2 and (d ->> 'scheduled')::int = 1 and (d ->> 'in_progress')::int = 1 and (d ->> 'paused')::int = 1, 'indicadores por estado';
  assert (d ->> 'awaiting_acceptance')::int = 1, 'concluídas aguardando aceite da versão atual';
  assert (d ->> 'closed_in_period')::int = 1 and (d ->> 'cancelled_in_period')::int = 1, 'encerradas e canceladas no período';
  assert (d ->> 'unassigned')::int = 1, 'não atribuídas no backlog (somente a ordem 6)';
  assert (d ->> 'late')::int = 1, 'atrasada = janela planejada já terminou e não concluída';
  assert (d ->> 'opened_in_period')::int = 8 and (d ->> 'completed_in_period')::int = 2, 'abertas e concluídas no período';
  assert (d #>> '{cycle,count}')::int = 2 and (d #>> '{cycle,avg_seconds}')::numeric >= 0 and d #>> '{cycle,basis}' like 'tempo corrido%', 'tempo de ciclo identificado como tempo corrido';
  assert (d #>> '{approved_value,count}')::int = 4 and (d #>> '{approved_value,total_cents}')::bigint = 10000 + 20000 + 30000 + 40000 and d #>> '{approved_value,basis}' like '%não é receita%', 'valor aprovado ≠ faturamento: ' || (d -> 'approved_value')::text;
  assert (select (x ->> 'orders')::int from jsonb_array_elements(d -> 'by_service') x where x ->> 'service' = 'Manutenção preventiva') = 4, 'distribuição por serviço usa o orçamento efetivo';
  assert (select (x ->> 'backlog')::int from jsonb_array_elements(d -> 'by_technician') x where (x ->> 'user_id')::uuid = 'ffffffff-0000-4000-8000-0000000000a2') = 2, 'técnico A: backlog 2 (em execução + agendada atrasada)';
  raise notice 'PASS: indicadores do painel (2)';
end $$;
reset role;

-- fora do período, nada é contado como «no período»
:as_m
do $$
declare org uuid := test.t('org'); d jsonb;
begin
  d := public.os_dashboard(org, current_date - 60, current_date - 30);
  assert (d ->> 'closed_in_period')::int = 0 and (d ->> 'opened_in_period')::int = 0 and (d #>> '{cycle,count}')::int = 0 and (d #>> '{approved_value,total_cents}')::bigint = 0 and (d ->> 'backlog')::int = 5, 'período passado: sem encerradas/aprovações; backlog é foto do momento';
  raise notice 'PASS: filtro de período (2)';
end $$;
reset role;

-- ===================================================================== (2b) bordas dos indicadores: atraso só no backlog, aceite da versão ATUAL, última versão aprovada, tempo de ciclo e fuso da empresa
:as_m
do $$
declare org uuid := test.t('org'); o uuid; q uuid; v integer; ta text := 'ffffffff-0000-4000-8000-0000000000a2'; cv integer;
begin
  o := (public.os_open_order(org, gen_random_uuid(), jsonb_build_object('customer_id', test.t('c'), 'subject', 'Ordem retrabalhada', 'problem_description', 'Concluída com janela já vencida.', 'technician_id', ta,
    'scheduled_start_at', (now() - interval '5 hours')::text, 'scheduled_end_at', (now() - interval '3 hours')::text)) ->> 'id')::uuid;
  perform set_config('t.o9', o::text, true);
  q := public.os_quote_new_draft(org, o); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 5)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'service_id', test.t('sv'), 'description', 'Manutenção preventiva', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 5000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform public.os_quote_decide_manual(org, q, 'approved', 'Cliente Painel', 'Aprovado em conversa registrada.', null, null);
  q := public.os_quote_new_draft(org, o); select version into v from public.quote_versions where id = q;
  perform public.os_quote_save_draft(org, q, v, jsonb_build_object('valid_date', (current_date + 5)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'service_id', test.t('sv'), 'description', 'Manutenção preventiva', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 7000))));
  select version into v from public.quote_versions where id = q;
  perform public.os_quote_publish(org, q, v);
  perform public.os_quote_decide_manual(org, q, 'approved', 'Cliente Painel', 'Aprovou o ajuste de preço.', null, null);
  perform public.os_start(org, o, test.ver(o));
  perform public.os_complete(org, o, test.ver(o), 'Primeira conclusão do serviço.', null);
  perform public.os_completion_decide_manual(org, o, test.ver(o), 'accepted', 'Cliente Painel', 'Aceitou presencialmente.', null);
  perform public.os_reopen(org, o, test.ver(o), 'Cliente pediu um ajuste após o aceite.', null);
  perform public.os_complete(org, o, test.ver(o), 'Segunda conclusão com o ajuste feito.', null);
  select completion_version into cv from public.service_orders where id = o;
  assert cv = 2, 'ordem na conclusão 2';
end $$;
reset role;
:as_m
do $$
declare org uuid := test.t('org'); d jsonb; expected double precision; tz text; ld date; n bigint;
begin
  d := public.os_dashboard(org, current_date - 2, current_date + 2);
  assert (d ->> 'late')::int = 1, 'ordem concluída com janela vencida NÃO é atrasada (só o backlog conta)';
  assert (d ->> 'awaiting_acceptance')::int = 2, 'o aceite da conclusão 1 não vale para a conclusão 2: continua aguardando aceite';
  assert (d #>> '{approved_value,count}')::int = 5 and (d #>> '{approved_value,total_cents}')::bigint = 10000 + 20000 + 30000 + 40000 + 7000, 'vale a ÚLTIMA versão aprovada de cada ordem: ' || (d -> 'approved_value')::text;
  select avg(extract(epoch from (completed_at - created_at))) into expected from public.service_orders
    where organization_id = org and execution_status in ('completed', 'closed')
      and completed_at >= (current_date - 2)::timestamp at time zone 'America/Sao_Paulo' and completed_at < (current_date + 3)::timestamp at time zone 'America/Sao_Paulo';
  assert (d #>> '{cycle,count}')::int = 3 and abs((d #>> '{cycle,avg_seconds}')::double precision - expected) < 0.000001, 'ciclo = da abertura à conclusão: ' || (d -> 'cycle')::text || ' esperado ' || expected;
  -- o período é contado no fuso da empresa (dois fusos extremos: em qualquer hora do dia, ao menos um difere da data UTC)
  foreach tz in array array['Pacific/Kiritimati', 'Etc/GMT+12'] loop
    perform test.sql(format($q$update public.os_settings set timezone = %L where organization_id = '%s'$q$, tz, org));
    ld := (now() at time zone tz)::date;
    d := public.os_dashboard(org, ld, ld);
    select count(*) into n from public.service_orders where organization_id = org;
    assert (d ->> 'opened_in_period')::bigint = n, 'período no fuso da empresa (' || tz || '): ' || (d ->> 'opened_in_period');
  end loop;
  perform test.sql(format($q$update public.os_settings set timezone = 'America/Sao_Paulo' where organization_id = '%s'$q$, org));
  raise notice 'PASS: bordas dos indicadores do painel (2b)';
end $$;
reset role;

-- ===================================================================== (3) o técnico enxerga só o próprio recorte e nenhum valor comercial
:as_t1
do $$
declare org uuid := test.t('org'); d jsonb;
begin
  d := public.os_dashboard(org, current_date - 2, current_date + 2);
  assert d ->> 'profile' = 'technician' and (d ->> 'backlog')::int = 2 and d -> 'approved_value' = 'null'::jsonb, 'técnico: só as dele e sem valor aprovado';
  assert jsonb_array_length(d -> 'by_technician') = 1, 'técnico só se vê';
  raise notice 'PASS: painel do técnico (3)';
end $$;
reset role;

-- ===================================================================== (4) documentos: snapshot da época e nenhum dado interno
:as_m
do $$
declare org uuid := test.t('org'); o uuid := test.t('o3'); doc jsonb; txt text; v integer;
begin
  perform public.os_add_update(org, o, gen_random_uuid(), 'internal', 'NOTA-INTERNA-NO-DOCUMENTO', null);
  perform public.os_add_cost(org, o, gen_random_uuid(), '{"category":"other","description":"CUSTO-NO-DOCUMENTO","amount_cents":500}');
  perform public.os_save_customer(org, test.t('c'), '{"name":"Cliente Painel Renomeado","document":"52998224725","internal_notes":"NOTA-CLIENTE-NO-DOCUMENTO"}');
  v := test.ver(o);
  perform public.os_update_snapshot(org, o, v, '{"reason":"Cadastro do cliente foi renomeado"}');
  doc := public.os_document(org, o, 'quote', 1);
  txt := doc::text;
  assert doc #>> '{customer,name}' = 'Cliente Painel' and (doc #>> '{customer,snapshot_version}') = '1', 'o PDF do orçamento usa o snapshot da época da publicação, não o cadastro atual';
  assert doc #>> '{quote,decision,channel}' = 'staff_manual' and doc #>> '{quote,decision,accepted_text}' like 'Registro manual pela equipe%', 'aceite manual aparece como tal no documento';
  doc := public.os_document(org, o, 'summary', 0);
  assert doc #>> '{customer,name}' = 'Cliente Painel Renomeado', 'o resumo usa o snapshot atual (após atualização explícita)';
  txt := doc::text || txt;
  assert txt not like '%NOTA-INTERNA-NO-DOCUMENTO%' and txt not like '%CUSTO-NO-DOCUMENTO%' and txt not like '%NOTA-CLIENTE-NO-DOCUMENTO%' and txt not like '%52998224725%', 'documentos nunca trazem nota interna, custo nem CPF/CNPJ';
  perform test.has(test.errmsg(format($q$select public.os_document(%L, %L, 'quote', 9)$q$, org, o)), '%Documento não encontrado%', 'versão inexistente');
  perform test.has(test.errmsg(format($q$select public.os_document(%L, %L, 'carta', 1)$q$, org, o)), '%tipo de documento inválido%', 'tipo inválido');
  doc := public.os_document(org, test.t('o1'), 'completion', 1);
  assert doc #>> '{completion,acceptance,decision}' = 'accepted' and doc #>> '{completion,summary}' = 'Serviço concluído sem intercorrências.' and (doc #>> '{completion,current}')::boolean, 'relatório de conclusão com o aceite da versão';
  raise notice 'PASS: documentos com snapshot e sem dados internos (4)';
end $$;
reset role;

-- rascunho nunca vira documento
:as_m
do $$
declare org uuid := test.t('org'); o uuid := test.t('o6'); q uuid;
begin
  q := public.os_quote_new_draft(org, o);
  perform test.has(test.errmsg(format($q$select public.os_document(%L, %L, 'quote', 1)$q$, org, o)), '%Documento não encontrado%', 'rascunho não gera documento');
  raise notice 'PASS: rascunho não gera documento (4)';
end $$;
reset role;

-- ===================================================================== (5) agenda: alerta de sobreposição, nunca bloqueio
:as_m
do $$
declare org uuid := test.t('org'); o uuid := test.t('o8'); r jsonb; s timestamptz := date_trunc('hour', now()) + interval '3 days'; v integer;
begin
  r := public.os_schedule(org, o, test.ver(o), 'ffffffff-0000-4000-8000-0000000000a3', s, s + interval '2 hours');
  assert jsonb_array_length(r -> 'conflicts') = 0 and (select execution_status from public.service_orders where id = o) = 'scheduled', 'agenda sem sobreposição';
  r := public.os_schedule(org, test.t('o6'), test.ver(test.t('o6')), 'ffffffff-0000-4000-8000-0000000000a3', s + interval '1 hour', s + interval '3 hours');
  assert jsonb_array_length(r -> 'conflicts') = 1 and (r -> 'conflicts' -> 0 ->> 'id')::uuid = o, 'sobreposição do mesmo técnico é ALERTA e a ordem fica agendada mesmo assim';
  assert (select execution_status from public.service_orders where id = test.t('o6')) = 'scheduled', 'não bloqueia';
  assert jsonb_array_length(public.os_schedule_conflicts(org, 'ffffffff-0000-4000-8000-0000000000a3', s, s + interval '30 minutes', null)) = 1, 'consulta de conflitos antes de agendar';
  perform test.has(test.errmsg(format($q$select public.os_schedule(%L, %L, %s, 'ffffffff-0000-4000-8000-0000000000a3', now(), now() + interval '20 days')$q$, org, o, test.ver(o))), '%no máximo 14 dias%', 'janela máxima');
  perform test.has(test.errmsg(format($q$select public.os_schedule(%L, %L, %s, null, now(), now() + interval '1 hour')$q$, org, o, test.ver(o))), '%escolha o técnico%', 'agendar exige técnico');
  v := public.os_unschedule(org, o, test.ver(o));
  assert (select execution_status from public.service_orders where id = o) = 'open' and (select scheduled_start_at from public.service_orders where id = o) is null and (select assigned_technician_user_id from public.service_orders where id = o) is not null, 'desagendar volta a aberta, mantém o técnico';
  raise notice 'PASS: agenda com alerta de sobreposição (5)';
end $$;
reset role;

rollback;
