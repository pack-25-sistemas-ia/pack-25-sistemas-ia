---
name: project-domain
description: Use ao mexer em projetos, estados, tarefas, checklist, impedimento, conclusão ou reabertura.
---

# project-domain

- Estados do projeto: `planned → active ⇄ paused`, `completed`/`cancelled`; reabrir (completed/cancelled → active) exige motivo ≥ 5 e fica no histórico; arquivar só concluído/cancelado. Regra no gatilho `pj_project_guard`, em `pj_writable` **e** em `lib/pj/status.ts` (espelho).
- Organizar (criar/editar/mover no mesmo tipo) vale em planejado/ativo/pausado; executar (mudar o tipo da etapa) só em ativo; concluído/cancelado/arquivado = somente consulta.
- Concluir projeto exige zero tarefas abertas (conta só tarefas não arquivadas e não concluídas).
- Tarefa: status = tipo da etapa; `completed_at` só o guard escreve; concluir exige itens obrigatórios do checklist; impedimento é atributo com motivo.
- Mudanças exigem a `version` lida (erro 40001 = alterada por outra pessoa; mensagem «Outra pessoa alterou … antes de você»).
