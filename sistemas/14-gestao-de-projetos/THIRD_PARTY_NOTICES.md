# THIRD_PARTY_NOTICES — Gestão de Projetos e Tarefas

Componentes de terceiros efetivamente **incorporados ao código** deste repositório: **nenhum**. O sistema usa apenas **dependências** instaladas via pnpm (Next.js, React, Supabase JS, Zod, Tailwind CSS e outras), cada uma sob a própria licença.

**Dependências de produção** (`pnpm licenses list --prod`, 2026-10-18; 29 pacotes): MIT (23), Apache-2.0 (2), ISC (1), BSD-3-Clause (1), 0BSD (1) e CC-BY-4.0 (1; `caniuse-lite`, dados de compatibilidade de navegadores usados só na compilação, sem redistribuição no código do app). Todas permissivas.

- O quadro (arrastar e menu), o Markdown seguro, a ordenação densa, o motor de estados, os leitores de bytes dos anexos e o CSV são **código próprio**.
- Foram apenas **consultados** (sem copiar código): Plane (AGPL-3.0), Planka (licença comunitária), Wekan (MIT); avaliados e **não** adotados: dnd-kit, TanStack Table, shadcn/ui. Detalhes em `docs/REFERENCES.md`.

Regras: preservar o texto de licença e o copyright originais ao incorporar; não incorporar `enterprise/`, `ee/`, arquivos `.pe.` ou marcas de terceiros; AGPL/GPL/SSPL somente após decisão jurídica explícita registrada em `docs/DECISIONS.md`.
