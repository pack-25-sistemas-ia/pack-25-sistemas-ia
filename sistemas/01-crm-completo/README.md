# CRM Completo

CRM comercial para equipes B2B pequenas e médias: do lead ao negócio fechado, com funil Kanban, metas, ranking e indicadores calculados do banco. Next.js + Supabase, com RLS em todas as tabelas.

**Público:** equipes comerciais de pequenas e médias empresas B2B.
**Problema:** leads em planilhas e WhatsApp, sem funil nem histórico.

## O que tem
- **Leads:** criar, editar, arquivar, classificar (frio/morno/quente), origem, responsável, bloqueio de duplicados, conversão em oportunidade e **importação CSV** (modo «apenas validar»).
- **Empresas e contatos** com campos extensíveis (`custom`).
- **Pipeline Kanban** (arrastar, teclado ou seletor «Mover para…») com etapas configuráveis e histórico; ganho e perdido (motivo obrigatório).
- **Atividades:** tarefas, ligações, reuniões e follow-ups com prazo, prioridade e destaque de atraso.
- **Metas e ranking** por vendedor e por equipe.
- **Painel:** 6 indicadores, 6 gráficos, filtros (período, vendedor, equipe, origem) e alertas (follow-up atrasado, oportunidade parada, fechamento próximo, meta abaixo do ritmo). Fórmulas em [docs/METRICS.md](docs/METRICS.md).
- **Relatórios** com exportação CSV (neutraliza injeção de fórmula).
- **Configurações:** etapas, origens, motivos de perda, equipes e identidade visual (nome, logo, cores).
- Do Core: login, organização, papéis (proprietário, administrador, gerente, vendedor, leitor), verificação em duas etapas, auditoria, privacidade (LGPD) e equipe.

## Fora do escopo
WhatsApp e e-mail automatizados · disparo em massa · integração fiscal/contábil · assinatura de proposta · PDF · SSO · app nativo.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o CRM Completo: https://github.com/pack-25-sistemas-ia/crm-completo
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começar
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local      # preencha com o SEU projeto Supabase
supabase start && supabase db reset   # banco local com dados fictícios
pnpm dev
```
Passo a passo de produção, backup e rollback: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Modelo de dados e permissões: [docs/DATA_MODEL.md](docs/DATA_MODEL.md). Evidência dos testes: [docs/FEATURES.md](docs/FEATURES.md). Para adaptar a um cliente, abra a pasta no Claude Code ou Codex e peça: «leia o AGENTS.md e o MEMORY.md».

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm test:db` (RLS e indicadores no banco) · `pnpm test:e2e` (navegador, com Supabase real).

## Privacidade (LGPD)
Risco: **médio**. Dados pessoais: nome, e-mail, telefone, cargo e histórico de contato. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica. Os dados de demonstração são fictícios.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
