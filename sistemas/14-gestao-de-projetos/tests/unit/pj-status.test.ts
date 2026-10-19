// Espelho das regras que o banco decide. Os valores usados aqui são os MESMOS dos testes SQL (50/51/55) — mudou a regra, mude os dois.
import { describe, expect, it } from 'vitest';
import {
  allowedProjectRoles, availableTaskActions, canArchive, canComplete, canEditRole, canLeadRole, canMove, canTransitionProject, checklistProgress, completionBlockers, dateWarnings, datesOrdered,
  dueBucket, effectiveRole, isAssignable, isDenseOrder, isOpenTask, isOverdue, isReadOnlyProject, nextProjectStatuses, pendingRequired, placeInOrder, progressPercent, projectAllows, statusNeedsReason,
  type ProjectStatus,
} from '@/lib/pj/status';
import { DEFINITIONS, countOrNoData, defaultPeriod, percentText } from '@/lib/pj/indicators';
import { addDays } from '@/lib/pj/time';

const P = (status: ProjectStatus, archived = false) => ({ status, archived });

describe('papéis e permissões', () => {
  it('gestão é líder em todos os projetos; colaborador depende da participação; sem perfil não há papel', () => {
    expect(effectiveRole('owner', null)).toBe('lead');
    expect(effectiveRole('manager', 'reader')).toBe('lead');
    expect(effectiveRole('collaborator', 'editor')).toBe('editor');
    expect(effectiveRole('collaborator', null)).toBeNull();
    expect(effectiveRole('viewer', 'reader')).toBe('reader');
    expect(effectiveRole(null, 'lead')).toBeNull();
  });
  it('editar = líder ou editor; liderar = só líder', () => {
    expect([canEditRole('lead'), canEditRole('editor'), canEditRole('reader'), canEditRole(null)]).toEqual([true, true, false, false]);
    expect([canLeadRole('lead'), canLeadRole('editor'), canLeadRole('reader'), canLeadRole(null)]).toEqual([true, false, false, false]);
  });
  it('responsável precisa de acesso e permissão operacional (leitor e quem não participa nunca)', () => {
    expect(isAssignable('manager', null)).toBe(true);
    expect(isAssignable('collaborator', 'editor')).toBe(true);
    expect(isAssignable('collaborator', 'lead')).toBe(true);
    expect(isAssignable('collaborator', 'reader')).toBe(false);
    expect(isAssignable('collaborator', null)).toBe(false);
    expect(isAssignable('viewer', 'reader')).toBe(false);
  });
  it('papéis permitidos ao participar: Leitor da empresa só leitor; gestão não é participante explícito', () => {
    expect(allowedProjectRoles('viewer')).toEqual(['reader']);
    expect(allowedProjectRoles('manager')).toEqual([]);
    expect(allowedProjectRoles('owner')).toEqual([]);
    expect(allowedProjectRoles('collaborator')).toEqual(['lead', 'editor', 'reader']);
  });
});

describe('o que o estado do projeto permite', () => {
  it('organizar: planejado, ativo e pausado; executar: só ativo', () => {
    for (const s of ['planned', 'active', 'paused'] as const) expect(projectAllows(P(s), 'organize')).toBe(true);
    for (const s of ['completed', 'cancelled'] as const) expect(projectAllows(P(s), 'organize')).toBe(false);
    expect((['planned', 'active', 'paused', 'completed', 'cancelled'] as const).filter((s) => projectAllows(P(s), 'execute'))).toEqual(['active']);
  });
  it('arquivado é somente consulta, qualquer que seja o status', () => {
    for (const s of ['planned', 'active', 'paused', 'completed', 'cancelled'] as const) {
      expect(projectAllows(P(s, true), 'organize')).toBe(false);
      expect(isReadOnlyProject(P(s, true))).toBe(true);
    }
  });
  it('transições do projeto: iguais às do gatilho', () => {
    expect(nextProjectStatuses('planned')).toEqual(['active', 'cancelled']);
    expect(nextProjectStatuses('active')).toEqual(['paused', 'completed', 'cancelled']);
    expect(nextProjectStatuses('paused')).toEqual(['active', 'cancelled']);
    expect(nextProjectStatuses('completed')).toEqual(['active']);
    expect(nextProjectStatuses('cancelled')).toEqual(['active']);
    expect(canTransitionProject('planned', 'completed')).toBe(false);
    expect(canTransitionProject('active', 'planned')).toBe(false);
  });
  it('motivo obrigatório ao cancelar e ao reabrir', () => {
    expect(statusNeedsReason('active', 'cancelled')).toBe(true);
    expect(statusNeedsReason('completed', 'active')).toBe(true);
    expect(statusNeedsReason('cancelled', 'active')).toBe(true);
    expect(statusNeedsReason('planned', 'active')).toBe(false);
    expect(statusNeedsReason('paused', 'active')).toBe(false);
  });
  it('arquivar só projeto concluído ou cancelado ainda não arquivado', () => {
    expect(canArchive(P('completed'))).toBe(true);
    expect(canArchive(P('cancelled'))).toBe(true);
    expect(canArchive(P('active'))).toBe(false);
    expect(canArchive(P('completed', true))).toBe(false);
  });
});

describe('mover entre etapas', () => {
  it('mesmo tipo vale em qualquer estado que permita organizar', () => {
    expect(canMove(P('planned'), 'todo', 'todo').ok).toBe(true);
    expect(canMove(P('paused'), 'in_progress', 'in_progress').ok).toBe(true);
  });
  it('tipo diferente (execução) exige projeto ativo, com a mensagem certa', () => {
    expect(canMove(P('active'), 'todo', 'in_progress').ok).toBe(true);
    const paused = canMove(P('paused'), 'todo', 'in_progress');
    expect(paused.ok === false && paused.reason).toContain('pausado');
    const planned = canMove(P('planned'), 'todo', 'review');
    expect(planned.ok === false && planned.reason).toContain('ainda não iniciado');
  });
  it('concluído, cancelado e arquivado não movem', () => {
    expect(canMove(P('completed'), 'todo', 'todo').ok).toBe(false);
    expect(canMove(P('cancelled'), 'todo', 'in_progress').ok).toBe(false);
    expect(canMove(P('active', true), 'todo', 'todo').ok).toBe(false);
  });
});

describe('checklist e conclusão', () => {
  it('só itens OBRIGATÓRIOS pendentes bloqueiam a conclusão', () => {
    const items = [{ required: true, done: true }, { required: false, done: false }, { required: true, done: false }];
    expect(pendingRequired(items)).toBe(1);
    const v = canComplete(items);
    expect(v.ok === false && v.reason).toContain('1 item(ns) obrigatório(s)');
    expect(canComplete([{ required: true, done: true }, { required: false, done: false }]).ok).toBe(true);
    expect(canComplete([]).ok).toBe(true);
  });
  it('progresso do checklist', () => {
    expect(checklistProgress([{ required: false, done: true }, { required: true, done: false }, { required: false, done: true }])).toEqual({ done: 2, total: 3 });
  });
  it('projeto só conclui sem tarefa aberta (arquivadas e concluídas não contam)', () => {
    expect(completionBlockers([{ archived: false, semantic: 'todo' }, { archived: false, semantic: 'review' }, { archived: true, semantic: 'todo' }, { archived: false, semantic: 'done' }])).toBe(2);
    expect(completionBlockers([])).toBe(0);
  });
});

describe('definições dos indicadores (mesmos números do SQL 55)', () => {
  it('progresso: concluídas ÷ total; sem tarefas → null (nunca 100%)', () => {
    expect(progressPercent(1, 4)).toBe(25);
    expect(progressPercent(0, 3)).toBe(0);
    expect(progressPercent(3, 3)).toBe(100);
    expect(progressPercent(0, 0)).toBeNull();
    expect(percentText(0, 0)).toBe('Sem tarefas');
    expect(percentText(1, 4)).toBe('25%');
  });
  it('tarefa aberta: não arquivada, fora de Concluído, em projeto não cancelado e não arquivado', () => {
    expect(isOpenTask({ archived: false, semantic: 'todo' }, P('active'))).toBe(true);
    expect(isOpenTask({ archived: false, semantic: 'done' }, P('active'))).toBe(false);
    expect(isOpenTask({ archived: true, semantic: 'todo' }, P('active'))).toBe(false);
    expect(isOpenTask({ archived: false, semantic: 'todo' }, P('cancelled'))).toBe(false);
    expect(isOpenTask({ archived: false, semantic: 'todo' }, P('completed', true))).toBe(false);
    expect(isOpenTask({ archived: false, semantic: 'review' }, P('paused'))).toBe(true);
  });
  it('atrasada: vencimento ANTERIOR a hoje; vencer hoje ainda não é atraso', () => {
    const t = (due: string | null) => ({ dueDate: due, archived: false, semantic: 'todo' as const });
    expect(isOverdue(t('2026-03-09'), P('active'), '2026-03-10')).toBe(true);
    expect(isOverdue(t('2026-03-10'), P('active'), '2026-03-10')).toBe(false);
    expect(isOverdue(t(null), P('active'), '2026-03-10')).toBe(false);
    expect(isOverdue({ dueDate: '2026-03-01', archived: false, semantic: 'done' }, P('active'), '2026-03-10')).toBe(false);
    expect(isOverdue(t('2026-03-01'), P('cancelled'), '2026-03-10')).toBe(false);
  });
  it('definições e período padrão estão escritos para a tela', () => {
    expect(DEFINITIONS.overdue).toContain('anterior a hoje');
    expect(DEFINITIONS.load).toContain('não uma medida de produtividade');
    expect(countOrNoData(null)).toBe('Sem dados');
    expect(countOrNoData(0)).toBe('0');
    expect(defaultPeriod('2026-03-30', addDays)).toEqual({ from: '2026-03-01', to: '2026-03-30' });
  });
});

describe('Minhas tarefas: grupos por data', () => {
  const today = '2026-03-10';
  const plus7 = '2026-03-17';
  it('atrasadas, hoje, próximos sete dias (inclusive o 7º), depois e sem prazo', () => {
    expect(dueBucket('2026-03-09', today, plus7)).toBe('overdue');
    expect(dueBucket('2026-03-10', today, plus7)).toBe('today');
    expect(dueBucket('2026-03-11', today, plus7)).toBe('next7');
    expect(dueBucket('2026-03-17', today, plus7)).toBe('next7');
    expect(dueBucket('2026-03-18', today, plus7)).toBe('later');
    expect(dueBucket(null, today, plus7)).toBe('none');
  });
});

describe('datas de planejamento', () => {
  it('aviso (nunca ajuste silencioso) quando a data sai do período do projeto', () => {
    const proj = { startDate: '2026-01-05', dueDate: '2026-12-30' };
    expect(dateWarnings(proj, '2025-12-20', '2026-02-01')).toEqual(['A data de início está fora do período do projeto.']);
    expect(dateWarnings(proj, '2026-02-01', '2027-01-01')).toEqual(['O vencimento está fora do período do projeto.']);
    expect(dateWarnings(proj, '2026-02-01', '2026-03-01')).toEqual([]);
    expect(dateWarnings({ startDate: null, dueDate: null }, '2000-01-01', '2100-01-01')).toEqual([]);
    expect(dateWarnings(proj, null, null)).toEqual([]);
  });
  it('início não pode ser depois do vencimento', () => {
    expect(datesOrdered('2026-03-01', '2026-03-01')).toBe(true);
    expect(datesOrdered('2026-03-02', '2026-03-01')).toBe(false);
    expect(datesOrdered(null, '2026-03-01')).toBe(true);
    expect(datesOrdered('2026-03-01', null)).toBe(true);
  });
});

describe('ordem do quadro (espelho de pj_move_task)', () => {
  it('reordenar dentro da etapa: 4 antes de 1 → 4,1,2,3', () => {
    expect(placeInOrder(['1', '2', '3', '4'], '4', '1')).toEqual(['4', '1', '2', '3']);
  });
  it('mover para outra etapa: ao fim, ou antes de uma referência', () => {
    expect(placeInOrder(['2'], '3', null)).toEqual(['2', '3']);
    expect(placeInOrder(['2'], '3', '2')).toEqual(['3', '2']);
    expect(placeInOrder([], '9', null)).toEqual(['9']);
  });
  it('referência inválida (a própria tarefa ou fora da etapa) → null', () => {
    expect(placeInOrder(['1', '2'], '1', '1')).toBeNull();
    expect(placeInOrder(['1', '2'], '3', 'x')).toBeNull();
  });
  it('mover para onde já está produz a mesma lista (sem mudança)', () => {
    expect(placeInOrder(['1', '2', '3'], '3', null)).toEqual(['1', '2', '3']);
    expect(placeInOrder(['1', '2', '3'], '2', '3')).toEqual(['1', '2', '3']);
  });
  it('invariante: posições 1..n sem buracos nem repetição', () => {
    expect(isDenseOrder([3, 1, 2])).toBe(true);
    expect(isDenseOrder([1, 2, 4])).toBe(false);
    expect(isDenseOrder([1, 1, 2])).toBe(false);
    expect(isDenseOrder([])).toBe(true);
  });
});

describe('ações oferecidas na tarefa', () => {
  const base = { project: P('active'), taskArchived: false, taskDone: false };
  it('leitor e quem não participa não veem ações', () => {
    expect(availableTaskActions({ ...base, role: 'reader' })).toEqual([]);
    expect(availableTaskActions({ ...base, role: null })).toEqual([]);
  });
  it('editor edita; só a liderança arquiva', () => {
    const ed = availableTaskActions({ ...base, role: 'editor' });
    expect(ed).toContain('edit');
    expect(ed).not.toContain('archive');
    expect(availableTaskActions({ ...base, role: 'lead' })).toContain('archive');
  });
  it('tarefa concluída não aceita impedimento nem checklist; arquivada e projeto somente consulta não aceitam nada', () => {
    const done = availableTaskActions({ ...base, role: 'lead', taskDone: true });
    expect(done).not.toContain('block');
    expect(done).not.toContain('checklist');
    expect(availableTaskActions({ ...base, role: 'lead', taskArchived: true })).toEqual([]);
    expect(availableTaskActions({ ...base, role: 'lead', project: P('completed') })).toEqual([]);
  });
});
