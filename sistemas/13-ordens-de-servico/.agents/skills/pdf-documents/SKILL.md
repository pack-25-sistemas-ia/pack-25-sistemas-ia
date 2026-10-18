---
name: pdf-documents
description: Use ao mexer em PDFs (orçamento, ordem, conclusão).
---

# pdf-documents

- `@react-pdf/renderer` no servidor (`serverExternalPackages`); nunca runtime Edge. Dados vêm de `os_document` (snapshot da época), sem notas internas, custos ou CPF/CNPJ.
- Documento do cliente via `os_public_document`; do técnico, só de ordem dele (`os_can_see_order`).
