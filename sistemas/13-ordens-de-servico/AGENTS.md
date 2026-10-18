# AGENTS — Ordens de Serviço

Sistema 13 do Pack 25 Sistemas IA (ordens-de-servico). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS (nunca desabilitar); toda escrita passa por RPC `os_*` (SECURITY DEFINER, search_path vazio) e valida sessão, MFA, perfil e que os ids são da MESMA empresa. As únicas funções chamáveis por `anon` são `os_public_*` (marcadas `PUBLIC_ENDPOINT`), todas validando o token.
- **O banco decide estado, orçamento, aceite e visibilidade** (`os_order_guard`, `os_quote_guard`, `os_public_view`). O espelho TS (`lib/os/status.ts`, `quote.ts`, `money.ts`) só projeta e explica: mudou uma regra, mude os dois e os testes com os mesmos valores.
- Técnico ≠ gestor com menus ocultos: nunca envie custos internos, CPF/CNPJ, rascunhos ou links ao navegador dele; qualquer DTO/consulta nova precisa de teste A/B.
- Cliente por link: token só em hash; texto do aceite montado NO BANCO; token inválido devolve `invalid_link` sem exceção (o RAISE desfaria o contador de falhas); nunca logar o token.
- Dinheiro em centavos (bigint), quantidade com 3 casas, `round()` meio para cima; nunca `number` para dinheiro.
- Orçamento publicado e conclusão são imutáveis; histórico (eventos, notas, peças, custos, aceites) é append-only: corrija com novo registro.
- CSP estrita: sem `style=""`. Anexos: tipo pelos bytes, EXIF removido, bucket privado, URL assinada curta; sem antivírus (não afirmar o contrário). O aceite é SIMPLES, nunca chamar de assinatura certificada.
- Nunca commitar segredos; o sistema não usa service_role. Dados pessoais mínimos; sem PII em logs; seed só com nomes fictícios (`@demo.exemplo`) e senha aleatória.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db · pnpm test:concurrency · pnpm test:mutation · pnpm test:e2e
(E2E: app compilado na porta 3127, `supabase db reset` + `node scripts/seed-demo.mjs` antes de cada arquivo e reinício do app — ver docs/DEPLOYMENT.md.)

## Mapa
`lib/os` (domínio, ações, PDF) · `components/os` · `app/(app)/*` (rotas em português) · `app/acompanhar/[token]` (público) · `app/api/{arquivos,pdf,exportar}` · `supabase/migrations/20271301*` · `supabase/tests` · `scripts` · `.agents/skills/*`.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright,
mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
