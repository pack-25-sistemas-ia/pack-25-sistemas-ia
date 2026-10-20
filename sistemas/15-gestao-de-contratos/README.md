# Gestão de Contratos e Vencimentos

> Cadastro de contratos com **partes, documentos versionados, vigência, prazo de aviso, aditivos, renovações manuais, obrigações, reajuste por percentual e lembretes internos** — para a empresa nunca mais perder uma renovação, um aviso ou um reajuste.

**Público:** empresas com contratos de clientes e fornecedores · **Problema:** renovações, avisos prévios e reajustes esquecidos · **Proposta:** cada contrato tem partes, arquivos privados, datas que importam, uma pessoa responsável e **lembretes que de fato saem** (agendador real, idempotente).

## O que faz
- **Contratos** com número por empresa (`CTR-0001`), categoria, partes (clientes/fornecedores), responsável, vigência **determinada** (início e fim) ou **indeterminada** e ciclo *rascunho → ativo → rescindido | encerrado* (reabrir exige motivo; arquivar é à parte). Passar da data final **não** rescinde nem renova sozinho: só sinaliza («Fim de vigência atingido»).
- **Prazo de aviso**: data de referência − N dias corridos, calculada pelo banco; ajuste manual exige justificativa e fica registrado. O sistema **não interpreta cláusulas** nem calcula feriados.
- **Documentos privados** (PDF, DOCX, PNG, JPEG, WebP; tipo conferido pelos bytes) com **versões** (a anterior nunca é apagada; qualquer versão pode voltar a ser a atual) e download por link assinado de 60 s.
- **Aditivos e correções** (com ou sem novo valor), **renovação manual** auditada (nova data final ou prazo indeterminado) e **histórico de valores** que nunca é editado: cada mudança cria uma nova versão.
- **Reajuste por percentual** em duas etapas: **simular** (prévia que não altera nada) e **aplicar** (explícito, transacional, uma única vez, conferindo que a base não mudou). Arredondamento exato ao centavo, meio para cima. Ver `docs/ADJUSTMENTS.md`.
- **Obrigações simples** (título, responsável, data) com concluir/cancelar.
- **Prazos**: lista e **calendário** mensal com fim de vigência, aviso, reajuste previsto e obrigações; filtros por faixa (vencidos, hoje, 7/30/90 dias).
- **Lembretes internos** (sino no sistema) por um **agendador real**: `POST /api/jobs/lembretes`, idempotente, com consolidação de atrasos e registro de cada execução. Ver `docs/REMINDERS.md`.
- **Painel** com dados reais (vigentes, vencendo em 30/60/90 dias, avisos, obrigações, reajustes previstos, valor **por periodicidade** — nunca somado entre periodicidades) e **CSV** seguro.
- **Acesso por contrato**: proprietário e gestor veem tudo; o colaborador só vê os contratos a que foi vinculado (editor ou leitor); o «Leitor» da empresa só consulta. CPF/CNPJ só para a gestão. Ver `docs/PERMISSIONS.md`.
- **Marca** (nome, cor, logotipo), **auditoria** sem dados pessoais e histórico imutável por contrato.

## Fora do escopo do MVP
Assinatura eletrônica ou certificada, parecer jurídico, interpretação de cláusulas, geração de contratos, cobrança/boleto/nota fiscal (o valor é **informativo**, não gera lançamento financeiro), renovação automática, e-mail/WhatsApp (as notificações são internas), aplicativo nativo, IA. **Nenhum botão de integração inexistente é exibido.** Sem IA o sistema funciona integralmente.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Gestão de Contratos: https://github.com/pack-25-sistemas-ia/gestao-de-contratos
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local, carrega os dados de demonstração e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.

## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), Supabase CLI; para produção, conta Supabase **na região de São Paulo**, hospedagem Node (ex.: Vercel) e um **agendador** para os lembretes (GitHub Actions, Vercel Cron ou cron do servidor).

## Instalação isolada
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # preencha com `supabase status` (URL da API e chave publishable/anon)
supabase start && supabase db reset
node scripts/seed-demo.mjs        # opcional: empresa fictícia «Consultoria Meridiano (demonstração)»
pnpm dev                          # http://localhost:3000
```
`supabase db reset` aplica só as **migrações** (inclui os buckets do Storage). O seed cria usuários `@demo.exemplo` (dono, gestor, colaboradores, leitor) com **senha aleatória**, mostrada uma vez e guardada em `node_modules/.cache/ct-demo-credentials.json` (não há senha fixa no código), com contratos em todos os estados, documentos PDF fictícios, obrigações, reajustes e notificações.

## Primeiro administrador e equipe
1. Em `/signup` crie a conta e a empresa: o primeiro usuário vira **proprietário** e ativa o **2º fator (TOTP)**.
2. Pessoas: convide pelo Auth do Supabase e associe pela tela «Pessoas e acessos» do Core. **Gerente = gestor** (todos os contratos), **Membro = colaborador** (só os vinculados), **Leitor = só consulta**.
3. **Configurações** (proprietário): marca, fuso horário (define «hoje» e «vencido»), prefixo dos números, janela de «próximo do fim», regras de lembrete (antecedências) e o **token do agendador**.
4. A gestão cadastra as partes e cria o contrato; vincula quem precisa ver (editor ou leitor) e define a pessoa responsável, que passa a receber os lembretes.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (regras de papéis, ciclo de vida, datas, dinheiro e reajuste exatos, lembretes, CSV) · `pnpm test:db` (SQL: RLS, domínio, lembretes, segurança, integridade) · `pnpm test:concurrency` (sessões simultâneas reais) · `pnpm test:mutation` (quebra regras de propósito e exige que algum teste falhe) · `pnpm test:e2e` (Playwright, incluindo celular e teclado). Resultados reais em `MEMORY.md`.

## Deploy, custos, backup e limitações
`docs/DEPLOYMENT.md` (variáveis, migrações, Storage, backup/restauração e **custos externos**), `docs/REMINDERS.md` (agendador) e `docs/SECURITY.md` (retenção, exclusão e LGPD).
- Sem antivírus nos arquivos (só lista de tipos pelos bytes, limite de tamanho e URL assinada curta). Arquivos `.docx` são **baixados**: o sistema não os pré-visualiza.
- Sem e-mail/WhatsApp: os lembretes são internos (sino no sistema). **Sem o agendador configurado, nenhum lembrete é gerado automaticamente** (há o botão «Processar lembretes agora» para a gestão).
- Valores são informativos e **não** geram cobrança. Datas são calendário (sem hora); «hoje» usa o fuso da empresa.
- A interface não exclui contratos (histórico imutável; só rascunhos podem ser descartados): arquiva. A exclusão/anonimização é administrativa, no banco.

## Documentação
`docs/ARCHITECTURE.md` · `DATA_MODEL.md` · `PERMISSIONS.md` · `DECISIONS.md` · `REFERENCES.md` · `FEATURES.md` · `DEPLOYMENT.md` · `SECURITY.md` · `REMINDERS.md` · `ADJUSTMENTS.md` · `THIRD_PARTY_NOTICES.md`.

## Privacidade (LGPD)
Risco **alto**. Dados pessoais: nome, e-mail e **CPF/CNPJ** das partes, endereço e documentos contratuais. Medidas: CPF/CNPJ em tabela à parte, visível só à gestão, com cópia **mascarada** no contrato e **nunca** no CSV, na auditoria ou nos logs; notificações guardam só identificadores; arquivos em bucket privado com URL assinada de 60 s; coleta mínima. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica nem parecer sobre cláusulas.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
