---
name: order-domain
description: Use ao mexer em ordens, estados, agenda, atribuição, pausa, conclusão ou reabertura.
---

# order-domain

- Estados: `draft → open ⇄ scheduled → in_progress ⇄ paused → completed → closed`; `cancelled` a partir de qualquer estado não final. Regra no gatilho `os_order_guard` **e** em `lib/os/status.ts` (espelho).
- Iniciar/retomar exige responsável e, se `quote_mode = required`, orçamento aprovado e nenhuma versão publicada pendente (`os_exec_block`).
- Concluir valida o checklist no servidor (`os_checklist_problems`) e a divergência de peças; cada conclusão tem `completion_version`. Aceite da v1 não encerra a v2.
- Reabrir: concluída → gestão; encerrada → só proprietário, com motivo. Mudanças exigem a `version` lida (erro 40001 = alterada por outra pessoa).
- Janela ≤ 14 dias no fuso da empresa; sobreposição é alerta, não bloqueio.
