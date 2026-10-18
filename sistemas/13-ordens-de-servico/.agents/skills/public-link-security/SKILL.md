---
name: public-link-security
description: Use ao mexer no link de acompanhamento, tokens, funções `os_public_*` ou fotos do cliente.
---

# public-link-security

- Token = 32 bytes base64url gerado no servidor Next; o banco guarda só o sha256. Nunca logar nem gravar o token em evidências.
- Token inválido/revogado/expirado/malformado → `{"error":"invalid_link"}` **sem exceção** (RAISE desfaria o contador). Só o estouro do limite levanta 54000 (`os_rate_peek`/`os_rate_bump`).
- Toda função nova para `anon` precisa do comentário `PUBLIC_ENDPOINT` em `999999_os_privileges.sql` e de teste em `60_os_public.sql`.
- Projeção pública sem notas internas, custos, CPF/CNPJ, técnico, rascunhos e arquivos internos. Fotos: rota do app repassa `x-os-token`; política `os_files_public_select`.
