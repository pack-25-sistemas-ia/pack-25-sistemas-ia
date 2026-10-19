// Apresentação (sem dependências do servidor): cartões do quadro e texto do histórico. Puro e testável.
import { formatDateBR } from './time';
import { PRIORITY_LABEL, PROJECT_STATUS_LABEL, PROJECT_ROLE_LABEL, SEMANTIC_LABEL, isOverdue, isPriority, isProjectStatus, isSemantic, type Priority, type ProjectRole, type ProjectStatus, type Semantic } from './status';

export type CardInput = {
  id: string; task_number: number; title: string; priority: Priority; due_date: string | null; assignee_user_id: string | null; blocked_reason: string | null;
  task_labels: Array<{ label_id: string }>; checklist: { done: number; total: number }; completed_at: string | null; archived_at: string | null; column_id: string;
};
export type CardOut = {
  id: string; key: string; title: string; priority: Priority; dueDate: string | null; overdue: boolean; assignee: string | null; blockedReason: string | null;
  labels: Array<{ name: string; color: string }>; checklist: { done: number; total: number }; completed: boolean;
};

export function toCard(t: CardInput, ctx: {
  key: (n: number) => string; semanticOf: (columnId: string) => Semantic; labels: Map<string, { name: string; color: string }>; nameOf: (id: string | null) => string | null;
  project: { status: ProjectStatus; archived: boolean }; today: string;
}): CardOut {
  const semantic = ctx.semanticOf(t.column_id);
  return {
    id: t.id, key: ctx.key(t.task_number), title: t.title, priority: t.priority, dueDate: t.due_date,
    overdue: isOverdue({ dueDate: t.due_date, archived: t.archived_at !== null, semantic }, ctx.project, ctx.today),
    assignee: ctx.nameOf(t.assignee_user_id), blockedReason: t.blocked_reason,
    labels: t.task_labels.map((l) => ctx.labels.get(l.label_id)).filter((x): x is { name: string; color: string } => !!x),
    checklist: t.checklist, completed: semantic === 'done',
  };
}

type Names = (id: string | null | undefined) => string;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const stat = (v: unknown): string => (isProjectStatus(v) ? PROJECT_STATUS_LABEL[v] : str(v));
const prio = (v: unknown): string => (isPriority(v) ? PRIORITY_LABEL[v] : str(v));
const sem = (v: unknown): string => (isSemantic(v) ? SEMANTIC_LABEL[v] : str(v));
const role = (v: unknown): string => (v === 'lead' || v === 'editor' || v === 'reader' ? PROJECT_ROLE_LABEL[v as ProjectRole] : str(v));
const dt = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateBR(v) : 'sem data');

/** Texto humano de um evento do histórico (sem texto de comentário: os eventos nunca o guardam). `by` é o nome de quem fez; eventos de sistema não têm pessoa. */
export function describeEvent(type: string, data: Record<string, unknown>, who: Names): string {
  switch (type) {
    case 'project_created': return 'Projeto criado';
    case 'project_updated': return `Dados do projeto atualizados (${Array.isArray(data.fields) ? (data.fields as string[]).map((f) => ({ name: 'nome', description: 'descrição', start_date: 'início', due_date: 'entrega' }[f] ?? f)).join(', ') : 'dados'})`;
    case 'status_changed': return `Status alterado de ${stat(data.from)} para ${stat(data.to)}${str(data.reason) ? ` — ${str(data.reason)}` : ''}`;
    case 'project_reopened': return `Projeto reaberto (de ${stat(data.from)} para ${stat(data.to)}) — ${str(data.reason)}`;
    case 'project_archived': return 'Projeto arquivado';
    case 'project_unarchived': return 'Projeto desarquivado';
    case 'member_added': return `${who(str(data.user_id))} entrou no projeto como ${role(data.role)}`;
    case 'member_removed': return `${who(str(data.user_id))} saiu do projeto${Number(data.tasks_handled) > 0 ? ` (${data.tasks_handled} tarefa(s) tratada(s))` : ''}`;
    case 'member_role_changed': return `${who(str(data.user_id))}: papel alterado de ${role(data.from)} para ${role(data.to)}`;
    case 'column_added': return `Etapa «${str(data.name)}» criada (${sem(data.semantic)})`;
    case 'column_renamed': return `Etapa «${str(data.from)}» renomeada para «${str(data.to)}»`;
    case 'column_deleted': return `Etapa «${str(data.name)}» excluída (${Number(data.moved_tasks) || 0} tarefa(s) realocada(s))`;
    case 'columns_reordered': return 'Ordem das etapas alterada';
    case 'label_deleted': return 'Etiqueta removida';
    case 'task_created': return `Tarefa criada em «${str(data.column)}»`;
    case 'task_updated': return `Tarefa atualizada (${Array.isArray(data.fields) ? (data.fields as string[]).map((f) => (f === 'title' ? 'título' : f === 'description' ? 'descrição' : f)).join(', ') : 'dados'})`;
    case 'priority_changed': return `Prioridade alterada de ${prio(data.from)} para ${prio(data.to)}`;
    case 'dates_changed': return `Datas alteradas: início ${dt(data.from_start)} → ${dt(data.to_start)}; vencimento ${dt(data.from_due)} → ${dt(data.to_due)}`;
    case 'assignee_changed': return data.to ? `Responsável: ${data.from ? who(str(data.from)) : 'ninguém'} → ${who(str(data.to))}` : `Responsável removido (era ${who(str(data.from))})`;
    case 'assignee_removed': return str(data.reason) === 'member_removed' || str(data.reason) === 'role_changed_to_viewer' ? 'Responsável removido porque a pessoa deixou de ter acesso' : 'Responsável removido';
    case 'task_moved': return `Movida de «${str(data.from)}» para «${str(data.to)}»`;
    case 'task_completed': return 'Tarefa concluída';
    case 'task_reopened': return `Tarefa reaberta (voltou para «${str(data.to)}»)`;
    case 'task_blocked': return `${data.update ? 'Impedimento atualizado' : 'Impedimento registrado'}: ${str(data.reason)}`;
    case 'task_unblocked': return 'Impedimento removido';
    case 'task_archived': return `Tarefa arquivada${str(data.reason) ? ` — ${str(data.reason)}` : ''}`;
    case 'labels_changed': return `Etiquetas atualizadas (${Number(data.count) || 0})`;
    case 'checklist_item_added': return `Item ${data.required ? 'obrigatório ' : ''}adicionado ao checklist`;
    case 'checklist_item_completed': return `Item ${data.required ? 'obrigatório ' : ''}do checklist concluído`;
    case 'checklist_item_reopened': return 'Item do checklist reaberto';
    case 'checklist_item_removed': return 'Item removido do checklist';
    case 'comment_added': return 'Comentário publicado';
    case 'attachment_added': return `${Number(data.count) || 1} arquivo(s) anexado(s)`;
    default: return type;
  }
}

export const NOTIFICATION_LABEL: Record<string, string> = {
  task_assigned: 'Tarefa atribuída a você', task_comment: 'Novo comentário', task_reopened: 'Tarefa reaberta', project_reopened: 'Projeto reaberto',
};
