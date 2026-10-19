# REFERENCES — Gestão de Projetos e Tarefas

Pesquisa de soluções abertas **antes** de construir. Licença, versão e popularidade foram **consultadas em 2026-10-18** (API do GitHub e `npm view`); o que não foi verificado não aparece. Nenhum código de terceiros foi copiado: as decisões abaixo são sobre **ideias** e **dependências**.

| Projeto | Licença | Popularidade (2026-10-18) | O que oferece | Decisão |
|---|---|---|---|---|
| [Plane](https://github.com/makeplane/plane) (v1.4.2) | AGPL-3.0 | 61.045 estrelas, ativo | Gestão de projetos (issues, ciclos, módulos, quadro) | **Estudar (só conceito).** AGPL-3.0 não pode ser incorporada a um produto distribuído sem copyleft de rede. Ideia usada (decisão nossa): etapas com *tipo* semântico separado do nome. |
| [Planka](https://github.com/plankanban/planka) (v2.2.1) | Licença comunitária (código `.pe.` é comercial) | ativo | Kanban colaborativo | **Estudar (só conceito).** Licença não é OSI e há arquivos de edição paga: não incorporar. Reforça o quadro simples com cartões, etiquetas e checklist. |
| [Wekan](https://github.com/wekan/wekan) (v12.53) | MIT | 21.124 estrelas, ativo | Kanban de código aberto | **Estudar.** Licença permite, mas é outro stack (Meteor/MongoDB). Referência de comportamento: raias, etiquetas, checklist e arquivamento (não excluir). |
| [dnd-kit](https://github.com/clauderic/dnd-kit) (`@dnd-kit/core` 6.3.1, `@dnd-kit/react` 0.5.1) | MIT | ativo | Arrastar e soltar acessível para React | **Não adotado.** Arrastar nativo (HTML5) opcional + menu «Mover…» obrigatório cobrem teclado, celular e leitor de tela com zero dependência; reavaliar se o arrastar por toque virar requisito. |
| [TanStack Table](https://github.com/TanStack/table) (`@tanstack/react-table` 9.3.1) | MIT | ativo | Tabelas headless | **Rejeitar.** Filtros, ordenação e paginação são feitos **no servidor** (URL + consulta paginada); a tabela é só HTML, com cartões no celular. |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | 125.844 estrelas, ativo | Componentes copiáveis (Radix + Tailwind) | **Rejeitar como dependência.** Traria Radix e muitos arquivos para poucos controles; os componentes do Core (Tailwind puro, `<details>`, formulários nativos) bastam e mantêm a CSP estrita. |

## Conclusões que viraram requisito
- Etapa com **tipo** (a fazer / andamento / revisão / concluído) para que «concluída» tenha significado independente do nome.
- Arquivar em vez de excluir; histórico do cartão que nunca se apaga.
- Movimentação **sem arrastar** (teclado/celular) e proteção contra duas pessoas movendo ao mesmo tempo.
- Todas as decisões que dependem de licença estão em `docs/DECISIONS.md`; `THIRD_PARTY_NOTICES.md` registra que nenhum código foi incorporado.
