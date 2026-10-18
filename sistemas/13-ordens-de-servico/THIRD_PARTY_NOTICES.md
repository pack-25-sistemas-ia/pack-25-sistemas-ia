# THIRD_PARTY_NOTICES — Ordens de Serviço

Componentes de terceiros efetivamente **incorporados ao código** deste repositório: **nenhum**. O sistema usa apenas **dependências** instaladas via pnpm (Next.js, React, Supabase JS, Zod, Tailwind CSS, `@react-pdf/renderer` e outras), cada uma sob a própria licença.

**Dependências de produção** (`pnpm licenses list --prod`, 2026-10-18; 86 pacotes): MIT (76), ISC (5), Apache-2.0 (2), BSD-3-Clause (1), 0BSD (1) e CC-BY-4.0 (1; `caniuse-lite`, dados de compatibilidade de navegadores usados só na compilação, sem redistribuição no código do app). Todas permissivas.

- `@react-pdf/renderer` 4.9.0 — MIT — geração de PDF no servidor.
- Os leitores/sanitizadores de imagem (JPEG/PNG/WebP), o cálculo de orçamento, o motor de estados e o CSV são **código próprio**.
- Foram apenas **consultados** (sem copiar código): ERPNext (GPL-3.0), Dolibarr (GPL-3.0), InvenTree (MIT), osTicket (GPL-2.0); avaliados e **não** adotados: shadcn/ui, TanStack Table. Detalhes em `docs/REFERENCES.md`.

Regras: preservar o texto de licença e o copyright originais ao incorporar; não incorporar `enterprise/`, `ee/` ou marcas de terceiros; AGPL/GPL/SSPL somente após decisão jurídica explícita registrada em `docs/DECISIONS.md`.
