# ARCHITECTURE — Gestão de Projetos e Tarefas

## Visão geral
Next.js 16 (App Router, Server Components e Server Actions) + React 19 + TypeScript strict + Tailwind 4 + Supabase (Auth, PostgreSQL, Storage). Sem `service_role`: o navegador e o servidor falam com o Supabase **com a sessão da pessoa**, e quem protege os dados é o banco.

```
navegador ── Server Components / Actions (lib/pj) ── supabase-js (sessão do usuário) ── PostgreSQL
                                                                                     ├─ RLS: só SELECT, por projeto
                                                                                     ├─ RPC pj_* (SECURITY DEFINER, search_path vazio)
                                                                                     ├─ gatilhos (guards): estado, datas, checklist, append-only
                                                                                     └─ Storage: pj-files (privado), pj-logos (público)
```

## Camadas
- **Core** (`core/`, sincronizado): organizações, membros e papéis, perfis, auditoria, MFA (obrigatório para proprietário/admin), login, cabeçalhos de segurança/CSP. O sistema não altera o Core.
- **Banco** (`supabase/migrations/20271401*`): esquema, acesso, guards, auxiliares, projetos, tarefas, leituras, Storage e privilégios. **É a fonte de verdade** de permissões, estados e ordem.
- **Domínio TS** (`lib/pj`): espelho puro e testável das regras (`status.ts`) usado para esconder ações, avisar e fazer a atualização otimista do quadro; Markdown seguro, CSV, indicadores, chaves, validação (Zod) e anexos (tipo pelos bytes).
- **Ações** (`lib/pj/actions/*`): validam entrada com Zod, chamam a RPC com chave de idempotência e traduzem erros do banco em mensagens claras. `moveTaskIntent` é a única porta de movimentação (arrastar e menu).
- **Dados** (`lib/pj/data.ts`): consultas com filtros/ordenação/paginação no servidor.
- **UI** (`app/(app)/*`, `components/pj`): rotas em português na raiz (`/projetos`, `/tarefas`, `/minhas-tarefas`…); formulários nativos, `<details>` e CSS puro; o quadro é o único componente cliente pesado.

## Mover cartões (o ponto mais delicado)
1. A tela atualiza **de forma otimista** e chama `pj_move_task(tarefa, etapa, antes_de, board_version)`.
2. O banco **trava o projeto primeiro e depois a tarefa** (ordem fixa: sem deadlock), confere `board_version` (se mudou, devolve conflito e a tela recarrega), valida estado/permissão, recalcula a ordem da etapa e grava posições **densas** (1..n) com `pj_apply_order` em duas fases (índice único parcial por etapa).
3. Mover sem mudar nada é *no-op* (não sobe versão). `board_version` sobe só em mover/reordenar/operar etapas.
4. Em erro a tela **desfaz** o movimento e mostra o motivo. O menu «Mover…» usa a mesma ação (teclado, celular).

## Segurança por construção
Cada tabela leva `organization_id`; FKs compostas `(id, organization_id[, project_id])` impedem misturar empresas/projetos mesmo em SQL direto; nenhum DTO sai do servidor sem passar por consulta com RLS. Ver `docs/SECURITY.md` e `docs/PERMISSIONS.md`.

## Testes
Unit (Vitest) · SQL (`supabase/tests` sobre o Core) · concorrência real (`test:concurrency`) · mutação (`test:mutation`) · E2E Playwright (13 passos do fluxo principal, segurança pela API, celular e teclado). Ver `MEMORY.md` para os resultados.
