---
name: files-lgpd
description: Use ao mexer em documentos, Storage, CPF/CNPJ, CSV ou logs.
---

# files-lgpd

- CPF/CNPJ só em `counterparty_documents` (gestão); instantâneo mascarado no contrato; nunca em CSV, auditoria, eventos, notificações ou logs.
- Arquivos: tipo pelos bytes, bucket privado, URL assinada de 60 s, sem antivírus (não afirmar o contrário), sem `upsert`. Políticas do Storage usam `ct_file_readable/ct_file_registered` (SECURITY DEFINER).
- CSV: BOM, `;`, fórmulas neutralizadas.
