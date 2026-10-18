---
name: supabase-security
description: Use ao criar tabela, função, política ou migração.
---

# supabase-security

- `organization_id` + RLS só `SELECT`; escrita por `os_*` SECURITY DEFINER com search_path vazio; FKs compostas `(id, organization_id)`; dados sensíveis em tabela separada.
- Privilégios no `999999_os_privileges.sql` (revogar de public/anon; conceder a authenticated). Atualize os testes 70 e a numeração de testes (50/51/55/60/70/80).
- Não existe `service_role` neste sistema.
