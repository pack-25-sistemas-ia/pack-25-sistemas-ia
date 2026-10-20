---
name: contract-domain
description: Use ao mexer em ciclo de vida, vigência, aviso, aditivo, renovação ou obrigação.
---

# contract-domain

- Estados: rascunho → ativo → rescindido|encerrado → (reabrir com motivo) ativo; arquivar é à parte. Passar do fim NÃO muda o estado.
- Datas inclusivas, sem hora; fuso da empresa; add_months limita ao último dia válido; aviso = referência − dias corridos.
- Espelho TS em `lib/ct/status.ts` e `dates.ts`: mudou o banco, mude o TS e os testes com os mesmos valores.
