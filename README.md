# Pack 25 Sistemas IA

25 sistemas MVP para pequenas e médias empresas, prontos para você personalizar com **Claude Code** ou **Codex**, conectar a um banco Supabase seu e publicar.

> ## Estado real (2026-10-18)
> **14 dos 25 sistemas estão validados: CRM Completo, Gestão de Propostas Comerciais, Qualificador de Leads, Pós-Venda e Reativação, Portal de Clientes B2B, Financeiro Completo, Controle de Estoque, Precificação, Dashboard Executivo, Gestão de Comissões, Agendamento Online, Central de Chamados, Ordens de Serviço e Gestão de Projetos.** Os outros 11 estão planejados e ainda não estão disponíveis para uso. O repositório traz o catálogo, os padrões de segurança e privacidade, o núcleo (organizações, papéis, RLS e auditoria) e o CRM, com testes executados e CI verde. O status de cada sistema abaixo é lido de [catalogo/sistemas.json](catalogo/sistemas.json) e só muda após os gates de qualidade. Nada aqui promete renda ou vendas: o pack reduz tempo de desenvolvimento; implantar e vender depende de adequação, testes, hospedagem, suporte e prospecção.

## Catálogo

| # | Sistema | Categoria | Repositório | Status |
|---|---|---|---|---|
| 01 | **CRM Completo** — Funil de vendas único com histórico, tarefas e indicadores calculados do banco | Comercial | [`crm-completo`](https://github.com/pack-25-sistemas-ia/crm-completo) | VALIDADO |
| 02 | **Gestão de Propostas Comerciais** — Propostas profissionais com catálogo, preços, versões imutáveis, PDF, link seguro de aceite e indicadores comerciais | Comercial | [`propostas-comerciais`](https://github.com/pack-25-sistemas-ia/propostas-comerciais) | VALIDADO |
| 03 | **Qualificador de Leads Inteligente** — Formulários públicos com condicionais, score transparente de 0 a 100, distribuição e indicadores por campanha | Comercial | [`qualificador-leads`](https://github.com/pack-25-sistemas-ia/qualificador-leads) | VALIDADO |
| 04 | **Pós-Venda e Reativação de Clientes** — Histórico de compras, RFM transparente, oportunidades de reativação e campanhas com resultados observados | Comercial | [`pos-venda`](https://github.com/pack-25-sistemas-ia/pos-venda) | VALIDADO |
| 05 | **Portal de Clientes B2B** — Painel da prestadora e portal do cliente: solicitações com prazo, documentos privados, entregas e comunicados, isolado por empresa | Comercial | [`portal-b2b`](https://github.com/pack-25-sistemas-ia/portal-b2b) | VALIDADO |
| 06 | **Financeiro Completo** — Controle de contas, categorias e fluxo de caixa com lançamentos auditáveis | Gestão | [`financeiro-completo`](https://github.com/pack-25-sistemas-ia/financeiro-completo) | VALIDADO |
| 07 | **Controle de Estoque** — Saldo confiável por depósito com movimentação auditável e alerta de mínimo | Gestão | [`controle-de-estoque`](https://github.com/pack-25-sistemas-ia/controle-de-estoque) | VALIDADO |
| 08 | **Precificação** — Cálculo transparente de preço, margem e markup com cenários comparáveis | Gestão | [`precificacao`](https://github.com/pack-25-sistemas-ia/precificacao) | VALIDADO |
| 09 | **Dashboard Executivo** — Importação de CSV com mapeamento de colunas e KPIs comparativos por período | Gestão | [`dashboard-executivo`](https://github.com/pack-25-sistemas-ia/dashboard-executivo) | VALIDADO |
| 10 | **Gestão de Comissões** — Planos de comissão por faixa com estornos e fechamentos rastreáveis | Gestão | [`gestao-de-comissoes`](https://github.com/pack-25-sistemas-ia/gestao-de-comissoes) | VALIDADO |
| 11 | **Agendamento Online** — Reserva pública com disponibilidade real, bloqueios e reagendamento | Operações | [`agendamento-online`](https://github.com/pack-25-sistemas-ia/agendamento-online) | VALIDADO |
| 12 | **Central de Chamados** — Tickets com SLA, responsáveis, notas e métricas | Operações | [`central-de-chamados`](https://github.com/pack-25-sistemas-ia/central-de-chamados) | VALIDADO |
| 13 | **Ordens de Serviço** — Ciclo completo da OS com checklist, peças, fotos e aceite simples | Operações | [`ordens-de-servico`](https://github.com/pack-25-sistemas-ia/ordens-de-servico) | VALIDADO |
| 14 | **Gestão de Projetos** — Quadro Kanban por projeto com prazos, responsáveis e comentários | Operações | [`gestao-de-projetos`](https://github.com/pack-25-sistemas-ia/gestao-de-projetos) | VALIDADO |
| 15 | **Gestão de Contratos** — Cadastro de contratos com arquivos, vencimentos e lembretes | Operações | `gestao-de-contratos` | PLANEJADO |
| 16 | **Dashboard de Marketing** — Visão consolidada de custo, conversão, ROAS e CPL por importação CSV | Marketing | `dashboard-de-marketing` | PLANEJADO |
| 17 | **Pesquisa NPS e Satisfação** — Pesquisa pública NPS/CSAT com alertas para detratores e relatório | Marketing | `pesquisa-nps` | PLANEJADO |
| 18 | **Programa de Fidelidade** — Pontos, recompensas e resgates com extrato imutável | Marketing | `programa-de-fidelidade` | PLANEJADO |
| 19 | **Conteúdo com IA** — Marcas, briefings, calendário e aprovação, com sugestões de IA por ação explícita | Marketing | `conteudo-com-ia` | PLANEJADO |
| 20 | **Programa de Afiliados** — Links rastreáveis, leads atribuídos e comissão com aprovação | Marketing | `programa-de-afiliados` | PLANEJADO |
| 21 | **CRM Imobiliário** — Funil de negociação com imóveis, visitas e ficha pública do interessado | Verticais | `crm-imobiliario` | PLANEJADO |
| 22 | **Cardápio Digital e Pedidos** — Cardápio público com carrinho, pedidos e painel de cozinha | Verticais | `cardapio-digital` | PLANEJADO |
| 23 | **Gestão de Academias** — Alunos, planos, agenda, treinos montados pelo profissional e mensalidades administrativas | Verticais | `gestao-de-academias` | PLANEJADO |
| 24 | **Gestão Escolar** — Matrículas, turmas, aulas, presença, parcelas e certificados administrativos | Verticais | `gestao-escolar` | PLANEJADO |
| 25 | **Gestão de Eventos** — Inscrições com lotes, ingressos QR assinados, check-in único e controle de presença | Verticais | `gestao-de-eventos` | PLANEJADO |

## Como usar um sistema (o caminho simples)

1. Na área de membros, abra a aula e clique no link do repositório.
2. Escolha o sistema na lista acima e entre no repositório dele (o nome é o da coluna "Repositório").
3. Clique em **Code** e copie o link de clone.
4. No VS Code, abra a pasta do seu projeto, cole o link num `git clone` e abra a pasta com **Claude Code** ou **Codex**.
5. Peça ao agente para ler o `AGENTS.md` e o `MEMORY.md` e adapte para a empresa do seu cliente.

Passo a passo completo, com os cuidados de privacidade, em [guias/primeiros-passos.md](guias/primeiros-passos.md).

> Os repositórios individuais só são criados quando o sistema passa nos testes de qualidade. Até lá, a coluna "Repositório individual" mostra o nome reservado, não um link ativo.

Alternativa (apenas uma pasta deste repositório, via *sparse checkout*) em [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md). O GitHub **não** permite `git clone` de uma subpasta.

## Pilares

- **Seguro por padrão:** isolamento por empresa com RLS testado, auditoria imutável, validação no servidor. Veja [docs/SECURITY_STANDARD.md](docs/SECURITY_STANDARD.md).
- **LGPD desde o projeto:** solicitações de titulares, minimização, retenção e guia por risco. Veja [docs/LGPD_GUIDE.md](docs/LGPD_GUIDE.md). Não substitui assessoria jurídica.
- **Autônomo:** cada sistema é independente, com banco, testes e documentação próprios.

## Custos previstos de infraestrutura

Você precisará de um projeto **Supabase** (banco, autenticação, armazenamento) e de hospedagem para a aplicação Next.js. Os planos gratuitos têm limites e, em alguns provedores, **restrição a uso comercial**; confira preços e termos vigentes antes de implantar para um cliente. Recursos de IA têm custo por uso do provedor que você escolher e são opcionais.

## Limites comerciais

Os sistemas são MVPs. Não incluem: emissão fiscal, contabilidade, assinatura eletrônica certificada, pagamento integrado, envio em massa ou automação de WhatsApp (ver "fora do escopo" de cada sistema no catálogo). Valores de implantação no catálogo são ilustrativos.

## Perguntas frequentes

**Posso usar com dados reais de clientes?** Sim, depois de configurar seu Supabase, revisar a LGPD ([guia](docs/LGPD_GUIDE.md)) e testar. Nunca use dados reais em ambientes de demonstração.
**Preciso saber programar?** Ajuda. O pack foi desenhado para personalização guiada por Claude Code ou Codex ([guias](guias/)).
**E se eu achar uma falha de segurança?** Veja [SECURITY.md](SECURITY.md).

## Licença e suporte

[LICENSE.md](LICENSE.md) · [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) · O suporte é feito pela plataforma em que você adquiriu o curso.
