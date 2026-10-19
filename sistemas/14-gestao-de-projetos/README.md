# Gestão de Projetos e Tarefas

> Quadro Kanban e lista por projeto, com **prazos, responsável único, checklist, comentários, anexos privados, impedimentos e histórico** — e a tela **«Minhas tarefas»**, para cada pessoa abrir o sistema e saber o que fazer hoje.

**Público:** agências e equipes de serviço que trabalham por projeto · **Problema:** tarefas e prazos sem dono nem visibilidade · **Proposta:** cada tarefa tem uma pessoa responsável, uma data e uma etapa; cada projeto tem sua equipe; e quem não participa **não vê**.

## O que faz
- **Projetos** com número por empresa, datas e estados *planejado · ativo · pausado · concluído · cancelado* (+ arquivar). Concluir exige **nenhuma tarefa aberta**; reabrir exige motivo e fica no histórico.
- **Participantes por projeto**: líder, editor, leitor. Gestor e proprietário atuam como líder em todos. Quem não participa nem sabe que o projeto existe (nem pela API).
- **Quadro Kanban** (etapas configuráveis, cada uma com um tipo: a fazer / em andamento / em revisão / concluído) e **lista** com filtros, busca, ordenação e paginação no servidor. Mover cartões **arrastando ou pelo menu «Mover…»** (teclado e celular), com ordem estável e proteção contra duas pessoas movendo ao mesmo tempo.
- **Tarefas**: título, descrição em Markdown seguro, **um** responsável, prioridade, início e vencimento (data, sem hora), etiquetas, **checklist com itens obrigatórios** (a tarefa só conclui com todos marcados), **impedimento** com motivo, arquivar com motivo.
- **Comentários** (somente acréscimo, Markdown sanitizado, sem HTML) e **anexos privados** (PNG, JPEG, WebP, PDF, TXT, CSV; tipo conferido pelos bytes; entrega por link assinado de 60 s).
- **Histórico** da tarefa e do projeto que nunca se apaga; **notificações internas** (atribuída a você, comentário, reaberta) sem copiar conteúdo.
- **Painel** com dados reais: abertas, atrasadas, bloqueadas, sem responsável, concluídas no período, por etapa, por prioridade, carga por pessoa e progresso por projeto («Sem tarefas» em vez de 0% ou 100% inventados). **CSV** seguro (BOM, `;`, fórmulas neutralizadas).
- **Marca** (nome, cor, logotipo) configurável; auditoria sem dados pessoais. Perfis e permissões em `docs/PERMISSIONS.md`.

## Fora do escopo do MVP
Gantt e dependências entre tarefas, controle de horas faturáveis, atribuição a várias pessoas, subtarefas hierárquicas, automações, integrações (e-mail, chat, calendário), aplicativo nativo, IA. **Nenhum botão de integração inexistente é exibido.** Sem IA o sistema funciona integralmente.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Gestão de Projetos: https://github.com/pack-25-sistemas-ia/gestao-de-projetos
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local, carrega os dados de demonstração e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.

## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), Supabase CLI; para produção, conta Supabase **na região de São Paulo** e hospedagem Node (ex.: Vercel).

## Instalação isolada
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # preencha com `supabase status` (URL da API e chave publishable/anon)
supabase start && supabase db reset
node scripts/seed-demo.mjs        # opcional: agência fictícia «Agência Prisma (demonstração)»
pnpm dev                          # http://localhost:3000
```
`supabase db reset` aplica só as **migrações** (inclui os buckets do Storage). O seed cria usuários `@demo.exemplo` (dono, gestor, colaboradores, leitor) com **senha aleatória**, mostrada uma vez e guardada em `node_modules/.cache/pj-demo-credentials.json` (não há senha fixa no código), com 5 projetos e 24 tarefas em todos os estados.

## Primeiro administrador e equipe
1. Em `/signup` crie a conta e a empresa: o primeiro usuário vira **proprietário** e ativa o **2º fator (TOTP)**.
2. Pessoas: convide pelo Auth do Supabase e associe pela tela «Pessoas e acessos» do Core. **Gerente = gestor**, **Membro = colaborador**, **Leitor = só consulta** (só pode ser leitor nos projetos).
3. **Configurações** (proprietário): marca, fuso horário (define o que é «atrasada» e «hoje»), prefixo das chaves (ex.: `PRJ-0001-12`), tamanho máximo de anexo.
4. A gestão cria o projeto, adiciona participantes com papéis e as tarefas começam a aparecer em «Minhas tarefas» de cada pessoa.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (regras de papéis, estados, checklist, ordem, datas, Markdown, anexos, CSV, indicadores) · `pnpm test:db` (SQL: RLS, domínio, estados, painel, segurança, integridade) · `pnpm test:concurrency` (sessões simultâneas reais) · `pnpm test:mutation` (quebra regras de propósito e exige que algum teste falhe) · `pnpm test:e2e` (Playwright, incluindo celular e teclado). Resultados reais em `MEMORY.md`.

## Deploy, custos, backup e limitações
`docs/DEPLOYMENT.md` (variáveis, migrações, Storage, backup/restauração e **custos externos**) e `docs/SECURITY.md` (retenção, exclusão e LGPD).
- Sem antivírus nos anexos (só allowlist pelos bytes, limite de tamanho e URL assinada curta).
- Sem e-mail/WhatsApp: as notificações são internas (sino no sistema).
- A interface não exclui projetos nem tarefas (histórico imutável): arquiva; a exclusão/anonimização é administrativa, no banco.
- «Atrasada» e «hoje» usam o fuso configurado da empresa; prazos são datas, sem hora.

## Documentação
`docs/ARCHITECTURE.md` · `DATA_MODEL.md` · `PERMISSIONS.md` · `DECISIONS.md` · `REFERENCES.md` · `FEATURES.md` · `DEPLOYMENT.md` · `SECURITY.md` · `THIRD_PARTY_NOTICES.md`.

## Privacidade (LGPD)
Dados pessoais: **nome e e-mail dos membros** e o conteúdo livre que a equipe digitar (comentários, anexos) — risco baixo a médio. Coleta mínima, notificações só com ids, anexos em bucket privado, auditoria sem valores pessoais, sem PII em logs. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
