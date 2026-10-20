---
name: release-validation
description: Use antes de declarar o sistema pronto.
---

# release-validation

- Rodar lint, typecheck, test, build, test:db, test:concurrency, test:mutation e os E2E (um arquivo por vez, banco e app reiniciados).
- Registrar em MEMORY.md só o que foi executado; o resto fica NÃO EXECUTADO.
