-- Gestão de Contratos — prazos derivados: revisões a cada mudança de data, regra de reajuste inativa e contrato encerrado.

\set as_o 'select set_config(''request.jwt.claims'', ''{"sub":"ffffffff-0000-4000-8000-0000000000b0","aal":"aal2","email":"o@t.invalid"}'', true); set local role authenticated;'

begin;

create function test.cnt(q text) returns bigint language plpgsql security definer set search_path = '' as $$ declare n bigint; begin execute q into n; return n; end $$;
create function test.cv(c uuid) returns integer language sql security definer set search_path = '' as $$ select version from public.contracts where id = c $$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email) values ('ffffffff-0000-4000-8000-0000000000b0', 'o@t.invalid');

:as_o
do $$
declare org uuid; cp uuid; c uuid; rev0 integer; v integer;
begin
  org := public.create_organization('Empresa Prazos', 'empresa-prazos');
  cp := public.ct_save_counterparty(org, null, null, '{"person_type":"company","name":"Parte de Prazos"}', gen_random_uuid());
  c := (public.ct_create_contract(org, gen_random_uuid(), jsonb_build_object('title', 'Contrato de prazos', 'start_date', (current_date - 30)::text, 'end_date', (current_date + 100)::text, 'notice_days', 10,
    'parties', jsonb_build_array(jsonb_build_object('counterparty_id', cp, 'role_description', 'Contratada')),
    'value', jsonb_build_object('amount_cents', 100000, 'billing_basis', 'monthly'),
    'adjustment_rule', jsonb_build_object('frequency_months', 12, 'next_adjustment_date', (current_date + 50)::text, 'reference_label', 'IPCA'))) ->> 'id')::uuid;
  -- rascunho já tem prazos; ativar não os recria
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and superseded_at is null$q$, c)) = 3, 'três prazos vigentes: fim, aviso e reajuste';
  perform public.ct_activate_contract(org, c, test.cv(c));
  assert test.cnt(format($q$select max(revision) from public.contract_deadlines where contract_id = %L and deadline_type = 'contract_end'$q$, c)) = 1, 'ativar não cria nova revisão do fim';
  rev0 := test.cnt(format($q$select deadline_revision from public.contracts where id = %L$q$, c));
  -- renovar muda o fim e o aviso: nova revisão, a anterior fica superada; o reajuste (mesma data) não muda
  perform public.ct_renew_contract(org, c, test.cv(c), current_date + 300, false, current_date, 'Renovação por mais um período', null);
  assert test.cnt(format($q$select revision from public.contract_deadlines where contract_id = %L and deadline_type = 'contract_end' and superseded_at is null$q$, c)) = 2, 'fim de vigência na revisão 2';
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and deadline_type = 'contract_end' and superseded_at is not null$q$, c)) = 1, 'a revisão antiga ficou superada';
  assert test.cnt(format($q$select revision from public.contract_deadlines where contract_id = %L and deadline_type = 'notice' and superseded_at is null$q$, c)) = 2, 'aviso na revisão 2';
  assert test.cnt(format($q$select revision from public.contract_deadlines where contract_id = %L and deadline_type = 'adjustment' and superseded_at is null$q$, c)) = 1, 'reajuste com a mesma data mantém a revisão 1';
  assert test.cnt(format($q$select deadline_revision from public.contracts where id = %L$q$, c)) > rev0, 'a revisão geral dos prazos do contrato avança';
  -- uma segunda renovação continua a contagem (revisão 3, e não volta a 1)
  perform public.ct_renew_contract(org, c, test.cv(c), current_date + 400, false, current_date, 'Segunda renovação do contrato', null);
  assert test.cnt(format($q$select revision from public.contract_deadlines where contract_id = %L and deadline_type = 'contract_end' and superseded_at is null$q$, c)) = 3, 'fim de vigência na revisão 3';
  -- regra de reajuste inativa não gera prazo
  perform public.ct_set_adjustment_rule(org, c, 12, current_date + 50, 'IPCA', false);
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and deadline_type = 'adjustment' and superseded_at is null$q$, c)) = 0, 'regra inativa não tem prazo vigente';
  perform public.ct_set_adjustment_rule(org, c, 12, current_date + 60, 'IPCA', true);
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and deadline_type = 'adjustment' and superseded_at is null and due_date = current_date + 60$q$, c)) = 1, 'regra ativa volta a ter prazo';
  -- encerrar tira todos os prazos vigentes
  perform public.ct_close_contract(org, c, test.cv(c), 'Encerramento normal do contrato');
  assert test.cnt(format($q$select count(*) from public.contract_deadlines where contract_id = %L and superseded_at is null$q$, c)) = 0, 'contrato encerrado não tem prazos vigentes';
  raise notice 'PASS: prazos, revisões e regra inativa (1)';
end $$;
reset role;

rollback;
