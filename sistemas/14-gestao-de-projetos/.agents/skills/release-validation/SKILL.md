---
name: release-validation
description: Use antes de declarar o sistema pronto ou publicar.
---

# release-validation

- Sequência: `pnpm lint`, `typecheck`, `test`, `build`, `test:db`, `test:concurrency`, `test:mutation`, E2E de cada arquivo (banco recriado + seed + app reiniciado entre eles).
- Verifique segredos (`scripts/check-no-secrets.mjs` do Pack), licenças (`pnpm licenses list --prod`) e instalação isolada a partir de uma exportação limpa.
- Só marque VALIDADO com a definição de pronto completa e docs/MEMORY.md coerentes.
