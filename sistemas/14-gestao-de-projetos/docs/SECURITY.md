# SECURITY — Gestão de Projetos e Tarefas

## Modelo de ameaças resumido
| Ameaça | Controle |
|---|---|
| Pessoa de fora do projeto lê tarefas, comentários, anexos, eventos ou notificações | RLS **somente SELECT** por `private.pj_can_see_project` em todas as tabelas; gestor/proprietário veem tudo da empresa, os demais só onde têm linha em `project_members`; teste A/B no SQL (70) e direto na API REST no E2E; telas respondem 404 real |
| Escalada pela API REST do Supabase | `authenticated` só tem `SELECT` (e a coluna `storage_path` dos anexos nem isso); toda escrita passa por RPC `pj_*` com `search_path=''` que revalida sessão, MFA, perfil, papel no projeto e que os ids são da mesma empresa/projeto; `anon` não executa nada; teste de privilégios de todas as funções (70) |
| Leitor da empresa escrevendo | só pode ter papel «leitor» (guard no banco); não recebe tarefas; sem botões de ação na tela |
| Alterar projeto concluído/cancelado/arquivado ou pausado | `pj_writable` no guard de cada tabela (vale para SQL direto); transições validadas no banco |
| Corrida / duplo clique / dois arrastando | `version` otimista (40001), trava de projeto antes da tarefa, `board_version`, idempotência por chave, contadores atômicos; teste de concorrência real e mutação |
| Adulteração do histórico | eventos, comentários, anexos e notificações são append-only; `projects` e `tasks` não são apagáveis; correção = novo registro |
| XSS por Markdown/HTML | comentário e descrição viram AST: **nenhum HTML**, links só `http/https`, limites de tamanho/itens; CSP sem `'unsafe-inline'`; `<script>` digitado aparece como texto (E2E) |
| Upload malicioso | tipo pelos **bytes** (PNG/JPEG/WebP/PDF; TXT/CSV só se UTF-8 válido sem controle); sem SVG/HTML; nome do arquivo sanitizado; caminho gerado no servidor; bucket privado; link assinado de 60 s; `nosniff`; texto entregue como download |
| Planilha maliciosa (CSV) | células iniciadas por `= + - @ TAB CR` neutralizadas; BOM + `;`; exportação respeita o acesso de quem exporta |
| Revogação de acesso | remover participante/membro revoga **na hora**: tarefas, projeto e notificações deixam de ser visíveis; tarefas abertas dele são liberadas (ou transferidas) com evento |
| Abuso | limites no banco (`pj_rate_hit`) por pessoa em criação, comentário, anexo e exportação; limitador de login do Core |
| Segredos | nenhuma `service_role`; `.env.local` fora do Git; `check-no-secrets` no CI |

## Dados pessoais e LGPD
- **O que coleta:** nome e e-mail dos membros (do Core) e o conteúdo livre digitado (títulos, comentários, anexos), que **pode** conter dados pessoais de terceiros. **Risco: baixo a médio.**
- **Princípios:** coleta mínima; notificações guardam só ids e tipo (nunca copiam título ou comentário); sem PII em logs; auditoria registra metadados, não conteúdo.
- **Retenção e exclusão:** o texto de retenção da empresa é configurável (`pj_settings.retention_policy_text`). A interface **não exclui** projetos nem tarefas (histórico imutável): arquiva. Anonimização/exclusão é **administrativa, no banco**, conforme a política de quem implanta. Anexos: remover do Storage e do registro por rotina administrativa (anexos órfãos de envio interrompido podem ser removidos após 2 horas).
- **Direitos do titular:** o CSV (gestão) e o histórico ajudam a atender pedidos; a resposta formal é responsabilidade do controlador.
- **Quem implanta é o controlador** dos dados; este software não substitui assessoria jurídica. Hospede o banco na **região do Brasil**.

## Limitações honestas
- Sem antivírus nos anexos; sem criptografia ponta a ponta (o banco e o Storage são do provedor).
- O limitador em memória do login é por instância; os limites do banco valem em qualquer instância.
- Comentários não podem ser editados nem apagados (por desenho); um dado pessoal postado por engano exige correção administrativa.
- Prazos são datas sem hora; «atrasada» depende do fuso configurado.

## Relato de vulnerabilidade
Abra um aviso privado de segurança no repositório (Security → Advisories) em vez de uma issue pública.
