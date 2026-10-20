---
name: supabase-security
description: Use ao criar migração, função ou política.
---

# supabase-security

- Toda tabela com organization_id + RLS; funções `SECURITY DEFINER` com `search_path` vazio; `revoke` de public/anon; só as funções da lista fechada são acessíveis.
- Sem service_role. `ct.bypass` só dentro de funções internas. Conferir `70_ct_security.sql` após qualquer migração.
