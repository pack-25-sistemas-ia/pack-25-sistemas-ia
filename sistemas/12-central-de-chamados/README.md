# Central de Chamados

> Plataforma de chamados para pequenas e médias empresas: o solicitante abre pelo portal, a equipe classifica, atribui, conversa e resolve, e **o SLA é medido em minutos úteis** (expediente, almoço, fim de semana e pausas), com histórico que nunca se apaga.

**Público:** suporte técnico, TI interna, prestadores de manutenção, agências e consultorias · **Problema:** solicitações em mensagens e planilhas, sem responsável, sem histórico e sem prazo visível · **Proposta:** fila, responsável, conversa pública e notas internas separadas **no banco**, SLA calculado na leitura (sem cron) e painel com dados reais.

## O que faz
- **Portal do solicitante**: abre chamados (com anexos), acompanha, responde, **confirma** a solução ou **reabre** dentro da janela. Vê só os próprios chamados e nunca notas internas, equipe, responsável ou SLA.
- **Fila da equipe**: tabela (cartões no celular) e quadro por status; filtros e paginação **no servidor**; visões «Meus», «Sem responsável», «Aguardando solicitante», «SLA atrasado» e «Resolvidos»; busca por número ou assunto.
- **Atendimento**: «Assumir» (só uma pessoa vence), «Atribuir a», «Mover para equipe», prioridade, categoria; compositor com modos explícitos **Resposta ao solicitante** × **Nota interna**; respostas prontas (só preenchem o texto); anexos privados.
- **SLA de verdade**: primeira resposta pública + resolução, expediente e fuso por empresa, **pausa enquanto aguarda o solicitante**, ciclos (a reabertura cria um novo; os anteriores ficam), metas **fixadas no início de cada ciclo**. Ver `docs/SLA.md`.
- **Painel e relatórios**: backlog, não atribuídos, ciclos resolvidos, reaberturas, cumprimento de SLA, tempos úteis, carga por atendente, **ciclos abertos já atrasados**; «Sem dados» em vez de 0%. Exportação **CSV** segura.
- **Notificações dentro do sistema** (atribuído, resposta, resolvido, reaberto) — não dependem de e-mail.
- **Multiempresa com RLS**; perfis: proprietário, gestor, atendente e solicitante (ver `docs/PERMISSIONS.md`). Marca (nome, cor, logotipo) configurável.

## Fora do escopo do MVP
Telefonia, WhatsApp, chat em tempo real, caixa de entrada/conversão de e-mail em chamado, envio de e-mail como requisito, chatbot, aplicativo nativo, base de conhecimento, gestão de ativos, contratos e faturamento, automação visual de workflows, SLA contratual por cliente, feriados automáticos, formulário público anônimo e IA. **Nenhum botão de integração inexistente é exibido.** Sem IA o sistema funciona integralmente.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Central de Chamados: https://github.com/pack-25-sistemas-ia/central-de-chamados
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local, carrega os dados de demonstração e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Pré-requisitos
Node 22+, pnpm 12, Docker (Supabase local e `pnpm test:db`), conta Supabase **na região de São Paulo** para produção e hospedagem Node (ex.: Vercel).

## Instalação isolada
```bash
pnpm install --frozen-lockfile
cp .env.example .env.local        # preencha com `supabase status`
supabase start && supabase db reset
node scripts/seed-demo.mjs        # opcional: empresa fictícia «Suporte Aurora TI (demonstração)»
pnpm dev                          # http://localhost:3000
```
`supabase db reset` aplica só as **migrações** (inclui os buckets privados do Storage). O seed de demonstração cria usuários `@demo.exemplo` com **senha aleatória** guardada em `node_modules/.cache/tk-demo-credentials.json` (não há senha fixa no código) e confere a coerência do histórico (nada no futuro, ordem temporal, todos os estados e situações de SLA presentes).

## Primeiro administrador, membros e equipes
1. Em `/signup` crie a conta e a empresa: o primeiro usuário vira **proprietário** e ativa o **2º fator (TOTP)** (exigido também no banco).
2. **Convidar/associar pessoas**: convide pelo painel do Supabase (Auth → Users) e associe à empresa pelo SQL de `docs/MEMBROS.md` (não existe cadastro público: ninguém entra numa empresa só informando o id ou o slug). Papéis: **Gerente = gestor**, **Membro = atendente**, **Leitor = solicitante**; troque em *Pessoas e acessos*.
3. **Equipes** → crie e marque os atendentes de cada equipe; **Categorias** → defina a equipe padrão (o solicitante não escolhe equipe); **Respostas prontas** → modelos de texto.
4. **Configurações** (proprietário) → marca, janela de reabertura, tamanho máximo dos anexos, retenção, expediente e metas de SLA.
5. **Portal do solicitante**: peça às pessoas que entrem com a conta delas em `/login`; o endereço `/portal/<slug-da-empresa>` leva à lista de chamados (o slug identifica a empresa, **não** dá acesso).

## SLA e personalização
Metas iniciais (minutos úteis) são **demonstrativas e editáveis**: baixa 480/2400, normal 240/1440, alta 60/480, urgente 30/240 (primeira resposta/resolução). Expediente padrão: segunda a sexta, 09–12 e 13–18, fuso `America/Sao_Paulo`. Cada alteração publica uma **nova versão**; ciclos em andamento mantêm a anterior. Marca: *Configurações → Marca*.

## Qualidade
`pnpm lint` · `pnpm typecheck` · `pnpm test` (SLA, estados, fórmulas, anexos, CSV) · `pnpm test:db` (SQL: RLS, domínio, SLA/painel, fila/anexos, segurança) · `pnpm test:concurrency` (sessões simultâneas reais) · `pnpm test:mutation` (quebra regras de propósito e exige que algum teste falhe) · `pnpm test:e2e` (Playwright). Resultados reais em `MEMORY.md`.

## Deploy, custos, backup e limitações
`docs/DEPLOYMENT.md` (variáveis, migrações, Storage, backup/restauração e **custos externos**), `docs/SECURITY.md` (retenção, exclusão e anonimização) e as limitações abaixo.
- Não há antivírus nos anexos (apenas allowlist de tipos conferida pelos bytes, limite de tamanho e download forçado por URL assinada curta).
- Sem e-mail: o aviso ao solicitante é interno (notificações); a equipe pode combinar outro canal fora do sistema.
- Feriados são informados manualmente (datas sem expediente).
- A interface não exclui chamados nem mensagens (histórico imutável); a exclusão é administrativa, no banco, conforme sua política.

## Documentação
`docs/ARCHITECTURE.md` · `DATA_MODEL.md` · `SLA.md` · `PERMISSIONS.md` · `DECISIONS.md` · `REFERENCES.md` · `FEATURES.md` · `DEPLOYMENT.md` · `SECURITY.md`.

## Privacidade (LGPD)
Dados pessoais: **nome e e-mail do solicitante e o conteúdo dos chamados** (risco médio — o texto é livre e pode conter dados de terceiros). Coleta mínima, sem PII em logs, anexos em bucket privado, auditoria de mudanças administrativas e de exportações. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no repositório do Pack.
