# SECURITY — Gestão de Contratos e Vencimentos

## Modelo
- **Isolamento por empresa e por contrato**: RLS em todas as tabelas (só leitura) + funções `ct_*` que reconferem sessão, MFA (obrigatório para proprietário/administrador), perfil e papel no contrato. FKs compostas impedem apontar para outra empresa.
- **Sem `service_role`** no aplicativo. Única função acessível sem login: `ct_run_reminders(token)` (token de 64 hex; só o hash fica no banco; limite de taxa). O teste de segurança lista os privilégios de `anon` e falha se aparecer outra função.
- **Funções internas** (`private.*`) não são executáveis por `anon` nem `authenticated`, exceto uma lista fechada de auxiliares de política (conferida por teste).
- **CPF/CNPJ**: tabela própria legível só pela gestão; cópia mascarada no contrato; ausente de CSV, auditoria, eventos, notificações e logs.
- **Arquivos**: bucket `ct-files` privado; caminho `empresa/contrato/<32 hex>.<ext>` validado no banco (empresa e contrato corretos, extensão e tipo coerentes, tamanho máximo configurável); download por **URL assinada de 60 s** emitida após conferir o acesso ao contrato; `storage_path` não é legível pela API. **Sem antivírus.**
- **Aplicação**: CSP estrita (sem `unsafe-inline`), `frame-ancestors 'none'`, `nosniff`, redirecionamentos validados, Markdown/HTML nunca renderizados, CSV com neutralização de fórmulas, limite de taxa por usuário no banco.
- **Concorrência**: edição otimista (`version`), idempotência por chave, travas em ordem fixa, aplicação de reajuste que só uma sessão vence.

## Auditoria e logs
`contract_events` (imutável) registra quem fez o quê em cada contrato; a auditoria do Core guarda ações sem dados pessoais. Exportações ficam registradas (tipo e quantidade de linhas, nunca o conteúdo). Logs do servidor não contêm e-mail, CPF/CNPJ, nomes de arquivos nem valores.

## LGPD
Risco **alto**. Dados pessoais: nome, e-mail, CPF/CNPJ, endereço e documentos contratuais. Finalidade: gestão de contratos. Minimização: documento é opcional; notificações só com ids. **Retenção**: configurável como texto em Configurações (política da empresa); o sistema **não apaga** contratos pela interface (arquiva). **Exclusão/anonimização** a pedido do titular é procedimento administrativo no banco, a cargo de quem implanta (controlador), observando prazos legais de guarda de contratos. Este software não substitui assessoria jurídica.

## O que NÃO fazemos
Não validamos a assinatura de documentos, não interpretamos cláusulas, não verificamos vírus nos arquivos, não enviamos e-mail/WhatsApp, não oferecemos criptografia por campo (use a criptografia em repouso do provedor) e não impedimos que uma pessoa com acesso baixe e compartilhe um arquivo.

## Relato de vulnerabilidades
Veja `SECURITY.md` na raiz do repositório.
