-- Gestão de Projetos e Tarefas — PRIVILÉGIOS DAS FUNÇÕES (última migração do sistema).
-- O Postgres concede EXECUTE a PUBLIC por padrão e o Supabase a anon/authenticated. Aqui:
--  · administrativas e de uso (public.pj_*): usuário autenticado (cada uma ainda valida sessão, MFA, perfil e papel no projeto). Este sistema NÃO tem porta pública: nada vai para anon;
--  · internas (private.pj_*): ninguém, exceto os auxiliares que as políticas de RLS e o Storage avaliam como o próprio usuário.

begin;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'pj\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'pj\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('pj_role', 'pj_profile', 'pj_is_owner', 'pj_is_manager', 'pj_is_member', 'pj_project_role', 'pj_can_see_project', 'pj_can_edit_project', 'pj_can_lead_project',
      'pj_can_edit_task', 'pj_can_see_task', 'pj_guard') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
