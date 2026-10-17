# Qualificador de Leads Inteligente

Capte leads com formulários públicos, **qualifique por score transparente (0–100)**, distribua ao vendedor certo e acompanhe a qualidade por campanha. Next.js + Supabase, com RLS em tudo.

**Público:** agências, consultorias, imobiliárias, escolas, empresas B2B e de serviços com equipe de vendas.
**Problema:** leads sem priorização chegam ao vendedor errado e esfriam; ninguém sabe quais campanhas trazem leads bons.

## O que faz
- **Construtor de formulários** (tipos de pergunta, lógica condicional, etapas, prévia, versões, 5 modelos prontos) e **página pública** `/f/[slug]` com UTM, consentimento LGPD, honeypot e limite de taxa.
- **Score explicável**: regras (operadores fechados, sem IA e sem código do usuário), faixas frio/morno/quente (0–39/40–69/70–100), simulador, modelos versionados e justificativa por lead.
- **Distribuição**: manual, rodízio ou por critérios, idempotente e sem corrida.
- **Pipeline Kanban** com transições válidas, atividades e follow-ups.
- **Painel** (10 indicadores, 9 gráficos, filtros, fuso por organização), **campanhas**, **relatórios** e CSV; importação CSV.
- **IA opcional** (análise textual separada do score, dados minimizados, limite diário).
- **LGPD**: consentimento, anonimização, retenção, sem PII em logs.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Qualificador de Leads Inteligente: https://github.com/pack-25-sistemas-ia/qualificador-leads
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
Entre com `gerente@demo.exemplo` / `DemoLocal#2026`. Formulário público de exemplo: `/f/qualificacao-b2b`. Detalhes em `docs/DEPLOYMENT.md`.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (unitários) · `pnpm test:db` (Postgres descartável) · `pnpm test:mutation` (quebra regras críticas de propósito) · `pnpm test:e2e` (Supabase local + app). Estado e evidências: `docs/FEATURES.md`.

## Documentação
`docs/PLANO_IMPLEMENTACAO.md` · `DECISIONS.md` · `SCORING.md` · `DATABASE.md` · `ARCHITECTURE.md` · `METRICS.md` · `DEPLOYMENT.md` · `OPEN_SOURCE_AUDIT.md`. Memória para agentes: `MEMORY.md`, `AGENTS.md`, `CLAUDE.md`.

## Fora do escopo
CRM completo, disparo em massa, enriquecimento por terceiros, pagamentos, RAG, webhooks de saída, custo/ROAS/CAC.

## Privacidade (LGPD)
Dados pessoais tratados: nome, e-mail, telefone, empresa e respostas do formulário. Quem implanta o sistema é o controlador dos dados; este software não substitui assessoria jurídica. O score apoia a priorização comercial e **não é decisão automatizada sobre pessoas**; não crie regras com características protegidas.

## Licença
MIT.
