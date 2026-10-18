---
description: Instala e roda o Ordens de Serviço neste computador, passo a passo
---

Você vai instalar o **Ordens de Serviço** (https://github.com/pack-25-sistemas-ia/ordens-de-servico) para a pessoa que abriu esta pasta. Ela pode ser iniciante: explique em português simples o que está fazendo, uma etapa por vez, e **pare para perguntar** sempre que precisar de algo dela (conta, chave, decisão). Leia `AGENTS.md` e `MEMORY.md` antes de começar.

## Regras
- Nunca invente nem publique chaves. `.env.local` é só da pessoa e **nunca** vai para o Git.
- Não rode nada destrutivo (apagar pastas, `git reset --hard`, `supabase db reset` em banco que não seja o local) sem pedir.
- Se um passo falhar, leia o erro, corrija a causa e tente de novo; se não souber, mostre o erro à pessoa em linguagem simples.

## Etapas
1. **Pasta.** Se o repositório ainda não foi clonado, clone `https://github.com/pack-25-sistemas-ia/ordens-de-servico` numa pasta nova e entre nela.
2. **Pré-requisitos.** Confira `node -v` (22 ou mais), `pnpm -v` (12), `docker info` (Docker Desktop aberto) e `supabase --version`. Para o que faltar, diga qual é e como instalar para o sistema operacional dela, e espere ela concluir.
3. **Dependências.** `pnpm install --frozen-lockfile`.
4. **Ambiente.** `cp .env.example .env.local` (no Windows: `copy`). Rode `supabase start` e preencha `.env.local` com os valores de `supabase status` (URL da API e chave publishable/anon). Gere `OS_LINK_SALT` com `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` e cole no `.env.local` (sem ele os links do cliente não funcionam). Não peça nem use a chave `service_role`.
5. **Banco.** `supabase db reset` (aplica as migrações no Supabase **local**, inclusive os buckets de arquivos).
6. **Dados de demonstração (opcional, recomendado).** Rode `node scripts/seed-demo.mjs`: cria a empresa fictícia «Assistência Horizonte» e usuários `@demo.exemplo` (dono, gestor, técnicos). Mostre o e-mail e a senha que o script informar (ficam em `node_modules/.cache/os-demo-credentials.json`); a senha é só desta instalação.
7. **Rodar.** `pnpm dev` e abra http://localhost:3000. Entre com o usuário dono; no primeiro acesso ele cadastra o segundo fator (aplicativo autenticador). Mostre onde clicar primeiro: **Ordens de serviço**, depois uma ordem, aba **Resumo → Gerar link de acompanhamento** para ver a página do cliente.
8. **Conferir.** Rode `pnpm lint`, `pnpm typecheck` e `pnpm test`. Se quiser ir além: `pnpm test:db` (precisa do Docker).
9. **Fechar.** Resuma em 5 linhas o que foi instalado, o endereço, o login de demonstração e o próximo passo. Diga que, para publicar de verdade, ela precisa do **próprio** projeto Supabase (região São Paulo) e hospedagem, e aponte `docs/DEPLOYMENT.md`. Para adaptar a um cliente, sugira criar um repositório **privado** dela e ler `docs/DECISIONS.md` e `docs/FEATURES.md`.

## Privacidade
Os dados de demonstração são fictícios. Antes de usar dados reais de um cliente, siga a seção de privacidade (LGPD) do README e `docs/SECURITY.md`.
