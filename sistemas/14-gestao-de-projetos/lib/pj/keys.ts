/** «PRJ-0003» e «PRJ-0003-12»: número do projeto e da tarefa (único dentro do projeto). Funções puras (testáveis fora do servidor). */
export const projectKey = (prefix: string, n: number | string): string => `${prefix}-${String(n).padStart(4, '0')}`;
export const taskKey = (prefix: string, project: number | string, task: number | string): string => `${projectKey(prefix, project)}-${task}`;
