---
name: csv-export-lgpd
description: Use ao mexer em exportação CSV, retenção, auditoria ou dados pessoais.
---

# csv-export-lgpd

- CSV com BOM e `;`; células iniciadas por `= + - @ TAB CR` são neutralizadas (`lib/os/csv.ts`). Só a gestão exporta; a exportação é auditada sem PII.
- CPF/CNPJ só em `customer_private`, só para a gestão; nunca em PDF, CSV de técnico, logs ou auditoria. Retenção/exclusão é administrativa (docs/SECURITY.md).
