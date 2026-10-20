# ADJUSTMENTS — reajuste por percentual

O sistema **não busca índices** (IPCA, IGP-M…): a pessoa informa o percentual e, se quiser, a referência e o período («IPCA — 12 meses até o mês anterior»). O resultado é um **valor informativo**: não gera cobrança, boleto, nota ou lançamento contábil.

## Fluxo
1. **Regra (opcional)** — frequência em meses (1 a 120) e próxima data prevista. A próxima data alimenta o prazo «Reajuste previsto» e os lembretes.
2. **Simular** — informa data de efeito e percentual. O banco calcula e **grava uma proposta** (`proposed`); **o contrato não muda**. Uma nova simulação cancela a proposta anterior em aberto.
3. **Aplicar** — ação explícita da gestão. Numa única transação o banco:
   - trava o contrato **primeiro** (aplicações simultâneas se enfileiram) e depois a proposta;
   - confere que a proposta está em aberto (**só uma aplicação vence**; as outras recebem «já foi aplicado»);
   - exige contrato **ativo**, data de efeito **≤ hoje** e **ordem cronológica** (não pode haver valor com data igual ou posterior);
   - confere que a **base não mudou** desde a simulação (senão erro 40001: «Simule novamente antes de aplicar»);
   - cria uma **nova versão de valor** (a anterior nunca é editada), marca a proposta como aplicada e avança a regra: próxima data = data de efeito + frequência (com fim de mês limitado);
   - atualiza os prazos (nova revisão) e grava evento e auditoria.
4. **Cancelar** — só propostas em aberto.

## Limites e regras
- Percentual: maior que **−100%** e até **1000%**, com até 4 casas decimais. **Negativo exige justificativa** (mínimo 5 caracteres).
- Resultado entre 0 e 99.999.999.999.999 centavos.
- A data de efeito pode ser **passada** (reajuste retroativo registrado agora) — o valor passa a valer a partir dela; não pode ser futura na aplicação.

## Aritmética exata
`novo = base × (100 + pct) / 100`, em `numeric` no banco e `BigInt` no TypeScript, arredondado ao **centavo, meio para cima (para longe de zero)**. Exemplos: 100.001 centavos com +3,3333% → 103.334; 333 com −33,3333% → 222; 1 com +50% → 2 e 1 com −50% → 1. Nunca ponto flutuante binário. Banco e TypeScript são testados com os **mesmos casos**.

## Histórico
Cada mudança de valor (inicial, aditivo, correção, reajuste) é uma linha em `contract_value_versions` com `effective_from`. O **valor vigente** em uma data é a versão de maior `effective_from` até aquela data. A tela do contrato mostra a linha do tempo completa.
