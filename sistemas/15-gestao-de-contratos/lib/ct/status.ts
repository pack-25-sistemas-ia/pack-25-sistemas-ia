// Espelho em TypeScript das regras de papéis, ciclo de vida e situação temporal. O BANCO é a fonte da verdade (ct_contract_guard, ct_contract_role_of, funções ct_*):
// aqui só explicamos e escondemos ações; quem decide é o banco. Mudou uma regra? Mude as duas e os testes com os mesmos valores.
import { daysBetween } from './time';

// ----------------------------------------------------------------------------- perfis e papéis
export const PROFILES = ['owner', 'manager', 'collaborator', 'viewer'] as const;
export type OrgProfile = (typeof PROFILES)[number];
export const PROFILE_LABEL: Record<OrgProfile, string> = { owner: 'Proprietário', manager: 'Gestor', collaborator: 'Colaborador', viewer: 'Leitor' };

/** Papel dentro do contrato: gestão (proprietário/gestor em todos), editor ou leitor. */
export type ContractRole = 'manager' | 'editor' | 'reader';
export const ACCESS_ROLES = ['editor', 'reader'] as const;
export const CONTRACT_ROLE_LABEL: Record<ContractRole, string> = { manager: 'Gestão', editor: 'Editor', reader: 'Leitor' };

/** Papel efetivo: gestão em tudo; colaborador/leitor só com vínculo; o «Leitor» da empresa nunca passa de leitor. */
export function effectiveRole(profile: OrgProfile | null, access: 'editor' | 'reader' | null): ContractRole | null {
  if (profile === null) return null;
  if (profile === 'owner' || profile === 'manager') return 'manager';
  if (access === null) return null;
  return profile === 'viewer' ? 'reader' : access;
}
export const canEditRole = (r: ContractRole | null): boolean => r === 'manager' || r === 'editor';
export const canManageRole = (r: ContractRole | null): boolean => r === 'manager';
/** Quem pode ser responsável (contrato ou obrigação): gestão ou editor. Leitor nunca. */
export const isAssignable = (r: ContractRole | null): boolean => r === 'manager' || r === 'editor';
/** Papéis de acesso que a gestão pode dar a alguém: o «Leitor» da empresa só pode ser leitor. */
export function allowedAccessRoles(profile: OrgProfile): readonly ('editor' | 'reader')[] {
  if (profile === 'owner' || profile === 'manager') return [];
  return profile === 'viewer' ? ['reader'] : ['editor', 'reader'];
}

// ----------------------------------------------------------------------------- ciclo de vida
export const LIFECYCLES = ['draft', 'active', 'terminated', 'closed'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];
export const LIFECYCLE_LABEL: Record<Lifecycle, string> = { draft: 'Rascunho', active: 'Ativo', terminated: 'Rescindido', closed: 'Encerrado' };
export const LIFECYCLE_TONE: Record<Lifecycle, 'neutral' | 'success' | 'danger' | 'warning'> = { draft: 'neutral', active: 'success', terminated: 'danger', closed: 'warning' };
export const isLifecycle = (v: unknown): v is Lifecycle => typeof v === 'string' && (LIFECYCLES as readonly string[]).includes(v);

/** draft → active · active → terminated | closed · terminated | closed → active (reabertura, gestão, com justificativa). */
export function canTransition(from: Lifecycle, to: Lifecycle): boolean {
  switch (from) {
    case 'draft': return to === 'active';
    case 'active': return to === 'terminated' || to === 'closed';
    case 'terminated':
    case 'closed': return to === 'active';
  }
}
export const isFinalLifecycle = (l: Lifecycle): boolean => l === 'terminated' || l === 'closed';
/** Arquivar: só rescindido/encerrado e ainda não arquivado. */
export const canArchive = (c: { lifecycle: Lifecycle; archived: boolean }): boolean => !c.archived && isFinalLifecycle(c.lifecycle);
/** Aceita edição de dados: rascunho ou ativo e não arquivado. */
export const isOpenForEdit = (c: { lifecycle: Lifecycle; archived: boolean }): boolean => !c.archived && (c.lifecycle === 'draft' || c.lifecycle === 'active');

// ----------------------------------------------------------------------------- situação temporal (derivada, não depende de job)
export type Situation = 'upcoming' | 'current' | 'near_end' | 'ended' | 'indefinite';
export const SITUATION_LABEL: Record<Situation, string> = { upcoming: 'A iniciar', current: 'Vigente', near_end: 'Próximo do fim', ended: 'Fim de vigência atingido', indefinite: 'Prazo indeterminado' };
export const SITUATION_TONE: Record<Situation, 'neutral' | 'success' | 'warning' | 'danger'> = { upcoming: 'neutral', current: 'success', near_end: 'warning', ended: 'danger', indefinite: 'neutral' };

/** Datas inclusivas: o último dia da vigência ainda é «vigente». Passar do fim NÃO rescinde nem renova: só sinaliza. */
export function situationOf(c: { start: string; end: string | null; indefinite: boolean }, today: string, nearEndDays: number): Situation {
  if (today < c.start) return 'upcoming';
  if (c.indefinite || c.end === null) return 'indefinite';
  if (c.end < today) return 'ended';
  if (daysBetween(today, c.end) <= nearEndDays) return 'near_end';
  return 'current';
}

// ----------------------------------------------------------------------------- ações disponíveis (a interface só mostra o que o banco aceitaria)
export type ContractAction = 'edit' | 'notice' | 'document' | 'obligation' | 'party' | 'access' | 'responsible' | 'activate' | 'amend' | 'renew' | 'adjust' | 'terminate' | 'close' | 'reopen' | 'archive' | 'unarchive' | 'delete';
export function availableActions(p: { role: ContractRole | null; lifecycle: Lifecycle; archived: boolean }): ContractAction[] {
  const out: ContractAction[] = [];
  if (p.role === null) return out;
  const edit = canEditRole(p.role); const manage = canManageRole(p.role);
  if (edit && !p.archived) out.push('document', 'obligation');
  if (edit && isOpenForEdit(p)) out.push('edit', 'notice');
  if (manage) {
    if (!p.archived) out.push('access');
    if (isOpenForEdit(p)) out.push('party', 'responsible');
    if (p.lifecycle === 'draft' && !p.archived) out.push('activate', 'delete');
    if (p.lifecycle === 'active' && !p.archived) out.push('amend', 'renew', 'adjust', 'terminate', 'close');
    if (isFinalLifecycle(p.lifecycle) && !p.archived) out.push('reopen');
    if (canArchive(p)) out.push('archive');
    if (p.archived) out.push('unarchive');
  }
  return out;
}

// ----------------------------------------------------------------------------- prazos
export const DEADLINE_LABEL = { contract_end: 'Fim de vigência', notice: 'Prazo de aviso', adjustment: 'Reajuste previsto', obligation: 'Obrigação' } as const;
export type DeadlineKind = keyof typeof DEADLINE_LABEL;
export const DEADLINE_TONE: Record<DeadlineKind, 'danger' | 'warning' | 'neutral'> = { contract_end: 'danger', notice: 'warning', adjustment: 'neutral', obligation: 'neutral' };

/** Faixa de uma data em relação a hoje (inclusiva): atrasada, hoje, próximos 7 dias, até 30, até 90, depois. */
export type DueBucket = 'overdue' | 'today' | 'next7' | 'next30' | 'next90' | 'later';
export function dueBucket(due: string, today: string): DueBucket {
  const d = daysBetween(today, due);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'next7';
  if (d <= 30) return 'next30';
  if (d <= 90) return 'next90';
  return 'later';
}
export const DUE_BUCKET_LABEL: Record<DueBucket, string> = { overdue: 'Vencidos', today: 'Hoje', next7: 'Próximos 7 dias', next30: 'Até 30 dias', next90: 'Até 90 dias', later: 'Mais adiante' };
