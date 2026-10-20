# REMINDERS — lembretes e agendador

Lembretes são **notificações internas** (sino no sistema). Não há e-mail nem WhatsApp. Para sair sem ninguém abrir o sistema, é preciso um **agendador** chamando o endpoint abaixo **pelo menos uma vez por dia**. Sem agendador, nada é gerado sozinho — a gestão pode usar «Processar lembretes agora» em Configurações.

## Regras (antecedências padrão, editáveis em Configurações)
| Evento | Antecedências (dias antes) |
|---|---|
| Fim de vigência | 60, 30, 15, 7 |
| Prazo de aviso | 30, 15, 7, 1 |
| Reajuste previsto | 30, 15, 7 |
| Obrigação | 7, 3, 1, 0 |

Valores: de 0 a 365 dias, de 1 a 8 antecedências.

## Como o processamento decide (`private.ct_process_reminders`)
1. **Quem recebe**: a pessoa responsável pela obrigação; senão o responsável do contrato; senão proprietário/gestores. Só quem **ainda tem acesso** ao contrato.
2. **O que entra**: prazos vigentes (não superados) de contratos **ativos e não arquivados**, com data ≥ hoje; obrigações **pendentes** nas mesmas condições. Concluídas, canceladas, rescindidas/encerradas e arquivadas **não** geram aviso.
3. **Chave de deduplicação**: `tipo|origem|revisão|antecedência|destinatário`. Repetir a execução (ou executar em paralelo) **não duplica** nada. Mudou a data do prazo? A **revisão** muda e os avisos recomeçam para a nova data; a revisão antiga é ignorada.
4. **Consolidação**: se várias antecedências já foram alcançadas e nenhuma entregue (ex.: o agendador ficou parado), envia **uma** só — a mais próxima do vencimento — e marca as demais como `consolidated`. Nunca envia uma antecedência **maior** do que uma já enviada.
5. **Depois da data** não notifica (o painel e a lista de prazos mostram «Vencidos»).
6. Cada execução grava `ct_job_runs` (origem, contratos verificados, enviados, consolidados, erros). Erro em um item não interrompe os demais (execução «parcial»).

## Endpoint
```
POST /api/jobs/lembretes
Authorization: Bearer <token de 64 caracteres hexadecimais>
```
- Resposta: contagens (`checked`, `sent`, `consolidated`, `errors`, `today`) — nunca dados de contratos.
- `401` token ausente/errado · `429` limite de chamadas (120/hora por empresa) · `502` falha ao processar.
- O token é gerado/rotacionado pelo **proprietário** em Configurações e **mostrado uma única vez**; no banco fica só o hash (SHA-256). Rotacionar invalida o anterior na hora.
- O endpoint **não** usa sessão de usuário nem `service_role`: chama a função pública `ct_run_reminders(token)`, a única acessível sem login (comentário `PUBLIC_ENDPOINT:`), que valida o token e aplica limite de taxa.

## Exemplos de agendador
**GitHub Actions** (`.github/workflows/lembretes.yml` no repositório do cliente; guarde `CT_URL` e `CT_TOKEN` em *Secrets*):
```yaml
name: lembretes-contratos
on:
  schedule: [{ cron: '0 10 * * *' }]   # 07:00 em Brasília (UTC-3)
  workflow_dispatch: {}
jobs:
  chamar:
    runs-on: ubuntu-latest
    steps:
      - run: curl --fail-with-body -sS -X POST -H "Authorization: Bearer ${{ secrets.CT_TOKEN }}" "${{ secrets.CT_URL }}/api/jobs/lembretes"
```
**cron do servidor / Linux:** `0 7 * * * curl -fsS -X POST -H "Authorization: Bearer $CT_TOKEN" https://SEU-DOMINIO/api/jobs/lembretes`.
**Vercel Cron:** faz requisições **GET**, e este endpoint aceita apenas **POST** (evita disparo por link/prefetch). Use GitHub Actions ou um serviço de cron que permita POST com cabeçalho.
**Supabase `pg_cron`** (opção avançada, **não testada neste repositório**): agendar `select private.ct_process_reminders('<id da empresa>', now(), 'scheduler');` com o papel dono do banco, uma vez por empresa.

## Testes
`supabase/tests/55_ct_reminders.sql` (regras acima, incluindo consolidação, revisão superada, acesso perdido e idempotência), `tests/unit/ct-domain.test.ts` (espelho do plano) e `scripts/test-concurrency.mjs` (execução simultânea sem duplicar).
