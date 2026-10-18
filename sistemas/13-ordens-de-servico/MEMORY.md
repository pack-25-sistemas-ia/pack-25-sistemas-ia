# MEMORY — ORDENS DE SERVIÇO
Atualizado em: 2026-10-18 | Versão: 1.0.0 | Estado: VALIDADO

## Missão do sistema
Gestão de ordens de serviço para assistências técnicas e empresas de manutenção: clientes, orçamento versionado, execução pelo técnico (checklist, peças, fotos), conclusão versionada com aceite simples do cliente por link, PDF, painel e CSV. Risco LGPD: médio (nome, telefone, e-mail, endereço, CPF/CNPJ opcional, fotos).

## Stack e caminhos-chave
Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind 4 + Supabase (Auth, PostgreSQL, Storage) + `@react-pdf/renderer` 4.9.0. Banco: `supabase/migrations/20271301*` (escrita só por RPCs `os_*` SECURITY DEFINER; RLS só SELECT; FKs compostas). Domínio TS (espelho): `lib/os/*`. Ações: `lib/os/actions/*`. UI: `app/(app)/*`, `app/acompanhar/[token]` (público), `components/os`. Testes: `tests/unit`, `tests/e2e`, `supabase/tests`, `scripts/test-*.mjs`, `scripts/mutation-check.mjs`. Skills: `.agents/skills/*`.
Comandos: `pnpm lint | typecheck | test | build | test:db | test:concurrency | test:mutation | test:e2e` (E2E na porta 3127, ver docs/DEPLOYMENT.md). Seed: `node scripts/seed-demo.mjs` («Assistência Horizonte (demonstração)», 14 ordens em todos os estados, datas relativas).

## Implementado e verificado (2026-10-18, com evidência)
- Clientes/contatos/endereços/equipamentos, catálogos, modelos de checklist, abertura idempotente com numeração por empresa e snapshots, agenda (alerta de sobreposição), orçamento versionado (publicado = congelado), aprovação por link e registro manual, execução (iniciar/pausar/retomar/concluir), checklist validado no servidor, peças sem estoque (estorno), fotos privadas sem EXIF, notas internas/compartilhadas, conclusão versionada e aceite/contestação, reabertura, encerramento, cancelamento, link do cliente (hash, revogação, validade, limite), PDF com dados da época, painel, CSV, marca, auditoria.
- `pnpm lint`, `pnpm typecheck`: sem erros. `pnpm test`: 96 testes em 6 arquivos. `pnpm build`: ok.
- `pnpm test:db` (Core + sistema): todos passam — 50 domínio, 51 execução, 55 painel/documentos, 60 público, 70 segurança, 80 integridade (SQL direto).
- `pnpm test:concurrency`: passa (numeração, duplo clique, início, aprovação × publicação, 8 decisões simultâneas, aceite × contestação, encerrar × reabrir, peças).
- E2E (Playwright, app compilado, banco recriado e app reiniciado antes de cada arquivo): os-demo 6, os-flow 11, os-security 5, os-responsive 4, core-flow 5, email-flows 3, security 5 — **39 passam**.
- `pnpm test:mutation`: **269/269 mutações reprovadas** (unit + banco + concorrência). Mutantes equivalentes retirados com justificativa no próprio script.
- Revisão visual desktop (1440) e celular (375) feita em capturas (painel, lista, quadro, agenda, clientes, relatórios, ordem).

## Em implementação
- Nada.

## Pendências e riscos
- Fora do MVP: estoque, faturamento/fiscal, assinatura certificada, WhatsApp/e-mail como requisito, app nativo, GPS, SLA contratual, IA (docs/DECISIONS.md).
- O aceite é SIMPLES (não é assinatura certificada). Sem antivírus nos anexos.
- Limitador de login do Core é em memória por instância; os limites do link público e de ações estão no banco.
- Retenção/exclusão é administrativa; a interface não exclui.
- Comprador precisa do próprio Supabase (região Brasil) e hospedagem (docs/DEPLOYMENT.md). `OS_LINK_SALT` é obrigatória (sem ela os links públicos falham fechados).

## Decisões relevantes
Ver docs/DECISIONS.md (D-O1…D-O17). Principais: banco como fonte de verdade com espelho TS; CPF/CNPJ em tabela separada; token de link só em hash e texto do aceite montado no banco; token inválido sem exceção; técnico vê preços mas não custos; sem TanStack/shadcn/RHF/gráficos; sem service_role.

## Testes executados
Ver «Implementado e verificado». Mutação: 50 sobreviventes da 1ª rodada viraram testes diretos (unit `os-boundaries`, SQL 50/51/55/60/80) ou foram classificados como equivalentes.

## Armadilhas (para não repetir)
- RAISE desfaz o contador de tentativas na mesma transação: token inválido devolve `invalid_link` e só o estouro levanta 54000.
- `jsonb_typeof(x) <> 'number'` é NULL com chave ausente: usar `is distinct from`.
- Exceção genérica `when check_violation` engole mensagens próprias; ASSERT com função volátil + subselect na mesma expressão vê snapshot antigo.
- E2E: seed com CPF fixo colide com o do teste (gerar CPF aleatório válido); React reinicia formulários após a ação (recarregar antes de preencher); app precisa reiniciar entre specs (limitador de login).
- `check_function_bodies`/funções do harness: `test.count` já existe no harness do Core.
- `os_start` só aceita ordem aberta/agendada; mutantes de camada redundante são equivalentes (documentar, não forçar).
- Não editar migrações/testes enquanto a mutação roda; rodar a de concorrência sem outra carga.

## Próxima tarefa recomendada
1. Se o comprador quiser: notificações por e-mail/WhatsApp com consentimento, estoque de peças, assinatura certificada (docs/DECISIONS.md).

## Referências
docs/FEATURES.md · docs/DATA_MODEL.md · docs/ARCHITECTURE.md · docs/DECISIONS.md · docs/REFERENCES.md · docs/SECURITY.md · docs/PERMISSIONS.md · docs/DEPLOYMENT.md · THIRD_PARTY_NOTICES.md
