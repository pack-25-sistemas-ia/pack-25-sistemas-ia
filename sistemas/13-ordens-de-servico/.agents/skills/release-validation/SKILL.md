---
name: release-validation
description: Use antes de declarar o sistema pronto: validação completa, instalação isolada, CI e repositório.
---

# release-validation

- Ordem: lint, typecheck, unit, build, `pnpm test:db`, `pnpm test:concurrency`, `pnpm test:mutation` (sem outra carga), E2E um arquivo por vez após `supabase db reset` + `node scripts/seed-demo.mjs` e reinício do app (porta 3127).
- Exportar com `scripts/export-system.mjs`, instalar em pasta isolada e repetir lint/tipos/unit/build/db. Rodar `check-no-secrets`, `validate-catalog` e `sync-core --check`.
- Nunca dizer «passou» sem rodar: escrever NÃO EXECUTADO.
