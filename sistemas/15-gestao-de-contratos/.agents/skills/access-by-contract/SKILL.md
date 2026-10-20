---
name: access-by-contract
description: Use ao criar ou alterar consulta, DTO, política ou função que toque dados de contrato.
---

# access-by-contract

- Visibilidade é por CONTRATO: `private.ct_contract_role_of` decide (gestão = proprietário/gestor; editor/leitor por vínculo; Leitor da empresa sempre leitor).
- RLS só SELECT; escrita só por RPC `ct_*` com `search_path` vazio. FKs compostas por empresa.
- Todo dado novo precisa de teste A/B: quem tem acesso × quem não tem (em `supabase/tests/70_ct_security.sql` e no E2E).
