// Apresentação dos indicadores do painel. Os números vêm do banco (os_dashboard); aqui só formatamos e deixamos CLARO o que cada um mede.
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'Sem dados';
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return s > 0 ? 'menos de 1 min' : '0 min';
}

/** Texto de um número do painel: nunca inventa valor. Sem dados → «Sem dados». */
export function countOrNoData(n: number | null | undefined, hasData: boolean): string {
  if (!hasData || n === null || n === undefined) return 'Sem dados';
  return String(n);
}

export const DEFINITIONS = {
  backlog: 'Backlog = abertas + agendadas + em execução + pausadas (foto do momento).',
  awaiting: 'Concluídas sem aceite válido da versão atual da conclusão (inclui as contestadas).',
  late: 'Atraso da PREVISÃO: ordens do backlog cuja janela planejada já terminou. Não é SLA contratual.',
  cycle: 'Tempo corrido entre a abertura e a conclusão (inclui noites, fins de semana e pausas).',
  approved: 'Valor aprovado pelo cliente (última versão aprovada de cada ordem). Não é receita recebida nem faturamento.',
  unassigned: 'Ordens do backlog sem responsável técnico.',
  rework: 'Ordens reabertas para execução no período (retrabalho).',
} as const;

/** Período padrão: últimos 30 dias, no fuso da empresa (datas locais AAAA-MM-DD). */
export function defaultPeriod(today: string, addDays: (d: string, n: number) => string): { from: string; to: string } {
  return { from: addDays(today, -29), to: today };
}
