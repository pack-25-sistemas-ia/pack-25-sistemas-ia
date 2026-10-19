// Apresentação dos indicadores do painel. Os números vêm do banco (pj_dashboard); aqui só formatamos e deixamos CLARO o que cada um mede.
import { progressPercent } from './status';

export const DEFINITIONS = {
  open: 'Tarefas não arquivadas, fora de «Concluído», em projetos não cancelados e não arquivados.',
  overdue: 'Tarefas abertas com vencimento anterior a hoje (no fuso da empresa). Vencer hoje ainda não é atraso.',
  blocked: 'Tarefas abertas marcadas com impedimento (o impedimento não muda a etapa).',
  unassigned: 'Tarefas abertas sem responsável.',
  completedInPeriod: 'Tarefas que estão em «Concluído» agora e foram concluídas dentro do período.',
  activeProjects: 'Projetos com status «Ativo» que não estão arquivados.',
  progress: 'Tarefas concluídas ÷ total de tarefas não arquivadas do projeto. Sem tarefas: «Sem tarefas», nunca 100%.',
  load: 'Distribuição das tarefas abertas por responsável. É um retrato da carga, não uma medida de produtividade ou desempenho.',
} as const;

export function percentText(done: number, total: number): string {
  const p = progressPercent(done, total);
  return p === null ? 'Sem tarefas' : `${p}%`;
}
export function countOrNoData(n: number | null | undefined): string {
  return n === null || n === undefined ? 'Sem dados' : String(n);
}
export function defaultPeriod(today: string, addDays: (d: string, n: number) => string): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}
