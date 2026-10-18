-- Gestão de Ordens de Serviço — CADASTROS (RPCs os_*): clientes, contatos, endereços, equipamentos, catálogos, modelos de checklist, configurações e técnicos.
-- Toda função: SECURITY DEFINER, search_path vazio, valida sessão + MFA + perfil (private.os_guard) e confere que os ids pertencem à MESMA empresa.
-- Cadastros não têm exclusão: «desativar» preserva o histórico das ordens que os usam.

begin;
set local check_function_bodies = off;

-- Contexto do usuário (perfil) para a interface.
create function public.os_my_context(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;
  return jsonb_build_object('profile', private.os_profile(p_org), 'user_id', (select auth.uid()));
end $$;

-- Pessoas da empresa com nome (para atribuição e filtros). Só a gestão enxerga.
create function public.os_people(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'manager');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.role, 'profile', private.os_profile_of(p_org, m.user_id), 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email,
      'active', private.os_tech_active(p_org, m.user_id)) order by coalesce(nullif(btrim(p.full_name), ''), p.email))
    from public.organization_members m left join public.profiles p on p.id = m.user_id where m.organization_id = p_org), '[]'::jsonb);
end $$;

-- Nomes das pessoas que aparecem no histórico de UMA ordem que o usuário pode ver (técnico incluído), sem e-mail.
create function public.os_order_people(p_org uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'staff');
  if not private.os_can_see_order(p_org, p_order) then raise exception 'ordem de serviço não encontrada' using errcode = 'P0002'; end if;
  return coalesce((
    select jsonb_object_agg(u.id, coalesce(nullif(btrim(p.full_name), ''), 'Pessoa'))
    from (select author_user_id as id from public.order_updates where service_order_id = p_order
          union select actor_user_id from public.order_events where service_order_id = p_order
          union select registered_by from public.order_part_usage where service_order_id = p_order
          union select uploaded_by from public.order_attachments where service_order_id = p_order
          union select answered_by from public.order_checklist_items where service_order_id = p_order
          union select completed_by from public.order_completions where service_order_id = p_order
          union select assigned_technician_user_id from public.service_orders where id = p_order
          union select created_by from public.service_orders where id = p_order) u
    left join public.profiles p on p.id = u.id where u.id is not null), '{}'::jsonb);
end $$;

-- ======================================================================= clientes
create function public.os_save_customer(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text; kd text; em text; ph text; doc text; notes text; act boolean; rid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  nm := private.os_req_text(p ->> 'name', 2, 160, 'Nome ou razão social');
  kd := coalesce(nullif(p ->> 'kind', ''), 'person');
  if kd not in ('person', 'company') then raise exception 'tipo de cliente inválido' using errcode = '22023'; end if;
  em := lower(private.os_opt_text(p ->> 'email', 200, 'E-mail')); ph := private.os_opt_text(p ->> 'phone', 20, 'Telefone');
  doc := regexp_replace(coalesce(p ->> 'document', ''), '[^0-9]', '', 'g'); doc := nullif(doc, '');
  if doc is not null and not private.os_valid_document(doc) then raise exception 'CPF ou CNPJ inválido' using errcode = '22023'; end if;
  notes := private.os_opt_text(p ->> 'internal_notes', 2000, 'Observações internas');
  act := coalesce((p ->> 'active')::boolean, true);
  if p_id is null then
    insert into public.customers (organization_id, name, kind, email, phone, active, created_by) values (p_org, nm, kd, em, ph, act, (select auth.uid())) returning customers.id into rid;
    insert into public.customer_private (customer_id, organization_id, document, internal_notes) values (rid, p_org, doc, notes);
  else
    update public.customers set name = nm, kind = kd, email = em, phone = ph, active = act where customers.id = p_id and organization_id = p_org returning customers.id into rid;
    if rid is null then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
    insert into public.customer_private (customer_id, organization_id, document, internal_notes) values (rid, p_org, doc, notes)
      on conflict (customer_id) do update set document = excluded.document, internal_notes = excluded.internal_notes;
  end if;
  return rid;
exception when unique_violation then raise exception 'já existe um cliente com este CPF/CNPJ' using errcode = '22023';
  when check_violation then raise exception 'dados do cliente inválidos (confira e-mail e telefone)' using errcode = '22023';
end $$;

create function public.os_save_contact(p_org uuid, p_customer uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text; rl text; ph text; em text; prim boolean; act boolean; rid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  nm := private.os_req_text(p ->> 'name', 2, 120, 'Nome do contato'); rl := private.os_opt_text(p ->> 'role_label', 60, 'Função');
  ph := private.os_opt_text(p ->> 'phone', 20, 'Telefone'); em := lower(private.os_opt_text(p ->> 'email', 200, 'E-mail'));
  prim := coalesce((p ->> 'is_primary')::boolean, false); act := coalesce((p ->> 'active')::boolean, true);
  if prim then update public.customer_contacts set is_primary = false where customer_id = p_customer and is_primary and id is distinct from p_id; end if;
  if p_id is null then
    insert into public.customer_contacts (organization_id, customer_id, name, role_label, phone, email, is_primary, active) values (p_org, p_customer, nm, rl, ph, em, prim and act, act) returning customer_contacts.id into rid;
  else
    update public.customer_contacts set name = nm, role_label = rl, phone = ph, email = em, is_primary = prim and act, active = act
      where customer_contacts.id = p_id and organization_id = p_org and customer_id = p_customer returning customer_contacts.id into rid;
    if rid is null then raise exception 'contato não encontrado' using errcode = 'P0002'; end if;
  end if;
  return rid;
exception when check_violation then raise exception 'dados do contato inválidos (confira e-mail e telefone)' using errcode = '22023';
end $$;

create function public.os_save_address(p_org uuid, p_customer uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lb text; st text; nu text; co text; di text; ci text; uf text; cep text; rf text; dflt boolean; act boolean; rid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  lb := private.os_req_text(p ->> 'label', 2, 60, 'Identificação do endereço'); st := private.os_req_text(p ->> 'street', 2, 160, 'Logradouro');
  nu := private.os_opt_text(p ->> 'number', 20, 'Número'); co := private.os_opt_text(p ->> 'complement', 80, 'Complemento'); di := private.os_opt_text(p ->> 'district', 80, 'Bairro');
  ci := private.os_req_text(p ->> 'city', 2, 80, 'Cidade'); uf := upper(private.os_req_text(p ->> 'state', 2, 2, 'UF'));
  cep := nullif(regexp_replace(coalesce(p ->> 'postal_code', ''), '[^0-9]', '', 'g'), '');
  if cep is not null and cep !~ '^[0-9]{8}$' then raise exception 'CEP inválido (8 dígitos)' using errcode = '22023'; end if;
  rf := private.os_opt_text(p ->> 'reference', 200, 'Referência');
  dflt := coalesce((p ->> 'is_default')::boolean, false); act := coalesce((p ->> 'active')::boolean, true);
  if dflt then update public.customer_addresses set is_default = false where customer_id = p_customer and is_default and id is distinct from p_id; end if;
  if p_id is null then
    insert into public.customer_addresses (organization_id, customer_id, label, street, number, complement, district, city, state, postal_code, reference, is_default, active)
    values (p_org, p_customer, lb, st, nu, co, di, ci, uf, cep, rf, dflt and act, act) returning customer_addresses.id into rid;
  else
    update public.customer_addresses set label = lb, street = st, number = nu, complement = co, district = di, city = ci, state = uf, postal_code = cep, reference = rf, is_default = dflt and act, active = act
      where customer_addresses.id = p_id and organization_id = p_org and customer_id = p_customer returning customer_addresses.id into rid;
    if rid is null then raise exception 'endereço não encontrado' using errcode = 'P0002'; end if;
  end if;
  return rid;
exception when check_violation then raise exception 'dados do endereço inválidos (UF com 2 letras e CEP com 8 dígitos)' using errcode = '22023';
end $$;

create function public.os_save_equipment(p_org uuid, p_customer uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare kd text; br text; md text; sn text; nt text; act boolean; rid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  if not exists (select 1 from public.customers where id = p_customer and organization_id = p_org) then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  kd := private.os_req_text(p ->> 'kind', 2, 80, 'Tipo do equipamento'); br := private.os_opt_text(p ->> 'brand', 80, 'Marca'); md := private.os_opt_text(p ->> 'model', 80, 'Modelo');
  sn := private.os_opt_text(p ->> 'serial_number', 80, 'Número de série'); nt := private.os_opt_text(p ->> 'notes', 1000, 'Observações'); act := coalesce((p ->> 'active')::boolean, true);
  if p_id is null then
    insert into public.equipment (organization_id, customer_id, kind, brand, model, serial_number, notes, active) values (p_org, p_customer, kd, br, md, sn, nt, act) returning equipment.id into rid;
  else
    update public.equipment set kind = kd, brand = br, model = md, serial_number = sn, notes = nt, active = act
      where equipment.id = p_id and organization_id = p_org and customer_id = p_customer returning equipment.id into rid;
    if rid is null then raise exception 'equipamento não encontrado' using errcode = 'P0002'; end if;
  end if;
  return rid;
end $$;

-- ======================================================================= catálogos
create function public.os_save_service(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text; ds text; un text; pr bigint; act boolean; rid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  nm := private.os_req_text(p ->> 'name', 2, 120, 'Nome do serviço'); ds := private.os_opt_text(p ->> 'description', 500, 'Descrição');
  un := private.os_req_text(coalesce(nullif(p ->> 'unit', ''), 'un'), 1, 16, 'Unidade');
  if jsonb_typeof(p -> 'reference_price_cents') is distinct from 'number' then raise exception 'preço de referência inválido' using errcode = '22023'; end if;
  pr := (p ->> 'reference_price_cents')::bigint; act := coalesce((p ->> 'active')::boolean, true);
  if pr < 0 or pr > 1000000000 then raise exception 'preço de referência fora do permitido' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.service_catalog (organization_id, name, description, unit, reference_price_cents, active) values (p_org, nm, ds, un, pr, act) returning service_catalog.id into rid;
  else
    update public.service_catalog set name = nm, description = ds, unit = un, reference_price_cents = pr, active = act where service_catalog.id = p_id and organization_id = p_org returning service_catalog.id into rid;
    if rid is null then raise exception 'serviço não encontrado' using errcode = 'P0002'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'já existe um serviço com este nome' using errcode = '22023';
end $$;

create function public.os_save_part(p_org uuid, p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cd text; nm text; un text; pr bigint; act boolean; rid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  cd := private.os_req_text(p ->> 'code', 1, 40, 'Código'); nm := private.os_req_text(p ->> 'name', 2, 120, 'Nome da peça');
  un := private.os_req_text(coalesce(nullif(p ->> 'unit', ''), 'un'), 1, 16, 'Unidade');
  if jsonb_typeof(p -> 'reference_price_cents') is distinct from 'number' then raise exception 'preço de referência inválido' using errcode = '22023'; end if;
  pr := (p ->> 'reference_price_cents')::bigint; act := coalesce((p ->> 'active')::boolean, true);
  if pr < 0 or pr > 1000000000 then raise exception 'preço de referência fora do permitido' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.part_catalog (organization_id, code, name, unit, reference_price_cents, active) values (p_org, cd, nm, un, pr, act) returning part_catalog.id into rid;
  else
    update public.part_catalog set code = cd, name = nm, unit = un, reference_price_cents = pr, active = act where part_catalog.id = p_id and organization_id = p_org returning part_catalog.id into rid;
    if rid is null then raise exception 'peça não encontrada' using errcode = 'P0002'; end if;
  end if;
  return rid;
exception when unique_violation then raise exception 'já existe uma peça com este código' using errcode = '22023';
end $$;

-- ======================================================================= modelos de checklist
-- Os itens são substituídos de uma vez. Ordens que já aplicaram o modelo guardam SNAPSHOT e não mudam.
create function public.os_save_template(p_org uuid, p_id uuid, p_name text, p_description text, p_active boolean, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nm text; ds text; rid uuid; it jsonb; pos integer := 0; kd text; opts jsonb; nr text;
begin
  perform private.os_guard(p_org, 'manager');
  nm := private.os_req_text(p_name, 2, 100, 'Nome do modelo'); ds := private.os_opt_text(p_description, 300, 'Descrição');
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then raise exception 'o modelo precisa de 1 a 100 itens' using errcode = '22023'; end if;
  if p_id is null then
    insert into public.checklist_templates (organization_id, name, description, active) values (p_org, nm, ds, coalesce(p_active, true)) returning checklist_templates.id into rid;
  else
    update public.checklist_templates set name = nm, description = ds, active = coalesce(p_active, active) where checklist_templates.id = p_id and organization_id = p_org returning checklist_templates.id into rid;
    if rid is null then raise exception 'modelo não encontrado' using errcode = 'P0002'; end if;
    delete from public.checklist_template_items where template_id = rid;
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    kd := it ->> 'kind';
    if kd is null or kd not in ('boolean', 'text', 'number', 'select') then raise exception 'tipo de item inválido (item %)', pos using errcode = '22023'; end if;
    opts := case when kd = 'select' then it -> 'options' else null end;
    if kd = 'select' and (opts is null or jsonb_typeof(opts) is distinct from 'array' or jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 20
        or exists (select 1 from jsonb_array_elements(opts) o where jsonb_typeof(o) is distinct from 'string' or char_length(btrim(o #>> '{}')) not between 1 and 60)) then
      raise exception 'item % de seleção precisa de 2 a 20 opções de texto', pos using errcode = '22023';
    end if;
    nr := coalesce(it ->> 'note_rule', 'never');
    if nr not in ('never', 'on_negative', 'always') then raise exception 'regra de justificativa inválida (item %)', pos using errcode = '22023'; end if;
    insert into public.checklist_template_items (organization_id, template_id, position, label, kind, options, required, allow_na, require_photo, note_rule)
    values (p_org, rid, pos, private.os_req_text(it ->> 'label', 2, 200, 'Texto do item'), kd, opts, coalesce((it ->> 'required')::boolean, false), coalesce((it ->> 'allow_na')::boolean, false),
      coalesce((it ->> 'require_photo')::boolean, false), nr);
  end loop;
  return rid;
exception when unique_violation then raise exception 'já existe um modelo com este nome' using errcode = '22023';
end $$;

-- ======================================================================= configurações e marca
create function public.os_save_settings(p_org uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'owner');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;
  update public.os_settings set
    public_display_name = case when p ? 'public_display_name' then private.os_opt_text(p ->> 'public_display_name', 80, 'Nome exibido ao cliente') else public_display_name end,
    primary_color = coalesce(p ->> 'primary_color', primary_color),
    timezone = coalesce(p ->> 'timezone', timezone),
    order_prefix = coalesce(upper(p ->> 'order_prefix'), order_prefix),
    quote_validity_days = coalesce((p ->> 'quote_validity_days')::integer, quote_validity_days),
    default_quote_terms = case when p ? 'default_quote_terms' then private.os_opt_text(p ->> 'default_quote_terms', 2000, 'Condições padrão') else default_quote_terms end,
    link_ttl_days = coalesce((p ->> 'link_ttl_days')::integer, link_ttl_days),
    attachment_max_size_bytes = coalesce((p ->> 'attachment_max_size_bytes')::integer, attachment_max_size_bytes),
    retention_policy_text = case when p ? 'retention_policy_text' then private.os_opt_text(p ->> 'retention_policy_text', 1000, 'Política de retenção') else retention_policy_text end
  where organization_id = p_org;
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p ->> 'timezone') then raise exception 'fuso horário desconhecido' using errcode = '22023'; end if;
exception when check_violation then raise exception 'valor fora do permitido (cor #RRGGBB, prefixo de até 6 letras/números, validade 1–365 dias, link 1–180 dias, arquivos 10 KB–10 MB)' using errcode = '22023';
end $$;

create function public.os_set_logo(p_org uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.os_guard(p_org, 'owner');
  if p_path is not null and (p_path !~ ('^' || p_org::text || '/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$')) then raise exception 'caminho de logotipo inválido' using errcode = '22023'; end if;
  update public.os_settings set logo_path = p_path where organization_id = p_org;
end $$;

-- ======================================================================= técnicos: desativar/reativar
-- Ao desativar, as ordens abertas dele voltam à fila (agendada → aberta; em execução → pausada com registro).
create function public.os_set_technician_active(p_org uuid, p_user uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  perform private.os_guard(p_org, 'manager');
  if not exists (select 1 from public.organization_members m where m.organization_id = p_org and m.user_id = p_user and m.role in ('manager', 'member')) then
    raise exception 'só gestores e técnicos podem ser desativados aqui' using errcode = '22023';
  end if;
  if p_user = (select auth.uid()) then raise exception 'você não pode desativar o próprio acesso' using errcode = '22023'; end if;
  if not coalesce(p_active, true) then
    insert into public.technician_status (organization_id, user_id, active, deactivated_at) values (p_org, p_user, false, now())
      on conflict (organization_id, user_id) do update set active = false, deactivated_at = now();
    n := private.os_release_orders(p_org, p_user, 'technician_deactivated');
  else
    insert into public.technician_status (organization_id, user_id, active) values (p_org, p_user, true)
      on conflict (organization_id, user_id) do update set active = true, deactivated_at = null;
  end if;
  return jsonb_build_object('orders_released', n);
end $$;

commit;
