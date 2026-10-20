-- Gestão de Projetos e Tarefas — CORREÇÃO do Storage (anexos): leitura/URL assinada e limpeza de órfãos.
-- Problema: as políticas do Storage rodam COMO o usuário, que não pode ler a coluna `task_attachments.storage_path` (grant por coluna). A política de leitura consultava essa coluna
-- diretamente, então a API recusava com «permission denied» (o download de anexos falhava; com `upsert` o envio também). Agora as políticas consultam o registro por funções com
-- direitos próprios (SECURITY DEFINER). Além disso, quem acabou de enviar um arquivo que não chegou a ser registrado pode removê-lo na hora.
-- Esta migração roda DEPOIS dos privilégios (999999): concede o que precisa.

begin;

create function private.pj_file_readable(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_attachments a where a.storage_path = p_path and private.pj_can_see_task(a.organization_id, a.task_id));
$$;
create function private.pj_file_registered(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.task_attachments where storage_path = p_path); $$;
revoke all on function private.pj_file_readable(text), private.pj_file_registered(text) from public, anon, authenticated;
grant execute on function private.pj_file_readable(text), private.pj_file_registered(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    drop policy if exists pj_files_select on storage.objects;
    drop policy if exists pj_files_delete_orphans on storage.objects;
    execute $p$create policy pj_files_select on storage.objects for select to authenticated using (
      bucket_id = 'pj-files' and (private.pj_file_readable(objects.name)
        or (objects.owner_id = (select auth.uid())::text and not private.pj_file_registered(objects.name))))$p$; -- o DELETE do Storage precisa enxergar a linha: quem enviou vê o próprio órfão
    execute $p$create policy pj_files_delete_orphans on storage.objects for delete to authenticated using (
      bucket_id = 'pj-files'
      and objects.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
      and not private.pj_file_registered(objects.name)
      and (objects.owner_id = (select auth.uid())::text
        or (private.pj_is_manager(split_part(objects.name, '/', 1)::uuid) and objects.created_at < now() - interval '2 hours')))$p$;
  end if;
end $$;

commit;
