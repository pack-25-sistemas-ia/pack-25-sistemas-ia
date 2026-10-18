# REFERENCES — Ordens de Serviço

Pesquisa de soluções abertas **antes** de construir. Licença, versão e popularidade foram **consultadas em 2026-10-18** (API do GitHub e `npm view`); o que não foi verificado não aparece. Nenhum código de terceiros foi copiado: as decisões abaixo são sobre **ideias** e **dependências**.

| Projeto | Licença | Popularidade (2026-10-18) | O que oferece | Decisão |
|---|---|---|---|---|
| [ERPNext](https://github.com/frappe/erpnext) (módulo de manutenção/serviço) | GPL-3.0 | 40.292 estrelas, ativo | ERP completo; ordens de manutenção ligadas a contas, estoque e faturamento | **Estudar (só conceito).** GPL-3.0 não pode ser incorporada a um produto vendido sem copyleft. Decisão de projeto inspirada em separar «solicitação», «orçamento» e «execução». |
| [Dolibarr](https://github.com/Dolibarr/dolibarr) (intervenções/fichas de intervenção) | GPL-3.0 | 7.740 estrelas, ativo | Intervenções com duração, linhas e assinatura do cliente | **Estudar (só conceito).** Mesma restrição de licença. Reforça (como decisão nossa) que o aceite fique preso a um **texto** e a uma **versão**. |
| [InvenTree](https://github.com/inventree/InvenTree) | MIT | 7.726 estrelas, ativo | Peças, estoque, ordens de produção/compra | **Estudar.** Licença permite, mas é estoque; este sistema registra **uso de peças sem estoque** (escopo do MVP). Ideia adotada: correção por estorno com referência ao lançamento original. |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | 125.841 estrelas, ativo | Componentes copiáveis (Radix + Tailwind) | **Rejeitar como dependência.** Traria Radix e dezenas de arquivos para poucos controles; os componentes do Core (Tailwind puro, `<details>`, formulários nativos) bastam e mantêm a CSP estrita. |
| [TanStack Table](https://github.com/TanStack/table) (`@tanstack/react-table` 9.3.1, MIT) | MIT | 28.498 estrelas, ativo | Tabelas headless | **Rejeitar.** Filtros, ordenação e paginação são feitos **no servidor** (URL + consulta paginada); a tabela é só HTML, com cartões no celular. |
| [react-pdf](https://github.com/diegomura/react-pdf) (`@react-pdf/renderer` 4.9.0, MIT) | MIT | 16.833 estrelas, ativo | PDF por componentes React, no servidor | **Incorporar como dependência** (`@react-pdf/renderer@4.9.0`, `serverExternalPackages`). Gera orçamento, ordem e conclusão sem navegador headless e sem serviço externo. |
| [osTicket](https://github.com/osTicket/osTicket) | GPL-2.0 | 3.987 estrelas, sem push desde 2026-06 | Help desk | **Rejeitar** (outro problema e licença GPL). |

## Conclusões que viraram requisito
- Orçamento **versionado e congelado** ao publicar; aprovação presa à versão (e ao texto aceito).
- Aceite **simples** (nome + caixa de confirmação + texto montado no banco), claramente diferente de assinatura certificada.
- Correção de peças por **estorno/ajuste referenciado**, nunca por edição do lançamento.
- Todas as decisões que dependem de licença estão em `docs/DECISIONS.md`; `THIRD_PARTY_NOTICES.md` registra que nenhum código foi incorporado.
