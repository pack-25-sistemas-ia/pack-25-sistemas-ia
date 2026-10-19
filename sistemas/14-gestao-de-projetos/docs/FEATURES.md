# FEATURES — Gestão de Projetos e Tarefas

Estado de cada funcionalidade do MVP. Tudo abaixo está **implementado e coberto por testes** (ver `MEMORY.md`); nada é prometido sem existir.

| Área | Funcionalidade | Estado |
|---|---|---|
| Projetos | Criar (planejado/ativo), editar, número por empresa, datas, status e transições, reabrir com motivo, arquivar/desarquivar, lista com busca e filtros | Pronto |
| Participantes | Líder/editor/leitor, trocar papel, remover (desatribuir ou transferir tarefas abertas), gestão com acesso total | Pronto |
| Quadro | Etapas configuráveis (criar, renomear, reordenar, excluir com realocação do mesmo tipo), cartões, arrastar e menu «Mover…», ordem estável, proteção de concorrência | Pronto |
| Lista | Filtros (status, etapa, responsável, prioridade, etiqueta, atraso, busca), ordenação, paginação no servidor, cartões no celular | Pronto |
| Tarefas | Criar/editar, prioridade, datas, responsável único, etiquetas, descrição Markdown, impedimento com motivo, arquivar, chave legível (`PRJ-0001-12`) | Pronto |
| Checklist | Itens opcionais e obrigatórios, marcar/desmarcar, remover, criar a partir de texto (`!` = obrigatório); bloqueia concluir | Pronto |
| Comentários | Somente acréscimo, Markdown sanitizado | Pronto |
| Anexos | PNG/JPEG/WebP/PDF/TXT/CSV, tipo pelos bytes, privados, download por link assinado | Pronto |
| Minhas tarefas | Grupos por data (atrasadas, hoje, próximos 7 dias, depois, sem prazo), só tarefas abertas atribuídas à pessoa | Pronto |
| Notificações | Atribuída a você, comentário, reaberta, projeto reaberto; lidas/todas lidas; contador no menu | Pronto |
| Histórico | Eventos do projeto e da tarefa em linguagem clara, sem apagar | Pronto |
| Painel | Abertas, atrasadas, bloqueadas, sem responsável, concluídas no período, por etapa/prioridade, carga por pessoa, progresso por projeto | Pronto |
| Exportação | CSV seguro (BOM, `;`, fórmulas neutralizadas), respeita filtros e acesso | Pronto |
| Marca e configurações | Nome, cor, logotipo, fuso, prefixo, tamanho de anexo, texto de retenção | Pronto |
| Segurança | RLS por projeto, escrita só por RPC, MFA para proprietário/admin, limites, auditoria | Pronto |
| Acessibilidade e celular | Teclado, foco visível, alvos de toque ≥ 40 px, sem rolagem horizontal da página | Pronto |

## Fora do escopo
Gantt e dependências, horas faturáveis, várias pessoas por tarefa, subtarefas hierárquicas, recorrência, automações, integrações, notificações por e-mail/WhatsApp, aplicativo nativo, IA. Decisões em `docs/DECISIONS.md`.
