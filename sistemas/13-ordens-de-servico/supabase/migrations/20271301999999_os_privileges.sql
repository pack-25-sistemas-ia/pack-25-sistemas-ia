-- Gestão de Ordens de Serviço — PRIVILÉGIOS DAS FUNÇÕES (última migração do sistema).
-- O Postgres concede EXECUTE a PUBLIC por padrão e o Supabase a anon/authenticated. Aqui:
--  · administrativas e de uso (public.os_*): usuário autenticado (cada uma ainda valida sessão, MFA e perfil);
--  · operações públicas por link (public.os_public_*): também anon — e só elas. Cada uma valida o token, limita tentativas no banco e devolve uma projeção;
--  · internas (private.os_*): ninguém, exceto os auxiliares que as políticas de RLS e o Storage avaliam como o próprio usuário.

begin;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'os\_%' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
    if f.proname like 'os\_public\_%' then
      execute format('grant execute on function %s to anon', f.sig);
      -- marca exigida pelo teste do Core (20_profiles.sql): toda função SECURITY DEFINER executável por anon é uma porta pública DECLARADA.
      execute format('comment on function %s is %L', f.sig, 'PUBLIC_ENDPOINT: operação pública por link de acompanhamento (sem sessão). Valida o token (hash, validade, revogação), aplica limite de tentativas no banco e devolve só a projeção pública. Ver docs/SECURITY.md.');
    end if;
  end loop;
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'os\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname in ('os_role', 'os_tech_active', 'os_profile', 'os_is_owner', 'os_is_manager', 'os_is_staff', 'os_order_visible', 'os_can_see_order', 'os_customer_visible', 'os_address_visible',
      'os_equipment_visible', 'os_guard') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

commit;
