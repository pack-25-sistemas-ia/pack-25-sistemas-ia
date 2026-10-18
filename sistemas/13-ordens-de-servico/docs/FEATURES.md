# FEATURES — Ordens de Serviço
Status permitido: VERIFIED (com evidência: arquivo/teste) ou FORA_DO_MVP (decisão registrada).

| Fluxo | Status | Evidência |
|---|---|---|
| Clientes, contatos, endereços, CPF/CNPJ validado e separado | VERIFIED | `supabase/tests/50_os_domain.sql`; E2E `os-flow` |
| Equipamentos (opcional), serviços e peças em catálogo | VERIFIED | `50_os_domain.sql`; E2E `os-demo` |
| Abertura da OS (numeração por empresa, idempotente, snapshots, rascunho) | VERIFIED | `50_os_domain.sql`; `scripts/test-concurrency.mjs` |
| Orçamento versionado (cálculo exato, publicado = congelado) | VERIFIED | `50_os_domain.sql`; `tests/unit/money-quote.test.ts`; mutação |
| Aprovação do cliente por link e registro manual pela equipe | VERIFIED | `60_os_public.sql`; E2E `os-flow` |
| Estados (rascunho → aberta → agendada → em execução ⇄ pausada → concluída → encerrada / cancelada) | VERIFIED | `50_os_domain.sql`, `80_os_integrity.sql`; `tests/unit/status-checklist.test.ts` |
| Agenda e atribuição (alerta de sobreposição, fuso da empresa) | VERIFIED | `50_os_domain.sql`; E2E `os-demo` |
| Checklist por modelo (snapshot, obrigatórios, foto obrigatória, N/A) | VERIFIED | `51_os_execution.sql`; unit `status-checklist` |
| Peças utilizadas sem estoque (estorno/ajuste, divergência com o orçamento) | VERIFIED | `51_os_execution.sql`; concorrência |
| Fotos e documentos privados (tipo pelos bytes, sem EXIF) | VERIFIED | `tests/unit/attachments-token-csv.test.ts`; E2E `os-flow` |
| Notas internas e compartilhadas | VERIFIED | `51_os_execution.sql`; `60_os_public.sql` |
| Conclusão versionada e aceite simples (aceitar/contestar; reabertura) | VERIFIED | `51_os_execution.sql`, `60_os_public.sql`; E2E `os-flow` |
| PDF (orçamento, ordem, conclusão) com dados da época | VERIFIED | `55_os_dashboard_docs.sql`; E2E `os-flow` |
| Painel e relatórios com «Sem dados» honesto; CSV seguro | VERIFIED | `55_os_dashboard_docs.sql`; `os-security`; unit `csv` |
| Marca (nome, cor, logotipo) | VERIFIED | E2E `os-flow` |
| Histórico auditável (eventos, auditoria sem PII) | VERIFIED | `70_os_security.sql` |
| Perfis: proprietário, gestor, técnico, cliente por link | VERIFIED | `70_os_security.sql`; E2E `os-security` |
| Celular (375 px) para o técnico e para o cliente | VERIFIED | E2E `os-responsive` |
| Estoque, faturamento/fiscal, assinatura certificada, WhatsApp/e-mail, app nativo, GPS, SLA contratual, IA | FORA_DO_MVP | `docs/DECISIONS.md` |
