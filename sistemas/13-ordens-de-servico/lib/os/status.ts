// Estados da ordem, perfis e ações. O banco repete as regras (gatilho order_guard + funções os_*); aqui só decidimos o que MOSTRAR.
export const STATUSES = ['draft', 'open', 'scheduled', 'in_progress', 'paused', 'completed', 'closed', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Profile = 'owner' | 'manager' | 'technician';
export const BACKLOG: readonly Status[] = ['open', 'scheduled', 'in_progress', 'paused'];
export const TERMINAL: readonly Status[] = ['closed', 'cancelled'];

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';
export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Rascunho', open: 'Aberta', scheduled: 'Agendada', in_progress: 'Em execução', paused: 'Pausada', completed: 'Concluída', closed: 'Encerrada', cancelled: 'Cancelada',
};
export const STATUS_TONE: Record<Status, Tone> = {
  draft: 'neutral', open: 'warning', scheduled: 'neutral', in_progress: 'success', paused: 'warning', completed: 'success', closed: 'neutral', cancelled: 'danger',
};
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
export const PRIORITY_TONE: Record<Priority, Tone> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };
export const PROFILE_LABEL: Record<Profile, string> = { owner: 'Proprietário', manager: 'Gestor', technician: 'Técnico' };
export const QUOTE_MODE_LABEL = { required: 'Exige orçamento aprovado', authorized: 'Execução autorizada sem orçamento' } as const;

export const CATEGORY_LABEL: Record<'before' | 'during' | 'after' | 'document', string> = { before: 'Antes', during: 'Durante', after: 'Depois', document: 'Documento' };
export const VISIBILITY_LABEL: Record<string, string> = { internal: 'Interno', customer: 'Compartilhado com o cliente' };
export const COST_CATEGORY_LABEL: Record<string, string> = { labor: 'Mão de obra', part: 'Peça', travel: 'Deslocamento', other: 'Outros' };

export const EVENT_LABEL: Record<string, string> = {
  opened: 'Ordem aberta', confirmed: 'Rascunho confirmado', updated: 'Dados da ordem alterados', snapshot_updated: 'Cliente/local/equipamento atualizados',
  assigned: 'Responsável atribuído', unassigned: 'Responsável removido', scheduled: 'Atendimento agendado', unscheduled: 'Agendamento desfeito',
  started: 'Execução iniciada', paused: 'Execução pausada', resumed: 'Execução retomada', completed: 'Serviço concluído', reopened: 'Reaberta para execução',
  reopened_after_close: 'Reaberta depois de encerrada', closed: 'Ordem encerrada', cancelled: 'Ordem cancelada',
  execution_authorized: 'Execução autorizada sem orçamento', execution_authorization_revoked: 'Autorização sem orçamento removida',
  quote_draft_created: 'Rascunho de orçamento criado', quote_published: 'Orçamento publicado', quote_approved: 'Orçamento aprovado', quote_rejected: 'Orçamento recusado',
  completion_accepted: 'Conclusão aceita', completion_contested: 'Conclusão contestada', checklist_applied: 'Modelo de checklist aplicado', checklist_answered: 'Item de checklist respondido',
  part_used: 'Peça utilizada', part_corrected: 'Uso de peça corrigido', cost_recorded: 'Custo interno registrado', note_added: 'Nota interna', update_shared: 'Atualização compartilhada com o cliente',
  files_added: 'Arquivos adicionados', file_shared: 'Arquivo compartilhado com o cliente', file_hidden: 'Arquivo ocultado do cliente', link_created: 'Link de acompanhamento gerado', link_revoked: 'Link de acompanhamento revogado',
};

export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
export const isPriority = (v: unknown): v is Priority => typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
export const isManager = (p: Profile | null): boolean => p === 'owner' || p === 'manager';

/** Transições aceitas pelo gatilho do banco. */
export function canTransition(from: Status, to: Status): boolean {
  switch (from) {
    case 'draft': return to === 'open' || to === 'cancelled';
    case 'open': return to === 'scheduled' || to === 'in_progress' || to === 'cancelled';
    case 'scheduled': return to === 'open' || to === 'in_progress' || to === 'cancelled';
    case 'in_progress': return to === 'paused' || to === 'completed' || to === 'cancelled';
    case 'paused': return to === 'in_progress' || to === 'cancelled';
    case 'completed': return to === 'closed' || to === 'in_progress';
    case 'closed': return to === 'in_progress';
    default: return false;
  }
}

export type Action = 'edit' | 'confirm' | 'assign' | 'schedule' | 'unschedule' | 'start' | 'pause' | 'resume' | 'complete' | 'reopen' | 'close' | 'cancel' | 'quote' | 'cost' | 'note' | 'files' | 'checklist' | 'parts' | 'link';

/** Ações oferecidas na tela (o banco recusa o resto). Estados terminais não têm ações livres. */
export function availableActions(p: { status: Status; profile: Profile; assignedToMe: boolean }): Action[] {
  const { status, profile, assignedToMe } = p;
  const mgr = isManager(profile);
  const exec = mgr || (profile === 'technician' && assignedToMe);
  const out: Action[] = [];
  if (status === 'cancelled') return out;
  if (status === 'closed') {
    if (profile === 'owner') out.push('reopen');
    if (mgr) out.push('link');
    return out;
  }
  if (mgr) {
    if (status === 'draft') out.push('confirm');
    if (status !== 'completed') out.push('edit', 'assign', 'quote', 'cost');
    if (status === 'open' || status === 'scheduled') out.push('schedule');
    if (status === 'scheduled') out.push('unschedule');
    out.push('link', 'cancel');
    if (status === 'completed') { out.push('reopen', 'close', 'cost'); }
  }
  if (exec) {
    if (status === 'open' || status === 'scheduled') out.push('start');
    if (status === 'in_progress') out.push('pause', 'complete');
    if (status === 'paused') out.push('resume');
    if (status === 'in_progress' || status === 'paused') out.push('checklist', 'parts');
  }
  out.push('note', 'files');
  return Array.from(new Set(out));
}

/** Atraso da PREVISÃO (não é SLA contratual): ordem do backlog cuja janela planejada já terminou. */
export function isLate(o: { status: Status; scheduledEndAt: string | null }, nowMs: number): boolean {
  return BACKLOG.includes(o.status) && !!o.scheduledEndAt && Date.parse(o.scheduledEndAt) < nowMs;
}

/** Concluída aguardando aceite: concluída sem aceite válido (accepted) da versão ATUAL da conclusão. */
export function awaitingAcceptance(o: { status: Status; completionVersion: number }, acceptances: ReadonlyArray<{ completionVersion: number; decision: string }>): boolean {
  return o.status === 'completed' && !acceptances.some((a) => a.completionVersion === o.completionVersion && a.decision === 'accepted');
}

/** Elegibilidade para o aceite/contestação do cliente: ordem concluída, versão corrente, sem resposta anterior. */
export function canCustomerDecide(o: { status: Status; completionVersion: number }, version: number, acceptances: ReadonlyArray<{ completionVersion: number }>): { ok: boolean; reason?: string } {
  if (o.status !== 'completed') return { ok: false, reason: 'Esta ordem não está aguardando o seu aceite.' };
  if (version !== o.completionVersion) return { ok: false, reason: 'Esta conclusão foi substituída por uma mais recente.' };
  if (acceptances.some((a) => a.completionVersion === version)) return { ok: false, reason: 'Esta conclusão já recebeu uma resposta.' };
  return { ok: true };
}

/** Encerramento exige o aceite (accepted) da versão CORRENTE; aceite de versão anterior não vale. */
export function canClose(o: { status: Status; completionVersion: number }, acceptances: ReadonlyArray<{ completionVersion: number; decision: string }>): { ok: boolean; reason?: string } {
  if (o.status !== 'completed') return { ok: false, reason: 'Só ordens concluídas podem ser encerradas.' };
  if (!acceptances.some((a) => a.completionVersion === o.completionVersion && a.decision === 'accepted')) {
    return { ok: false, reason: `O encerramento exige o aceite da conclusão atual (versão ${o.completionVersion}).` };
  }
  return { ok: true };
}

/** Estado do aceite final para exibição, separado do estado operacional. */
export function acceptanceState(o: { completionVersion: number }, acceptances: ReadonlyArray<{ completionVersion: number; decision: string }>): 'none' | 'pending' | 'accepted' | 'contested' {
  if (o.completionVersion === 0) return 'none';
  const a = acceptances.find((x) => x.completionVersion === o.completionVersion);
  if (!a) return 'pending';
  return a.decision === 'accepted' ? 'accepted' : 'contested';
}
