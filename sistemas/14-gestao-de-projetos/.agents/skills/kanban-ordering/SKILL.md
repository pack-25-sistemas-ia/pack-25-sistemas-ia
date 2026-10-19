---
name: kanban-ordering
description: Use ao mexer em mover cartões, ordem das tarefas, etapas do quadro ou board_version.
---

# kanban-ordering

- Toda movimentação passa por `pj_move_task` (arrastar e menu usam `moveTaskIntent`). Ordem de travas FIXA: **projeto primeiro, depois a tarefa**.
- Posições são densas (1..n) por etapa, com índice único parcial entre não arquivadas; reordene só por `pj_apply_order` (duas fases: +1.000.000, depois 1..n).
- `board_version` sobe apenas em mover/reordenar/operar etapas; mover sem efeito é no-op (não sobe). Divergência = conflito 40001 e a tela recarrega.
- Etapas: ≤ 12; sempre ≥ 1 «a fazer» e ≥ 1 «concluído»; não muda o tipo com tarefas; excluir ocupada exige destino do MESMO tipo.
- O GUC `pj.bypass` só pode ser ligado dentro de funções internas do banco.
