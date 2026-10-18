# Ordens de Serviço

> Gestão de ordens de serviço para assistências técnicas e empresas de manutenção: do pedido à **conclusão aceita pelo cliente**, com orçamento versionado, checklist, peças, fotos privadas, PDF e histórico que nunca se apaga.

**Público:** assistências técnicas, manutenção predial e de equipamentos, instaladores · **Problema:** serviço sem registro, sem foto e sem aceite do cliente · **Proposta:** ciclo completo da OS, com o **técnico no celular**, o **cliente por link** (sem criar conta) e a gestão com painel de dados reais.

## O que faz
- **Clientes, contatos, endereços e equipamentos** (opcional); CPF/CNPJ **validado e guardado à parte**, visível só à gestão. Catálogos de serviços e peças.
- **Abertura da OS** com número por empresa, idempotente (duplo clique não duplica), cópia (snapshot) do cliente/endereço/equipamento; rascunho opcional.
- **Orçamento versionado**: contas exatas (centavos e quantidades de 3 casas, arredondamento documentado), **publicado = congelado**; nova versão substitui a pendente. O cliente aprova ou recusa **pelo link**, ou a gestão registra a decisão **manualmente** (aparece como tal, com justificativa).
- **Estados**: rascunho · aberta · agendada · em execução · pausada · concluída · encerrada · cancelada. Agenda com alerta de sobreposição, no fuso da empresa.
- **Técnico**: vê **só as ordens dele**; inicia, pausa (com motivo), registra **peças** (sem estoque; correção por estorno), responde o **checklist** (obrigatórios, foto obrigatória, «não se aplica»), anexa fotos e conclui. Nunca vê custos internos, margens nem CPF/CNPJ.
- **Conclusão versionada e aceite simples**: o cliente aceita ou contesta pelo link; contestação reabre; o aceite da versão 1 não encerra a versão 2.
- **Fotos e documentos privados** (tipo conferido pelos bytes; metadados/GPS removidos das fotos); você escolhe o que **compartilhar** com o cliente.
- **PDF** de orçamento, ordem e conclusão com os dados **da época** (sem notas internas, custos ou CPF/CNPJ). **CSV** seguro. **Painel** com backlog, atrasadas, aguardando aceite, retrabalho e tempos — «Sem dados» em vez de números inventados.
- **Multiempresa com RLS**; marca (nome, cor, logotipo) configurável; auditoria sem dados pessoais. Perfis em `docs/PERMISSIONS.md`.

## Fora do escopo do MVP
Controle de estoque, faturamento/nota fiscal, **assinatura eletrônica certificada** (o aceite é *simples* e a tela diz isso), WhatsApp/e-mail como requisito, aplicativo nativo, GPS/rota, contratos e SLA contratual, IA. **Nenhum botão de integração inexistente é exibido.** Sem IA o sistema funciona integralmente.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Ordens de Serviço: https://github.com/pack-25-sistemas-ia/ordens-de-servico
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local, carrega os dados de demonstração e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.

## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), Supabase CLI; para produção, conta Supabase **na região de São Paulo** e hospedagem Node (ex.: Vercel).

## Instalação isolada
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # preencha com `supabase status` e gere OS_LINK_SALT (veja o arquivo)
supabase start && supabase db reset
node scripts/seed-demo.mjs        # opcional: empresa fictícia «Assistência Horizonte (demonstração)»
pnpm dev                          # http://localhost:3000
```
`supabase db reset` aplica só as **migrações** (inclui os buckets do Storage). O seed cria usuários `@demo.exemplo` (dono, gestor, técnicos) com **senha aleatória**, mostrada uma vez e guardada em `node_modules/.cache/os-demo-credentials.json` (não há senha fixa no código), e confere a coerência do histórico (nada no futuro, todos os estados presentes).

## Primeiro administrador e equipe
1. Em `/signup` crie a conta e a empresa: o primeiro usuário vira **proprietário** e ativa o **2º fator (TOTP)**.
2. Pessoas: convide pelo Auth do Supabase e associe pela tela «Pessoas e acessos» do Core. **Gerente = gestor**, **Membro = técnico**, Leitor não tem perfil neste sistema.
3. **Configurações** (proprietário): marca, fuso, prefixo do número, validade do orçamento e do link, tamanho de anexo, retenção. **Modelos de checklist** e catálogos ficam com a gestão.
4. Para o cliente acompanhar: abra a ordem → **Gerar link de acompanhamento** → envie o link. Trate-o como senha (revogue quando acabar).

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (dinheiro, orçamento, estados, checklist, arquivos, token, CSV) · `pnpm test:db` (SQL: RLS, domínio, execução, painel/PDF, público, segurança, integridade) · `pnpm test:concurrency` (sessões simultâneas reais) · `pnpm test:mutation` (quebra regras de propósito e exige que algum teste falhe) · `pnpm test:e2e` (Playwright). Resultados reais em `MEMORY.md`.

## Deploy, custos, backup e limitações
`docs/DEPLOYMENT.md` (variáveis, migrações, Storage, backup/restauração e **custos externos**) e `docs/SECURITY.md` (retenção, exclusão e LGPD).
- Sem antivírus nos anexos (só allowlist pelos bytes, limite de tamanho e URL assinada curta).
- O aceite é **simples**, não uma assinatura certificada.
- Sem estoque, faturamento ou notificações por e-mail/WhatsApp: o link é enviado por você, pelo canal que preferir.
- A interface não exclui ordens (histórico imutável); a exclusão/anonimização é administrativa, no banco.

## Documentação
`docs/ARCHITECTURE.md` · `DATA_MODEL.md` · `PERMISSIONS.md` · `DECISIONS.md` · `REFERENCES.md` · `FEATURES.md` · `DEPLOYMENT.md` · `SECURITY.md` · `THIRD_PARTY_NOTICES.md`.

## Privacidade (LGPD)
Dados pessoais: **nome, telefone, e-mail e endereço do cliente, CPF/CNPJ (opcional) e fotos** (risco médio). Coleta mínima, CPF/CNPJ separado e só para a gestão, sem PII em logs, anexos em bucket privado, auditoria sem valores pessoais. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
