# DEPLOYMENT — Ordens de Serviço

## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), Supabase CLI, e para produção: um projeto Supabase **na região de São Paulo**, hospedagem Node (ex.: Vercel) e (opcional) SMTP próprio para e-mails de conta.

## Variáveis (`.env.example`)
| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_APP_URL` | URL pública do app (links de acompanhamento e redirecionamentos) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | projeto Supabase e chave publishable/anon (segura no navegador; o acesso é limitado por RLS e privilégios) |
| `OS_LINK_SALT` | **obrigatória**, ≥ 32 caracteres aleatórios: anonimiza a origem (IP) nos limites do link público. Sem ela os links públicos ficam **indisponíveis** (falha fechada). Gere: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |

O sistema **não usa** `service_role`; não a configure.

## Local
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local      # preencha com `supabase status` (API 59021) e gere OS_LINK_SALT
supabase start && supabase db reset
node scripts/seed-demo.mjs      # opcional: «Assistência Horizonte (demonstração)»
pnpm dev                        # ou: pnpm build && pnpm start -p 3127
```
Portas locais do Supabase: API 59021, banco 59022, e-mail de teste 59024; app dos testes E2E: 3127 (`site_url` do `config.toml`).

## Produção
1. Crie o projeto Supabase (região **São Paulo**), ative **MFA** e configure SMTP/URLs de redirecionamento.
2. `supabase link` e `supabase db push` (aplica as migrações `20271301*` e do Core; **cria os buckets** `os-files` privado e `os-logos` público).
3. Configure as variáveis na hospedagem; `pnpm build`. O PDF roda no **servidor Node** (`@react-pdf/renderer`, `serverExternalPackages`): não use runtime Edge.
4. Primeiro acesso: `/signup` cria a empresa e o proprietário (2º fator obrigatório). Pessoas entram pela tela «Pessoas e acessos» do Core (**Gerente = gestor**, **Membro = técnico**).
5. Configurações (proprietário): nome público, cor, logotipo, fuso, prefixo do número, validade do orçamento/link, tamanho máximo de anexo, retenção.

## Backup, restauração e rollback
- Banco: backups gerenciados do Supabase (plano pago) ou `pg_dump` agendado; teste a restauração. **Storage** (fotos/PDF) não vem no dump do banco: faça cópia do bucket `os-files`.
- Migrações são **aditivas e transacionais**; para voltar, restaure o backup anterior (não há `down`). Teste em um projeto de homologação antes.
- Custos externos: Supabase (banco + Storage + Auth), hospedagem Node e SMTP. Os valores dependem do plano e do volume de fotos; consulte as tabelas de preço dos provedores.

## Testes de ponta a ponta (E2E)
App compilado na porta **3127**, `supabase db reset` + `node scripts/seed-demo.mjs` **antes de cada arquivo** e **reinício do app** (o limitador de login em memória acumula tentativas): `pnpm build && pnpm exec next start -p 3127`, depois `pnpm exec playwright test tests/e2e/<arquivo>.spec.ts` com `.env.e2e` (`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_BASE_URL`, `E2E_MAILPIT_URL`).
