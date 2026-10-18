-- Gestão de Ordens de Serviço — AUXILIARES internos (nada aqui é chamável pela API): validação de texto/documento, eventos, carga da ordem com trava e versão,
-- idempotência, numeração por empresa sem MAX+1, formatação de valores e registro de anexos já enviados ao Storage.

begin;
set local check_function_bodies = off;

create function private.os_req_text(p text, p_min integer, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, ''));
begin
  if char_length(s) < p_min or char_length(s) > p_max then raise exception '% deve ter entre % e % caracteres', p_what, p_min, p_max using errcode = '22023'; end if;
  return s;
end $$;
create function private.os_opt_text(p text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := nullif(btrim(coalesce(p, '')), '');
begin
  if s is not null and char_length(s) > p_max then raise exception '% deve ter no máximo % caracteres', p_what, p_max using errcode = '22023'; end if;
  return s;
end $$;
revoke all on function private.os_req_text(text, integer, integer, text), private.os_opt_text(text, integer, text) from public, anon, authenticated;

-- CPF/CNPJ com dígitos verificadores (só dígitos; sequências repetidas são recusadas).
create function private.os_valid_document(d text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare i integer; s integer; dv1 integer; dv2 integer; w1 integer[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 integer[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d is null or d !~ '^([0-9]{11}|[0-9]{14})$' or d ~ '^(.)\1+$' then return false; end if;
  if char_length(d) = 11 then
    s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::integer * (11 - i); end loop;
    dv1 := (s * 10) % 11; if dv1 = 10 then dv1 := 0; end if;
    s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::integer * (12 - i); end loop;
    dv2 := (s * 10) % 11; if dv2 = 10 then dv2 := 0; end if;
    return dv1 = substr(d, 10, 1)::integer and dv2 = substr(d, 11, 1)::integer;
  end if;
  s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::integer * w1[i]; end loop;
  dv1 := s % 11; dv1 := case when dv1 < 2 then 0 else 11 - dv1 end;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::integer * w2[i]; end loop;
  dv2 := s % 11; dv2 := case when dv2 < 2 then 0 else 11 - dv2 end;
  return dv1 = substr(d, 13, 1)::integer and dv2 = substr(d, 14, 1)::integer;
end $$;
revoke all on function private.os_valid_document(text) from public, anon, authenticated;

-- Valor em reais no formato brasileiro («R$ 1.234,56») para os textos de aceite montados NO BANCO.
create function private.os_brl(p_cents bigint) returns text
language sql immutable set search_path = '' as $$
  select 'R$ ' || replace(replace(replace(to_char(p_cents / 100.0, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;
revoke all on function private.os_brl(bigint) from public, anon, authenticated;

create function private.os_conflict() returns void language plpgsql immutable set search_path = '' as $$
begin raise exception 'Esta ordem foi alterada por outra pessoa. Atualize a página para ver a versão mais recente antes de continuar.' using errcode = '40001'; end $$;
revoke all on function private.os_conflict() from public, anon, authenticated;

-- Evento imutável da ordem (sem valores pessoais: só ids, estados e versões).
create function private.os_event(p_org uuid, p_order uuid, p_type text, p_data jsonb default '{}'::jsonb, p_kind text default 'user') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.order_events (organization_id, service_order_id, event_type, actor_kind, actor_user_id, data)
  values (p_org, p_order, p_type, p_kind, case when p_kind = 'user' then (select auth.uid()) end, coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function private.os_event(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- Carrega a ordem (com trava de linha quando `p_lock`), conferindo acesso do usuário atual e a versão esperada.
create function private.os_load_order(p_org uuid, p_order uuid, p_lock boolean, p_expected integer) returns public.service_orders
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders;
begin
  if p_lock then select * into o from public.service_orders where id = p_order and organization_id = p_org for update;
  else select * into o from public.service_orders where id = p_order and organization_id = p_org; end if;
  if not found or not private.os_order_visible(p_org, o.assigned_technician_user_id) then raise exception 'ordem de serviço não encontrada' using errcode = 'P0002'; end if;
  if p_expected is not null and o.version <> p_expected then perform private.os_conflict(); end if;
  return o;
end $$;
revoke all on function private.os_load_order(uuid, uuid, boolean, integer) from public, anon, authenticated;

-- Idempotência: devolve o resultado guardado se a MESMA chave já concluiu; NULL se esta chamada é a primeira (e reserva a chave).
create function private.os_idem(p_org uuid, p_uid uuid, p_key uuid, p_scope text, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n integer; r public.mutation_requests;
begin
  if p_key is null then raise exception 'solicitação inválida (chave ausente)' using errcode = '22023'; end if;
  insert into public.mutation_requests (organization_id, user_id, idempotency_key, scope, request_hash) values (p_org, p_uid, p_key, p_scope, p_hash) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 1 then return null; end if;
  select * into r from public.mutation_requests where organization_id = p_org and user_id = p_uid and idempotency_key = p_key;
  if r.scope <> p_scope or r.request_hash <> p_hash then raise exception 'esta solicitação já foi usada com outros dados; recarregue a página' using errcode = '22023'; end if;
  if r.result is null then raise exception 'solicitação em andamento; aguarde alguns segundos' using errcode = '55000'; end if;
  return r.result;
end $$;
revoke all on function private.os_idem(uuid, uuid, uuid, text, text) from public, anon, authenticated;

create function private.os_idem_done(p_org uuid, p_uid uuid, p_key uuid, p_result jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.mutation_requests set result = p_result where organization_id = p_org and user_id = p_uid and idempotency_key = p_key;
$$;
revoke all on function private.os_idem_done(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

create function private.os_hash(p_parts text[]) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(array_to_string(p_parts, '|'), 'UTF8')), 'hex'); $$;
revoke all on function private.os_hash(text[]) from public, anon, authenticated;

-- Numeração legível e única por empresa. A linha do contador é travada até o fim da transação: nunca MAX + 1 (que repetiria números sob concorrência).
create function private.os_next_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into public.order_number_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1 returning last_number into n;
  return n;
end $$;
revoke all on function private.os_next_number(uuid) from public, anon, authenticated;

create function private.os_number_text(p_org uuid, p_number bigint) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select order_prefix from public.os_settings where organization_id = p_org), 'OS') || '-' || lpad(p_number::text, 5, '0');
$$;
revoke all on function private.os_number_text(uuid, bigint) from public, anon, authenticated;

-- Anexos já enviados ao Storage: confere caminho (gerado pelo servidor), tipo, tamanho e vincula à ordem/nota/item. Nunca aceita caminho de outra ordem.
create function private.os_add_attachments(p_org uuid, p_order uuid, p_update uuid, p_item uuid, p_att jsonb, p_uid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare a jsonb; maxb integer; n integer := 0; fname text; mime text; sz integer; path text; cat text; vis text; digest text;
begin
  if p_att is null or jsonb_typeof(p_att) = 'null' then return 0; end if;
  if jsonb_typeof(p_att) is distinct from 'array' or jsonb_array_length(p_att) > 5 then raise exception 'envie até 5 arquivos por vez' using errcode = '22023'; end if;
  select attachment_max_size_bytes into maxb from public.os_settings where organization_id = p_org;
  if (select count(*) from public.order_attachments where service_order_id = p_order) + jsonb_array_length(p_att) > 120 then raise exception 'limite de arquivos da ordem atingido' using errcode = '22023'; end if;
  if p_item is not null and not exists (select 1 from public.order_checklist_items where id = p_item and service_order_id = p_order and organization_id = p_org) then
    raise exception 'item de checklist não pertence a esta ordem' using errcode = '22023';
  end if;
  if p_update is not null and not exists (select 1 from public.order_updates where id = p_update and service_order_id = p_order and organization_id = p_org) then
    raise exception 'nota não pertence a esta ordem' using errcode = '22023';
  end if;
  for a in select value from jsonb_array_elements(p_att) loop
    path := a ->> 'path'; mime := a ->> 'mime'; fname := a ->> 'filename'; cat := coalesce(a ->> 'category', 'during'); vis := coalesce(a ->> 'visibility', 'internal'); digest := a ->> 'sha256';
    if path is null or path !~ ('^' || p_org::text || '/' || p_order::text || '/[0-9a-f]{32}\.(jpg|png|webp|pdf)$') then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    if mime is null or mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf') then raise exception 'tipo de arquivo não permitido (use JPEG, PNG, WebP ou PDF)' using errcode = '22023'; end if;
    if (mime = 'application/pdf') <> (path ~ '\.pdf$') then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    if cat not in ('before', 'during', 'after', 'document') then raise exception 'categoria inválida' using errcode = '22023'; end if;
    if vis not in ('internal', 'customer') then raise exception 'visibilidade inválida' using errcode = '22023'; end if;
    if mime = 'application/pdf' and cat <> 'document' then raise exception 'PDF só pode ser enviado como documento' using errcode = '22023'; end if;
    if jsonb_typeof(a -> 'size') is distinct from 'number' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    sz := (a ->> 'size')::integer;
    if sz < 1 or sz > maxb then raise exception 'arquivo acima do tamanho máximo permitido (% KB)', maxb / 1024 using errcode = '22023'; end if;
    if digest is not null and digest !~ '^[0-9a-f]{64}$' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    fname := left(regexp_replace(btrim(coalesce(fname, 'arquivo')), '[\\/\x00-\x1f]', '_', 'g'), 180);
    if fname = '' then fname := 'arquivo'; end if;
    insert into public.order_attachments (organization_id, service_order_id, update_id, checklist_item_id, category, visibility, storage_path, original_filename, content_type, size_bytes, sha256, uploaded_by)
    values (p_org, p_order, p_update, p_item, cat, vis, path, fname, mime, sz, digest, p_uid);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.os_add_attachments(uuid, uuid, uuid, uuid, jsonb, uuid) from public, anon, authenticated;

commit;
