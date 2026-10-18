-- Gestão de Ordens de Serviço — ORÇAMENTO VERSIONADO (RPCs os_quote_*): rascunho, publicação (congela), decisão manual da equipe e a decisão única compartilhada com o link do cliente.
-- Regras: totais SEMPRE recalculados no servidor (nunca confia no navegador); total da linha = quantidade × preço unitário arredondado a centavos «meio para cima» (round() do numeric);
-- desconto fixo em centavos, nunca maior que o subtotal (total nunca negativo); publicar congela itens e valores; alterar depois = nova versão; uma decisão por versão.

begin;
set local check_function_bodies = off;

-- Recalcula subtotal/total a partir dos itens (única fonte dos valores gravados).
create function private.os_recalc_quote(p_quote uuid, p_discount bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
declare sub bigint; disc bigint;
begin
  select coalesce(sum(line_total_cents), 0) into sub from public.quote_items where quote_version_id = p_quote;
  select coalesce(p_discount, discount_cents) into disc from public.quote_versions where id = p_quote;
  if disc > sub then raise exception 'o desconto (%) não pode ser maior que o subtotal (%)', private.os_brl(disc), private.os_brl(sub) using errcode = '22023'; end if;
  update public.quote_versions set subtotal_cents = sub, discount_cents = disc, total_cents = sub - disc where id = p_quote;
end $$;
revoke all on function private.os_recalc_quote(uuid, bigint) from public, anon, authenticated;

-- Texto de aceite montado NO BANCO (o cliente aceita exatamente este texto; o navegador não escolhe o que é registrado).
create function private.os_quote_text(p_quote uuid, p_decision text, p_channel text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_channel = 'staff_manual' then
      'Registro manual pela equipe (não é uma ação autenticada do cliente): ' || case p_decision when 'approved' then 'APROVAÇÃO' else 'RECUSA' end
    else 'Declaro, em nome próprio ou como representante do cliente, que li e ' || case p_decision when 'approved' then 'APROVO' else 'RECUSO' end end
    || case when p_channel = 'staff_manual' then ' da versão ' else ' a versão ' end || q.version_number || ' do orçamento da ordem de serviço ' || private.os_number_text(q.organization_id, o.order_number)
    || ', no valor total de ' || private.os_brl(q.total_cents) || ', válido até '
    || to_char(q.valid_until at time zone coalesce((select s.timezone from public.os_settings s where s.organization_id = q.organization_id), 'America/Sao_Paulo'), 'DD/MM/YYYY') || '.'
    || case when p_channel = 'staff_manual' then '' else ' Este aceite simples registra uma manifestação pelo link, sem verificação certificada de identidade.' end
  from public.quote_versions q join public.service_orders o on o.id = q.service_order_id where q.id = p_quote;
$$;
revoke all on function private.os_quote_text(uuid, text, text) from public, anon, authenticated;

-- Decisão única da versão. O CHAMADOR já travou a linha da ordem. Recusa versão expirada, substituída ou já decidida.
create function private.os_decide_quote(p_org uuid, p_quote uuid, p_decision text, p_channel text, p_name text, p_note text, p_operator uuid, p_justification text, p_evidence_att uuid, p_evidence jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare q public.quote_versions; o public.service_orders; did uuid; txt text;
begin
  select * into q from public.quote_versions where id = p_quote and organization_id = p_org for update;
  if not found then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  select * into o from public.service_orders where id = q.service_order_id;
  if p_decision not in ('approved', 'rejected') then raise exception 'decisão inválida' using errcode = '22023'; end if;
  if o.execution_status in ('closed', 'cancelled') then raise exception 'esta ordem não aceita mais decisões' using errcode = '23514'; end if;
  if q.status = 'superseded' then raise exception 'esta versão do orçamento foi substituída por uma mais recente; use a versão vigente' using errcode = '23514'; end if;
  if q.status in ('approved', 'rejected') then raise exception 'esta versão do orçamento já recebeu uma decisão' using errcode = '23514'; end if;
  if q.status <> 'published' then raise exception 'este orçamento ainda não foi publicado' using errcode = '23514'; end if;
  if q.valid_until <= now() then raise exception 'esta versão do orçamento expirou; peça uma nova versão à empresa' using errcode = '23514'; end if;
  txt := private.os_quote_text(p_quote, p_decision, p_channel);
  insert into public.quote_decisions (organization_id, service_order_id, quote_version_id, decision, channel, declared_name, note, accepted_text, operator_user_id, justification, evidence_attachment_id, evidence)
  values (p_org, q.service_order_id, p_quote, p_decision, p_channel, p_name, p_note, txt, p_operator, p_justification, p_evidence_att, coalesce(p_evidence, '{}'::jsonb)) returning id into did;
  update public.quote_versions set status = p_decision where id = p_quote;
  perform private.os_event(p_org, q.service_order_id, case when p_decision = 'approved' then 'quote_approved' else 'quote_rejected' end,
    jsonb_build_object('quote_version_id', p_quote, 'version_number', q.version_number, 'channel', p_channel), case when p_channel = 'customer_link' then 'customer_link' else 'user' end);
  return did;
end $$;
revoke all on function private.os_decide_quote(uuid, uuid, text, text, text, text, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- ======================================================================= rascunho
-- Cria um rascunho copiando os itens da última versão (publicada, aprovada ou recusada). Só um rascunho por ordem.
create function public.os_quote_new_draft(p_org uuid, p_order uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; src public.quote_versions; qid uuid; vn integer; st public.os_settings;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, null);
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não aceita novo orçamento (reabra se precisar)', o.execution_status using errcode = '23514'; end if;
  if exists (select 1 from public.quote_versions where service_order_id = p_order and status = 'draft') then raise exception 'já existe um rascunho de orçamento nesta ordem; continue editando-o' using errcode = '22023'; end if;
  select * into st from public.os_settings where organization_id = p_org;
  select * into src from public.quote_versions where service_order_id = p_order order by version_number desc limit 1;
  vn := coalesce(src.version_number, 0) + 1;
  insert into public.quote_versions (organization_id, service_order_id, version_number, terms_snapshot, created_by)
  values (p_org, p_order, vn, coalesce(src.terms_snapshot, st.default_quote_terms), (select auth.uid())) returning id into qid;
  if src.id is not null then
    insert into public.quote_items (organization_id, quote_version_id, position, kind, service_id, part_id, description, unit, quantity, unit_price_cents, line_total_cents)
    select p_org, qid, position, kind, service_id, part_id, description, unit, quantity, unit_price_cents, line_total_cents from public.quote_items where quote_version_id = src.id;
    perform private.os_recalc_quote(qid, src.discount_cents);
  end if;
  perform private.os_event(p_org, p_order, 'quote_draft_created', jsonb_build_object('quote_version_id', qid, 'version_number', vn));
  return qid;
end $$;

-- Substitui o conteúdo do rascunho (itens, desconto, validade, condições). p_expected = versão do rascunho que o editor carregou (impede sobrescrita silenciosa).
-- p: items[{kind, service_id?, part_id?, description, unit, quantity, unit_price_cents}], discount_cents, valid_date ('AAAA-MM-DD', fim do dia no fuso da empresa), terms, notes.
create function public.os_quote_save_draft(p_org uuid, p_quote uuid, p_expected integer, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quote_versions; o public.service_orders; it jsonb; pos integer := 0; kd text; sid uuid; pid uuid; ds text; un text; qty numeric; price bigint; disc bigint; vd date; tz text; vu timestamptz; res public.quote_versions;
begin
  perform private.os_guard(p_org, 'manager');
  select * into q from public.quote_versions where id = p_quote and organization_id = p_org;
  if not found then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  o := private.os_load_order(p_org, q.service_order_id, true, null);
  select * into q from public.quote_versions where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'só rascunhos podem ser editados: crie uma nova versão' using errcode = '23514'; end if;
  if p_expected is not null and q.version <> p_expected then perform private.os_conflict(); end if;
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não aceita alterações de orçamento', o.execution_status using errcode = '23514'; end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') > 200 then raise exception 'o orçamento aceita até 200 itens' using errcode = '22023'; end if;
  if jsonb_typeof(p -> 'discount_cents') is distinct from 'number' and p ? 'discount_cents' then raise exception 'desconto inválido' using errcode = '22023'; end if;
  disc := coalesce((p ->> 'discount_cents')::bigint, 0);
  if disc < 0 or disc > 100000000000 then raise exception 'desconto fora do permitido' using errcode = '22023'; end if;
  select timezone into tz from public.os_settings where organization_id = p_org;
  if nullif(p ->> 'valid_date', '') is not null then
    vd := (p ->> 'valid_date')::date;
    vu := ((vd + 1)::timestamp at time zone tz) - interval '1 second';
  end if;
  delete from public.quote_items where quote_version_id = p_quote;
  for it in select value from jsonb_array_elements(p -> 'items') loop
    pos := pos + 1;
    kd := it ->> 'kind';
    if kd is null or kd not in ('service', 'part') then raise exception 'tipo de item inválido (item %)', pos using errcode = '22023'; end if;
    sid := case when kd = 'service' then nullif(it ->> 'service_id', '')::uuid end; pid := case when kd = 'part' then nullif(it ->> 'part_id', '')::uuid end;
    if sid is not null and not exists (select 1 from public.service_catalog where id = sid and organization_id = p_org) then raise exception 'serviço do catálogo inválido (item %)', pos using errcode = '22023'; end if;
    if pid is not null and not exists (select 1 from public.part_catalog where id = pid and organization_id = p_org) then raise exception 'peça do catálogo inválida (item %)', pos using errcode = '22023'; end if;
    ds := private.os_req_text(it ->> 'description', 2, 200, 'Descrição do item ' || pos); un := private.os_req_text(coalesce(nullif(it ->> 'unit', ''), 'un'), 1, 16, 'Unidade do item ' || pos);
    if jsonb_typeof(it -> 'quantity') is distinct from 'number' or jsonb_typeof(it -> 'unit_price_cents') is distinct from 'number' then raise exception 'quantidade e preço do item % precisam ser números', pos using errcode = '22023'; end if;
    qty := (it ->> 'quantity')::numeric; price := (it ->> 'unit_price_cents')::bigint;
    if qty <> round(qty, 3) then raise exception 'a quantidade do item % aceita no máximo 3 casas decimais', pos using errcode = '22023'; end if;
    if qty <= 0 or qty > 1000000 then raise exception 'quantidade do item % fora do permitido', pos using errcode = '22023'; end if;
    if price < 0 or price > 1000000000 then raise exception 'preço do item % fora do permitido', pos using errcode = '22023'; end if;
    insert into public.quote_items (organization_id, quote_version_id, position, kind, service_id, part_id, description, unit, quantity, unit_price_cents, line_total_cents)
    values (p_org, p_quote, pos, kd, sid, pid, ds, un, qty, price, round(qty * price));
  end loop;
  update public.quote_versions set valid_until = coalesce(vu, valid_until), terms_snapshot = private.os_opt_text(p ->> 'terms', 2000, 'Condições'), notes = private.os_opt_text(p ->> 'notes', 1000, 'Observações')
    where id = p_quote;
  perform private.os_recalc_quote(p_quote, disc);
  select * into res from public.quote_versions where id = p_quote;
  return jsonb_build_object('version', res.version, 'subtotal_cents', res.subtotal_cents, 'discount_cents', res.discount_cents, 'total_cents', res.total_cents);
end $$;

-- ======================================================================= publicar
-- Congela a versão, substitui a publicada anterior (ainda sem decisão) e fixa o snapshot do cliente/local vigente.
create function public.os_quote_publish(p_org uuid, p_quote uuid, p_expected integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.quote_versions; o public.service_orders; st public.os_settings; n integer; vu timestamptz;
begin
  perform private.os_guard(p_org, 'manager');
  select * into q from public.quote_versions where id = p_quote and organization_id = p_org;
  if not found then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  o := private.os_load_order(p_org, q.service_order_id, true, null);
  select * into q from public.quote_versions where id = p_quote for update;
  if q.status <> 'draft' then raise exception 'esta versão já foi publicada' using errcode = '23514'; end if;
  if p_expected is not null and q.version <> p_expected then perform private.os_conflict(); end if;
  if o.execution_status in ('completed', 'closed', 'cancelled') then raise exception 'ordem % não aceita alterações de orçamento', o.execution_status using errcode = '23514'; end if;
  select count(*) into n from public.quote_items where quote_version_id = p_quote;
  if n = 0 then raise exception 'adicione ao menos um item antes de publicar' using errcode = '22023'; end if;
  perform private.os_recalc_quote(p_quote);
  select * into st from public.os_settings where organization_id = p_org;
  vu := coalesce(q.valid_until, now() + make_interval(days => st.quote_validity_days));
  if vu <= now() then raise exception 'a validade do orçamento precisa ser futura' using errcode = '22023'; end if;
  update public.quote_versions set status = 'superseded' where service_order_id = q.service_order_id and status = 'published';
  update public.quote_versions set status = 'published', published_at = clock_timestamp(), published_by = (select auth.uid()), valid_until = vu,
    terms_snapshot = coalesce(terms_snapshot, st.default_quote_terms), snapshot_version = private.os_snapshot_current(q.service_order_id)
    where id = p_quote;
  perform private.os_event(p_org, q.service_order_id, 'quote_published', jsonb_build_object('quote_version_id', p_quote, 'version_number', q.version_number));
  return jsonb_build_object('quote_version_id', p_quote, 'version_number', q.version_number, 'valid_until', vu);
end $$;

-- ======================================================================= decisão registrada manualmente pela equipe
-- Aparece como tal (operador + justificativa; evidência opcional). NÃO é uma ação autenticada do cliente.
create function public.os_quote_decide_manual(p_org uuid, p_quote uuid, p_decision text, p_declared_name text, p_justification text, p_note text, p_evidence uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare q public.quote_versions; o public.service_orders; nm text; jst text;
begin
  perform private.os_guard(p_org, 'manager');
  select * into q from public.quote_versions where id = p_quote and organization_id = p_org;
  if not found then raise exception 'orçamento não encontrado' using errcode = 'P0002'; end if;
  o := private.os_load_order(p_org, q.service_order_id, true, null);
  nm := private.os_req_text(p_declared_name, 2, 120, 'Nome de quem aprovou'); jst := private.os_req_text(p_justification, 10, 500, 'Justificativa');
  if p_evidence is not null and not exists (select 1 from public.order_attachments where id = p_evidence and service_order_id = q.service_order_id and organization_id = p_org) then
    raise exception 'a evidência precisa ser um arquivo desta ordem' using errcode = '22023';
  end if;
  return private.os_decide_quote(p_org, p_quote, p_decision, 'staff_manual', nm, private.os_opt_text(p_note, 1000, 'Observação'), (select auth.uid()), jst, p_evidence, '{}'::jsonb);
end $$;

commit;
