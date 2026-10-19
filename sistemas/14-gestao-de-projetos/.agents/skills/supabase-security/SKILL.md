---
name: supabase-security
description: Use ao criar migração, tabela, função, política RLS ou Storage.
---

# supabase-security

- Função nova: `SECURITY DEFINER`, `search_path=''`, nomes qualificados, `revoke ... from public, anon`, conceder só a `authenticated` (ou nenhuma, se interna). `pj_guard`/`pj_require` primeiro; MFA incluso.
- Sem `service_role`. FKs compostas `(id, organization_id[, project_id])`. Histórico append-only; projetos e tarefas sem DELETE.
- Rode `pnpm test:db` (inclui 70 segurança e 80 integridade por SQL direto) e `pnpm test:concurrency` se mexer em travas, contadores ou idempotência.
