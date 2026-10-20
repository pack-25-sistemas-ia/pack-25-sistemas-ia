# ARCHITECTURE — Gestão de Contratos e Vencimentos

## Camadas
- **Banco (fonte da verdade).** PostgreSQL/Supabase. RLS só de leitura; toda escrita por funções `ct_*` (`SECURITY DEFINER`, `search_path` vazio). Gatilhos de guarda (`ct_contract_guard` e afins) recusam estados inválidos mesmo para SQL direto. Migrações `20271501*` sobre o Core (`2026101*`).
- **Domínio TypeScript (`lib/ct`).** Espelho **puro** das regras para explicar e esconder ações (`status.ts`, `dates.ts`, `money.ts`, `reminders.ts`), testado com os mesmos valores do banco. Mudou uma regra? Mude as duas.
- **Servidor (Next.js App Router).** Páginas em `app/(app)/*` leem por RLS com a sessão da pessoa; ações (`lib/ct/actions/*`) validam com Zod e chamam a RPC; erros viram mensagens em português. Rotas de API: `arquivos/[id]` (URL assinada), `exportar/contratos` (CSV) e `jobs/lembretes` (agendador).
- **Interface.** Tailwind puro, formulários nativos e `<details>`; CSP estrita (sem `style=""`, sem `unsafe-inline`).

## Fluxos
```
Navegador ──(sessão)──▶ Next.js ──(JWT da pessoa)──▶ Supabase (RLS leitura / RPC ct_* escrita)
Agendador ──(Bearer 64 hex)──▶ /api/jobs/lembretes ──(anon)──▶ ct_run_reminders(token) ──▶ ct_process_reminders
Arquivo: navegador/servidor ──▶ Storage (ct-files, privado) ──▶ ct_add_document (valida caminho, tipo, tamanho)
```
- **Prazos**: `ct_sync_deadlines` mantém `contract_deadlines` (fim, aviso, reajuste) com **revisões**: mudar uma data cria nova revisão e supera a anterior, o que invalida lembretes antigos.
- **Concorrência**: `contracts.version` (otimista), `mutation_requests` (idempotência), `contract_number_counters` (numeração), limite de abuso por usuário (`ct_rate_hit`). Ordem fixa de travas: contrato → proposta/documento.
- **Auditoria**: `contract_events` (por contrato, imutável) e auditoria do Core (sem dados pessoais).

## Testes
Unitários (`tests/unit`), banco (`supabase/tests`, pgTAP-like em SQL puro), concorrência (`scripts/test-concurrency.mjs`), mutação (`scripts/mutation-check.mjs`), E2E Playwright (`tests/e2e`, incluindo celular e teclado).
