# Pós-Venda e Reativação de Clientes

Entenda **quem está comprando, quem está esfriando e quem já sumiu**, e organize o contato manual da sua equipe para trazer esses clientes de volta. Next.js + Supabase, com RLS em tudo.

**Público:** lojas, distribuidoras, serviços recorrentes e qualquer empresa com base de clientes que compram mais de uma vez.
**Problema:** o cliente compra, some, e ninguém percebe a tempo nem sabe a quem chamar primeiro.

## O que faz
- **Clientes e compras** com importação CSV por assistente (mapeamento de colunas, dinheiro em R$, datas BR, validação sem gravar, deduplicação).
- **RFM determinístico** (recência, frequência, valor; notas 1–5) em SQL e TypeScript, com janela configurável, percentis ou limites fixos, histórico imutável e 7 segmentos: Campeões, Fiéis, Novos, Promissores, Precisam de atenção, Em risco e Inativos.
- **Risco com explicação**: inatividade, ciclo de recompra vencido, queda de frequência e mudança de segmento.
- **Oportunidades de reativação** com prioridade transparente (valor, frequência, atraso) e valor estimado como referência.
- **Segmentos dinâmicos sem SQL livre** e **campanhas de contato manual**: permissão por canal, lista de supressão, mensagens com variáveis, resultado observado.
- **Tarefas, notificações internas, painel** (10 indicadores, 9 gráficos, filtros), **12 relatórios com CSV** e LGPD (anonimização, auditoria de exportações).

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Pós-Venda e Reativação de Clientes: https://github.com/pack-25-sistemas-ia/pos-venda
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começar
```bash
pnpm install
supabase start && supabase db reset     # banco local + dados de demonstração fictícios
cp .env.example .env.local              # preencha com as chaves do supabase status
pnpm dev
```
Entre com `gerente@demo.exemplo` / `DemoLocal#2026`. Detalhes em `docs/DEPLOYMENT.md`.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (unitários) · `pnpm test:db` (Postgres descartável) · `pnpm test:mutation` (quebra regras críticas de propósito) · `pnpm test:e2e` (Supabase local + app). Estado e evidências: `docs/FEATURES.md`.

## Documentação
`docs/PLANO_IMPLEMENTACAO.md` · `DECISIONS.md` · `RFM_MODEL.md` · `CAMPAIGN_RULES.md` · `METRICS.md` · `DATABASE.md` · `ARCHITECTURE.md` · `DEPLOYMENT.md` · `OPEN_SOURCE_AUDIT.md`. Memória para agentes: `MEMORY.md`, `AGENTS.md`, `CLAUDE.md`.

## Linguagem honesta dos números
Reativação e recompra de campanha são **observadas**: a compra aconteceu depois da identificação ou do contato. O sistema **não** afirma que a ação causou a compra e não calcula receita incremental.

## Fora do escopo
ERP, disparo em massa ou automação de WhatsApp, previsão de churn por modelo, prova de incrementalidade, RAG, entrevista de onboarding.

## Privacidade (LGPD)
Dados pessoais tratados: nome, e-mail, telefone, documento, empresa e histórico de compras. Quem implanta o sistema é o controlador dos dados; este software não substitui assessoria jurídica. **Cliente sem permissão registrada nunca entra em campanha** (ausência de registro não é consentimento). Segmentos e prioridade apoiam a abordagem comercial e **não são decisão automatizada sobre pessoas**.

## Licença
MIT.
