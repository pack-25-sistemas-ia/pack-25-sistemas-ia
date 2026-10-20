# AGENTS — Gestão de Contratos e Vencimentos

Sistema 15 do Pack 25 Sistemas IA (gestao-de-contratos). O status real vive em MEMORY.md.

## Regras perenes
- Esta pasta é autossuficiente: nada importa de fora dela, sem workspace:*, sem citar outros sistemas.
- Ler MEMORY.md antes de trabalhar; atualizar ao concluir marcos, só com fatos comprovados.
- Toda tabela de negócio tem organization_id + RLS (nunca desabilitar); RLS é só SELECT (via `private.ct_can_see_contract`); toda escrita passa por RPC `ct_*` (SECURITY DEFINER, search_path vazio) que valida sessão, MFA, perfil, papel NO CONTRATO e que os ids são da MESMA empresa/contrato (FKs compostas). Só `ct_run_reminders(token)` é chamável por `anon` (marcada `PUBLIC_ENDPOINT:`).
- **O banco decide estado, permissões e datas** (`ct_contract_guard`, `ct_contract_role_of`, `ct_sync_deadlines`, `ct_process_reminders`). O espelho TS (`lib/ct/status.ts`, `dates.ts`, `money.ts`, `reminders.ts`) só projeta e explica: mudou uma regra, mude os dois e os testes com os mesmos valores.
- Visibilidade é por CONTRATO: gestão (proprietário/gestor) vê todos; colaborador só os vinculados (editor/leitor); «Leitor» da empresa nunca passa de leitor. Quem não tem acesso não vê contrato, documento, valor, obrigação, prazo, notificação nem evento (nem por contagem). Todo DTO/consulta nova precisa de teste A/B (com acesso × sem acesso).
- CPF/CNPJ só em `counterparty_documents` (gestão); no contrato vai o instantâneo MASCARADO. Nunca em CSV, auditoria, notificações, logs ou eventos.
- Ciclo de vida: rascunho → ativo → rescindido|encerrado → (reabrir, com motivo) ativo. Arquivar é separado e só para rescindido/encerrado. Passar do fim da vigência NÃO muda o estado (a situação é derivada). Renovação é sempre manual e auditada.
- Dinheiro em CENTAVOS (inteiro) e percentual em `numeric`/BigInt: nunca ponto flutuante. Reajuste: simular (grava proposta) → aplicar (trava o contrato primeiro, data ≤ hoje, ordem cronológica, base inalterada, senão 40001). Histórico de valores é append-only.
- Concorrência: `version` otimista (40001, «Outra pessoa alterou … antes de você»), idempotência por chave (`mutation_requests`), contadores sem MAX+1, ordem fixa de travas (contrato antes da proposta). O GUC `ct.bypass` só pode ser ligado dentro de funções internas.
- Lembretes: chave de deduplicação `tipo|origem|revisão|antecedência|destinatário`; consolidação das antecedências atrasadas; ignora revisão superada, concluído, rescindido/encerrado, arquivado e quem perdeu o acesso. O agendador usa token Bearer de 64 hex (só o sha256 fica no banco). Não afirmar que há e-mail/WhatsApp.
- Storage: as políticas rodam COMO o usuário, que não lê `storage_path` (grant por coluna): use as funções `private.ct_file_readable/ct_file_registered` (SECURITY DEFINER). Envio sem `upsert`. Tipo pelos bytes, bucket privado, URL assinada de 60 s, sem antivírus (não afirmar o contrário).
- Histórico (eventos, versões de documento e de valor, notificações) é append-only: corrija com novo registro. CSP estrita: sem `style=""`. CSV neutraliza fórmulas.
- Nunca commitar segredos; o sistema não usa service_role. Dados pessoais mínimos; sem PII em logs; seed só com nomes fictícios (`@demo.exemplo`) e senha aleatória.
- Não declarar pronto sem evidência (comando + resultado). Se algo não foi executado, escrever NÃO EXECUTADO.

## Comandos
pnpm install --frozen-lockfile · pnpm lint · pnpm typecheck · pnpm test · pnpm build · pnpm test:db · pnpm test:concurrency · pnpm test:mutation · pnpm test:e2e
(E2E: app compilado na porta 3129, `supabase db reset` + `node scripts/seed-demo.mjs` antes de cada arquivo e reinício do app — ver docs/DEPLOYMENT.md.)

## Mapa
`lib/ct` (domínio, ações, dados) · `components/ct` · `app/(app)/*` (rotas em português: dashboard, contratos, partes, prazos, obrigacoes, reajustes, notificacoes, relatorios, configuracoes, arquivados) · `app/api/{arquivos,exportar,jobs}` · `supabase/migrations/20271501*` · `supabase/tests` · `scripts` · `.agents/skills/*`.

## Definição de pronto (resumo)
Migrações em banco limpo, seed reproduzível, teste RLS A/B negando acesso cruzado, fluxos críticos em Playwright,
mobile e desktop revisados, licenças e segredos verificados, instalação isolada validada, docs e MEMORY.md atualizados.
