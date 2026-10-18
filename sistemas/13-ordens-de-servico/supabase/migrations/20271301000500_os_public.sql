-- Gestão de Ordens de Serviço — ACESSO PÚBLICO POR LINK (/acompanhar/[token]).
-- O token é uma CREDENCIAL: 32 bytes aleatórios gerados pelo servidor da aplicação; o banco guarda SÓ o sha256. Expira e pode ser revogado.
-- As funções os_public_* são as ÚNICAS portas anônimas do sistema. Cada uma: valida o token (formato, hash, validade, revogação), aplica limite de tentativas no banco e
-- devolve uma PROJEÇÃO montada aqui (jamais linhas de tabela): sem notas internas, custos, técnico, CPF/CNPJ, rascunhos, outras ordens nem anexos internos.
-- Token inválido NÃO levanta exceção: devolve {"error":"invalid_link"} (sempre igual: não revela se o link existe, expirou ou foi revogado). Motivo: uma exceção desfaria o contador
-- de tentativas na mesma transação e o limite nunca acumularia. Só o estouro do limite levanta exceção (54000).

begin;
set local check_function_bodies = off;

-- ======================================================================= gestão do link (equipe)
-- p_token_hash: sha256 (hex, 64) do token gerado pelo servidor. Um único link ativo por ordem: gerar outro revoga o anterior.
create function public.os_create_link(p_org uuid, p_order uuid, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; ttl integer; exp timestamptz; tid uuid;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, null);
  if o.execution_status in ('draft', 'cancelled') then raise exception 'ordens em rascunho ou canceladas não têm link de acompanhamento' using errcode = '23514'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'token inválido' using errcode = '22023'; end if;
  perform private.os_rate_hit('link:' || p_org::text || ':' || (select auth.uid())::text, 60, 600);
  select link_ttl_days into ttl from public.os_settings where organization_id = p_org;
  exp := now() + make_interval(days => ttl);
  update public.public_access_tokens set revoked_at = now() where service_order_id = p_order and revoked_at is null;
  insert into public.public_access_tokens (organization_id, service_order_id, token_hash, expires_at, created_by) values (p_org, p_order, decode(p_token_hash, 'hex'), exp, (select auth.uid())) returning id into tid;
  perform private.os_event(p_org, p_order, 'link_created', jsonb_build_object('token_id', tid, 'expires_at', exp));
  return jsonb_build_object('id', tid, 'expires_at', exp);
end $$;

create function public.os_revoke_link(p_org uuid, p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform private.os_guard(p_org, 'manager');
  perform private.os_load_order(p_org, p_order, true, null);
  update public.public_access_tokens set revoked_at = now() where service_order_id = p_order and organization_id = p_org and revoked_at is null;
  get diagnostics n = row_count;
  if n > 0 then perform private.os_event(p_org, p_order, 'link_revoked', '{}'::jsonb); end if;
end $$;

-- ======================================================================= validação do token (interna)
-- Devolve a linha do token se (e só se) é válido agora; caso contrário, uma linha NULA (o chamador responde invalid_link). Limite de tentativas por «origem» (hash do IP informado pelo app) E por prefixo do token.
create function private.os_token_check(p_token text, p_source text) returns public.public_access_tokens
language plpgsql security definer set search_path = '' as $$
declare t public.public_access_tokens; src text := left(coalesce(nullif(p_source, ''), 'sem-origem'), 64);
begin
  perform private.os_rate_hit('pub:' || src, 120, 600);
  -- origem que já errou demais fica barrada, até para um link correto (janela de 10 minutos)
  if private.os_rate_peek('pubfail:' || src, 600) >= 20 then raise exception 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.' using errcode = '54000'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform private.os_rate_bump('pubfail:' || src, 600);
    return null;
  end if;
  select * into t from public.public_access_tokens where token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found or t.revoked_at is not null or t.expires_at <= now() then
    perform private.os_rate_bump('pubfail:' || src, 600);
    return null;
  end if;
  perform private.os_rate_hit('pubtok:' || left(encode(t.token_hash, 'hex'), 16), 300, 600);
  return t;
end $$;
revoke all on function private.os_token_check(text, text) from public, anon, authenticated;

-- Estado do aceite final visto pelo cliente.
create function private.os_public_acceptance(p_order uuid, p_cv integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_cv = 0 then null else coalesce(
    (select jsonb_build_object('decision', a.decision, 'decided_at', a.decided_at, 'declared_name', a.declared_name, 'channel', a.channel) from public.completion_acceptances a where a.service_order_id = p_order and a.completion_version = p_cv),
    jsonb_build_object('decision', 'pending')) end;
$$;
revoke all on function private.os_public_acceptance(uuid, integer) from public, anon, authenticated;

-- ======================================================================= projeção pública
create function public.os_public_view(p_token text, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.public_access_tokens; o public.service_orders; st public.os_settings; snap public.service_order_snapshots; qv public.quote_versions; cmp public.order_completions; res jsonb;
begin
  t := private.os_token_check(p_token, p_source);
  if t.id is null then return jsonb_build_object('error', 'invalid_link'); end if;
  select * into o from public.service_orders where id = t.service_order_id;
  select * into st from public.os_settings where organization_id = o.organization_id;
  select * into snap from public.service_order_snapshots where service_order_id = o.id order by snapshot_version desc limit 1;
  -- versão do orçamento exibida: a publicada (aguardando decisão) ou, se não houver, a mais recente já decidida; rascunho NUNCA.
  select * into qv from public.quote_versions where service_order_id = o.id and status in ('published', 'approved', 'rejected')
    order by (status = 'published') desc, version_number desc limit 1;
  select * into cmp from public.order_completions where service_order_id = o.id order by completion_version desc limit 1;
  update public.public_access_tokens set last_used_at = now() where id = t.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  res := jsonb_build_object(
    'company', jsonb_build_object('name', coalesce(st.public_display_name, (select display_name from public.organization_settings where organization_id = o.organization_id)), 'primary_color', st.primary_color,
      'logo_path', st.logo_path, 'timezone', st.timezone),
    'order', jsonb_build_object('number_text', private.os_number_text(o.organization_id, o.order_number), 'subject', o.subject, 'status', o.execution_status, 'priority', o.priority,
      'scheduled_start_at', o.scheduled_start_at, 'scheduled_end_at', o.scheduled_end_at, 'started_at', o.started_at, 'completed_at', o.completed_at, 'closed_at', o.closed_at,
      'created_at', o.created_at, 'quote_mode', o.quote_mode, 'completion_version', o.completion_version),
    'customer', jsonb_build_object('name', snap.customer_name, 'address', snap.address, 'equipment', snap.equipment),
    'quote', case when qv.id is null then null else jsonb_build_object(
      'id', qv.id, 'version_number', qv.version_number, 'status', qv.status, 'subtotal_cents', qv.subtotal_cents, 'discount_cents', qv.discount_cents, 'total_cents', qv.total_cents,
      'valid_until', qv.valid_until, 'expired', (qv.status = 'published' and qv.valid_until <= now()), 'terms', qv.terms_snapshot, 'notes', qv.notes, 'published_at', qv.published_at,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'description', i.description, 'unit', i.unit, 'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents, 'line_total_cents', i.line_total_cents) order by i.position), '[]'::jsonb)
                from public.quote_items i where i.quote_version_id = qv.id),
      'decision', (select jsonb_build_object('decision', d.decision, 'decided_at', d.decided_at, 'declared_name', d.declared_name, 'channel', d.channel) from public.quote_decisions d where d.quote_version_id = qv.id),
      'text_to_accept', case when qv.status = 'published' and qv.valid_until > now() then private.os_quote_text(qv.id, 'approved', 'customer_link') end,
      'text_to_reject', case when qv.status = 'published' and qv.valid_until > now() then private.os_quote_text(qv.id, 'rejected', 'customer_link') end) end,
    'updates', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'body', u.body, 'created_at', u.created_at) order by u.created_at), '[]'::jsonb)
                from public.order_updates u where u.service_order_id = o.id and u.visibility = 'customer'),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'category', a.category, 'name', a.original_filename, 'content_type', a.content_type, 'size_bytes', a.size_bytes, 'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
              from public.order_attachments a where a.service_order_id = o.id and a.visibility = 'customer'),
    'completion', case when cmp.id is null then null else jsonb_build_object('version', cmp.completion_version, 'summary', cmp.summary, 'completed_at', cmp.completed_at,
      'parts', cmp.parts_snapshot,
      'checklist', (select coalesce(jsonb_agg(jsonb_build_object('group', c ->> 'group', 'label', c ->> 'label', 'not_applicable', (c ->> 'not_applicable')::boolean, 'answer', c -> 'answer')), '[]'::jsonb) from jsonb_array_elements(cmp.checklist_snapshot) c),
      'current', (cmp.completion_version = o.completion_version),
      'acceptance', private.os_public_acceptance(o.id, cmp.completion_version),
      'can_decide', (o.execution_status = 'completed' and cmp.completion_version = o.completion_version
        and not exists (select 1 from public.completion_acceptances a where a.service_order_id = o.id and a.completion_version = cmp.completion_version)),
      'text_to_accept', private.os_completion_text(o.id, cmp.completion_version, 'accepted', 'customer_link'),
      'text_to_contest', private.os_completion_text(o.id, cmp.completion_version, 'contested', 'customer_link')) end,
    'expires_at', t.expires_at);
  return res;
end $$;

-- Texto de aceite da conclusão (montado no banco).
create function private.os_completion_text(p_order uuid, p_cv integer, p_decision text, p_channel text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_channel = 'staff_manual' then 'Registro manual pela equipe (não é uma ação autenticada do cliente): '
         else 'Declaro, em nome próprio ou como representante do cliente, que ' end
    || case when p_channel = 'staff_manual' then case p_decision when 'accepted' then 'ACEITE' else 'CONTESTAÇÃO' end || ' da conclusão (versão ' || p_cv || ') do serviço da ordem '
       else case p_decision when 'accepted' then 'ACEITO' else 'CONTESTO' end || ' a conclusão (versão ' || p_cv || ') do serviço da ordem ' end
    || private.os_number_text(o.organization_id, o.order_number) || '.'
    || case when p_channel = 'staff_manual' then '' else ' Este aceite simples registra uma manifestação pelo link, sem verificação certificada de identidade.' end
  from public.service_orders o where o.id = p_order;
$$;
revoke all on function private.os_completion_text(uuid, integer, text, text) from public, anon, authenticated;

-- ======================================================================= decisões públicas
-- p_quote precisa ser a versão VIGENTE no momento da gravação (travando a ordem, uma publicação concorrente não deixa uma decisão antiga passar).
create function public.os_public_quote_decide(p_token text, p_source text, p_quote uuid, p_decision text, p_name text, p_note text, p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.public_access_tokens; o public.service_orders; nm text; q public.quote_versions;
begin
  t := private.os_token_check(p_token, p_source);
  if t.id is null then return jsonb_build_object('error', 'invalid_link'); end if;
  perform private.os_rate_hit('pubdec:' || left(encode(t.token_hash, 'hex'), 16), 20, 600);
  select * into o from public.service_orders where id = t.service_order_id for update;
  select * into q from public.quote_versions where id = p_quote and service_order_id = o.id;
  if not found then raise exception 'Orçamento não encontrado.' using errcode = 'P0002'; end if;
  nm := private.os_req_text(p_name, 2, 120, 'Seu nome');
  perform private.os_decide_quote(o.organization_id, p_quote, p_decision, 'customer_link', nm, private.os_opt_text(p_note, 1000, 'Observação'), null, null, null,
    jsonb_build_object('token_id', t.id, 'source', left(coalesce(p_source, ''), 64), 'user_agent', left(coalesce(p_evidence ->> 'user_agent', ''), 200)));
  return jsonb_build_object('ok', true, 'decision', p_decision);
end $$;

-- Aceite/contestação da conclusão. Só vale para a versão CORRENTE da conclusão e enquanto a ordem está «concluída». Aceite de versão antiga nunca encerra a nova.
create function public.os_public_completion_decide(p_token text, p_source text, p_completion_version integer, p_decision text, p_name text, p_note text, p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.public_access_tokens; o public.service_orders; nm text; nt text;
begin
  t := private.os_token_check(p_token, p_source);
  if t.id is null then return jsonb_build_object('error', 'invalid_link'); end if;
  perform private.os_rate_hit('pubdec:' || left(encode(t.token_hash, 'hex'), 16), 20, 600);
  select * into o from public.service_orders where id = t.service_order_id for update;
  if p_decision is null or p_decision not in ('accepted', 'contested') then raise exception 'decisão inválida' using errcode = '22023'; end if;
  nm := private.os_req_text(p_name, 2, 120, 'Seu nome');
  nt := private.os_opt_text(p_note, 1000, 'Observação');
  if p_decision = 'contested' and (nt is null or char_length(nt) < 5) then raise exception 'conte o que precisa ser revisto (mínimo 5 caracteres)' using errcode = '22023'; end if;
  if o.execution_status <> 'completed' then raise exception 'esta ordem não está aguardando o seu aceite' using errcode = '23514'; end if;
  if p_completion_version is distinct from o.completion_version then raise exception 'esta conclusão foi substituída por uma mais recente; recarregue a página' using errcode = '23514'; end if;
  if exists (select 1 from public.completion_acceptances where service_order_id = o.id and completion_version = o.completion_version) then raise exception 'esta conclusão já recebeu uma resposta' using errcode = '23514'; end if;
  insert into public.completion_acceptances (organization_id, service_order_id, completion_version, decision, channel, declared_name, accepted_text, note, evidence)
  values (o.organization_id, o.id, o.completion_version, p_decision, 'customer_link', nm, private.os_completion_text(o.id, o.completion_version, p_decision, 'customer_link'), nt,
    jsonb_build_object('token_id', t.id, 'source', left(coalesce(p_source, ''), 64), 'user_agent', left(coalesce(p_evidence ->> 'user_agent', ''), 200)));
  perform private.os_event(o.organization_id, o.id, case when p_decision = 'accepted' then 'completion_accepted' else 'completion_contested' end,
    jsonb_build_object('completion_version', o.completion_version, 'channel', 'customer_link'), 'customer_link');
  return jsonb_build_object('ok', true, 'decision', p_decision);
end $$;

-- Registro manual do aceite/contestação pela equipe (aparece como tal, com operador e justificativa).
create function public.os_completion_decide_manual(p_org uuid, p_order uuid, p_version integer, p_decision text, p_declared_name text, p_justification text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.service_orders; nm text; jst text; nt text;
begin
  perform private.os_guard(p_org, 'manager');
  o := private.os_load_order(p_org, p_order, true, p_version);
  if p_decision is null or p_decision not in ('accepted', 'contested') then raise exception 'decisão inválida' using errcode = '22023'; end if;
  nm := private.os_req_text(p_declared_name, 2, 120, 'Nome de quem aceitou'); jst := private.os_req_text(p_justification, 10, 500, 'Justificativa'); nt := private.os_opt_text(p_note, 1000, 'Observação');
  if p_decision = 'contested' and (nt is null or char_length(nt) < 5) then raise exception 'conte o motivo da contestação (mínimo 5 caracteres)' using errcode = '22023'; end if;
  if o.execution_status <> 'completed' then raise exception 'esta ordem não está aguardando aceite' using errcode = '23514'; end if;
  if exists (select 1 from public.completion_acceptances where service_order_id = o.id and completion_version = o.completion_version) then raise exception 'esta conclusão já recebeu uma resposta' using errcode = '23514'; end if;
  insert into public.completion_acceptances (organization_id, service_order_id, completion_version, decision, channel, declared_name, accepted_text, note, operator_user_id, justification)
  values (p_org, p_order, o.completion_version, p_decision, 'staff_manual', nm, private.os_completion_text(p_order, o.completion_version, p_decision, 'staff_manual'), nt, (select auth.uid()), jst);
  perform private.os_event(p_org, p_order, case when p_decision = 'accepted' then 'completion_accepted' else 'completion_contested' end, jsonb_build_object('completion_version', o.completion_version, 'channel', 'staff_manual'));
end $$;

-- Caminho no Storage de um arquivo COMPARTILHADO (para o servidor assinar uma URL curta). Mesma validação do token; arquivo interno é «inexistente».
create function public.os_public_file(p_token text, p_source text, p_attachment uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.public_access_tokens; a public.order_attachments;
begin
  t := private.os_token_check(p_token, p_source);
  if t.id is null then return jsonb_build_object('error', 'invalid_link'); end if;
  select * into a from public.order_attachments where id = p_attachment and service_order_id = t.service_order_id and visibility = 'customer';
  if not found then raise exception 'Arquivo não encontrado.' using errcode = 'P0002'; end if;
  return jsonb_build_object('path', a.storage_path, 'content_type', a.content_type, 'name', a.original_filename);
end $$;

-- Dados do documento (PDF) do cliente: ordem, orçamento publicado/decidido OU conclusão. Mesma projeção pública (nunca notas internas, custos ou CPF/CNPJ).
-- O PDF usa os dados do SNAPSHOT da época do documento, não o cadastro atual do cliente.
create function public.os_public_document(p_token text, p_source text, p_kind text, p_ref integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.public_access_tokens;
begin
  t := private.os_token_check(p_token, p_source);
  if t.id is null then return jsonb_build_object('error', 'invalid_link'); end if;
  return private.os_document_data(t.service_order_id, p_kind, p_ref);
end $$;

commit;
