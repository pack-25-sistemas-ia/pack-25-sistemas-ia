# DATA_MODEL — Gestão de Contratos e Vencimentos

Todas as tabelas têm `organization_id` e RLS (leitura por `private.ct_can_see_contract`); relações usam **chaves estrangeiras compostas** `(id, organization_id)`, então nenhum registro aponta para outra empresa.

| Tabela | Para quê |
|---|---|
| `ct_settings` | Uma linha por empresa: marca (cor, logotipo), fuso, prefixo (`CTR`), tamanho máximo de arquivo, janela «próximo do fim», texto de retenção |
| `counterparties` | **Partes** (pessoa/empresa): nome, tipo, e-mail, telefone, endereço, ativo, `version` |
| `counterparty_documents` | **CPF/CNPJ** (só gestão). Único por empresa; dígitos verificadores validados |
| `contract_categories` | Categorias do contrato (ativas/inativas) |
| `contracts` | Contrato: número, título, categoria, responsável, `lifecycle_status` (draft/active/terminated/closed), `archived_at`, vigência (`start_date`, `end_date` ou `indefinite_term`), aviso (`notice_days`, `notice_reference_date`, `notice_deadline_date`, ajustado + motivo), renovação (`renewal_mode`), `deadline_revision`, `version` |
| `contract_access` | Vínculo de **colaborador** ao contrato: `editor` ou `reader` |
| `contract_parties` | Partes do contrato, papel descritivo e instantâneo **mascarado** do documento |
| `contract_documents` / `contract_document_versions` | Documento (título, tipo, ponteiro `current_version_id`, `version_counter`) e **versões** imutáveis (caminho, tipo, tamanho, sha256, autoria). `storage_path` não é legível pela API |
| `contract_changes` | Aditivos, correções e renovações: descrição, data de efeito, **antes/depois** e documento de apoio |
| `contract_value_versions` | **Histórico de valores** append-only (`amount_cents`, `billing_basis`, `effective_from`, origem: aditivo ou reajuste) |
| `contract_adjustment_rules` / `contract_adjustments` | Regra de reajuste (frequência em meses, próxima data) e **propostas/aplicações** (percentual `numeric`, base, novo valor, status proposed/applied/cancelled) |
| `contract_obligations` | Obrigações simples: título, responsável, data, status, nota de conclusão, `revision`, `version` |
| `contract_deadlines` | Prazos derivados (fim, aviso, reajuste) com **revisões** (`superseded_at`) |
| `reminder_rules` / `reminder_deliveries` | Antecedências por tipo de evento; entregas com **chave de deduplicação** única (`sent`/`consolidated`) |
| `notifications` | Sino interno: só ids, tipo, data e antecedência (sem conteúdo) |
| `contract_events` | Histórico imutável por contrato |
| `contract_number_counters`, `mutation_requests`, `ct_rate_limits` | Numeração sem `MAX+1`, idempotência, limite de abuso |
| `ct_job_tokens` / `ct_job_runs` | **Hash** do token do agendador (por empresa) e registro de cada execução (contagens e estado) |

## Regras no banco (resumo)
- `lifecycle_status` só muda por RPC e por transições válidas; `archived_at` só em rescindido/encerrado.
- `end_date` ≥ `start_date`; prazo determinado exige fim; indeterminado não tem fim; aviso indeterminado exige referência.
- `contract_value_versions` e `contract_document_versions` não aceitam UPDATE/DELETE; datas em ordem cronológica.
- Responsável do contrato/obrigação precisa ser membro **com permissão de edição** naquele contrato (`ct_assignable`).
- Remover o acesso de quem tem obrigações pendentes exige decidir: desatribuir ou transferir.
