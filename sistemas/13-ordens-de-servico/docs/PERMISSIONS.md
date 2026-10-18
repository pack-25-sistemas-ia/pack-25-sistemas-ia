# PERMISSIONS — Ordens de Serviço

Quatro formas de acesso. Os três primeiros vêm do papel do **Core** (a tela «Pessoas e acessos»); o quarto não tem conta.

| Perfil no sistema | Papel no Core | O que vê | O que faz |
|---|---|---|---|
| **Proprietário** | owner / admin | tudo da empresa, custos internos e CPF/CNPJ | tudo; configurações da empresa; **reabre ordem encerrada**; ativa/desativa técnicos |
| **Gestor** | manager | tudo da empresa, custos internos e CPF/CNPJ | cadastros, abre/agenda/atribui/cancela ordens, orçamentos, links, registra decisão manual do cliente, encerra, reabre ordem **concluída**, relatórios e CSV |
| **Técnico** | member | **somente** as ordens atribuídas a ele (e o cliente, endereço e equipamento delas); orçamento publicado/aprovado dessas ordens | inicia, pausa, retoma e conclui **as suas**; checklist, peças, fotos, notas; **nunca** custos internos, margens, CPF/CNPJ, rascunhos de orçamento, links ou relatórios |
| **Cliente** | — (sem conta) | uma página por **link com token** | vê a ordem, o orçamento publicado, atualizações e fotos **compartilhadas**; aprova/recusa o orçamento e aceita/contesta a conclusão |
| (Leitor do Core) | viewer | **nada**: não tem perfil neste sistema | — |

## Regras
- Técnico **desativado** (tabela `technician_status`) perde o acesso e as ordens abertas dele voltam à fila (`os_release_orders`); quem sai da empresa também.
- Um técnico não é gestor com menus ocultos: o filtro é do **banco** (RLS e funções), não da tela. Teste A/B em `supabase/tests/70_os_security.sql` e no E2E `os-security`.
- Escrita **só** por funções `os_*` (SECURITY DEFINER, `search_path` vazio): validam sessão, MFA (exigência do Core para papéis administrativos), perfil e que todos os ids são da **mesma** empresa.
- O técnico enxerga os **preços** do orçamento da ordem dele (decisão D-O9); não enxerga custos internos nem margem.
- O cliente só chega ao que o token da **sua** ordem autoriza; token inválido, revogado, expirado ou malformado responde igual (404), sem revelar nada.
- Ações por estado e perfil: `lib/os/status.ts` (`availableActions`) é o espelho para a interface; o banco recusa o resto.
