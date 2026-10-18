# SECURITY — Ordens de Serviço

## Modelo de ameaças resumido
| Ameaça | Controle |
|---|---|
| Técnico lê/altera ordem alheia, custos, CPF/CNPJ | RLS por `os_can_see_order`; tabelas sensíveis separadas e só da gestão; escrita só por RPC que revalida perfil e ids da mesma empresa |
| Escalada via API REST do Supabase | `authenticated` só tem `SELECT`; funções `os_*` com `search_path=''`; teste de privilégios de todas as funções (70) e E2E direto na API |
| Adivinhar o link do cliente | token de 256 bits; só o sha256 é guardado; revogável e com validade; falhas contadas por origem **anonimizada** (HMAC + `OS_LINK_SALT`); resposta idêntica para qualquer link inválido; página `noindex`, `no-store`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` |
| Cliente vê o que não deve | projeção `os_public_view` sem notas internas, custos, CPF/CNPJ, técnico, rascunhos e arquivos internos |
| Aceite repudiado | texto montado no banco, versão do orçamento/conclusão, nome declarado, evidências mínimas, **uma** resposta por versão; é aceite simples, não assinatura certificada |
| Upload malicioso | tipo pelos **bytes** (JPEG/PNG/WebP/PDF), sem SVG/HTML; EXIF/GPS removidos; arquivo malformado recusado; caminho gerado no servidor; bucket privado; URL assinada curta; `nosniff` e download forçado |
| Planilha maliciosa (CSV) | células iniciadas por `= + - @ TAB CR` são neutralizadas; BOM + `;` |
| Corrida / duplo clique | versão otimista (40001), trava de linha, idempotência por chave, numeração atômica; teste de concorrência real |
| Adulteração do histórico | gatilhos `append-only`/`no-delete`, orçamento publicado e conclusão imutáveis; correção = novo registro |
| Abuso de login/endpoints | limitador do Core + limites no banco (`os_rate_hit`) |
| Segredos | nenhuma `service_role`; `.env.local` fora do Git; `check-no-secrets` no CI |

## Dados pessoais e LGPD
- **O que coleta:** nome, telefone, e-mail e endereço do cliente; CPF/CNPJ (opcional, tabela à parte); fotos da ordem (podem mostrar pessoas/ambientes); nome declarado no aceite. **Risco: médio.**
- **Princípios:** coleta mínima; CPF/CNPJ opcional e só para a gestão; sem PII em logs; auditoria registra metadados; o link do cliente expõe apenas o que é dele.
- **Retenção e exclusão:** o texto de retenção da empresa é configurável (`os_settings.retention_policy_text`). A interface **não exclui** ordens (histórico imutável por desenho); anonimização/exclusão é **administrativa, no banco**, conforme a política de quem implanta. Fotos: remover do Storage e do registro por rotina administrativa.
- **Direitos do titular:** a exportação CSV (gestão) e a ficha do cliente ajudam a atender pedidos; a resposta formal é responsabilidade do controlador.
- **Quem implanta é o controlador** dos dados; este software não substitui assessoria jurídica. Hospede o banco na **região do Brasil**.

## Limitações honestas
- Sem antivírus nos anexos; sem assinatura digital certificada; sem proteção contra captura de tela do link pelo cliente.
- O limitador em memória do login é por instância; os limites do banco valem em qualquer instância.
- Quem tem o link tem acesso à página até a revogação/expiração: trate-o como credencial (não publique em redes).

## Relato de vulnerabilidade
Abra um aviso privado de segurança no repositório (Security → Advisories) em vez de uma issue pública.
