// Espelho das regras de domínio que o BANCO decide (gatilhos pj_project_guard / pj_task_guard / pj_member_guard e funções pj_*). Aqui elas só explicam e projetam a interface; os testes usam os mesmos valores do SQL.
// Mudou uma regra? Mude o banco e este arquivo juntos.

export const PROJECT_STATUSES = ['planned', 'active', 'paused', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const SEMANTICS = ['todo', 'in_progress', 'review', 'done'] as const;
export type Semantic = (typeof SEMANTICS)[number];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
/** Perfil na empresa: owner (owner/admin do Core), manager (gerente), collaborator (membro) e viewer (Leitor do Core: só consulta). */
export type OrgProfile = 'owner' | 'manager' | 'collaborator' | 'viewer';
export type ProjectRole = 'lead' | 'editor' | 'reader';
export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { planned: 'Planejado', active: 'Ativo', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado' };
export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = { planned: 'neutral', active: 'success', paused: 'warning', completed: 'neutral', cancelled: 'danger' };
export const SEMANTIC_LABEL: Record<Semantic, string> = { todo: 'A fazer', in_progress: 'Em andamento', review: 'Em revisão', done: 'Concluído' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
export const PRIORITY_TONE: Record<Priority, Tone> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };
export const PROFILE_LABEL: Record<OrgProfile, string> = { owner: 'Proprietário', manager: 'Gestor', collaborator: 'Colaborador', viewer: 'Leitor' };
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = { lead: 'Líder', editor: 'Editor', reader: 'Leitor' };

export const isProjectStatus = (v: unknown): v is ProjectStatus => typeof v === 'string' && (PROJECT_STATUSES as readonly string[]).includes(v);
export const isPriority = (v: unknown): v is Priority => typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
export const isSemantic = (v: unknown): v is Semantic => typeof v === 'string' && (SEMANTICS as readonly string[]).includes(v);
export const isManagement = (p: OrgProfile | null): boolean => p === 'owner' || p === 'manager';

/** Papel efetivo no projeto: gestão atua como líder em todos; os demais dependem da participação. */
export function effectiveRole(profile: OrgProfile | null, memberRole: ProjectRole | null): ProjectRole | null {
  if (profile === null) return null;
  if (isManagement(profile)) return 'lead';
  return memberRole;
}
export const canEditRole = (r: ProjectRole | null): boolean => r === 'lead' || r === 'editor';
export const canLeadRole = (r: ProjectRole | null): boolean => r === 'lead';
/** Quem pode ser RESPONSÁVEL por uma tarefa: gestão, líder ou editor (leitor nunca). */
export const isAssignable = (profile: OrgProfile | null, memberRole: ProjectRole | null): boolean => canEditRole(effectiveRole(profile, memberRole));
/** Papéis que uma pessoa pode ter no projeto: o «Leitor» da empresa só pode ser leitor; gestão não é participante explícito. */
export function allowedProjectRoles(profile: OrgProfile): ProjectRole[] {
  if (profile === 'viewer') return ['reader'];
  if (isManagement(profile)) return [];
  return ['lead', 'editor', 'reader'];
}

/** O que o estado do projeto permite (espelho de pj_writable): organizar = planejado/ativo/pausado; executar = só ativo. Arquivado, concluído e cancelado são só consulta. */
export function projectAllows(p: { status: ProjectStatus; archived: boolean }, mode: 'organize' | 'execute'): boolean {
  if (p.archived) return false;
  return mode === 'execute' ? p.status === 'active' : p.status === 'planned' || p.status === 'active' || p.status === 'paused';
}
export const isReadOnlyProject = (p: { status: ProjectStatus; archived: boolean }): boolean => !projectAllows(p, 'organize');

/** Transições de status do projeto (espelho de pj_project_guard). */
export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  switch (from) {
    case 'planned': return to === 'active' || to === 'cancelled';
    case 'active': return to === 'paused' || to === 'completed' || to === 'cancelled';
    case 'paused': return to === 'active' || to === 'cancelled';
    case 'completed':
    case 'cancelled': return to === 'active';
    default: return false;
  }
}
/** Estados para os quais a tela oferece uma ação, na ordem de exibição. */
export function nextProjectStatuses(from: ProjectStatus): ProjectStatus[] {
  return PROJECT_STATUSES.filter((s) => canTransitionProject(from, s));
}
/** Motivo obrigatório ao cancelar ou reabrir (mínimo 5 caracteres). */
export const statusNeedsReason = (from: ProjectStatus, to: ProjectStatus): boolean => to === 'cancelled' || ((from === 'completed' || from === 'cancelled') && to === 'active');
/** Arquivar só concluído/cancelado (atributo separado do status). */
export const canArchive = (p: { status: ProjectStatus; archived: boolean }): boolean => !p.archived && (p.status === 'completed' || p.status === 'cancelled');

export type MoveVerdict = { ok: true } | { ok: false; reason: string };
/** Pode mover uma tarefa de uma etapa para outra? Entre tipos diferentes (execução) o projeto precisa estar ativo. */
export function canMove(project: { status: ProjectStatus; archived: boolean }, from: Semantic, to: Semantic): MoveVerdict {
  if (!projectAllows(project, 'organize')) return { ok: false, reason: 'O projeto não aceita movimentações (concluído, cancelado ou arquivado).' };
  if (from !== to && !projectAllows(project, 'execute')) {
    return { ok: false, reason: project.status === 'paused' ? 'Projeto pausado: movimentações de execução ficam bloqueadas até retomar.' : 'Projeto ainda não iniciado: ative o projeto para mover tarefas entre etapas de execução.' };
  }
  return { ok: true };
}

export type ChecklistLite = { required: boolean; done: boolean };
export const pendingRequired = (items: readonly ChecklistLite[]): number => items.filter((i) => i.required && !i.done).length;
/** Concluir exige todos os itens obrigatórios concluídos (o servidor confere de novo). */
export function canComplete(items: readonly ChecklistLite[]): MoveVerdict {
  const n = pendingRequired(items);
  return n === 0 ? { ok: true } : { ok: false, reason: `${n} item(ns) obrigatório(s) do checklist pendente(s).` };
}
export const checklistProgress = (items: readonly ChecklistLite[]): { done: number; total: number } => ({ done: items.filter((i) => i.done).length, total: items.length });

/** Projeto só conclui sem tarefa aberta (não arquivada fora de «Concluído»). */
export function completionBlockers(tasks: ReadonlyArray<{ archived: boolean; semantic: Semantic }>): number {
  return tasks.filter((t) => !t.archived && t.semantic !== 'done').length;
}
/** Progresso = concluídas ÷ total (não arquivadas). Sem tarefas → null («Sem tarefas»), nunca 100%. */
export function progressPercent(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((100 * done) / total);
}

/** Tarefa aberta: não arquivada, fora de «Concluído», em projeto não cancelado e não arquivado. */
export function isOpenTask(t: { archived: boolean; semantic: Semantic }, p: { status: ProjectStatus; archived: boolean }): boolean {
  return !t.archived && t.semantic !== 'done' && p.status !== 'cancelled' && !p.archived;
}
/** Atrasada: aberta com vencimento ANTERIOR a hoje (datas de planejamento, no fuso da empresa). Vencer hoje ainda não é atraso. */
export function isOverdue(t: { dueDate: string | null; archived: boolean; semantic: Semantic }, p: { status: ProjectStatus; archived: boolean }, today: string): boolean {
  return isOpenTask(t, p) && t.dueDate !== null && t.dueDate < today;
}

export type DueBucket = 'overdue' | 'today' | 'next7' | 'later' | 'none';
export const BUCKET_LABEL: Record<DueBucket, string> = { overdue: 'Atrasadas', today: 'Hoje', next7: 'Próximos sete dias', later: 'Depois', none: 'Sem prazo' };
export const BUCKETS: readonly DueBucket[] = ['overdue', 'today', 'next7', 'later', 'none'];
/** Grupo de «Minhas tarefas». `plus7` é a data de hoje + 7 dias (inclusive). */
export function dueBucket(dueDate: string | null, today: string, plus7: string): DueBucket {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate <= plus7) return 'next7';
  return 'later';
}

/** Avisos de planejamento (nunca ajustam datas em silêncio): datas da tarefa fora do período do projeto. */
export function dateWarnings(project: { startDate: string | null; dueDate: string | null }, start: string | null, due: string | null): string[] {
  const out: string[] = [];
  const outside = (d: string): boolean => (project.startDate !== null && d < project.startDate) || (project.dueDate !== null && d > project.dueDate);
  if (start && outside(start)) out.push('A data de início está fora do período do projeto.');
  if (due && outside(due)) out.push('O vencimento está fora do período do projeto.');
  return out;
}
export const datesOrdered = (start: string | null, due: string | null): boolean => !start || !due || start <= due;

/**
 * Nova ordem de uma etapa depois de mover `taskId` para ela, antes de `beforeId` (nulo = ao fim). Espelho de pj_move_task.
 * `ordered` é a lista atual da etapa de destino (pode conter a própria tarefa quando é reordenação). Devolve null se a referência for inválida.
 */
export function placeInOrder(ordered: readonly string[], taskId: string, beforeId: string | null): string[] | null {
  const rest = ordered.filter((id) => id !== taskId);
  if (beforeId === null) return [...rest, taskId];
  if (beforeId === taskId) return null;
  const idx = rest.indexOf(beforeId);
  if (idx < 0) return null;
  return [...rest.slice(0, idx), taskId, ...rest.slice(idx)];
}
/** Posições 1..n sem buracos nem repetição (invariante do quadro). */
export const isDenseOrder = (positions: readonly number[]): boolean => [...positions].sort((a, b) => a - b).every((p, i) => p === i + 1);

/** Ações oferecidas na tela para a tarefa (o banco recusa o resto). */
export type TaskAction = 'edit' | 'assign' | 'move' | 'comment' | 'attach' | 'checklist' | 'block' | 'labels' | 'archive';
export function availableTaskActions(p: { role: ProjectRole | null; project: { status: ProjectStatus; archived: boolean }; taskArchived: boolean; taskDone: boolean }): TaskAction[] {
  if (!canEditRole(p.role) || p.taskArchived || isReadOnlyProject(p.project)) return [];
  const out: TaskAction[] = ['edit', 'assign', 'move', 'comment', 'attach', 'labels'];
  if (!p.taskDone) out.push('block', 'checklist');
  if (canLeadRole(p.role)) out.push('archive');
  return out;
}
