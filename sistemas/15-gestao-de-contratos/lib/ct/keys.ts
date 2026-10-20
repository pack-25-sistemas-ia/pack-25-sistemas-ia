/** «CTR-0003»: prefixo da empresa + número do contrato (único por empresa). Função pura (testável fora do servidor). */
export const contractKey = (prefix: string, n: number | string): string => `${prefix}-${String(n).padStart(4, '0')}`;
