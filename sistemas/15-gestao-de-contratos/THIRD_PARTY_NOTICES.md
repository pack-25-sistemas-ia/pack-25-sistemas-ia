# THIRD_PARTY_NOTICES — Gestão de Contratos e Vencimentos

Componentes de terceiros efetivamente **incorporados ao código** deste repositório: **nenhum**. O sistema usa apenas **dependências** instaladas via pnpm (Next.js, React, Supabase JS, Zod, Tailwind CSS e outras), cada uma sob a própria licença.

**Dependências de produção** (`pnpm licenses list --prod`): permissivas (MIT, Apache-2.0, ISC, BSD-3-Clause, 0BSD) e CC-BY-4.0 (`caniuse-lite`, dados de compatibilidade de navegadores usados só na compilação, sem redistribuição no código do app). A contagem exata fica em `MEMORY.md`.

- A aritmética de datas (soma de meses com fim de mês limitado, prazo de aviso, calendário), o dinheiro e o reajuste exatos, o processamento de lembretes, a leitura de bytes dos arquivos e o CSV são **código próprio**.
- Foram apenas **consultados** (sem copiar código): Documenso (AGPL-3.0), DocuSeal (AGPL-3.0) e Paperless-ngx (GPL-3.0); avaliados e **não** adotados como dependência: shadcn/ui (MIT; só como inspiração de padrões, nada copiado), TanStack Table (MIT) e date-fns (MIT). Detalhes em `docs/REFERENCES.md`.

Regras: preservar o texto de licença e o copyright originais ao incorporar; não incorporar `enterprise/`, `ee/`, arquivos `.pe.` ou marcas de terceiros; AGPL/GPL/SSPL somente após decisão jurídica explícita registrada em `docs/DECISIONS.md`.
