-- Gestão de Ordens de Serviço — STORAGE PRIVADO.
--  · os-files: bucket PRIVADO (fotos e documentos das ordens; 10 MB no máximo, allowlist JPEG/PNG/WebP/PDF; sem SVG, HTML nem executáveis);
--  · os-logos: logotipo da marca (público por natureza; só imagens raster pequenas; só o proprietário grava/remove).
-- Arquivos: caminho <organização>/<ordem>/<32 hex>.<ext> GERADO PELO SERVIDOR. Envio: quem pode ver a ordem (técnico só nas dele). Leitura: SOMENTE se o arquivo tem registro
-- e o usuário pode ver a ordem dona dele. Remoção: só a gestão, e só de arquivos ÓRFÃOS (sem registro) com mais de 2 horas.
-- O cliente por link NÃO fala com o Storage: o servidor da aplicação valida o token (os_public_file) e busca o arquivo repassando o token no cabeçalho `x-os-token`.
-- O Storage expõe esse cabeçalho às políticas (`request.headers`); a política abaixo só libera, para o papel anon, arquivos COMPARTILHADOS (visibilidade «customer») da ordem do token
-- válido (hash conferido, não revogado, não expirado). Sem o cabeçalho, ou com token errado, o anônimo não lê nem LISTA nada.
-- Só cria os buckets se o Storage existir (Postgres puro de teste não tem).

-- Porta pública (somente leitura): conferida pela política do Storage. Marcada PUBLIC_ENDPOINT em 999999 (teste do Core). Devolve só verdadeiro/falso.
create function public.os_public_object_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare h text := nullif(current_setting('request.headers', true), ''); tok text;
begin
  if h is null or p_name is null then return false; end if;
  begin tok := (h::json) ->> 'x-os-token'; exception when others then return false; end;
  if tok is null or tok !~ '^[A-Za-z0-9_-]{43}$' then return false; end if;
  return exists (
    select 1 from public.public_access_tokens t
    join public.order_attachments a on a.service_order_id = t.service_order_id and a.organization_id = t.organization_id
    where t.token_hash = sha256(convert_to(tok, 'UTF8')) and t.revoked_at is null and t.expires_at > now()
      and a.storage_path = p_name and a.visibility = 'customer');
end $$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('os-files', 'os-files', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('os-logos', 'os-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp']) on conflict (id) do nothing;

    execute $p$create policy os_files_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'os-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|png|webp|pdf)$'
      and private.os_can_see_order(split_part(objects.name, '/', 1)::uuid, split_part(objects.name, '/', 2)::uuid))$p$;
    execute $p$create policy os_files_select on storage.objects for select to authenticated using (
      bucket_id = 'os-files'
      and exists (select 1 from public.order_attachments a where a.storage_path = objects.name and private.os_can_see_order(a.organization_id, a.service_order_id)))$p$;
    execute $p$create policy os_files_public_select on storage.objects for select to anon using (
      bucket_id = 'os-files' and public.os_public_object_ok(objects.name))$p$;
    execute $p$create policy os_files_delete_orphans on storage.objects for delete to authenticated using (
      bucket_id = 'os-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and private.os_is_manager(split_part(objects.name, '/', 1)::uuid)
      and objects.created_at < now() - interval '2 hours'
      and not exists (select 1 from public.order_attachments a where a.storage_path = objects.name))$p$;

    execute $p$create policy os_logos_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'os-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$'
      and private.os_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
    execute $p$create policy os_logos_delete on storage.objects for delete to authenticated using (
      bucket_id = 'os-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and private.os_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
  end if;
end $$;
