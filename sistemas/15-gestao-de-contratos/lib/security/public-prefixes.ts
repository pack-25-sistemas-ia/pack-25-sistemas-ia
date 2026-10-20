// Prefixos de rota acessíveis SEM sessão, além das rotas de autenticação (ver paths.ts).
// Este sistema expõe UMA rota pública: o endpoint do agendador de lembretes (/api/jobs/lembretes). Ela valida o token da empresa (guardado só como hash no banco),
// o banco limita a taxa e a rota nunca usa a sessão do usuário nem registra o token. Arquivo do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
export const PUBLIC_PREFIXES: readonly string[] = ['/api/jobs/'];
