// Texto humano do histórico e das notificações. Eventos e notificações guardam só ids/tipos/datas (nunca o texto livre do contrato); aqui viram frases.
import { formatBRL } from './money';
import { BILLING_LABEL, isBillingBasis } from './money';
import { LIFECYCLE_LABEL, isLifecycle } from './status';
import { formatDateBR } from './time';

type Names = (id: string | null | undefined) => string;
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const dt = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateBR(v) : 'sem data');
const money = (v: unknown): string => (typeof v === 'number' || typeof v === 'string' ? formatBRL(BigInt(v)) : 'sem valor');
const life = (v: unknown): string => (isLifecycle(v) ? LIFECYCLE_LABEL[v] : str(v));

const FIELD_LABEL: Record<string, string> = { title: 'título', description: 'descrição', category: 'categoria', renewal_mode: 'modo de renovação', term: 'vigência' };

export function describeEvent(type: string, data: Record<string, unknown>, who: Names): string {
  switch (type) {
    case 'contract_created': return `Contrato registrado (nº ${str(data.contract_number) || '—'})`;
    case 'contract_updated': {
      const f = Array.isArray(data.fields) ? data.fields.map((x) => FIELD_LABEL[str(x)] ?? str(x)).join(', ') : '';
      return f ? `Dados atualizados: ${f}` : 'Dados atualizados';
    }
    case 'notice_changed': return data.days === null || data.days === undefined ? 'Prazo de aviso removido' : `Prazo de aviso: ${str(data.days)} dias${data.adjusted ? ' (ajustado manualmente)' : ''}`;
    case 'responsible_changed': return `Responsável: ${data.from ? who(str(data.from)) : 'ninguém'} → ${data.to ? who(str(data.to)) : 'ninguém'}`;
    case 'responsible_removed': return 'Responsável removido (a pessoa saiu da empresa ou virou leitora)';
    case 'access_granted': return `Acesso concedido a ${who(str(data.user_id))} (${data.role === 'editor' ? 'editor' : 'leitor'})`;
    case 'access_changed': return `Acesso de ${who(str(data.user_id))}: ${data.from === 'editor' ? 'editor' : 'leitor'} → ${data.to === 'editor' ? 'editor' : 'leitor'}`;
    case 'access_removed': return `Acesso de ${who(str(data.user_id))} removido`;
    case 'party_added': return 'Parte adicionada ao contrato';
    case 'party_removed': return 'Parte removida do contrato';
    case 'contract_activated': return 'Contrato ativado (registro administrativo)';
    case 'contract_terminated': return `Contrato rescindido em ${dt(data.ended_on)}`;
    case 'contract_closed': return 'Contrato encerrado administrativamente';
    case 'contract_reopened': return `Contrato reaberto (estava ${life(data.from).toLowerCase()})`;
    case 'contract_archived': return 'Contrato arquivado';
    case 'contract_unarchived': return 'Contrato desarquivado';
    case 'document_added': return 'Documento adicionado';
    case 'document_version_added': return `Nova versão do documento (v${str(data.version_number)})`;
    case 'document_current_changed': return 'Versão atual do documento alterada';
    case 'amendment_registered': return data.value_changed ? 'Aditivo registrado, com novo valor' : 'Aditivo registrado';
    case 'correction_registered': return data.value_changed ? 'Correção registrada, com novo valor' : 'Correção registrada';
    case 'contract_renewed': return data.indefinite ? 'Contrato renovado por prazo indeterminado' : 'Contrato renovado (nova data de fim)';
    case 'value_set': return `Valor inicial cadastrado (${isBillingBasis(data.basis) ? BILLING_LABEL[data.basis].toLowerCase() : '—'})`;
    case 'adjustment_rule_set': return `Regra de reajuste: a cada ${str(data.frequency_months)} meses, próximo em ${dt(data.next)}`;
    case 'adjustment_applied': return `Reajuste aplicado: ${money(data.from)} → ${money(data.to)}`;
    case 'obligation_created': return `Obrigação criada para ${dt(data.due_date)}`;
    case 'obligation_updated': return `Obrigação atualizada (${dt(data.due_date)})`;
    case 'obligation_completed': return 'Obrigação concluída';
    case 'obligation_cancelled': return 'Obrigação cancelada';
    default: return type;
  }
}

export const NOTIFICATION_LABEL: Record<string, string> = {
  reminder_contract_end: 'Fim de vigência se aproxima',
  reminder_notice: 'Prazo de aviso se aproxima',
  reminder_adjustment: 'Reajuste previsto se aproxima',
  reminder_obligation: 'Obrigação com prazo se aproximando',
  contract_assigned: 'Você foi definido(a) como responsável por um contrato',
  obligation_assigned: 'Uma obrigação foi atribuída a você',
};

export const CHANGE_LABEL: Record<string, string> = { amendment: 'Aditivo', renewal: 'Renovação', correction: 'Correção', termination: 'Rescisão' };
export const DOC_TYPE_LABEL: Record<string, string> = { main: 'Contrato principal', amendment: 'Aditivo', attachment: 'Anexo', proof: 'Comprovante', other: 'Outros' };
export const OBLIGATION_STATUS_LABEL: Record<string, string> = { pending: 'Pendente', completed: 'Concluída', cancelled: 'Cancelada' };
export const ADJUSTMENT_STATUS_LABEL: Record<string, string> = { proposed: 'Simulação em aberto', applied: 'Aplicado', cancelled: 'Cancelado' };
