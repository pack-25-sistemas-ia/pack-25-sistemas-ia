# ARCHITECTURE — Ordens de Serviço

```
Navegador ──► Next.js 16 (App Router, Server Components + Server Actions)
                │  lib/os/actions/*  (Zod no servidor → RPC os_*)
                │  lib/os/data.ts    (leituras paginadas no servidor, sob RLS)
                │  lib/os/pdf/*      (@react-pdf/renderer, no servidor)
                ▼
          Supabase: Auth · PostgreSQL (RLS + funções os_*) · Storage (os-files privado, os-logos público)
```

## Camadas
- **Core** (`core/`, sincronizado): login, MFA, organizações, papéis, auditoria, proxy com CSP. O sistema só acrescenta; arquivos próprios estão em `.core-overrides`.
- **Banco decide, a tela reflete.** Estados, permissões, cálculo de orçamento, aceite e visibilidade vivem em `supabase/migrations/20271301*`. `lib/os/{status,quote,money,checklist}.ts` são **espelhos** para a interface e para os testes (mesmos valores); mudou uma regra, mude os dois.
- **Escrita** apenas por `os_*` (SECURITY DEFINER, `search_path=''`). Uma função por intenção do usuário (`os_start`, `os_complete`, `os_quote_publish` …), com versão otimista e chave de idempotência.
- **Leitura** por RLS (`os_can_see_order`): técnico só vê as suas ordens. Dados sensíveis em tabelas separadas (`customer_private`, `order_internal_costs`).
- **Acesso do cliente sem conta**: token de 32 bytes (base64url) gerado no servidor Next; o banco guarda só o sha256. Funções `os_public_*` (chamáveis por `anon`, marcadas `PUBLIC_ENDPOINT`) validam o token e devolvem uma **projeção** (sem notas internas, custos, CPF/CNPJ, técnico). Token inválido devolve `{"error":"invalid_link"}` **sem exceção** (para o contador de falhas não ser desfeito pelo rollback); o estouro do limite levanta 54000.
- **Fotos do cliente**: a rota `/acompanhar/[token]/arquivo/[id]` busca no Storage como `anon`, repassando o token em `x-os-token`; a política `os_files_public_select` consulta `os_public_object_ok(name)`. Nenhuma `service_role`.
- **Uploads**: tipo pelos **bytes** (JPEG/PNG/WebP/PDF), EXIF/XMP/IPTC/comentários removidos das fotos (mantém só a orientação), arquivo malformado recusado, caminho gerado no servidor (`<empresa>/<ordem>/<32hex>.<ext>`), URL assinada curta, `nosniff`.
- **PDF**: orçamento, ordem e conclusão usam os **snapshots da época** (`quote_versions.snapshot_version`, `order_completions.snapshot_version`), sem notas internas, custos nem CPF/CNPJ.
- **Tempo**: tudo em instantes UTC; exibição e janelas no **fuso da empresa**.

## Mapa de código
`lib/os/` (domínio e ações) · `components/os/` · `app/(app)/{ordens,minhas-ordens,agenda,clientes,equipamentos,servicos,pecas,modelos-checklist,relatorios,configuracoes}` · `app/acompanhar/[token]` (público) · `app/api/{arquivos,pdf,exportar}` · `supabase/migrations/20271301*` · `supabase/tests` · `scripts/` · `.agents/skills/*`.

## Testes (ver MEMORY.md para os números)
Unidade (Vitest) · SQL (`pnpm test:db`: Core + 50/51/55/60/70/80) · concorrência real (`pnpm test:concurrency`) · mutação (`pnpm test:mutation`) · E2E (Playwright: fluxo, segurança, demonstração, celular).
