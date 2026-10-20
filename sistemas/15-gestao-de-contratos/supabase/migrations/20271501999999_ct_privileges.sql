-- Gestão de Contratos — PRIVILÉGIOS DAS FUNÇÕES (última migração do sistema).
-- O Postgres concede EXECUTE a PUBLIC por padrão e o Supabase a anon/authenticated. Aqui:
--  · funções de uso (public.ct_*): usuário autenticado (cada uma valida sessão, MFA, perfil e papel no contrato);
--  · ÚNICO ponto público (PUBLIC_ENDPOINT): public.ct_run_reminders(token) — o agendador externo; valida o token (hash) e limita a taxa;
--  · internas (private.ct_*): ninguém, exceto os auxiliares que as políticas de RLS e o Storage avaliam como o próprio usuário.

begin;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ct\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname = 'ct_run_reminders' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
      execute format('comment on function %s is %L', f.sig, 'PUBLIC_ENDPOINT: agendador externo dos lembretes; exige o token da empresa (só o hash fica no banco), limita a taxa e é idempotente');
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'ct\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('ct_role', 'ct_profile', 'ct_is_owner', 'ct_is_manager', 'ct_is_member', 'ct_contract_role', 'ct_can_see_contract', 'ct_can_edit_contract', 'ct_can_manage_contract',
      'ct_can_see_counterparty', 'ct_can_edit_file', 'ct_can_see_file', 'ct_file_readable', 'ct_file_registered', 'ct_guard') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
