-- Gestão de Projetos e Tarefas — STORAGE PRIVADO.
--  · pj-files: bucket PRIVADO (anexos das tarefas; 10 MB no máximo; allowlist JPEG/PNG/WebP/PDF/TXT/CSV; sem SVG, HTML nem executáveis);
--  · pj-logos: logotipo da marca (público por natureza; só imagens raster pequenas; só o proprietário grava/remove).
-- Anexos: caminho <organização>/<tarefa>/<32 hex>.<ext> GERADO PELO SERVIDOR. Envio: quem pode EDITAR o projeto da tarefa. Leitura: SOMENTE se o arquivo tem registro e o usuário
-- enxerga o projeto da tarefa (leitor incluído; quem perdeu o acesso deixa de ler na hora). Remoção: só a gestão e só de arquivos ÓRFÃOS (sem registro) com mais de 2 horas.
-- Só cria os buckets se o Storage existir (Postgres puro de teste não tem).

create function private.pj_can_edit_task(p_org uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = p_task and t.organization_id = p_org and private.pj_can_edit_project(t.organization_id, t.project_id));
$$;
create function private.pj_can_see_task(p_org uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = p_task and t.organization_id = p_org and private.pj_can_see_project(t.organization_id, t.project_id));
$$;
revoke all on function private.pj_can_edit_task(uuid, uuid), private.pj_can_see_task(uuid, uuid) from public, anon;
grant execute on function private.pj_can_edit_task(uuid, uuid), private.pj_can_see_task(uuid, uuid) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('pj-files', 'pj-files', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'])
    on conflict (id) do nothing;
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('pj-logos', 'pj-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp']) on conflict (id) do nothing;

    execute $p$create policy pj_files_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'pj-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.(jpg|png|webp|pdf|txt|csv)$'
      and private.pj_can_edit_task(split_part(objects.name, '/', 1)::uuid, split_part(objects.name, '/', 2)::uuid))$p$;
    execute $p$create policy pj_files_select on storage.objects for select to authenticated using (
      bucket_id = 'pj-files'
      and exists (select 1 from public.task_attachments a where a.storage_path = objects.name and private.pj_can_see_task(a.organization_id, a.task_id)))$p$;
    execute $p$create policy pj_files_delete_orphans on storage.objects for delete to authenticated using (
      bucket_id = 'pj-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and private.pj_is_manager(split_part(objects.name, '/', 1)::uuid)
      and objects.created_at < now() - interval '2 hours'
      and not exists (select 1 from public.task_attachments a where a.storage_path = objects.name))$p$;

    execute $p$create policy pj_logos_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'pj-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{8,32}\.(png|jpg|webp)$'
      and private.pj_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
    execute $p$create policy pj_logos_delete on storage.objects for delete to authenticated using (
      bucket_id = 'pj-logos' and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and private.pj_is_owner(split_part(objects.name, '/', 1)::uuid))$p$;
  end if;
end $$;
