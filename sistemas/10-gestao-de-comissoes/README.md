# Gestão de Comissões

> Cálculo de comissões comerciais **auditável**: planos versionados, faixas, rateio entre vendedores, estornos, aprovação, fechamento mensal e registro de pagamentos — sem planilha e sem folha de pagamento.

**Público:** empresas com vendedores comissionados · **Problema:** cálculo manual gera erro e disputa · **Proposta:** cada centavo tem memória de cálculo, histórico imutável e fechamento rastreável.

## O que faz
- **Planos de comissão versionados** (percentual, valor fixo, faixas marginal/atingida, margem, valor recebido), regras por produto, categoria, canal, equipe ou vendedor, com precedência explícita e detecção de conflito.
- **Vendas, itens, recebimentos, devoluções e cancelamentos.** O plano de cada venda é **fixado na confirmação**: mudar a taxa depois não reescreve o passado.
- **Motor decimal** (centavos inteiros, arredondamento meio-para-cima, rateio por maior resto) com **memória de cálculo** de cada lançamento.
- **Livro imutável**: lançamentos nunca são editados; correções são estornos/ajustes que referenciam o original. Reprocessar é **idempotente**.
- **Calculado ≠ aprovado ≠ pago**: aprovação (com justificativa e segregação de funções opcional), contestação do vendedor, ajustes manuais aprovados.
- **Fechamento mensal** por vendedor, saldo devedor transportado, reabertura controlada, **pagamentos apenas registrados** (o sistema não movimenta dinheiro).
- **Demonstrativos em PDF** versionados, **metas e bônus**, **simulador**, painel, relatórios CSV/PDF, **importação CSV** com prévia e erros por linha, notificações internas.
- **Multiempresa com RLS** e cinco perfis: administrador, gestor (só a equipe que gere), financeiro, vendedor (só o próprio) e consulta (só agregados).

## Fora do escopo
Folha de pagamento, encargos trabalhistas, pagamento bancário/PIX/remessa, emissão fiscal, integração contábil automática, XLSX.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Gestão de Comissões: https://github.com/pack-25-sistemas-ia/gestao-de-comissoes
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começando (local)
```bash
pnpm install --frozen-lockfile
supabase start && supabase db reset     # migrações + dados fictícios (NovaSales)
cp .env.example .env.local              # preencha com `supabase status`
pnpm dev                                # http://localhost:3000
```
Usuários de demonstração (senha `DemoLocal#2026`): `admin@`, `gestor@`, `gestor2@`, `financeiro@`, `vend1@`…`vend4@`, `consulta@` — todos `@demo.exemplo`. O administrador cadastra o 2º fator no primeiro acesso.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (motor) · `pnpm test:db` (SQL: RLS, domínio, segurança) · `pnpm test:concurrency` (sessões simultâneas reais) · `pnpm test:mutation` (quebra regras de propósito e exige que algum teste falhe) · `pnpm test:e2e` (Playwright). Detalhes e resultados em `MEMORY.md`.

## Documentação
`docs/ARCHITECTURE.md` · `COMMISSION_ENGINE.md` · `CALCULATION_RULES.md` · `TIER_RULES.md` · `ELIGIBILITY_RULES.md` · `SPLIT_RULES.md` · `REVERSALS.md` · `CLOSING_RULES.md` · `METRICS.md` · `PERMISSIONS.md` · `DATABASE.md` · `DATA_MODEL.md` · `DECISIONS.md` · `DEPLOYMENT.md` · `OPEN_SOURCE_AUDIT.md` · `FEATURES.md`.

## Privacidade (LGPD)
Dados pessoais tratados: **nome do vendedor e remuneração variável** (risco médio). Sem CPF, dados bancários ou endereço. Arquivos importados não são guardados. Acesso, exportação e download de demonstrativo ficam na auditoria. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
