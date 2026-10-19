---
name: csv-export-lgpd
description: Use ao criar ou alterar exportações (CSV) ou o que entra em auditoria e logs.
---

# csv-export-lgpd

- CSV: BOM, separador `;`, células iniciadas por `= + - @ TAB CR` neutralizadas, quebras de linha trocadas por espaço. A exportação respeita o acesso de quem exporta e registra auditoria (sem conteúdo).
- Dados mínimos: sem e-mail em colunas desnecessárias; notificações e eventos guardam ids, não textos; sem PII em logs.
- Exclusão/anonimização é administrativa (docs/SECURITY.md); a interface arquiva.
