# DATA_MODEL — Gestão de Projetos e Tarefas

Todas as tabelas de negócio têm `organization_id`, RLS ligada (só `SELECT`) e FKs compostas para impedir referências entre empresas/projetos. Escrita só por RPC `pj_*`. Tabelas do Core (organizations, organization_members, profiles, audit_log) não são descritas aqui.

## Tabelas
| Tabela | Conteúdo / regras principais |
|---|---|
| `pj_settings` | uma linha por empresa: logotipo, cor, **fuso** (padrão America/Sao_Paulo), **prefixo** da chave (`PRJ`), tamanho máximo de anexo, texto de retenção |
| `projects` | número por empresa (`project_number`), nome, descrição, datas (`date`, início ≤ entrega), `status` (planned/active/paused/completed/cancelled), `archived_at`, `completed_at` (só quando concluído), `board_version`, `version` |
| `project_members` | `(project_id, user_id)` único; `project_role` lead/editor/reader; FK composta para `organization_members` (sai da empresa, sai do projeto) |
| `project_columns` | etapas do quadro: nome, `semantic_status` (todo/in_progress/review/done), posição; sempre ≥ 1 etapa «a fazer» e ≥ 1 «concluído»; ≤ 12 |
| `project_labels` | etiquetas do projeto (nome único sem diferenciar caixa, cor #RRGGBB, ≤ 40) |
| `tasks` | número por projeto (`task_number`), título, descrição, `column_id`, `position` (denso por etapa, índice único parcial entre não arquivadas), `assignee_user_id` (um só), `priority` + `priority_rank` gerada, `start_date`/`due_date` (`date`), `completed_at`, `blocked_at`/`blocked_reason` (juntos), `archived_at`/`archive_reason`, `version` |
| `task_labels` | tarefa × etiqueta (mesmo projeto, por FK composta) |
| `task_checklist_items` | título, `required`, posição, `completed_at`/`completed_by` (juntos); ≤ 50 por tarefa |
| `task_comments` | **append-only**; corpo 1–4000 caracteres, Markdown (renderizado como AST) |
| `task_attachments` | **append-only**; nome original, MIME permitido, tamanho, `storage_path` (coluna **não legível** pela API) |
| `project_events`, `task_events` | histórico **append-only** (tipo, autor, dados ≤ 4 KB; sem texto sensível) |
| `notifications` | só ids e `kind` (atribuída, comentário, reaberta, projeto reaberto); a pessoa só marca como lida; visível enquanto ela vê o projeto |
| `project_number_counters`, `task_number_counters` | numeração atômica (sem `MAX()+1`) |
| `mutation_requests` | idempotência: chave + escopo + hash da requisição |
| `pj_rate_limits` | contadores de limite por pessoa/ação |

## Relações principais
`organizations 1—N projects 1—N project_columns / project_labels / project_members / tasks`; `tasks N—1 project_columns` (composta); `tasks 1—N task_checklist_items / task_comments / task_attachments / task_events`; `tasks N—N project_labels`.

## Invariantes garantidas por gatilho (valem também para SQL direto)
- Identidade imutável (id, números, autor, criação, empresa); `version` sobe a cada mudança real.
- Projeto: transições de status válidas; concluído exige zero tarefas abertas e `completed_at`; concluído/cancelado/arquivado sem edição de conteúdo; arquivar só concluído/cancelado.
- Tarefa: status vem da etapa; `completed_at` escrito só pelo guard; concluir exige itens obrigatórios marcados; responsável precisa ser líder/editor/gestão; arquivada é somente consulta; não nasce concluída.
- Etapa: não muda de projeto; não muda de tipo com tarefas; o quadro sempre mantém «a fazer» e «concluído».
- Histórico, comentários, anexos: sem `UPDATE`/`DELETE`; projetos e tarefas: sem `DELETE`.
- Participantes: gestão não vira participante explícito; leitor da empresa só como leitor; rebaixar/remover exige tratar as tarefas abertas (desatribuir ou transferir).

## Storage
`pj-files` (privado): `<org>/<tarefa>/<32hex>.<ext>`, extensões png/jpg/webp/pdf/txt/csv, caminho gerado no servidor; leitura/escrita por políticas que reutilizam `pj_can_see_task`/`pj_can_edit_task`. `pj-logos` (público): `<org>/logo-<hex>.<ext>`, só proprietário escreve.
