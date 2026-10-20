-- Gestão de Contratos — CONTRATOS: contexto, pessoas, configurações, partes, categorias, contratos (ciclo de vida, vigência, aviso, acesso) e documentos.
-- Toda escrita passa por estas funções (SECURITY DEFINER, search_path vazio): validam sessão, MFA, perfil, papel no contrato, que os ids são da MESMA empresa e a versão lida.

begin;
set local check_function_bodies = off;

-- ======================================================================= CPF/CNPJ (validação dos dígitos e máscara para o snapshot)
create function private.ct_valid_document(p text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare d int[]; s int; i int; w int[];
begin
  if p is null or p !~ '^\d+$' then return false; end if;
  if length(p) = 11 then
    if p ~ '^(\d)\1{10}$' then return false; end if;
    select array_agg(x::int order by o) into d from unnest(string_to_array(p, null)) with ordinality as t(x, o);
    for i in 10..11 loop
      s := 0;
      for j in 1..(i - 1) loop s := s + d[j] * (i + 1 - j); end loop;
      if ((s * 10) % 11) % 10 <> d[i] then return false; end if;
    end loop;
    return true;
  elsif length(p) = 14 then
    if p ~ '^(\d)\1{13}$' then return false; end if;
    select array_agg(x::int order by o) into d from unnest(string_to_array(p, null)) with ordinality as t(x, o);
    for i in 13..14 loop
      w := case i when 13 then array[5,4,3,2,9,8,7,6,5,4,3,2] else array[6,5,4,3,2,9,8,7,6,5,4,3,2] end;
      s := 0;
      for j in 1..(i - 1) loop s := s + d[j] * w[j]; end loop;
      if (case when s % 11 < 2 then 0 else 11 - s % 11 end) <> d[i] then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;
create function private.ct_mask_document(p text) returns text
language sql immutable set search_path = '' as $$
  select case length(p) when 11 then '***.' || substr(p, 4, 3) || '.' || substr(p, 7, 3) || '-**' when 14 then '**.***.***/' || substr(p, 9, 4) || '-**' else null end;
$$;
-- Identidade registrada NO MOMENTO do vínculo: o contrato mostra quem era a parte mesmo que o cadastro mude depois. O número completo fica só na tabela da gestão.
create function private.ct_party_snapshot(p_org uuid, p_cp uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'person_type', c.person_type, 'document_masked', private.ct_mask_document(d.document_number))
  from public.counterparties c left join public.counterparty_documents d on d.counterparty_id = c.id where c.id = p_cp and c.organization_id = p_org;
$$;
create function private.ct_compute_notice(p_end date, p_indef boolean, p_days integer, p_ref date, out ref date, out deadline date)
language plpgsql immutable set search_path = '' as $$
begin
  if p_days is null then ref := null; deadline := null; return; end if;
  ref := coalesce(p_ref, case when not p_indef then p_end end);
  if ref is null then raise exception 'informe a data de referência do prazo de aviso (contrato por prazo indeterminado)' using errcode = '22023'; end if;
  deadline := private.ct_notice_deadline(ref, p_days);
end $$;
revoke all on function private.ct_valid_document(text), private.ct_mask_document(text), private.ct_party_snapshot(uuid, uuid), private.ct_compute_notice(date, boolean, integer, date) from public, anon, authenticated;

-- ======================================================================= contexto e pessoas
create function public.ct_my_context(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.ct_settings;
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  select * into s from public.ct_settings where organization_id = p_org;
  return jsonb_build_object('profile', private.ct_profile(p_org), 'user_id', (select auth.uid()), 'timezone', s.timezone, 'contract_prefix', s.contract_prefix,
    'attachment_max_size_bytes', s.attachment_max_size_bytes, 'near_end_days', s.near_end_days,
    'unread_notifications', (select count(*) from public.notifications n where n.organization_id = p_org and n.user_id = (select auth.uid()) and n.read_at is null
      and private.ct_can_see_contract(n.organization_id, n.contract_id)));
end $$;

-- Pessoas da empresa (com e-mail) para escolher responsável e acessos. Só a gestão.
create function public.ct_people(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'manager');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'profile', private.ct_profile_of(p_org, m.user_id), 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email)
      order by coalesce(nullif(btrim(p.full_name), ''), p.email))
    from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org), '[]'::jsonb);
end $$;

-- Nomes (sem e-mail) das pessoas que aparecem em UM contrato que o usuário enxerga.
create function public.ct_contract_people(p_org uuid, p_contract uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'member');
  if not private.ct_can_see_contract(p_org, p_contract) then raise exception 'contrato não encontrado' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', u.id, 'name', coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'), 'contract_role', private.ct_contract_role_of(p_org, p_contract, u.id),
      'assignable', private.ct_assignable(p_org, p_contract, u.id)) order by coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'))
    from (select user_id as id from public.contract_access where contract_id = p_contract
          union select user_id from public.organization_members where organization_id = p_org and role in ('owner', 'admin', 'manager')
          union select responsible_user_id from public.contracts where id = p_contract
          union select responsible_user_id from public.contract_obligations where contract_id = p_contract
          union select actor_user_id from public.contract_events where contract_id = p_contract
          union select uploaded_by from public.contract_document_versions v join public.contract_documents d on d.id = v.document_id where d.contract_id = p_contract
          union select created_by from public.contracts where id = p_contract) u
    left join public.profiles p on p.id = u.id where u.id is not null), '[]'::jsonb);
end $$;

-- Nomes das pessoas citadas nas visões globais (obrigações, notificações): só quem aparece em contratos que o usuário enxerga.
create function public.ct_people_names(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'member');
  return coalesce((
    select jsonb_object_agg(u.id, coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'))
    from (select distinct c.responsible_user_id as id from public.contracts c where c.organization_id = p_org and c.responsible_user_id is not null and private.ct_can_see_contract(c.organization_id, c.id)
          union select distinct o.responsible_user_id from public.contract_obligations o where o.organization_id = p_org and o.responsible_user_id is not null and private.ct_can_see_contract(o.organization_id, o.contract_id)
          union select distinct n.actor_user_id from public.notifications n where n.organization_id = p_org and n.user_id = (select auth.uid()) and n.actor_user_id is not null) u
    left join public.profiles p on p.id = u.id), '{}'::jsonb);
end $$;

-- ======================================================================= configurações, marca, lembretes e agendador (proprietário)
create function public.ct_save_settings(p_org uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'owner');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p ->> 'timezone') then raise exception 'fuso horário desconhecido' using errcode = '22023'; end if;
  update public.ct_settings set
    primary_color = coalesce(p ->> 'primary_color', primary_color),
    timezone = coalesce(p ->> 'timezone', timezone),
    contract_prefix = coalesce(upper(p ->> 'contract_prefix'), contract_prefix),
    attachment_max_size_bytes = coalesce((p ->> 'attachment_max_size_bytes')::integer, attachment_max_size_bytes),
    near_end_days = coalesce((p ->> 'near_end_days')::integer, near_end_days),
    retention_policy_text = case when p ? 'retention_policy_text' then private.ct_opt_text(p ->> 'retention_policy_text', 1000, 'Política de retenção') else retention_policy_text end
  where organization_id = p_org;
exception when check_violation then raise exception 'valor fora do permitido (cor #RRGGBB, prefixo de até 6 letras/números, arquivos 10 KB–20 MB, aviso de fim 1–365 dias)' using errcode = '22023';
end $$;

create function public.ct_set_logo(p_org uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'owner');
  if p_path is not null and (p_path !~ ('^' || p_org::text || '/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$')) then raise exception 'caminho de logotipo inválido' using errcode = '22023'; end if;
  update public.ct_settings set logo_path = p_path where organization_id = p_org;
end $$;

-- Antecedências dos lembretes por tipo de evento (dias antes da data).
create function public.ct_save_reminder_rule(p_org uuid, p_event text, p_offsets integer[], p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'manager');
  if p_event is null or p_event not in ('contract_end', 'notice', 'adjustment', 'obligation') then raise exception 'tipo de lembrete inválido' using errcode = '22023'; end if;
  if not private.ct_offsets_ok(p_offsets) then raise exception 'informe de 1 a 8 antecedências, em dias, entre 0 e 365' using errcode = '22023'; end if;
  update public.reminder_rules set offsets_days = (select array_agg(distinct x order by x desc) from unnest(p_offsets) x), active = coalesce(p_active, true) where organization_id = p_org and event_type = p_event;
  perform private.ct_audit(p_org, 'update', 'reminder_rule', p_event, jsonb_build_object('offsets', p_offsets, 'active', p_active));
end $$;

-- Token do agendador: só o hash fica no banco; o texto aparece UMA vez. Girar invalida o anterior.
create function public.ct_rotate_job_token(p_org uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  perform private.ct_guard(p_org, 'owner');
  insert into public.ct_job_tokens (organization_id, token_hash, rotated_by) values (p_org, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), (select auth.uid()))
  on conflict (organization_id) do update set token_hash = excluded.token_hash, rotated_by = excluded.rotated_by, rotated_at = now();
  perform private.ct_audit(p_org, 'update', 'job_token', p_org::text, '{}'::jsonb);
  return tok;
end $$;

-- ======================================================================= partes e categorias (gestão)
-- p: person_type, name, email, phone, address, document_number (CPF/CNPJ, só dígitos ou formatado), active
create function public.ct_save_counterparty(p_org uuid, p_id uuid, p_expected integer, p jsonb, p_idem uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); pt text; nm text; em text; ph text; ad text; doc text; rid uuid; prev jsonb; cur public.counterparties; v integer;
begin
  perform private.ct_guard(p_org, 'manager');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  perform private.ct_rate_hit('cp:' || p_org::text || ':' || uid::text, 120, 600);
  pt := coalesce(p ->> 'person_type', ''); if pt not in ('person', 'company') then raise exception 'informe se a parte é pessoa física ou empresa' using errcode = '22023'; end if;
  nm := private.ct_req_text(p ->> 'name', 2, 160, 'Nome'); em := private.ct_opt_text(p ->> 'email', 200, 'E-mail'); ph := private.ct_opt_text(p ->> 'phone', 40, 'Telefone'); ad := private.ct_opt_text(p ->> 'address', 400, 'Endereço');
  doc := nullif(regexp_replace(coalesce(p ->> 'document_number', ''), '\D', '', 'g'), '');
  if doc is not null then
    if not private.ct_valid_document(doc) then raise exception 'CPF/CNPJ inválido' using errcode = '22023'; end if;
    if (pt = 'person' and length(doc) <> 11) or (pt = 'company' and length(doc) <> 14) then raise exception 'o documento não combina com o tipo (pessoa física: CPF; empresa: CNPJ)' using errcode = '22023'; end if;
  end if;
  if p_id is null then
    prev := private.ct_idem(p_org, uid, p_idem, 'save_counterparty', private.ct_hash(array[pt, nm, coalesce(em, ''), coalesce(doc, '')]));
    if prev is not null then return (prev ->> 'id')::uuid; end if;
    insert into public.counterparties (organization_id, person_type, name, email, phone, address, created_by) values (p_org, pt, nm, em, ph, ad, uid) returning id into rid;
    perform private.ct_idem_done(p_org, uid, p_idem, jsonb_build_object('id', rid));
  else
    select * into cur from public.counterparties where id = p_id and organization_id = p_org for update;
    if not found then raise exception 'parte não encontrada' using errcode = 'P0002'; end if;
    if p_expected is not null and cur.version <> p_expected then perform private.ct_conflict('esta parte'); end if;
    update public.counterparties set person_type = pt, name = nm, email = em, phone = ph, address = ad, version = version + 1 where id = p_id returning id into rid;
  end if;
  if doc is null then delete from public.counterparty_documents where counterparty_id = rid;
  else insert into public.counterparty_documents (counterparty_id, organization_id, document_number) values (rid, p_org, doc) on conflict (counterparty_id) do update set document_number = excluded.document_number; end if;
  return rid;
exception when unique_violation then raise exception 'já existe uma parte cadastrada com este CPF/CNPJ' using errcode = '23505';
end $$;

create function public.ct_set_counterparty_active(p_org uuid, p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.ct_guard(p_org, 'manager');
  if p_active is null then raise exception 'informe se a parte fica ativa' using errcode = '22023'; end if;
  update public.counterparties set active = p_active, version = version + 1 where id = p_id and organization_id = p_org and active is distinct from p_active;
  if not exists (select 1 from public.counterparties where id = p_id and organization_id = p_org) then raise exception 'parte não encontrada' using errcode = 'P0002'; end if;
end $$;

create function public.ct_save_category(p_org uuid, p_id uuid, p_name text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text := private.ct_req_text(p_name, 2, 80, 'Nome da categoria'); rid uuid;
begin
  perform private.ct_guard(p_org, 'manager');
  if p_id is null then insert into public.contract_categories (organization_id, name) values (p_org, nm) returning id into rid;
  else
    update public.contract_categories set name = nm, active = coalesce(p_active, true) where id = p_id and organization_id = p_org returning id into rid;
    if rid is null then raise exception 'categoria não encontrada' using errcode = 'P0002'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'já existe uma categoria com esse nome' using errcode = '23505';
end $$;

-- ======================================================================= contratos
-- p: title, description, category_id, start_date, end_date, indefinite_term, responsible_user_id, notice_days, notice_reference_date, renewal_mode,
--    parties [{counterparty_id, role_description}], access [{user_id, role}], value {amount_cents, billing_basis}, adjustment_rule {frequency_months, next_adjustment_date, reference_label}
create function public.ct_create_contract(p_org uuid, p_idem uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); ttl text; ds text; cat uuid; sd date; ed date; ind boolean; resp uuid; nd integer; nref date; ren text; num bigint; cid uuid; prev jsonb; res jsonb; hash text;
  n jsonb; it jsonb; cp uuid; amt bigint; basis text; nr record;
begin
  perform private.ct_guard(p_org, 'manager');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  perform private.ct_rate_hit('ctr:' || p_org::text || ':' || uid::text, 60, 600);
  ttl := private.ct_req_text(p ->> 'title', 2, 200, 'Título'); ds := private.ct_opt_text(p ->> 'description', 4000, 'Descrição');
  cat := nullif(p ->> 'category_id', '')::uuid;
  if cat is not null and not exists (select 1 from public.contract_categories where id = cat and organization_id = p_org and active) then raise exception 'categoria inválida' using errcode = '22023'; end if;
  sd := private.ct_opt_date(p ->> 'start_date', 'Início da vigência'); ed := private.ct_opt_date(p ->> 'end_date', 'Fim da vigência');
  ind := coalesce((p ->> 'indefinite_term')::boolean, false);
  if sd is null then raise exception 'informe o início da vigência' using errcode = '22023'; end if;
  if ind and ed is not null then raise exception 'contrato por prazo indeterminado não tem data de fim' using errcode = '22023'; end if;
  if not ind and ed is null then raise exception 'informe o fim da vigência ou marque prazo indeterminado' using errcode = '22023'; end if;
  if ed is not null and ed < sd then raise exception 'o fim da vigência não pode ser anterior ao início' using errcode = '22023'; end if;
  resp := nullif(p ->> 'responsible_user_id', '')::uuid;
  if resp is not null and private.ct_profile_of(p_org, resp) is null then raise exception 'o responsável precisa ser membro da empresa' using errcode = '22023'; end if;
  nd := nullif(p ->> 'notice_days', '')::integer; nref := private.ct_opt_date(p ->> 'notice_reference_date', 'Referência do prazo de aviso');
  if nd is not null and (nd < 0 or nd > 3650) then raise exception 'prazo de aviso fora do permitido (0 a 3650 dias)' using errcode = '22023'; end if;
  ren := coalesce(nullif(p ->> 'renewal_mode', ''), 'none'); if ren not in ('none', 'manual') then raise exception 'modo de renovação inválido' using errcode = '22023'; end if;
  select * into nr from private.ct_compute_notice(ed, ind, nd, nref);
  hash := private.ct_hash(array[ttl, coalesce(ds, ''), coalesce(cat::text, ''), sd::text, coalesce(ed::text, ''), ind::text, coalesce(resp::text, ''), coalesce(nd::text, ''), coalesce((p -> 'parties')::text, ''), coalesce((p -> 'value')::text, '')]);
  prev := private.ct_idem(p_org, uid, p_idem, 'create_contract', hash);
  if prev is not null then return prev; end if;
  num := private.ct_next_contract_number(p_org);
  insert into public.contracts (organization_id, contract_number, title, description, category_id, start_date, end_date, indefinite_term, notice_days, notice_reference_date, notice_deadline_date, renewal_mode, created_by)
    values (p_org, num, ttl, ds, cat, sd, ed, ind, nd, nr.ref, nr.deadline, ren, uid) returning id into cid;
  if p ? 'parties' then
    if jsonb_typeof(p -> 'parties') is distinct from 'array' or jsonb_array_length(p -> 'parties') > 50 then raise exception 'lista de partes inválida' using errcode = '22023'; end if;
    for it in select value from jsonb_array_elements(p -> 'parties') loop
      cp := (it ->> 'counterparty_id')::uuid;
      if not exists (select 1 from public.counterparties where id = cp and organization_id = p_org and active) then raise exception 'parte inválida ou inativa' using errcode = '22023'; end if;
      insert into public.contract_parties (organization_id, contract_id, counterparty_id, role_description, identity_snapshot, created_by)
        values (p_org, cid, cp, private.ct_req_text(it ->> 'role_description', 2, 120, 'Papel da parte'), private.ct_party_snapshot(p_org, cp), uid);
    end loop;
  end if;
  if p ? 'access' then
    if jsonb_typeof(p -> 'access') is distinct from 'array' or jsonb_array_length(p -> 'access') > 100 then raise exception 'lista de acessos inválida' using errcode = '22023'; end if;
    for it in select value from jsonb_array_elements(p -> 'access') loop
      if private.ct_profile_of(p_org, (it ->> 'user_id')::uuid) is null then raise exception 'a pessoa precisa ser membro da empresa' using errcode = '22023'; end if;
      if private.ct_profile_of(p_org, (it ->> 'user_id')::uuid) in ('owner', 'manager') then continue; end if;
      if coalesce(it ->> 'role', 'reader') not in ('editor', 'reader') then raise exception 'papel de acesso inválido' using errcode = '22023'; end if;
      insert into public.contract_access (organization_id, contract_id, user_id, contract_role, added_by) values (p_org, cid, (it ->> 'user_id')::uuid, coalesce(it ->> 'role', 'reader'), uid) on conflict do nothing;
    end loop;
  end if;
  if resp is not null then update public.contracts set responsible_user_id = resp where id = cid; end if;
  if jsonb_typeof(p -> 'value') = 'object' and nullif(p -> 'value' ->> 'amount_cents', '') is not null then
    if jsonb_typeof(p -> 'value' -> 'amount_cents') is distinct from 'number' then raise exception 'valor inválido' using errcode = '22023'; end if;
    amt := (p -> 'value' ->> 'amount_cents')::bigint; basis := coalesce(p -> 'value' ->> 'billing_basis', '');
    if amt < 0 or amt > 99999999999999 then raise exception 'valor fora do permitido' using errcode = '22023'; end if;
    if basis not in ('monthly', 'annual', 'one_time', 'reference') then raise exception 'informe a periodicidade do valor (mensal, anual, único ou referência)' using errcode = '22023'; end if;
    insert into public.contract_value_versions (organization_id, contract_id, amount_cents, billing_basis, effective_from, created_by) values (p_org, cid, amt, basis, sd, uid);
  end if;
  if jsonb_typeof(p -> 'adjustment_rule') = 'object' and nullif(p -> 'adjustment_rule' ->> 'frequency_months', '') is not null then
    insert into public.contract_adjustment_rules (contract_id, organization_id, frequency_months, next_adjustment_date, reference_label)
      values (cid, p_org, (p -> 'adjustment_rule' ->> 'frequency_months')::integer, private.ct_opt_date(p -> 'adjustment_rule' ->> 'next_adjustment_date', 'Próximo reajuste'),
        private.ct_opt_text(p -> 'adjustment_rule' ->> 'reference_label', 80, 'Referência do reajuste'));
  end if;
  perform private.ct_sync_deadlines(cid);
  perform private.ct_event(p_org, cid, 'contract_created', jsonb_build_object('contract_number', num));
  if resp is not null then perform private.ct_notify(p_org, cid, 'contract_assigned', array[resp]); end if;
  res := jsonb_build_object('id', cid, 'contract_number', num);
  perform private.ct_idem_done(p_org, uid, p_idem, res);
  return res;
exception when invalid_text_representation then raise exception 'dado inválido nas informações do contrato' using errcode = '22023';
end $$;

-- p: title, description, category_id (editor ou gestão) · renewal_mode (gestão) · start_date, end_date, indefinite_term (gestão, só rascunho; contrato ativo muda a vigência por renovação ou aditivo)
create function public.ct_update_contract(p_org uuid, p_contract uuid, p_expected integer, p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; role text; ttl text; ds text; cat uuid; ren text; sd date; ed date; ind boolean; changed text[] := '{}'; v integer; nr record; dates boolean;
begin
  perform private.ct_guard(p_org, 'member');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'edit');
  role := private.ct_contract_role(p_org, p_contract);
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  perform private.ct_open_for_edit(c);
  dates := p ? 'start_date' or p ? 'end_date' or p ? 'indefinite_term';
  if (p ? 'renewal_mode' or dates) and role <> 'manager' then raise exception 'sem permissão' using errcode = '42501'; end if;
  if dates and c.lifecycle_status <> 'draft' then raise exception 'a vigência de um contrato ativo muda por renovação ou aditivo' using errcode = '23514'; end if;
  ttl := case when p ? 'title' then private.ct_req_text(p ->> 'title', 2, 200, 'Título') else c.title end;
  ds := case when p ? 'description' then private.ct_opt_text(p ->> 'description', 4000, 'Descrição') else c.description end;
  cat := case when p ? 'category_id' then nullif(p ->> 'category_id', '')::uuid else c.category_id end;
  if cat is not null and cat is distinct from c.category_id and not exists (select 1 from public.contract_categories where id = cat and organization_id = p_org and active) then raise exception 'categoria inválida' using errcode = '22023'; end if;
  ren := case when p ? 'renewal_mode' then p ->> 'renewal_mode' else c.renewal_mode end;
  if ren not in ('none', 'manual') then raise exception 'modo de renovação inválido' using errcode = '22023'; end if;
  sd := case when p ? 'start_date' then private.ct_opt_date(p ->> 'start_date', 'Início da vigência') else c.start_date end;
  ind := case when p ? 'indefinite_term' then coalesce((p ->> 'indefinite_term')::boolean, false) else c.indefinite_term end;
  ed := case when ind then null when p ? 'end_date' then private.ct_opt_date(p ->> 'end_date', 'Fim da vigência') else c.end_date end;
  if sd is null then raise exception 'informe o início da vigência' using errcode = '22023'; end if;
  if not ind and ed is null then raise exception 'informe o fim da vigência ou marque prazo indeterminado' using errcode = '22023'; end if;
  if ed is not null and ed < sd then raise exception 'o fim da vigência não pode ser anterior ao início' using errcode = '22023'; end if;
  if ttl is distinct from c.title then changed := array_append(changed, 'title'); end if;
  if ds is distinct from c.description then changed := array_append(changed, 'description'); end if;
  if cat is distinct from c.category_id then changed := array_append(changed, 'category'); end if;
  if ren is distinct from c.renewal_mode then changed := array_append(changed, 'renewal_mode'); end if;
  if sd is distinct from c.start_date or ed is distinct from c.end_date or ind is distinct from c.indefinite_term then changed := array_append(changed, 'term'); end if;
  if cardinality(changed) = 0 then return c.version; end if;
  select * into nr from private.ct_compute_notice(ed, ind, c.notice_days, case when ind or c.notice_adjusted then c.notice_reference_date else null end);
  update public.contracts set title = ttl, description = ds, category_id = cat, renewal_mode = ren, start_date = sd, end_date = ed, indefinite_term = ind,
    notice_reference_date = case when c.notice_adjusted then c.notice_reference_date else nr.ref end,
    notice_deadline_date = case when c.notice_adjusted then c.notice_deadline_date else nr.deadline end
    where id = p_contract returning version into v;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'contract_updated', jsonb_build_object('fields', to_jsonb(changed)));
  return v;
end $$;

-- Prazo de aviso: dias + referência (padrão: fim da vigência). Ajuste manual exige justificativa e fica marcado como ajustado.
-- p: notice_days (nulo remove o aviso), notice_reference_date, manual_deadline, justification
create function public.ct_set_notice(p_org uuid, p_contract uuid, p_expected integer, p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; nd integer; nref date; man date; why text; nr record; v integer;
begin
  perform private.ct_guard(p_org, 'member');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'edit');
  perform private.ct_open_for_edit(c);
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  nd := nullif(p ->> 'notice_days', '')::integer; nref := private.ct_opt_date(p ->> 'notice_reference_date', 'Referência'); man := private.ct_opt_date(p ->> 'manual_deadline', 'Prazo ajustado'); why := private.ct_opt_text(p ->> 'justification', 500, 'Justificativa');
  if nd is not null and (nd < 0 or nd > 3650) then raise exception 'prazo de aviso fora do permitido (0 a 3650 dias)' using errcode = '22023'; end if;
  if nd is null then
    update public.contracts set notice_days = null, notice_reference_date = null, notice_deadline_date = null, notice_adjusted = false, notice_adjust_reason = null where id = p_contract returning version into v;
  else
    select * into nr from private.ct_compute_notice(c.end_date, c.indefinite_term, nd, nref);
    if man is not null then
      if why is null or char_length(why) < 5 then raise exception 'informe a justificativa do ajuste manual (mínimo 5 caracteres)' using errcode = '22023'; end if;
      update public.contracts set notice_days = nd, notice_reference_date = nr.ref, notice_deadline_date = man, notice_adjusted = true, notice_adjust_reason = why where id = p_contract returning version into v;
    else
      update public.contracts set notice_days = nd, notice_reference_date = nr.ref, notice_deadline_date = nr.deadline, notice_adjusted = false, notice_adjust_reason = null where id = p_contract returning version into v;
    end if;
  end if;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'notice_changed', jsonb_build_object('days', nd, 'adjusted', man is not null));
  return v;
end $$;

create function public.ct_set_responsible(p_org uuid, p_contract uuid, p_expected integer, p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  perform private.ct_open_for_edit(c);
  if p_user is not null and not private.ct_assignable(p_org, p_contract, p_user) then raise exception 'responsável inválido: precisa ser membro com acesso e permissão de edição ao contrato' using errcode = '22023'; end if;
  if p_user is not distinct from c.responsible_user_id then return c.version; end if;
  update public.contracts set responsible_user_id = p_user where id = p_contract returning version into v;
  perform private.ct_event(p_org, p_contract, 'responsible_changed', jsonb_build_object('from', c.responsible_user_id, 'to', p_user));
  if p_user is not null then perform private.ct_notify(p_org, p_contract, 'contract_assigned', array[p_user]); end if;
  return v;
end $$;

-- Trata as obrigações pendentes de quem perde o acesso (ou vira leitor): `unassign` ou `transfer` para outra pessoa elegível. Sem escolha explícita, recusa.
create function private.ct_handle_obligations(p_org uuid, p_contract uuid, p_user uuid, p_action text, p_transfer_to uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; o record;
begin
  select count(*) into n from public.contract_obligations where contract_id = p_contract and responsible_user_id = p_user and status = 'pending';
  if n = 0 then return 0; end if;
  if p_action is null or p_action not in ('unassign', 'transfer') then raise exception 'esta pessoa tem % obrigação(ões) pendente(s): escolha desatribuir ou transferir', n using errcode = '23514'; end if;
  if p_action = 'transfer' and (p_transfer_to is null or p_transfer_to = p_user or not private.ct_assignable(p_org, p_contract, p_transfer_to)) then
    raise exception 'escolha, para a transferência, outra pessoa do contrato com permissão de edição' using errcode = '23514';
  end if;
  for o in select id from public.contract_obligations where contract_id = p_contract and responsible_user_id = p_user and status = 'pending' order by id for update loop
    update public.contract_obligations set responsible_user_id = case when p_action = 'transfer' then p_transfer_to end where id = o.id;
    if p_action = 'transfer' then perform private.ct_notify(p_org, p_contract, 'obligation_assigned', array[p_transfer_to], o.id); end if;
  end loop;
  return n;
end $$;
revoke all on function private.ct_handle_obligations(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- Acesso de uma pessoa a um contrato (gestão). p_role nulo remove o acesso.
create function public.ct_set_access(p_org uuid, p_contract uuid, p_user uuid, p_role text, p_obligation_action text default null, p_transfer_to uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; old_role text; n integer := 0;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.archived_at is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
  if p_role is not null and p_role not in ('editor', 'reader') then raise exception 'papel de acesso inválido' using errcode = '22023'; end if;
  if p_user is null or private.ct_profile_of(p_org, p_user) is null then raise exception 'a pessoa precisa ser membro da empresa' using errcode = '22023'; end if;
  select contract_role into old_role from public.contract_access where contract_id = p_contract and user_id = p_user;
  if (p_role is null or p_role = 'reader') and c.responsible_user_id = p_user then raise exception 'esta pessoa é a responsável pelo contrato: troque o responsável antes' using errcode = '23514'; end if;
  if p_role is null then
    if old_role is null then raise exception 'esta pessoa não tem acesso por vínculo a este contrato' using errcode = 'P0002'; end if;
    n := private.ct_handle_obligations(p_org, p_contract, p_user, p_obligation_action, p_transfer_to);
    delete from public.contract_access where contract_id = p_contract and user_id = p_user;
    perform private.ct_event(p_org, p_contract, 'access_removed', jsonb_build_object('user_id', p_user, 'obligations_handled', n));
  elsif old_role is null then
    insert into public.contract_access (organization_id, contract_id, user_id, contract_role, added_by) values (p_org, p_contract, p_user, p_role, (select auth.uid()));
    perform private.ct_event(p_org, p_contract, 'access_granted', jsonb_build_object('user_id', p_user, 'role', p_role));
  elsif old_role <> p_role then
    if p_role = 'reader' then n := private.ct_handle_obligations(p_org, p_contract, p_user, p_obligation_action, p_transfer_to); end if;
    update public.contract_access set contract_role = p_role where contract_id = p_contract and user_id = p_user;
    perform private.ct_event(p_org, p_contract, 'access_changed', jsonb_build_object('user_id', p_user, 'from', old_role, 'to', p_role));
  end if;
  return n;
end $$;

create function public.ct_add_party(p_org uuid, p_contract uuid, p_counterparty uuid, p_role_description text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contracts;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'manage');
  perform private.ct_open_for_edit(c);
  if not exists (select 1 from public.counterparties where id = p_counterparty and organization_id = p_org and active) then raise exception 'parte inválida ou inativa' using errcode = '22023'; end if;
  if exists (select 1 from public.contract_parties where contract_id = p_contract and counterparty_id = p_counterparty) then raise exception 'esta parte já está no contrato' using errcode = '23505'; end if;
  insert into public.contract_parties (organization_id, contract_id, counterparty_id, role_description, identity_snapshot, created_by)
    values (p_org, p_contract, p_counterparty, private.ct_req_text(p_role_description, 2, 120, 'Papel da parte'), private.ct_party_snapshot(p_org, p_counterparty), (select auth.uid()));
  perform private.ct_event(p_org, p_contract, 'party_added', jsonb_build_object('counterparty_id', p_counterparty));
end $$;

create function public.ct_remove_party(p_org uuid, p_contract uuid, p_counterparty uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contracts;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'manage');
  perform private.ct_open_for_edit(c);
  if not exists (select 1 from public.contract_parties where contract_id = p_contract and counterparty_id = p_counterparty) then raise exception 'esta parte não está no contrato' using errcode = 'P0002'; end if;
  if c.lifecycle_status = 'active' and (select count(*) from public.contract_parties where contract_id = p_contract) <= 1 then raise exception 'um contrato ativo precisa ter ao menos uma parte' using errcode = '23514'; end if;
  delete from public.contract_parties where contract_id = p_contract and counterparty_id = p_counterparty;
  perform private.ct_event(p_org, p_contract, 'party_removed', jsonb_build_object('counterparty_id', p_counterparty));
end $$;

-- ======================================================================= ciclo de vida
create function public.ct_activate_contract(p_org uuid, p_contract uuid, p_expected integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'draft' then raise exception 'só um rascunho pode ser ativado' using errcode = '23514'; end if;
  update public.contracts set lifecycle_status = 'active' where id = p_contract returning version into v;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'contract_activated');
  return v;
end $$;

-- Rescisão: data (entre o início e hoje) e motivo; preserva o registro em contract_changes.
create function public.ct_terminate_contract(p_org uuid, p_contract uuid, p_expected integer, p_ended_on date, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer; rsn text := private.ct_opt_text(p_reason, 500, 'Motivo');
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'active' or c.archived_at is not null then raise exception 'só um contrato ativo pode ser rescindido' using errcode = '23514'; end if;
  if rsn is null or char_length(rsn) < 5 then raise exception 'informe o motivo (mínimo 5 caracteres)' using errcode = '22023'; end if;
  if p_ended_on is null or p_ended_on < c.start_date or p_ended_on > private.ct_today(p_org) then raise exception 'a data da rescisão deve estar entre o início da vigência e hoje' using errcode = '22023'; end if;
  insert into public.contract_changes (organization_id, contract_id, change_type, effective_date, description, before_snapshot, after_snapshot, created_by)
    values (p_org, p_contract, 'termination', p_ended_on, rsn, jsonb_build_object('lifecycle_status', c.lifecycle_status, 'end_date', c.end_date), jsonb_build_object('lifecycle_status', 'terminated', 'ended_on', p_ended_on), (select auth.uid()));
  update public.contracts set lifecycle_status = 'terminated', ended_on = p_ended_on, end_reason = rsn where id = p_contract returning version into v;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'contract_terminated', jsonb_build_object('ended_on', p_ended_on));
  return v;
end $$;

-- Encerramento administrativo (sem rescisão): contrato cumprido, substituído, etc.
create function public.ct_close_contract(p_org uuid, p_contract uuid, p_expected integer, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer; rsn text := private.ct_opt_text(p_reason, 500, 'Motivo');
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'active' or c.archived_at is not null then raise exception 'só um contrato ativo pode ser encerrado' using errcode = '23514'; end if;
  if rsn is null or char_length(rsn) < 5 then raise exception 'informe o motivo (mínimo 5 caracteres)' using errcode = '22023'; end if;
  update public.contracts set lifecycle_status = 'closed', ended_on = private.ct_today(p_org), end_reason = rsn where id = p_contract returning version into v;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'contract_closed');
  return v;
end $$;

create function public.ct_reopen_contract(p_org uuid, p_contract uuid, p_expected integer, p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer; rsn text := private.ct_opt_text(p_reason, 500, 'Justificativa');
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status not in ('terminated', 'closed') or c.archived_at is not null then raise exception 'só um contrato rescindido ou encerrado (e não arquivado) pode ser reaberto' using errcode = '23514'; end if;
  if rsn is null or char_length(rsn) < 5 then raise exception 'informe a justificativa (mínimo 5 caracteres)' using errcode = '22023'; end if;
  update public.contracts set lifecycle_status = 'active', ended_on = null, end_reason = null where id = p_contract returning version into v;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, 'contract_reopened', jsonb_build_object('from', c.lifecycle_status, 'reason', rsn));
  return v;
end $$;

create function public.ct_archive_contract(p_org uuid, p_contract uuid, p_expected integer, p_archive boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v integer;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if p_archive is null then raise exception 'informe se é para arquivar ou desarquivar' using errcode = '22023'; end if;
  if p_archive = (c.archived_at is not null) then return c.version; end if;
  update public.contracts set archived_at = case when p_archive then clock_timestamp() end where id = p_contract returning version into v;
  perform private.ct_sync_deadlines(p_contract);
  perform private.ct_event(p_org, p_contract, case when p_archive then 'contract_archived' else 'contract_unarchived' end);
  return v;
end $$;

-- Exclusão física: só rascunho sem documentos, aditivos ou obrigações (o resto é histórico e fica).
create function public.ct_delete_draft(p_org uuid, p_contract uuid, p_expected integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contracts;
begin
  perform private.ct_guard(p_org, 'manager');
  c := private.ct_load_contract(p_org, p_contract, true, p_expected);
  perform private.ct_require(p_org, p_contract, 'manage');
  if c.lifecycle_status <> 'draft' then raise exception 'só um rascunho pode ser excluído' using errcode = '23514'; end if;
  if exists (select 1 from public.contract_documents where contract_id = p_contract) or exists (select 1 from public.contract_changes where contract_id = p_contract)
     or exists (select 1 from public.contract_obligations where contract_id = p_contract) or exists (select 1 from public.contract_adjustments where contract_id = p_contract) then
    raise exception 'o rascunho já tem documentos, aditivos, obrigações ou reajustes: arquive-o em vez de excluir' using errcode = '23514';
  end if;
  perform set_config('ct.bypass', 'on', true);
  delete from public.notifications where contract_id = p_contract;
  delete from public.contract_deadlines where contract_id = p_contract;
  delete from public.contract_events where contract_id = p_contract;
  delete from public.contract_adjustment_rules where contract_id = p_contract;
  delete from public.contract_value_versions where contract_id = p_contract;
  delete from public.contract_parties where contract_id = p_contract;
  delete from public.contract_access where contract_id = p_contract;
  delete from public.contracts where id = p_contract;
  perform set_config('ct.bypass', 'off', true);
  perform private.ct_audit(p_org, 'delete', 'contract_draft', p_contract::text, jsonb_build_object('contract_number', c.contract_number));
end $$;

-- ======================================================================= documentos e versões (privados; nunca sobrescrevem)
create function public.ct_add_document(p_org uuid, p_contract uuid, p_idem uuid, p_title text, p_type text, p_file jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); c public.contracts; prev jsonb; did uuid; vid uuid; res jsonb; ttl text := private.ct_req_text(p_title, 2, 160, 'Título do documento');
begin
  perform private.ct_guard(p_org, 'member');
  c := private.ct_load_contract(p_org, p_contract, true, null);
  perform private.ct_require(p_org, p_contract, 'edit');
  if c.archived_at is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
  if p_type is null or p_type not in ('main', 'amendment', 'attachment', 'proof', 'other') then raise exception 'tipo de documento inválido' using errcode = '22023'; end if;
  perform private.ct_rate_hit('doc:' || p_org::text || ':' || uid::text, 60, 600);
  prev := private.ct_idem(p_org, uid, p_idem, 'add_document', private.ct_hash(array[p_contract::text, ttl, p_type, coalesce(p_file::text, '')]));
  if prev is not null then return prev; end if;
  insert into public.contract_documents (organization_id, contract_id, title, document_type, created_by) values (p_org, p_contract, ttl, p_type, uid) returning id into did;
  vid := private.ct_add_doc_version(p_org, p_contract, did, p_file, uid);
  perform private.ct_event(p_org, p_contract, 'document_added', jsonb_build_object('document_id', did, 'type', p_type));
  res := jsonb_build_object('document_id', did, 'version_id', vid, 'version_number', 1);
  perform private.ct_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

create function public.ct_add_document_version(p_org uuid, p_document uuid, p_idem uuid, p_file jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); d public.contract_documents; c public.contracts; prev jsonb; vid uuid; num integer; res jsonb;
begin
  perform private.ct_guard(p_org, 'member');
  select * into d from public.contract_documents where id = p_document and organization_id = p_org;
  if not found then raise exception 'documento não encontrado' using errcode = 'P0002'; end if;
  c := private.ct_load_contract(p_org, d.contract_id, true, null);
  perform private.ct_require(p_org, d.contract_id, 'edit');
  if c.archived_at is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
  perform private.ct_rate_hit('doc:' || p_org::text || ':' || uid::text, 60, 600);
  prev := private.ct_idem(p_org, uid, p_idem, 'add_document_version', private.ct_hash(array[p_document::text, coalesce(p_file::text, '')]));
  if prev is not null then return prev; end if;
  select * into d from public.contract_documents where id = p_document for update;
  vid := private.ct_add_doc_version(p_org, d.contract_id, p_document, p_file, uid);
  select version_number into num from public.contract_document_versions where id = vid;
  perform private.ct_event(p_org, d.contract_id, 'document_version_added', jsonb_build_object('document_id', p_document, 'version_number', num));
  res := jsonb_build_object('version_id', vid, 'version_number', num);
  perform private.ct_idem_done(p_org, uid, p_idem, res);
  return res;
end $$;

-- Define explicitamente qual versão é a atual do documento.
create function public.ct_set_current_version(p_org uuid, p_document uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.contract_documents; c public.contracts;
begin
  perform private.ct_guard(p_org, 'member');
  select * into d from public.contract_documents where id = p_document and organization_id = p_org;
  if not found then raise exception 'documento não encontrado' using errcode = 'P0002'; end if;
  c := private.ct_load_contract(p_org, d.contract_id, true, null);
  perform private.ct_require(p_org, d.contract_id, 'edit');
  if c.archived_at is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
  if not exists (select 1 from public.contract_document_versions where id = p_version and document_id = p_document) then raise exception 'versão não encontrada neste documento' using errcode = 'P0002'; end if;
  if d.current_version_id = p_version then return; end if;
  update public.contract_documents set current_version_id = p_version where id = p_document;
  perform private.ct_event(p_org, d.contract_id, 'document_current_changed', jsonb_build_object('document_id', p_document));
end $$;

-- Caminho para o servidor assinar a URL curta: só devolve se o usuário ENXERGA o contrato (leitor incluído).
create function public.ct_document_info(p_org uuid, p_version uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.contract_document_versions; d public.contract_documents;
begin
  perform private.ct_guard(p_org, 'member');
  select * into v from public.contract_document_versions where id = p_version and organization_id = p_org;
  if not found then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;
  select * into d from public.contract_documents where id = v.document_id;
  if private.ct_contract_role(p_org, d.contract_id) is null then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', v.storage_path, 'name', v.original_filename, 'mime', v.mime_type, 'size', v.size_bytes, 'contract_id', d.contract_id);
end $$;

commit;
