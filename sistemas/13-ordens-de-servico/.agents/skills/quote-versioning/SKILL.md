---
name: quote-versioning
description: Use ao mexer em orçamento, itens, cálculo, publicação ou decisão do cliente.
---

# quote-versioning

- Dinheiro em centavos (bigint); quantidade com 3 casas; linha = `round(qty × preço)` (meio para cima). Espelho exato em `lib/os/money.ts` e `quote.ts`; os testes usam os mesmos valores do SQL.
- Publicar congela (gatilho `os_quote_guard`, itens imutáveis); nova versão substitui a publicada pendente. Uma decisão por versão (`quote_decisions.quote_version_id unique`).
- Decisão do cliente só na versão **vigente** e não expirada; o texto aceito é montado no banco (`os_quote_text`). Registro manual = canal `staff_manual` com operador e justificativa.
- O documento/PDF usa o snapshot de cliente/endereço da época (`snapshot_version`).
