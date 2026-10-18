// Prefixos de rota acessíveis SEM sessão, além das rotas de autenticação (ver paths.ts).
// Este sistema expõe a página de acompanhamento do cliente (/acompanhar/<token>). Cada rota pública faz a própria validação
// (token de 256 bits guardado só como hash, validade, revogação, limite de abuso no banco) e nunca usa a sessão do usuário.
// Arquivo do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
export const PUBLIC_PREFIXES: readonly string[] = ['/acompanhar/'];
