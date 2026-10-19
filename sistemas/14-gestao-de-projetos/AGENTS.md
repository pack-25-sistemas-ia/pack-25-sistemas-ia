# AGENTS — Gestão de Projetos e Tarefas

Sistema 14 do Pack 25 Sistemas IA (gestao-de-projetos). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS (nunca desabilitar); RLS é só SELECT (via `private.pj_can_see_project`); toda escrita passa por RPC `pj_*` (SECURITY DEFINER, search_path vazio) que valida sessão, MFA, perfil, papel no projeto e que os ids são da MESMA empresa/projeto. Nenhuma função é chamável por `anon`.
- **O banco decide estado, permissões e ordem** (`pj_project_guard`, `pj_task_guard`, `pj_writable`, `pj_move_task`). O espelho TS (`lib/pj/status.ts`) só projeta e explica: mudou uma regra, mude os dois e os testes com os mesmos valores.
- Visibilidade é por PROJETO: quem não participa não vê projeto, tarefa, comentário, anexo, notificação nem evento (nem por contagem). Gestor/proprietário agem como líder em todos, sem linha em project_members. Leitor da empresa só pode ser leitor nos projetos. Todo DTO/consulta nova precisa de teste A/B (quem participa × quem não participa).
- Estado do projeto: organizar (planejado/ativo/pausado), executar (só ativo), concluído/cancelado/arquivado = somente consulta. Concluir exige zero tarefas abertas.
- Tarefa: status vem da etapa (`semantic_status`); `completed_at` só o guard escreve; itens obrigatórios do checklist bloqueiam concluir; impedimento é atributo à parte (com motivo).
- Mover cartão: trava o PROJETO antes da tarefa (ordem fixa de travas), confere `board_version`, posições densas por etapa. Nunca reordenar sem `pj_apply_order`. O GUC `pj.bypass` só pode ser ligado dentro de funções internas.
- Concorrência: `version` otimista (40001, mensagem «Outra pessoa alterou … antes de você»), idempotência por chave, contadores sem MAX+1.
- Histórico (eventos, comentários, anexos, notificações) é append-only: corrija com novo registro. Notificações guardam só ids e tipo.
- CSP estrita: sem `style=""`. Markdown vira AST (sem HTML, só links http/https). Anexos: tipo pelos bytes, bucket privado, URL assinada de 60 s, sem antivírus (não afirmar o contrário). CSV neutraliza fórmulas.
- Nunca commitar segredos; o sistema não usa service_role. Dados pessoais mínimos; sem PII em logs; seed só com nomes fictícios (`@demo.exemplo`) e senha aleatória.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db · pnpm test:concurrency · pnpm test:mutation · pnpm test:e2e
(E2E: app compilado na porta 3128, `supabase db reset` + `node scripts/seed-demo.mjs` antes de cada arquivo e reinício do app — ver docs/DEPLOYMENT.md.)

## Mapa
`lib/pj` (domínio, ações, dados) · `components/pj` · `app/(app)/*` (rotas em português: projetos, tarefas, minhas-tarefas, arquivados, notificacoes, configuracoes) · `app/api/{arquivos,exportar}` · `supabase/migrations/20271401*` · `supabase/tests` · `scripts` · `.agents/skills/*`.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright,
mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
