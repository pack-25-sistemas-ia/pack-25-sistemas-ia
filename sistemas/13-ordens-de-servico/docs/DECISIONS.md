# DECISIONS — Ordens de Serviço

Decisões que mudariam o resultado se fossem outras. Formato: decisão — motivo.

- **D-O1 Rotas na raiz em português** (`/ordens`, `/clientes` …), não sob `/app`: o Core já usa a raiz e o proxy; o catálogo manda no diretório (`13-ordens-de-servico`).
- **D-O2 Leitor do Core não tem perfil.** Proprietário/admin → proprietário; gerente → gestor; membro → técnico. Evita um quarto papel sem uso.
- **D-O3 Banco como fonte de verdade.** Estados, cálculo, aceite e visibilidade nas funções `os_*` e em gatilhos; o espelho TS só explica/projeta. Quem fala direto com a API recebe as mesmas regras.
- **D-O4 CPF/CNPJ em tabela separada** (`customer_private`), legível só pela gestão, com dígitos verificadores conferidos no banco e no servidor. O técnico não precisa dele para trabalhar.
- **D-O5 Token do link = 32 bytes, só o hash no banco.** Gerado no servidor Next (o banco nunca vê o token em claro); revogável, com validade; um link ativo por ordem. Texto do aceite **montado no banco** (`os_quote_text`, `os_completion_text`), nunca vindo do navegador.
- **D-O6 Token inválido não é exceção.** Uma exceção desfaria, na mesma transação, o contador de tentativas falhas; por isso devolve `invalid_link` e só o estouro do limite (54000) levanta erro. Origem é anonimizada por HMAC com sal do servidor (`OS_LINK_SALT`; sem ele o link público falha **fechado**).
- **D-O7 Aceite «simples».** Nome declarado + caixa de confirmação + texto + evidências mínimas (origem anonimizada, agente, token). **Não** é assinatura eletrônica certificada e a interface diz isso. Registro manual pela equipe é um canal distinto, com operador e justificativa.
- **D-O8 Orçamento versionado.** Publicar congela; nova versão substitui a publicada pendente; aprovação vale só para a versão vigente (travas de linha). Execução sem orçamento exige **justificativa** e fica registrada (`quote_mode = authorized`).
- **D-O9 Técnico vê os preços** do orçamento da ordem dele (precisa saber o que foi vendido) mas **não** custos internos nem margem.
- **D-O10 Reabertura.** Ordem concluída (aguardando aceite) pode ser reaberta pela gestão; **encerrada só pelo proprietário**, com motivo. Cada conclusão tem **versão**; o aceite da v1 nunca encerra a v2.
- **D-O11 Peças sem estoque.** Registra-se o **uso**; correção por estorno/ajuste referenciado; divergência com o orçamento aprovado exige justificativa (≥ 10 caracteres) ou nova versão.
- **D-O12 Dinheiro em centavos, quantidade com 3 casas**, «meio para cima»; BigInt no TS, `numeric`/`round()` no banco, com testes de mesmos valores.
- **D-O13 Fuso da empresa** em janelas e períodos; janela ≤ 14 dias; **sobreposição de agenda é alerta**, não bloqueio.
- **D-O14 Fotos sem metadados.** EXIF/XMP/IPTC/comentários removidos por código próprio (mantém a orientação). Sem antivírus — não afirmamos o contrário.
- **D-O15 Sem TanStack Table, react-hook-form, shadcn/ui nem biblioteca de gráficos.** Filtros/paginação no servidor, formulários nativos com Zod no servidor (ver `docs/REFERENCES.md`). PDF com `@react-pdf/renderer` (MIT).
- **D-O16 Licenças.** Nenhum código GPL/AGPL (ERPNext, Dolibarr, osTicket) foi incorporado; só referência conceitual.
- **D-O17 Sem `service_role`.** Nem no servidor: tudo passa por RLS/RPC; fotos do cliente via política de Storage com cabeçalho repassado.
- **Fora do MVP:** estoque, faturamento/fiscal, assinatura certificada, WhatsApp/e-mail como requisito, aplicativo nativo, GPS/rota, contratos e SLA contratual, IA.
