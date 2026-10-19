---
name: markdown-attachments
description: Use ao mexer em Markdown de descrição/comentário ou em anexos e Storage.
---

# markdown-attachments

- Markdown vira AST (`lib/pj/markdown.ts`): nunca HTML; links só `http/https`; limites de tamanho, blocos e itens.
- Anexos: tipo pelos bytes (`sniff`/`sniffText`), caminho `<org>/<tarefa>/<32hex>.<ext>` gerado no servidor, bucket `pj-files` privado, `storage_path` ilegível pela API, entrega por `/api/arquivos/[id]` com URL assinada de 60 s; texto sempre como download.
- Não afirmar antivírus. Mudou a allowlist? Mude SQL (`pj_add_attachments`, políticas), TS e testes.
