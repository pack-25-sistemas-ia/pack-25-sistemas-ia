-- Gestão de Contratos — painel nas fronteiras (datas inclusivas: hoje, último dia, 30/60/90 dias, 365 dias) e registro das exportações.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'
\set as_ed 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000d1","aal":"aal1","email":"ed@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.errmsg(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlerrm; end $$;
create function test.has(msg text, pat text, label text) returns void language plpgsql as $$ begin if msg is null or msg not like pat then raise exception 'FALHOU: % — esperado %, veio %', label, pat, coalesce(msg, '(sem erro)'); end if; end $$;
create function test.t(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
create function test.derr(q text) returns text language plpgsql security definer set search_path = '' as $$ begin begin execute q; exception when others then return sqlerrm; end; return null; end $$;
create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.sql(q text) returns void language plpgsql security definer set search_path = '' as $$ begin execute q; end $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
create function test.today() returns date language sql security definer set search_path = '' as $$ select private.ct_today(current_setting('t.org')::uuid) $$;
-- contrato ativo: início/fim relativos a hoje, aviso opcional (dias) — o fim é a referência
create function test.mk(title text, ini integer, fim integer, aviso integer) returns uuid language plpgsql as $$
declare org uuid := current_setting('t.org')::uuid; t date := test.today(); c uuid; p jsonb;
begin
  p := jsonb_build_object('title', title, 'start_date', (t + ini)::text, 'end_date', (t + fim)::text, 'parties', jsonb_build_array(jsonb_build_object('counterparty_id', current_setting('t.cp')::uuid, 'role_description', 'Contratada')));
  if aviso is not null then p := p || jsonb_build_object('notice_days', aviso); end if;
  c := (public.ct_create_contract(org, gen_random_uuid(), p) ->> 'id')::uuid;
  perform public.ct_activate_contract(org, c, test.cv(c));
  return c;
end $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000d0', 'o@t.invalid'), ('ffffffff-0000-4000-8000-0000000000d1', 'ed@t.invalid');

:as_o
do $$
declare org uuid; cp uuid;
begin
  org := public.create_organization('Empresa Painel', 'empresa-painel'); perform set_config('t.org', org::text, true);
  insert into public.organization_members (organization_id, user_id, role) values (org, 'ffffffff-0000-4000-8000-0000000000d1', 'member');
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte do Painel"}', gen_random_uuid());
  perform set_config('t.cp', cp::text, true);
  raise notice 'PASS: preparação (1)';
end $$;

-- ===================================================================== (2) contratos nas fronteiras
do $$
declare org uuid := test.t('org'); t date := test.today(); d jsonb;
  etoday uuid; e30 uuid; e31 uuid; e60 uuid; e61 uuid; e90 uuid; e91 uuid; eyest uuid; n30 uuid; n31 uuid; nyest uuid; ntoday uuid; rn1 uuid; rn2 uuid; o1 uuid; o2 uuid; o3 uuid;
begin
  etoday := test.mk('Fim hoje', -400, 0, null);
  e30 := test.mk('Fim em 30', -400, 30, null);
  e31 := test.mk('Fim em 31', -400, 31, null);
  e60 := test.mk('Fim em 60', -400, 60, null);
  e61 := test.mk('Fim em 61', -400, 61, null);
  e90 := test.mk('Fim em 90', -400, 90, null);
  e91 := test.mk('Fim em 91', -400, 91, null);
  eyest := test.mk('Fim ontem', -400, -1, 5);          -- aviso em hoje-6, mas o contrato já terminou: não conta como aviso vencido
  perform test.mk('Começa hoje', 0, 300, null);
  perform test.mk('Começa amanhã', 1, 300, null);
  n30 := test.mk('Aviso em 30', -100, 130, 100);        -- aviso em hoje+30
  n31 := test.mk('Aviso em 31', -100, 131, 100);        -- aviso em hoje+31
  nyest := test.mk('Aviso ontem', -100, 99, 100);       -- aviso em hoje-1
  ntoday := test.mk('Aviso hoje', -100, 100, 100);      -- aviso em hoje
  rn1 := test.mk('Renovado há 365 dias', -400, 500, null);
  rn2 := test.mk('Renovado há 364 dias', -400, 500, null);
  -- obrigações: uma vence hoje, uma venceu ontem, uma concluída
  o1 := public.ct_save_obligation(org, etoday, null, null, jsonb_build_object('title', 'Vence hoje', 'due_date', t::text));
  o2 := public.ct_save_obligation(org, e30, null, null, jsonb_build_object('title', 'Venceu ontem', 'due_date', (t - 1)::text));
  o3 := public.ct_save_obligation(org, e31, null, null, jsonb_build_object('title', 'Já concluída', 'due_date', (t + 3)::text));
  perform public.ct_complete_obligation(org, o3, 1, 'feito');
  -- reajustes previstos: dentro de 60 dias, fora (61) e regra inativa
  perform public.ct_set_adjustment_rule(org, e91, 12, t + 60, 'IPCA', true);
  perform public.ct_set_adjustment_rule(org, e61, 12, t + 61, 'IPCA', true);
  perform public.ct_set_adjustment_rule(org, n31, 12, t + 10, 'IPCA', false);
  -- renovações: efeito há 365 dias (fora da janela) e há 364 (dentro)
  perform public.ct_renew_contract(org, rn1, test.cv(rn1), t + 600, false, t - 365, 'Renovação fora da janela de 12 meses', null);
  perform public.ct_renew_contract(org, rn2, test.cv(rn2), t + 600, false, t - 364, 'Renovação dentro da janela de 12 meses', null);

  d := public.ct_dashboard(org);
  assert (d ->> 'active')::int = 16, 'ativos: ' || (d ->> 'active');
  assert (d ->> 'valid_today')::int = 14, 'vigentes hoje (inclui quem começa hoje e quem termina hoje): ' || (d ->> 'valid_today');
  assert (d ->> 'ending_30')::int = 2, 'fim em até 30 dias (hoje e +30 incluídos, +31 fora): ' || (d ->> 'ending_30');
  assert (d ->> 'ending_60')::int = 4, 'fim em até 60 dias: ' || (d ->> 'ending_60');
  assert (d ->> 'ending_90')::int = 6, 'fim em até 90 dias: ' || (d ->> 'ending_90');
  assert (d ->> 'end_reached')::int = 1, 'fim atingido: só quem terminou ontem, não quem termina hoje: ' || (d ->> 'end_reached');
  assert (d ->> 'notice_soon')::int = 2, 'aviso em até 30 dias (hoje e +30): ' || (d ->> 'notice_soon');
  assert (d ->> 'notice_overdue')::int = 1, 'aviso vencido: só de contrato ainda vigente: ' || (d ->> 'notice_overdue');
  assert (d ->> 'obligations_pending')::int = 2, 'obrigações pendentes (a concluída não conta): ' || (d ->> 'obligations_pending');
  assert (d ->> 'obligations_overdue')::int = 1, 'obrigação atrasada: só a de ontem, não a de hoje: ' || (d ->> 'obligations_overdue');
  assert (d ->> 'adjustments_expected')::int = 1, 'reajustes previstos em até 60 dias (regra inativa e +61 fora): ' || (d ->> 'adjustments_expected');
  assert (d ->> 'renewals_12m')::int = 1, 'renovações dos últimos 12 meses (há 365 dias fica fora): ' || (d ->> 'renewals_12m');
  raise notice 'PASS: painel nas fronteiras (2)';
end $$;
reset role;

-- ===================================================================== (3) exportações: tipo, limite de chamadas e registro na auditoria
:as_ed
do $$
declare org uuid := test.t('org'); i int; blocked int := 0; n0 bigint;
begin
  perform test.has(test.errmsg(format($q$select public.ct_audit_export(%L, 'Tipo Inválido!', 3)$q$, org)), '%tipo de exportação inválido%', 'tipo de exportação inválido');
  perform test.has(test.errmsg(format($q$select public.ct_audit_export(%L, 'x', 3)$q$, org)), '%tipo de exportação inválido%', 'tipo curto demais');
  n0 := test.cnt(format($q$select count(*) from public.audit_log where organization_id = %L and action = 'export'$q$, org));
  perform public.ct_audit_export(org, 'contratos', 7);
  assert test.cnt(format($q$select count(*) from public.audit_log where organization_id = %L and action = 'export' and entity = 'export_contratos' and (changes ->> 'rows')::int = 7$q$, org)) = 1
    and test.cnt(format($q$select count(*) from public.audit_log where organization_id = %L and action = 'export'$q$, org)) = n0 + 1, 'a exportação fica na auditoria (tipo e quantidade)';
  for i in 1..35 loop
    begin
      perform public.ct_audit_export(org, 'contratos', 1);
    exception when sqlstate '54000' then blocked := blocked + 1;
    end;
  end loop;
  assert blocked = 6, format('limite de 30 exportações por 10 minutos (barradas %s)', blocked);
  raise notice 'PASS: exportações (3)';
end $$;
reset role;

-- ===================================================================== (4) o tamanho máximo de arquivo configurável tem limites no banco, mesmo para SQL direto
do $$
declare org uuid := test.t('org');
begin
  perform test.has(test.derr(format($q$update public.ct_settings set attachment_max_size_bytes = 1000 where organization_id = %L$q$, org)), '%check%', 'tamanho máximo abaixo de 10 KB');
  perform test.has(test.derr(format($q$update public.ct_settings set attachment_max_size_bytes = 30000000 where organization_id = %L$q$, org)), '%check%', 'tamanho máximo acima de 20 MB');
  perform test.sql(format($q$update public.ct_settings set attachment_max_size_bytes = 20971520 where organization_id = %L$q$, org));
  raise notice 'PASS: limites do tamanho de arquivo (4)';
end $$;

rollback;
