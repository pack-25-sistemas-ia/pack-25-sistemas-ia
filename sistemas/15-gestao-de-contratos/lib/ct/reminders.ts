// Espelho do processamento de lembretes (private.ct_process_reminders). O banco decide; isto explica o plano e é testado com os mesmos casos.
import { daysBetween } from './time';

export type ReminderPlan = { send: number | null; consolidate: number[] };

/**
 * Para UM evento e UM destinatário: dado hoje, a data devida, as antecedências configuradas, as já entregues (qualquer status) e a menor já ENVIADA,
 * decide qual antecedência notificar e quais viram «consolidadas» (alcançadas, mas superadas por uma mais recente).
 * Não notifica depois da data devida. Nunca envia uma antecedência maior do que uma já enviada.
 */
export function planReminders(p: { today: string; due: string; offsets: readonly number[]; delivered: readonly number[]; minSent: number | null }): ReminderPlan {
  if (daysBetween(p.today, p.due) < 0) return { send: null, consolidate: [] };
  const undelivered = p.offsets.filter((d) => daysBetween(p.today, p.due) <= d && !p.delivered.includes(d));
  if (undelivered.length === 0) return { send: null, consolidate: [] };
  const candidates = undelivered.filter((d) => p.minSent === null || d < p.minSent);
  const send = candidates.length ? Math.min(...candidates) : null;
  return { send, consolidate: undelivered.filter((d) => d !== send) };
}

/** Chave de deduplicação: tipo|origem|revisão|antecedência|destinatário. */
export const dedupeKey = (type: string, source: string, revision: number, offset: number, user: string): string => `${type}|${source}|${revision}|${offset}|${user}`;

export const REMINDER_KINDS = { contract_end: 'reminder_contract_end', notice: 'reminder_notice', adjustment: 'reminder_adjustment', obligation: 'reminder_obligation' } as const;
