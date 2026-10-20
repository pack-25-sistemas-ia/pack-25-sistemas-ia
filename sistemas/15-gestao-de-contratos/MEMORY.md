# MEMORY — GESTÃO DE CONTRATOS E VENCIMENTOS
Atualizado em: 2026-10-20 | Versão: 1.0.0 | Estado: VALIDADO

## Missão do sistema
Renovações, avisos prévios e reajustes esquecidos. Público: empresas com contratos de clientes e fornecedores. Valor: cadastro de contratos com partes, arquivos privados, vigência, aviso, aditivos, renovação manual, reajuste por percentual e lembretes reais.

## Stack e caminhos-chave
Next.js (App Router) + TypeScript strict + Tailwind + Supabase (Auth, Storage, RLS). `lib/ct` (domínio, ações, dados) · `components/ct` · `app/(app)/*` (rotas em português) · `app/api/{arquivos,exportar,jobs}` · `supabase/migrations/20271501*` · `supabase/tests` · `scripts` · `.agents/skills`.
Comandos: pnpm install --frozen-lockfile · lint · typecheck · test · build · test:db · test:concurrency · test:mutation · test:e2e (porta 3129; Supabase local 592xx).

## Implementado e verificado (2026-10-20, comando → resultado)
- `pnpm lint` e `pnpm typecheck`: sem erros. `pnpm test`: 76 testes unitários passam (4 arquivos). `pnpm build`: compila.
- `node scripts/test-db.mjs`: TODOS OS TESTES PASSARAM (Core + 50 domínio, 55/56 lembretes, 57 painel nas fronteiras, 70 segurança, 80 integridade, 85 papéis, 86 auxiliares, 87 visibilidade, 88 prazos, 89 valores/reajuste).
- `node scripts/test-concurrency.mjs`: 25 verificações passam (numeração, duplo clique, reajuste em paralelo — só um vence, versões de documento, edição × encerramento, concluir × cancelar obrigação, remover acesso × criar obrigação, job de lembretes simultâneo sem duplicar).
- `node scripts/mutation-check.mjs`: 254 mutantes (TS, SQL e concorrência). 1ª rodada 149 reprovados e 124 sobreviventes; testes novos escritos para cada um; 2ª rodada só nos sobreviventes: 105/105 reprovados. 20 mutantes equivalentes documentados no cabeçalho de `scripts/mutation-list.mjs` e retirados da lista.
- E2E Playwright (um arquivo por vez, banco recriado e app reiniciado): core-flow 5, email-flows 3, security 5, ct-demo 5, ct-flow 10, ct-security 6 (inclui Storage REAL), ct-responsive 3 (celular 375 px e teclado) — todos passam.
- Dependências de produção (`pnpm licenses list --prod`): 29 pacotes, todos permissivos (MIT 23, Apache-2.0 2, ISC 1, BSD-3-Clause 1, 0BSD 1, CC-BY-4.0 1 = `caniuse-lite`).

## Pendências e riscos
- Risco LGPD: alto (nome, e-mail, CPF/CNPJ, endereço, documentos). Mitigações em `docs/SECURITY.md`.
- Sem antivírus nos arquivos; DOCX só é baixado; lembretes só internos e dependem de agendador externo (`docs/REMINDERS.md`); valores informativos, sem cobrança.
- Pasta/slug seguem o catálogo; assinatura, parecer e interpretação de cláusulas estão fora do escopo.

## Decisões relevantes
Ver `docs/DECISIONS.md` (D-01…D-18): acesso por contrato, CPF/CNPJ à parte, situação derivada, datas inclusivas, reajuste em duas etapas, lembretes idempotentes, funções de política do Storage (SECURITY DEFINER) e envio sem `upsert`.

## Armadilhas (para quem continuar)
- Políticas do Storage rodam como o usuário e ele não lê `storage_path`: use `ct_file_readable/ct_file_registered`; o DELETE do Storage precisa também ENXERGAR a linha (select do próprio órfão).
- Título da página inicial deve conter «Painel» (os testes do Core procuram esse cabeçalho).
- Mutante `if A or B` → `if A or B and false` é equivalente quando A já cobre o caso: troque a condição inteira.
- Windows: Docker lento sob carga trava `docker exec`; os scripts têm vigia de tempo. E2E: reiniciar o app a cada arquivo (limitador de login em memória).

## Próxima tarefa recomendada
Manter o Core sincronizado (`node scripts/sync-core.mjs gestao-de-contratos --check`) e, se o cliente quiser e-mail/WhatsApp, tratar como evolução com decisão registrada.

## Referências
docs/FEATURES.md · DATA_MODEL.md · DEPLOYMENT.md · REMINDERS.md · ADJUSTMENTS.md · PERMISSIONS.md · REFERENCES.md
