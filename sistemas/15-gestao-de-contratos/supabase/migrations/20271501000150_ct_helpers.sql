-- Gestão de Contratos — AUXILIARES internos (nada aqui é chamável pela API): validação de texto, eventos, cargas com trava e versão, idempotência, numeração sem MAX+1,
-- datas (soma de meses com último dia válido, prazo de aviso), prazos derivados com revisão, valor vigente, notificações e registro de arquivos já enviados ao Storage.
-- Ordem de travas (evita impasse): SEMPRE o contrato primeiro, depois filhos (documento, obrigação).

begin;
set local check_function_bodies = off;

create function private.ct_req_text(p text, p_min integer, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, ''));
begin
  if char_length(s) < p_min or char_length(s) > p_max then raise exception '% deve ter entre % e % caracteres', p_what, p_min, p_max using errcode = '22023'; end if;
  return s;
end $$;
create function private.ct_opt_text(p text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := nullif(btrim(coalesce(p, '')), '');
begin
  if s is not null and char_length(s) > p_max then raise exception '% deve ter no máximo % caracteres', p_what, p_max using errcode = '22023'; end if;
  return s;
end $$;
create function private.ct_opt_date(p text, p_what text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  if p !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% deve estar no formato AAAA-MM-DD', p_what using errcode = '22023'; end if;
  return p::date;
exception when datetime_field_overflow or invalid_datetime_format then raise exception '% é uma data inválida', p_what using errcode = '22023';
end $$;
revoke all on function private.ct_req_text(text, integer, integer, text), private.ct_opt_text(text, integer, text), private.ct_opt_date(text, text) from public, anon, authenticated;

create function private.ct_conflict(p_what text) returns void language plpgsql immutable set search_path = '' as $$
begin raise exception 'Outra pessoa alterou % antes de você. Atualize a página para ver a versão mais recente antes de continuar.', p_what using errcode = '40001'; end $$;
revoke all on function private.ct_conflict(text) from public, anon, authenticated;

-- ======================================================================= datas
-- Soma de meses limitada ao último dia válido (31/01 + 1 mês = 28/02 ou 29/02).
create function private.ct_add_months(p_date date, p_months integer) returns date
language sql immutable set search_path = '' as $$ select (p_date + make_interval(months => p_months))::date; $$;
-- Prazo de aviso = data de referência − dias corridos (sem feriados, sem interpretar cláusulas).
create function private.ct_notice_deadline(p_ref date, p_days integer) returns date
language sql immutable set search_path = '' as $$ select p_ref - p_days; $$;
create function private.ct_today(p_org uuid) returns date
language sql stable set search_path = '' as $$ select (now() at time zone coalesce((select timezone from public.ct_settings where organization_id = p_org), 'America/Sao_Paulo'))::date; $$;
-- Reajuste: novo = base × (1 + pct/100), numeric exato; arredonda meio para cima (para longe de zero) em centavos.
create function private.ct_apply_percentage(p_base bigint, p_pct numeric) returns bigint
language sql immutable set search_path = '' as $$ select round(p_base::numeric * (100 + p_pct) / 100)::bigint; $$;
revoke all on function private.ct_add_months(date, integer), private.ct_notice_deadline(date, integer), private.ct_today(uuid), private.ct_apply_percentage(bigint, numeric) from public, anon, authenticated;

-- ======================================================================= eventos imutáveis (sem texto livre sensível, sem segredos)
create function private.ct_event(p_org uuid, p_contract uuid, p_type text, p_data jsonb default '{}'::jsonb, p_kind text default 'user') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.contract_events (organization_id, contract_id, event_type, actor_kind, actor_user_id, data)
  values (p_org, p_contract, p_type, p_kind, case when p_kind = 'user' then (select auth.uid()) end, coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function private.ct_event(uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- ======================================================================= cargas com trava, acesso e versão
create function private.ct_load_contract(p_org uuid, p_contract uuid, p_lock boolean, p_expected integer default null) returns public.contracts
language plpgsql security definer set search_path = '' as $$
declare c public.contracts;
begin
  if p_lock then select * into c from public.contracts where id = p_contract and organization_id = p_org for update;
  else select * into c from public.contracts where id = p_contract and organization_id = p_org; end if;
  if not found or private.ct_contract_role(p_org, p_contract) is null then raise exception 'contrato não encontrado' using errcode = 'P0002'; end if;
  if p_expected is not null and c.version <> p_expected then perform private.ct_conflict('este contrato'); end if;
  return c;
end $$;
revoke all on function private.ct_load_contract(uuid, uuid, boolean, integer) from public, anon, authenticated;

-- Exige papel no contrato: 'edit' (gestão ou editor) ou 'manage' (gestão). Leitor e quem não tem acesso recebem «sem permissão».
create function private.ct_require(p_org uuid, p_contract uuid, p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare r text := private.ct_contract_role(p_org, p_contract);
begin
  if r is null or (p_level = 'edit' and r not in ('manager', 'editor')) or (p_level = 'manage' and r <> 'manager') then raise exception 'sem permissão' using errcode = '42501'; end if;
end $$;
revoke all on function private.ct_require(uuid, uuid, text) from public, anon, authenticated;

-- Contrato que aceita edição de dados: rascunho ou ativo, não arquivado.
create function private.ct_open_for_edit(c public.contracts) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if c.archived_at is not null then raise exception 'contrato arquivado é somente para consulta' using errcode = '23514'; end if;
  if c.lifecycle_status in ('terminated', 'closed') then raise exception 'contrato encerrado é somente para consulta (reabra para alterar)' using errcode = '23514'; end if;
end $$;
revoke all on function private.ct_open_for_edit(public.contracts) from public, anon, authenticated;

-- ======================================================================= idempotência
create function private.ct_idem(p_org uuid, p_uid uuid, p_key uuid, p_scope text, p_hash text) returns jsonb
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
create function private.ct_idem_done(p_org uuid, p_uid uuid, p_key uuid, p_result jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.mutation_requests set result = p_result where organization_id = p_org and user_id = p_uid and idempotency_key = p_key;
$$;
create function private.ct_hash(p_parts text[]) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(array_to_string(p_parts, '|'), 'UTF8')), 'hex'); $$;
revoke all on function private.ct_idem(uuid, uuid, uuid, text, text), private.ct_idem_done(uuid, uuid, uuid, jsonb), private.ct_hash(text[]) from public, anon, authenticated;

-- numeração (a linha do contador é travada até o fim da transação: nunca MAX + 1)
create function private.ct_next_contract_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into public.contract_number_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1 returning last_number into n;
  return n;
end $$;
revoke all on function private.ct_next_contract_number(uuid) from public, anon, authenticated;

-- ======================================================================= prazos derivados (revisões)
-- Mantém exatamente um prazo corrente por tipo. Mudou a data → o anterior vira «substituído» e nasce uma nova revisão (lembretes antigos deixam de valer).
create function private.ct_sync_deadlines(p_contract uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contracts; r public.contract_adjustment_rules; t text; want date; cur public.contract_deadlines; ref text; changed boolean := false;
begin
  select * into c from public.contracts where id = p_contract;
  select * into r from public.contract_adjustment_rules where contract_id = p_contract and active;
  foreach t in array array['contract_end', 'notice', 'adjustment'] loop
    want := case when c.lifecycle_status not in ('draft', 'active') or c.archived_at is not null then null
      when t = 'contract_end' then c.end_date when t = 'notice' then c.notice_deadline_date when t = 'adjustment' then r.next_adjustment_date end;
    ref := case t when 'contract_end' then 'fim da vigência' when 'notice' then case when c.notice_adjusted then 'prazo de aviso (ajustado)' else 'prazo de aviso' end else coalesce('reajuste: ' || r.reference_label, 'reajuste') end;
    select * into cur from public.contract_deadlines where contract_id = p_contract and deadline_type = t and superseded_at is null;
    if found and want is not null and cur.due_date = want then continue; end if;
    if found then update public.contract_deadlines set superseded_at = clock_timestamp() where id = cur.id; end if;
    if want is not null then
      insert into public.contract_deadlines (organization_id, contract_id, deadline_type, due_date, source_reference, revision)
      values (c.organization_id, p_contract, t, want, ref, coalesce((select max(revision) from public.contract_deadlines where contract_id = p_contract and deadline_type = t), 0) + 1);
    end if;
    changed := true;
  end loop;
  if changed then update public.contracts set deadline_revision = deadline_revision + 1 where id = p_contract; end if;
end $$;
revoke all on function private.ct_sync_deadlines(uuid) from public, anon, authenticated;

-- Valor vigente numa data: a versão com maior effective_from <= data.
create function private.ct_value_at(p_contract uuid, p_date date) returns public.contract_value_versions
language sql stable security definer set search_path = '' as $$
  select v from public.contract_value_versions v where v.contract_id = p_contract and v.effective_from <= p_date order by v.effective_from desc limit 1;
$$;
revoke all on function private.ct_value_at(uuid, date) from public, anon, authenticated;

-- ======================================================================= notificações internas
-- Só para quem tem acesso ATUAL ao contrato, nunca para o autor, uma por destinatário.
create function private.ct_notify(p_org uuid, p_contract uuid, p_kind text, p_users uuid[], p_source uuid default null, p_due date default null, p_offset integer default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid; n integer := 0; me uuid := (select auth.uid());
begin
  for u in select distinct x from unnest(p_users) x where x is not null and x is distinct from me loop
    if private.ct_contract_role_of(p_org, p_contract, u) is not null then
      insert into public.notifications (organization_id, user_id, kind, contract_id, source_id, due_date, offset_days, actor_user_id) values (p_org, u, p_kind, p_contract, p_source, p_due, p_offset, me);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.ct_notify(uuid, uuid, text, uuid[], uuid, date, integer) from public, anon, authenticated;

-- ======================================================================= arquivos já enviados ao Storage
-- p_file: {path, mime, size, filename, sha256?}. Caminho gerado pelo servidor: <org>/<contrato>/<32 hex>.<ext>. Nunca aceita caminho de outro contrato.
create function private.ct_add_doc_version(p_org uuid, p_contract uuid, p_document uuid, p_file jsonb, p_uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare maxb integer; fname text; mime text; sz integer; path text; digest text; ext text; vid uuid; num integer;
begin
  if p_file is null or jsonb_typeof(p_file) is distinct from 'object' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
  select attachment_max_size_bytes into maxb from public.ct_settings where organization_id = p_org;
  path := p_file ->> 'path'; mime := p_file ->> 'mime'; fname := p_file ->> 'filename'; digest := p_file ->> 'sha256';
  if path is null or path !~ ('^' || p_org::text || '/' || p_contract::text || '/[0-9a-f]{32}\.(pdf|docx|jpg|png|webp)$') then raise exception 'arquivo inválido' using errcode = '22023'; end if;
  ext := substring(path from '\.([a-z]+)$');
  if mime is null or mime not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'tipo de arquivo não permitido (use PDF, DOCX, JPEG, PNG ou WebP)' using errcode = '22023';
  end if;
  if (mime, ext) not in (('application/pdf', 'pdf'), ('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'), ('image/jpeg', 'jpg'), ('image/png', 'png'), ('image/webp', 'webp')) then
    raise exception 'arquivo inválido' using errcode = '22023';
  end if;
  if jsonb_typeof(p_file -> 'size') is distinct from 'number' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
  sz := (p_file ->> 'size')::integer;
  if sz < 1 or sz > maxb then raise exception 'arquivo acima do tamanho máximo permitido (% MB)', maxb / 1048576 using errcode = '22023'; end if;
  if digest is not null and digest !~ '^[0-9a-f]{64}$' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
  fname := left(regexp_replace(btrim(coalesce(fname, 'arquivo')), '[\\/\x00-\x1f]', '_', 'g'), 180);
  if fname = '' then fname := 'arquivo'; end if;
  update public.contract_documents set version_counter = version_counter + 1 where id = p_document returning version_counter into num;
  insert into public.contract_document_versions (organization_id, document_id, version_number, storage_path, original_filename, mime_type, size_bytes, sha256, uploaded_by)
    values (p_org, p_document, num, path, fname, mime, sz, digest, p_uid) returning id into vid;
  update public.contract_documents set current_version_id = vid where id = p_document;
  return vid;
end $$;
revoke all on function private.ct_add_doc_version(uuid, uuid, uuid, jsonb, uuid) from public, anon, authenticated;

commit;
