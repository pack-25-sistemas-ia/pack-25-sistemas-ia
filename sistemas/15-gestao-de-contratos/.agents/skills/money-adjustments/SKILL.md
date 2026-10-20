---
name: money-adjustments
description: Use ao mexer em valores, histórico de valores ou reajuste.
---

# money-adjustments

- Centavos inteiros; percentual em numeric/BigInt; meio para cima. Nunca ponto flutuante.
- Histórico de valores é append-only e cronológico. Reajuste: simular (proposta) → aplicar (trava contrato antes, data ≤ hoje, base inalterada, senão 40001).
- Valores NÃO são somados entre periodicidades e não geram cobrança.
