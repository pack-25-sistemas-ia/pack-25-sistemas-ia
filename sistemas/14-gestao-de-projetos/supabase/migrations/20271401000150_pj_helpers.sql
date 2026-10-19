-- Gestão de Projetos e Tarefas — AUXILIARES internos (nada aqui é chamável pela API): validação de texto, eventos, cargas com trava e versão, idempotência,
-- numeração sem MAX+1, ordenação determinística do quadro, notificações e registro de anexos já enviados ao Storage.
-- Ordem de travas (evita impasse): SEMPRE o projeto primeiro, depois a tarefa.

begin;
set local check_function_bodies = off;

create function private.pj_req_text(p text, p_min integer, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := btrim(coalesce(p, ''));
begin
  if char_length(s) < p_min or char_length(s) > p_max then raise exception '% deve ter entre % e % caracteres', p_what, p_min, p_max using errcode = '22023'; end if;
  return s;
end $$;
create function private.pj_opt_text(p text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
declare s text := nullif(btrim(coalesce(p, '')), '');
begin
  if s is not null and char_length(s) > p_max then raise exception '% deve ter no máximo % caracteres', p_what, p_max using errcode = '22023'; end if;
  return s;
end $$;
-- data opcional «AAAA-MM-DD» (nada de timestamp: datas de planejamento não têm fuso)
create function private.pj_opt_date(p text, p_what text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  if p !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '% deve estar no formato AAAA-MM-DD', p_what using errcode = '22023'; end if;
  return p::date;
exception when datetime_field_overflow or invalid_datetime_format then raise exception '% é uma data inválida', p_what using errcode = '22023';
end $$;
revoke all on function private.pj_req_text(text, integer, integer, text), private.pj_opt_text(text, integer, text), private.pj_opt_date(text, text) from public, anon, authenticated;

create function private.pj_conflict(p_what text) returns void language plpgsql immutable set search_path = '' as $$
begin raise exception 'Outra pessoa alterou % antes de você. Atualize a página para ver a versão mais recente antes de continuar.', p_what using errcode = '40001'; end $$;
revoke all on function private.pj_conflict(text) from public, anon, authenticated;

-- ======================================================================= eventos imutáveis (sem texto de comentário, sem segredos)
create function private.pj_project_event(p_org uuid, p_project uuid, p_type text, p_data jsonb default '{}'::jsonb, p_kind text default 'user') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_events (organization_id, project_id, event_type, actor_kind, actor_user_id, data)
  values (p_org, p_project, p_type, p_kind, case when p_kind = 'user' then (select auth.uid()) end, coalesce(p_data, '{}'::jsonb));
end $$;
create function private.pj_task_event(p_org uuid, p_project uuid, p_task uuid, p_type text, p_data jsonb default '{}'::jsonb, p_kind text default 'user') returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_events (organization_id, project_id, task_id, event_type, actor_kind, actor_user_id, data)
  values (p_org, p_project, p_task, p_type, p_kind, case when p_kind = 'user' then (select auth.uid()) end, coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function private.pj_project_event(uuid, uuid, text, jsonb, text), private.pj_task_event(uuid, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- ======================================================================= cargas com trava, acesso e versão
create function private.pj_load_project(p_org uuid, p_project uuid, p_lock boolean, p_expected integer default null) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare p public.projects;
begin
  if p_lock then select * into p from public.projects where id = p_project and organization_id = p_org for update;
  else select * into p from public.projects where id = p_project and organization_id = p_org; end if;
  if not found or private.pj_project_role(p_org, p_project) is null then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;
  if p_expected is not null and p.version <> p_expected then perform private.pj_conflict('este projeto'); end if;
  return p;
end $$;

-- Carrega a tarefa (com trava de linha quando `p_lock`), conferindo acesso ao projeto dela e a versão esperada.
create function private.pj_load_task(p_org uuid, p_task uuid, p_lock boolean, p_expected integer default null) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if p_lock then select * into t from public.tasks where id = p_task and organization_id = p_org for update;
  else select * into t from public.tasks where id = p_task and organization_id = p_org; end if;
  if not found or private.pj_project_role(p_org, t.project_id) is null then raise exception 'tarefa não encontrada' using errcode = 'P0002'; end if;
  if p_expected is not null and t.version <> p_expected then perform private.pj_conflict('esta tarefa'); end if;
  return t;
end $$;
revoke all on function private.pj_load_project(uuid, uuid, boolean, integer), private.pj_load_task(uuid, uuid, boolean, integer) from public, anon, authenticated;

-- Exige papel no projeto: 'edit' (líder/editor/gestão) ou 'lead' (líder/gestão). Leitor e quem não participa recebem «sem permissão».
create function private.pj_require(p_org uuid, p_project uuid, p_level text) returns void
language plpgsql security definer set search_path = '' as $$
declare r text := private.pj_project_role(p_org, p_project);
begin
  if r is null or (p_level = 'edit' and r not in ('lead', 'editor')) or (p_level = 'lead' and r <> 'lead') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
end $$;
revoke all on function private.pj_require(uuid, uuid, text) from public, anon, authenticated;

-- ======================================================================= idempotência
create function private.pj_idem(p_org uuid, p_uid uuid, p_key uuid, p_scope text, p_hash text) returns jsonb
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
create function private.pj_idem_done(p_org uuid, p_uid uuid, p_key uuid, p_result jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.mutation_requests set result = p_result where organization_id = p_org and user_id = p_uid and idempotency_key = p_key;
$$;
create function private.pj_hash(p_parts text[]) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(array_to_string(p_parts, '|'), 'UTF8')), 'hex'); $$;
revoke all on function private.pj_idem(uuid, uuid, uuid, text, text), private.pj_idem_done(uuid, uuid, uuid, jsonb), private.pj_hash(text[]) from public, anon, authenticated;

-- ======================================================================= numeração (a linha do contador é travada até o fim da transação: nunca MAX + 1)
create function private.pj_next_project_number(p_org uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into public.project_number_counters as c (organization_id, last_number) values (p_org, 1)
  on conflict (organization_id) do update set last_number = c.last_number + 1 returning last_number into n;
  return n;
end $$;
create function private.pj_next_task_number(p_org uuid, p_project uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare n bigint;
begin
  insert into public.task_number_counters as c (project_id, organization_id, last_number) values (p_project, p_org, 1)
  on conflict (project_id) do update set last_number = c.last_number + 1 returning last_number into n;
  return n;
end $$;
revoke all on function private.pj_next_project_number(uuid), private.pj_next_task_number(uuid, uuid) from public, anon, authenticated;

-- ======================================================================= ordenação do quadro
-- Reescreve as posições da etapa para exatamente a ordem informada (1..n). O índice único parcial exige duas fases: primeiro afasta todas (+1.000.000), depois numera.
create function private.pj_apply_order(p_column uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  select count(*) into n from public.tasks where column_id = p_column and archived_at is null;
  if n <> coalesce(cardinality(p_ids), 0) then raise exception 'ordem inconsistente da etapa (esperadas % tarefas)', n using errcode = '55000'; end if;
  update public.tasks set position = position + 1000000 where column_id = p_column and archived_at is null;
  update public.tasks t set position = u.ord from unnest(p_ids) with ordinality as u(id, ord) where t.id = u.id and t.column_id = p_column and t.archived_at is null;
end $$;
-- Mantém a ordem atual e fecha os buracos.
create function private.pj_reindex_column(p_column uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.pj_apply_order(p_column, coalesce((select array_agg(id order by position, id) from public.tasks where column_id = p_column and archived_at is null), '{}'::uuid[]));
end $$;
-- Próxima posição ao FIM da etapa (sem reindexar).
create function private.pj_end_position(p_column uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(max(position), 0) + 1 from public.tasks where column_id = p_column and archived_at is null;
$$;
revoke all on function private.pj_apply_order(uuid, uuid[]), private.pj_reindex_column(uuid), private.pj_end_position(uuid) from public, anon, authenticated;

-- ======================================================================= notificações internas
-- Só para quem tem acesso ATUAL ao projeto, nunca para o autor, uma por destinatário.
create function private.pj_notify(p_org uuid, p_project uuid, p_task uuid, p_kind text, p_users uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare u uuid; n integer := 0; me uuid := (select auth.uid());
begin
  for u in select distinct x from unnest(p_users) x where x is not null and x is distinct from me loop
    if private.pj_project_role_of(p_org, p_project, u) is not null then
      insert into public.notifications (organization_id, user_id, kind, project_id, task_id, actor_user_id) values (p_org, u, p_kind, p_project, p_task, me);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.pj_notify(uuid, uuid, uuid, text, uuid[]) from public, anon, authenticated;

-- ======================================================================= anexos já enviados ao Storage
-- Confere caminho (gerado pelo servidor), tipo, tamanho e vincula à tarefa. Nunca aceita caminho de outra tarefa.
create function private.pj_add_attachments(p_org uuid, p_task uuid, p_att jsonb, p_uid uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare a jsonb; maxb integer; n integer := 0; fname text; mime text; sz integer; path text; digest text; ext text;
begin
  if p_att is null or jsonb_typeof(p_att) = 'null' then return 0; end if;
  if jsonb_typeof(p_att) is distinct from 'array' or jsonb_array_length(p_att) > 5 then raise exception 'envie até 5 arquivos por vez' using errcode = '22023'; end if;
  select attachment_max_size_bytes into maxb from public.pj_settings where organization_id = p_org;
  if (select count(*) from public.task_attachments where task_id = p_task) + jsonb_array_length(p_att) > 60 then raise exception 'limite de arquivos da tarefa atingido' using errcode = '22023'; end if;
  for a in select value from jsonb_array_elements(p_att) loop
    path := a ->> 'path'; mime := a ->> 'mime'; fname := a ->> 'filename'; digest := a ->> 'sha256';
    if path is null or path !~ ('^' || p_org::text || '/' || p_task::text || '/[0-9a-f]{32}\.(jpg|png|webp|pdf|txt|csv)$') then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    ext := substring(path from '\.([a-z]+)$');
    if mime is null or mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv') then raise exception 'tipo de arquivo não permitido (use JPEG, PNG, WebP, PDF, TXT ou CSV)' using errcode = '22023'; end if;
    if (mime, ext) not in (('image/png', 'png'), ('image/jpeg', 'jpg'), ('image/webp', 'webp'), ('application/pdf', 'pdf'), ('text/plain', 'txt'), ('text/csv', 'csv')) then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    if jsonb_typeof(a -> 'size') is distinct from 'number' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    sz := (a ->> 'size')::integer;
    if sz < 1 or sz > maxb then raise exception 'arquivo acima do tamanho máximo permitido (% KB)', maxb / 1024 using errcode = '22023'; end if;
    if digest is not null and digest !~ '^[0-9a-f]{64}$' then raise exception 'arquivo inválido' using errcode = '22023'; end if;
    fname := left(regexp_replace(btrim(coalesce(fname, 'arquivo')), '[\\/\x00-\x1f]', '_', 'g'), 180);
    if fname = '' then fname := 'arquivo'; end if;
    insert into public.task_attachments (organization_id, task_id, storage_path, original_filename, mime_type, size_bytes, sha256, uploaded_by) values (p_org, p_task, path, fname, mime, sz, digest, p_uid);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.pj_add_attachments(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

commit;
