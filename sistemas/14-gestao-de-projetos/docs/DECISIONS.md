# DECISIONS — Gestão de Projetos e Tarefas

Formato: decisão · motivo · consequência. Identificadores D-P1… (sistema 14).

- **D-P1 Banco como fonte de verdade, com espelho TS.** Permissões, estados, ordem e conclusão são impostos por RPC + gatilhos; `lib/pj/status.ts` só reflete para a interface. *Consequência:* mudar regra = mudar SQL e TS e os testes com os mesmos valores.
- **D-P2 Visibilidade por projeto, não só por empresa.** Colaborador só vê onde participa; gestor/proprietário veem tudo e atuam como líder sem linha em `project_members`. *Motivo:* agências têm clientes e projetos que não se misturam.
- **D-P3 «Leitor» da empresa = colaborador somente leitura.** Pode participar de projetos apenas como leitor; não recebe tarefas nem aparece em «Minhas tarefas». *Motivo:* aproveita o papel do Core sem criar um quinto perfil.
- **D-P4 Um responsável por tarefa.** Dono claro > tarefa «de todos». Atribuição só a líder/editor/gestão. Quem perde o acesso tem as tarefas liberadas, com evento.
- **D-P5 Etapa define o status.** Cada etapa tem um tipo (a fazer / em andamento / em revisão / concluído); o status da tarefa é derivado dele. Nunca há dois campos que possam divergir. Quadro sempre mantém ≥ 1 etapa «a fazer» e ≥ 1 «concluído».
- **D-P6 Impedimento é atributo, não etapa.** Uma tarefa bloqueada continua onde está; tem motivo e data; entra no painel.
- **D-P7 Estados do projeto: organizar × executar.** Planejado/pausado permitem organizar o quadro mas não executar (mudar o tipo da etapa); concluído/cancelado/arquivado são somente consulta; concluir exige zero tarefas abertas; reabrir exige motivo. «Arquivado» é atributo à parte (só de concluído/cancelado).
- **D-P8 Datas, não horários.** Início/vencimento são `date`; «atrasada» = vencimento anterior a *hoje no fuso da empresa* (configurável, padrão America/Sao_Paulo). Concluída nunca é atrasada. Fora do período do projeto só **avisa**.
- **D-P9 Ordem densa e travas em ordem fixa.** Posições 1..n por etapa com índice único parcial; reordenação em duas fases (+1.000.000, depois 1..n) dentro da transação; `pj_move_task` trava o **projeto antes da tarefa** (evita deadlock); `board_version` detecta quem moveu sobre um quadro já alterado e só sobe em mover/reordenar/operar etapas; mover sem efeito é no-op.
- **D-P10 Rotas na raiz.** `/projetos`, `/tarefas`, `/minhas-tarefas`… (e não `/app/projetos`), coerente com o Core e com os demais sistemas.
- **D-P11 Arrastar é opcional, o menu é obrigatório.** Arrastar nativo (HTML5) melhora o uso no desktop, mas **toda** movimentação também existe pelo menu «Mover…» (teclado, leitor de tela, celular). *Não adotado:* `@dnd-kit` (ver REFERENCES).
- **D-P12 Concorrência explícita.** `version` otimista nas entidades (erro 40001 com mensagem clara «Outra pessoa alterou … antes de você»), idempotência por chave nas criações e contadores atômicos (sem `MAX()+1`).
- **D-P13 Comentários e histórico só acrescentam.** Sem editar nem apagar: correção = novo comentário. *Custo:* dado pessoal postado por engano exige correção administrativa (docs/SECURITY.md).
- **D-P14 Markdown como AST, nunca HTML.** Parser próprio (negrito, itálico, código, listas, links http/https) com limites; sem `dangerouslySetInnerHTML`; CSP sem `'unsafe-inline'`.
- **D-P15 Anexos privados e simples.** Allowlist pelos bytes (imagens, PDF; TXT/CSV só se UTF-8 sem controles), caminho gerado no servidor, `storage_path` ilegível pela API, entrega por rota própria com URL assinada de 60 s; texto sempre como download. Sem antivírus (dito na documentação).
- **D-P16 Notificações mínimas e internas.** Só ids e tipo; nunca o autor; destinatários sem repetição; visíveis só enquanto a pessoa vê o projeto. Sem e-mail/WhatsApp no MVP.
- **D-P17 Painel sem «produtividade».** Mostra o que é contável (abertas, atrasadas, bloqueadas, sem responsável, concluídas no período, carga, progresso); sem tarefas → «Sem tarefas», nunca 0% ou 100% inventado; não ranqueia pessoas.
- **D-P18 Sem bibliotecas de formulário, tabela, gráfico ou componentes.** Sem React Hook Form, TanStack Table, shadcn/ui nem biblioteca de gráficos: formulários nativos + Zod, tabela HTML paginada no servidor, barras em CSS. Menos superfície de ataque e de licença.
- **D-P19 Sem `service_role`.** Nenhum segredo de servidor; tudo roda com a sessão da pessoa e as funções `SECURITY DEFINER` validam o chamador.
- **D-P20 Sem exclusão pela interface.** Arquivar substitui excluir (projeto e tarefa); exclusão/anonimização é administrativa (LGPD documentada).
- **D-P21 Fora do MVP:** Gantt/dependências, horas faturáveis, várias pessoas por tarefa, subtarefas hierárquicas, recorrência, automações, integrações, app nativo, IA.
