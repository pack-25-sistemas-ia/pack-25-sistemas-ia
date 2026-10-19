# MEMORY — GESTÃO DE PROJETOS E TAREFAS
Atualizado em: 2026-10-19 | Versão: 1.0.0 | Estado: VALIDADO

## Missão do sistema
Gestão de projetos e tarefas para agências e equipes de serviço: projetos com participantes por papel (líder, editor, leitor), quadro Kanban e lista, «Minhas tarefas» por data, responsável único, checklist com itens obrigatórios, comentários e anexos privados, impedimentos, histórico, notificações internas, painel e CSV. Risco LGPD: baixo a médio (nome e e-mail dos membros e conteúdo livre digitado).

## Stack e caminhos-chave
Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind 4 + Supabase (Auth, PostgreSQL, Storage). Banco: `supabase/migrations/20271401*` (escrita só por RPCs `pj_*` SECURITY DEFINER; RLS só SELECT por projeto; FKs compostas). Domínio TS (espelho): `lib/pj/*`. Ações: `lib/pj/actions/*`. UI: `app/(app)/*` (rotas em português na raiz), `components/pj`. Testes: `tests/unit`, `tests/e2e`, `supabase/tests`, `scripts/test-*.mjs`, `scripts/mutation-check.mjs`. Skills: `.agents/skills/*`.
Comandos: `pnpm lint | typecheck | test | build | test:db | test:concurrency | test:mutation | test:e2e` (E2E na porta 3128, ver docs/DEPLOYMENT.md). Seed: `node scripts/seed-demo.mjs` («Agência Prisma (demonstração)», 5 projetos e 24 tarefas, datas relativas).

## Implementado e verificado (2026-10-19, com evidência)
- Projetos (estados, reabrir com motivo, arquivar), participantes por papel, quadro Kanban (arrastar + menu «Mover…», ordem densa, `board_version`), lista com filtros no servidor, tarefas (responsável único, prioridade, datas, etiquetas, checklist obrigatório, impedimento, arquivar), comentários append-only (Markdown seguro), anexos privados, histórico, notificações, «Minhas tarefas», painel, CSV, marca, auditoria.
- `pnpm lint`, `pnpm typecheck`: sem erros. `pnpm test`: 94 testes em 5 arquivos. `pnpm build`: ok.
- `pnpm test:db` (Core + sistema): todos passam — 50 domínio, 51 estados, 55 painel, 70 segurança, 80 integridade, 90 fronteiras (mensagens, limites, SQL direto).
- `pnpm test:concurrency`: passa (numeração, duplo clique, movimentos e reordenação simultâneos, atribuição, conclusão × checklist, remover participante, excluir etapa e concluir projeto × criar tarefa, comentários).
- `pnpm test:mutation`: **406/406 mutações reprovadas** (unit + banco + concorrência). 27 mutantes equivalentes (ou fora do alcance do Postgres de teste: políticas do Storage) retirados com justificativa no próprio script.
- E2E (Playwright, app compilado, banco recriado e app reiniciado antes de cada arquivo): core-flow 5, email-flows 3, security 5, pj-demo 6, pj-flow 9, pj-security 5, pj-responsive 4 — **37 passam** (uma falha intermitente no passo 2 do pj-flow na 1ª rodada passou na repetição; a espera da asserção foi ampliada). Exportação limpa: instalação isolada, lint, tipos, 94 testes, build, banco e concorrência passam (E2E não repetido na exportação).
- Revisão visual desktop (1440) e celular (375) feita em capturas.

## Em implementação
- Nada.

## Pendências e riscos
- Fora do MVP: Gantt/dependências, horas faturáveis, várias pessoas por tarefa, subtarefas, automações, integrações, app nativo, IA (docs/DECISIONS.md).
- Sem antivírus nos anexos. Comentários não se editam nem apagam (correção administrativa no banco).
- Limitador de login do Core é em memória por instância; os limites de ações estão no banco.
- As políticas do bucket `pj-files` só existem no Supabase real; não são exercitadas pela mutação (Postgres puro) e dependem da revisão e do E2E.
- Comprador precisa do próprio Supabase (região Brasil) e hospedagem (docs/DEPLOYMENT.md).

## Decisões relevantes
Ver docs/DECISIONS.md (D-P1…D-P21). Principais: banco como fonte de verdade com espelho TS; visibilidade por projeto; etapa define o status; impedimento é atributo; trava do projeto antes da tarefa; arrastar opcional e menu obrigatório; sem TanStack/shadcn/RHF/gráficos; sem service_role.

## Armadilhas (para não repetir)
- Gatilho `before update of <coluna>` não dispara para outras colunas: regras de identidade precisam de `before update` completo (a mutação revelou).
- Mensagem de conflito reescrita («Outra pessoa alterou … antes de você»): testes e regex precisam acompanhar.
- E2E: seletores exatos de rótulos, busca só numérica vira número de tarefa, app reinicia entre specs (limitador de login).
- Mutação: não editar migrações/testes enquanto roda; concorrência sozinha; o vigia de 10 min marca TRAVOU (não conta como morto).
- Ambiente Windows: disco cheio congela o Docker; dados do Docker foram movidos para outro disco (`CustomWslDistroDir`); `settings-store.json` não pode ter BOM.
- Mutantes de camada redundante (gatilho + função com a mesma mensagem) são equivalentes: documentar, não forçar.

## Próxima tarefa recomendada
1. Se o comprador quiser: notificações por e-mail, dependências entre tarefas, horas e Gantt (docs/DECISIONS.md).

## Referências
docs/FEATURES.md · docs/DATA_MODEL.md · docs/ARCHITECTURE.md · docs/DECISIONS.md · docs/REFERENCES.md · docs/SECURITY.md · docs/PERMISSIONS.md · docs/DEPLOYMENT.md · THIRD_PARTY_NOTICES.md
