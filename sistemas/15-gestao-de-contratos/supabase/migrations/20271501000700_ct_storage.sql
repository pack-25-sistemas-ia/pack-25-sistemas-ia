-- Gestão de Contratos — STORAGE PRIVADO.
--  · ct-files: bucket PRIVADO (documentos dos contratos; 20 MB no máximo; allowlist PDF/DOCX/JPEG/PNG/WebP; sem SVG, HTML nem executáveis);
--  · ct-logos: logotipo da marca (público por natureza; só imagens raster pequenas; só o proprietário grava/remove).
-- Documentos: caminho <organização>/<contrato>/<32 hex>.<ext> GERADO PELO SERVIDOR. Envio: quem pode EDITAR o contrato. Leitura: SOMENTE se o arquivo tem registro e o usuário
-- enxerga o contrato (leitor incluído; quem perdeu o acesso deixa de ler na hora). Remoção: só de arquivos ÓRFÃOS (sem registro): quem enviou, de imediato (limpeza de um envio que falhou), ou a gestão, depois de 2 horas.
-- Só cria os buckets se o Storage existir (Postgres puro de teste não tem).

create function private.ct_can_edit_file(p_org uuid, p_contract uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ct_can_edit_contract(p_org, p_contract);
$$;
create function private.ct_can_see_file(p_org uuid, p_contract uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.ct_can_see_contract(p_org, p_contract);
$$;
revoke all on function private.ct_can_edit_file(uuid, uuid), private.ct_can_see_file(uuid, uuid) from public, anon;
grant execute on function private.ct_can_edit_file(uuid, uuid), private.ct_can_see_file(uuid, uuid) to authenticated;

-- As políticas do Storage rodam COMO o usuário, que não pode ler a coluna storage_path (grant por coluna). Por isso consultam o registro por funções com direitos próprios:
--  · ct_file_readable: o arquivo está registrado e o usuário enxerga o contrato dono dele (leitura e URL assinada);
--  · ct_file_registered: o arquivo já tem registro (órfãos, de envio interrompido, podem ser removidos).
create function private.ct_file_readable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.contract_document_versions v join public.contract_documents d on d.id = v.document_id
    where v.storage_path = p_path and private.ct_can_see_contract(d.organization_id, d.contract_id));
$$;
create function private.ct_file_registered(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.contract_document_versions where storage_path = p_path); $$;
revoke all on function private.ct_file_readable(text), private.ct_file_registered(text) from public, anon;
grant execute on function private.ct_file_readable(text), private.ct_file_registered(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ct-files', 'ct-files', false, 20971520, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ct-logos', 'ct-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp']) on conflict (id) do nothing;

    execute $p$create policy ct_files_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'ct-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.(pdf|docx|jpg|png|webp)$'
      and private.ct_can_edit_file(split_part(objects.name, '/', 1)::uuid, split_part(objects.name, '/', 2)::uuid))$p$;
    execute $p$create policy ct_files_select on storage.objects for select to authenticated using (
      bucket_id = 'ct-files'
      and (private.ct_file_readable(objects.name)
        or (objects.owner_id = (select auth.uid())::text and not private.ct_file_registered(objects.name))))$p$; -- o DELETE do Storage precisa enxergar a linha: quem enviou vê o próprio órfão
    execute $p$create policy ct_files_delete_orphans on storage.objects for delete to authenticated using (
      bucket_id = 'ct-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and not private.ct_file_registered(objects.name)
      and (objects.owner_id = (select auth.uid())::text
        or (private.ct_is_manager(split_part(objects.name, '/', 1)::uuid) and objects.created_at < now() - interval '2 hours')))$p$;

    execute $p$create policy ct_logos_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'ct-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$'
      and private.ct_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
    execute $p$create policy ct_logos_delete on storage.objects for delete to authenticated using (
      bucket_id = 'ct-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and private.ct_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
  end if;
end $$;
