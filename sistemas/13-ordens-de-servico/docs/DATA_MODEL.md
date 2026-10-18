# DATA_MODEL — Ordens de Serviço

Migrações `supabase/migrations/20271301*` (sobre o Core: organizações, membros, papéis, `audit_log`). Toda tabela tem `organization_id`, **RLS ligada** (só `SELECT` para `authenticated`) e **chaves compostas** `(id, organization_id)` nas referências: um registro de uma empresa nunca aponta para outra. Escrita só por funções `os_*`.

## Cadastros
| Tabela | Conteúdo |
|---|---|
| `os_settings` | por empresa: nome público, logotipo, cor, **fuso**, prefixo do número, validade padrão do orçamento, validade do link, tamanho máximo de anexo, texto de retenção |
| `technician_status` | técnico ativo/desativado (o papel vem do Core) |
| `customers` · `customer_private` | cliente (pessoa/empresa, contato) · **CPF/CNPJ e observações internas em tabela separada**, legível só pela gestão |
| `customer_contacts` · `customer_addresses` | contatos (um principal) e endereços (um padrão) |
| `equipment` | equipamento **opcional** do cliente (tipo, marca, modelo, série) |
| `service_catalog` · `part_catalog` | serviços e peças com preço de referência (centavos) — o preço de referência **não** vale para ordens já orçadas |
| `checklist_templates` · `checklist_template_items` | modelos de checklist (tipos: sim/não, texto, número, seleção; obrigatório; foto obrigatória; «não se aplica»; regra de justificativa) |

## Ordem de serviço
| Tabela | Conteúdo |
|---|---|
| `service_orders` | número **por empresa** (`order_number`, contador atômico), cliente/endereço/equipamento, `execution_status` (`draft, open, scheduled, in_progress, paused, completed, closed, cancelled`), técnico, janela (≤ 14 dias, fuso da empresa), `quote_mode` (`required` / `authorized` + justificativa), `completion_version`, `version` otimista |
| `service_order_snapshots` | **cópia** de cliente, endereço e equipamento no momento da abertura e a cada mudança (documentos usam a cópia da época) |
| `order_pauses` | pausas (uma aberta por ordem) |
| `quote_versions` · `quote_items` | orçamento **versionado**: rascunho → publicado → aprovado/recusado/substituído. Itens com `quantity numeric(12,3)` e `line_total_cents = round(quantity × preço)`; total = subtotal − desconto (restrições `CHECK`). Publicado é **imutável** |
| `quote_decisions` | **uma** decisão por versão; canal `customer_link` ou `staff_manual` (operador e justificativa obrigatórios); texto aceito gravado; evidências mínimas (origem, agente, token) |
| `order_checklist_items` | **snapshot** do modelo + respostas |
| `order_part_usage` | uso de peças **sem estoque**; correção só por estorno/ajuste referenciando o lançamento original |
| `order_internal_costs` | custos internos (**só gestão**); correção por lançamento negativo referenciado |
| `order_updates` | notas `internal` ou `customer` (append-only) |
| `order_attachments` | fotos/PDF **privados** (Storage `os-files`); só a visibilidade muda |
| `order_completions` · `completion_acceptances` | conclusão **versionada** (resumo, snapshots de checklist/peças/orçamento, justificativa de divergência) e aceite/contestação por versão |
| `order_events` | linha do tempo (append-only) |
| `public_access_tokens` | só o **hash sha256** do token, validade, revogação; um link ativo por ordem |
| `order_number_counters` · `mutation_requests` · `os_rate_limits` | numeração, idempotência e limite de abuso |

## Invariantes (no banco, não só na tela)
- Estados: `os_order_guard` recusa transição inválida, edição de ordem concluída/encerrada/cancelada, início sem responsável e responsável que não seja membro **ativo e operacional**.
- Dinheiro em **centavos** (`bigint`); quantidade com 3 casas; arredondamento «meio para cima» do `round()` do `numeric` (espelho TS em BigInt: `lib/os/money.ts`).
- Histórico imutável: gatilhos `os_no_delete` / `os_append_only`; correção = novo registro.
- Concorrência: `version` em ordens e orçamentos (erro 40001 = «alterada por outra pessoa»), trava de linha, idempotência por `mutation_requests`, numeração sem `MAX+1`.
- Dados pessoais: nome/telefone/e-mail/endereço do cliente, fotos e CPF/CNPJ (separado). Auditoria registra **metadados**, nunca valores pessoais.
