import type { ReactNode } from 'react';
import { DateTimeLocal, Section } from './bits';
import type { TabProps } from './tab-summary';
import { EVENT_LABEL } from '@/lib/os/status';

/** Linha do tempo auditável: eventos são imutáveis (nem a interface nem a API os alteram). Só ids e estados — nunca valores pessoais. */
export function HistoryTab({ c, d, me }: TabProps): ReactNode {
  const actor = (e: (typeof d.events)[number]) => (e.actor_kind === 'customer_link' ? 'Cliente (pelo link)' : e.actor_kind === 'system' ? 'Sistema' : e.actor_user_id ? (e.actor_user_id === me ? 'Você' : d.names[e.actor_user_id] ?? 'Equipe') : 'Equipe');
  const detail = (e: (typeof d.events)[number]): string => {
    const x = e.data;
    const bits: string[] = [];
    if (typeof x.version_number === 'number') bits.push(`versão ${x.version_number} do orçamento`);
    if (typeof x.completion_version === 'number') bits.push(`conclusão v${x.completion_version}`);
    if (x.channel === 'staff_manual') bits.push('registro manual da equipe');
    if (x.channel === 'customer_link') bits.push('pelo link do cliente');
    if (x.divergence === true) bits.push('com divergência de peças justificada');
    if (typeof x.status === 'string') bits.push(`status inicial: ${String(x.status)}`);
    if (x.reason === 'member_removed' || x.reason === 'technician_deactivated') bits.push('o responsável deixou de atuar na empresa');
    return bits.join(' · ');
  };
  return (
    <Section title="Histórico" description="Tudo o que aconteceu nesta ordem, do mais recente para o mais antigo.">
      {d.events.length === 0 ? <p className="text-sm text-muted">Sem eventos.</p> : (
        <ol className="relative grid gap-0 border-l border-border pl-5" aria-label="Linha do tempo">
          {d.events.map((e) => (
            <li key={e.id} className="relative pb-5">
              <span aria-hidden className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full border border-border bg-primary" />
              <p className="text-sm font-medium">{EVENT_LABEL[e.event_type] ?? e.event_type}</p>
              <p className="text-xs text-muted">{actor(e)} · <DateTimeLocal value={e.created_at} tz={c.tz} />{detail(e) ? ` · ${detail(e)}` : ''}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
