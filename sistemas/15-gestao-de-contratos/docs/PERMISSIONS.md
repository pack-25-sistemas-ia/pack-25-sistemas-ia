# PERMISSIONS — Gestão de Contratos e Vencimentos

## Perfis da empresa (vêm do Core)
| Core | Perfil aqui | Vê | Faz |
|---|---|---|---|
| owner / admin | **Proprietário** | todos os contratos | tudo, incl. configurações, regras de lembrete e token do agendador (2º fator exigido) |
| manager | **Gestor** | todos os contratos | cria/edita contratos e partes, ativa, rescinde, encerra, reabre, arquiva, reajusta, renova, gere acessos e processa lembretes |
| member | **Colaborador** | só contratos a que foi vinculado | conforme o vínculo (abaixo) |
| viewer | **Leitor** (empresa) | só contratos vinculados | **sempre somente consulta** |

## Papel dentro do contrato
| Papel | Ver | Documentos e obrigações | Editar dados / aviso | Estado, valor, reajuste, acessos |
|---|---|---|---|---|
| Gestão (proprietário/gestor) | ✔ | ✔ | ✔ | ✔ |
| Editor | ✔ | ✔ | ✔ | ✘ |
| Leitor | ✔ | ✘ | ✘ | ✘ |

- **Responsável** (contrato ou obrigação) precisa ser gestão ou editor naquele contrato; leitor nunca.
- **CPF/CNPJ** das partes: só a gestão lê. Colaboradores veem a parte (nome, contato) apenas nos contratos que enxergam, com o documento **mascarado**.
- **Notificação**: só a própria, e só enquanto a pessoa ainda enxerga o contrato.
- Contrato **arquivado** ou **encerrado** é somente consulta (a gestão pode reabrir/desarquivar).

## Como é aplicado
`private.ct_contract_role_of(org, contrato, usuário)` decide tudo; as políticas RLS de leitura e as funções `ct_*` usam a mesma função; a interface só esconde o que o banco recusaria. Testes A/B em `supabase/tests/70_ct_security.sql` e `tests/e2e/ct-security.spec.ts`.
