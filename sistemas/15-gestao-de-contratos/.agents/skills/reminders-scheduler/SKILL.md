---
name: reminders-scheduler
description: Use ao mexer em lembretes, prazos derivados ou no endpoint do agendador.
---

# reminders-scheduler

- `private.ct_process_reminders` é a única fonte; chave de deduplicação `tipo|origem|revisão|antecedência|destinatário`; consolidar atrasos; ignorar revisão superada, concluído, encerrado, arquivado e quem perdeu acesso.
- Endpoint `POST /api/jobs/lembretes` com Bearer de 64 hex (só o hash no banco). `ct_run_reminders` é a ÚNICA função chamável por anon (`PUBLIC_ENDPOINT:`).
- Teste em `55_ct_reminders.sql` e na concorrência.
