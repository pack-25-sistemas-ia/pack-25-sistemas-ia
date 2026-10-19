---
name: access-by-project
description: Use ao criar consulta, tela, rota, DTO, notificação ou exportação que exponha dados de projetos ou tarefas.
---

# access-by-project

- Visibilidade é por PROJETO: `private.pj_can_see_project`. Gestor/proprietário veem tudo; os demais só onde há linha em `project_members`. Leitor da empresa só é leitor e não recebe tarefas.
- Toda tabela nova leva `organization_id` + RLS só SELECT com essa função; escrita só por RPC `pj_*` que revalida papel e ids da mesma empresa/projeto.
- Nada de contagem, título ou nome vazando de projeto inacessível (nem em painel, notificação, busca, CSV ou erro). Telas respondem 404 real.
- Todo DTO novo ganha teste A/B (participa × não participa) no SQL e, se houver rota, no E2E pela API.
