import type { ReactNode } from 'react';
import { ActionButton, AreaF, CheckF, OsForm, SelectF, TextF } from './fields';
import { Section, DateTimeLocal, DefinitionList, Disclosure } from './bits';
import { LinkBox } from './order-forms';
import { Card } from '@/components/ui/primitives';
import { assignOrder, cancelOrder, confirmDraft, reopenOrder, scheduleOrder, unscheduleOrder, updateOrder, updateSnapshot } from '@/lib/os/actions/orders';
import type { OrderDetail, Person } from '@/lib/os/data';
import type { PageCtx } from '@/lib/os/page';
import { PRIORITIES, PRIORITY_LABEL, QUOTE_MODE_LABEL, isManager, type Action } from '@/lib/os/status';
import { formatInstant, instantToLocal } from '@/lib/os/time';

export type TabProps = { c: PageCtx; d: OrderDetail; people: Person[]; actions: Action[]; me: string };

type CustomerBits = { addresses: Array<{ id: string; label: string; street: string; number: string | null; city: string; state: string }>; equipment: Array<{ id: string; kind: string; brand: string | null; model: string | null }>; contacts: Array<{ id: string; name: string; phone: string | null }> };

const addr = (a: Record<string, string> | null): string => (a ? `${a.street ?? ''}${a.number ? `, ${a.number}` : ''}${a.complement ? ` — ${a.complement}` : ''} · ${a.district ? `${a.district}, ` : ''}${a.city ?? ''}/${a.state ?? ''}${a.postal_code ? ` · CEP ${a.postal_code.replace(/(\d{5})(\d{3})/, '$1-$2')}` : ''}${a.reference ? ` (ref.: ${a.reference})` : ''}` : '—');

export function SummaryTab({ c, d, people, actions, me, customer }: TabProps & { customer: CustomerBits }): ReactNode {
  const o = d.order;
  const snap = d.snapshots[0];
  const mgr = isManager(c.profile);
  const v = String(o.version);
  const techs = people.filter((p) => p.active && p.profile);
  const win = o.scheduled_start_at && o.scheduled_end_at ? `${formatInstant(Date.parse(o.scheduled_start_at), c.tz)} até ${instantToLocal(Date.parse(o.scheduled_end_at), c.tz).time}` : null;
  const local = o.scheduled_start_at ? instantToLocal(Date.parse(o.scheduled_start_at), c.tz) : null;
  const endLocal = o.scheduled_end_at ? instantToLocal(Date.parse(o.scheduled_end_at), c.tz) : null;
  const can = (a: Action) => actions.includes(a);
  const eq = snap?.equipment ? [snap.equipment.kind, snap.equipment.brand, snap.equipment.model].filter(Boolean).join(' · ') + (snap.equipment.serial_number ? ` (série ${snap.equipment.serial_number})` : '') : null;

  return (
    <>
      <Section title="Atendimento">
        <Card>
          <DefinitionList items={[
            ['Solicitação', <span key="p" className="whitespace-pre-wrap">{o.problem_description}</span>],
            ['Responsável técnico', o.assigned_technician_user_id ? (o.assigned_technician_user_id === me ? 'Você' : d.names[o.assigned_technician_user_id] ?? 'Técnico') : 'Sem responsável'],
            ['Janela planejada', win ?? 'Não agendada'],
            ['Aberta em', <DateTimeLocal key="a" value={o.created_at} tz={c.tz} />],
            ['Execução iniciada', o.started_at ? <DateTimeLocal key="s" value={o.started_at} tz={c.tz} /> : '—'],
            ['Concluída em', o.completed_at ? <DateTimeLocal key="c" value={o.completed_at} tz={c.tz} /> : '—'],
            ['Encerrada em', o.closed_at ? <DateTimeLocal key="e" value={o.closed_at} tz={c.tz} /> : '—'],
            ['Autorização da execução', QUOTE_MODE_LABEL[o.quote_mode]],
          ]} />
          {o.quote_mode === 'authorized' ? (
            <p className="mt-3 rounded-md border border-warning p-3 text-sm"><strong>Execução autorizada sem orçamento.</strong> Justificativa: {o.authorization_justification} — registrada por {o.authorized_by ? d.names[o.authorized_by] ?? 'gestão' : 'gestão'}{o.authorized_at ? <> em <DateTimeLocal value={o.authorized_at} tz={c.tz} /></> : null}.</p>
          ) : null}
          {o.cancel_reason ? <p className="mt-3 rounded-md border border-danger p-3 text-sm"><strong>Cancelada.</strong> Motivo: {o.cancel_reason}</p> : null}
        </Card>
      </Section>

      <Section title="Cliente, local e equipamento" description={snap ? `Dados guardados na abertura${d.snapshots.length > 1 ? ` e atualizados ${d.snapshots.length - 1} vez(es)` : ''}. Mudanças no cadastro do cliente não alteram esta ordem nem documentos já aprovados.` : undefined}>
        <Card>
          <DefinitionList items={[
            ['Cliente', snap?.customer_name],
            ['Telefone', snap?.customer_phone],
            ['E-mail', snap?.customer_email],
            ['Contato no local', snap?.contact_name ? `${snap.contact_name}${snap.contact_phone ? ` — ${snap.contact_phone}` : ''}` : null],
            ['Endereço do atendimento', addr(snap?.address ?? null)],
            ['Equipamento', eq],
          ]} />
          {mgr && can('edit') ? (
            <div className="mt-4"><Disclosure summary="Atualizar cliente, local ou equipamento (cria nova versão dos dados)">
              <OsForm action={updateSnapshot} submit="Atualizar dados" reset={false} className="grid gap-4 sm:grid-cols-2">
                <>
                  <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                  <SelectF name="address_id" label="Local do atendimento" def={o.address_id ?? ''} placeholder="Sem endereço" opts={customer.addresses.map((a) => ({ value: a.id, label: `${a.label} — ${a.street}${a.number ? `, ${a.number}` : ''} · ${a.city}/${a.state}` }))} />
                  <SelectF name="equipment_id" label="Equipamento" def={o.equipment_id ?? ''} placeholder="Nenhum" opts={customer.equipment.map((e) => ({ value: e.id, label: [e.kind, e.brand, e.model].filter(Boolean).join(' · ') }))} />
                  <SelectF name="contact_id" label="Contato no local" placeholder="Nenhum" opts={customer.contacts.map((k) => ({ value: k.id, label: `${k.name}${k.phone ? ` — ${k.phone}` : ''}` }))} />
                  <TextF name="reason" label="Motivo da atualização" required max={300} hint="Fica registrado no histórico." />
                </>
              </OsForm>
            </Disclosure></div>
          ) : null}
        </Card>
      </Section>

      {mgr && (can('assign') || can('schedule')) ? (
        <Section title="Responsável e agenda" description="A agenda representa janelas planejadas; sobreposição do mesmo técnico gera um alerta, não um bloqueio.">
          <div className="grid gap-4 lg:grid-cols-2">
            {can('assign') ? (
              <Card title="Responsável técnico">
                <OsForm action={assignOrder} submit="Salvar responsável" reset={false} className="grid gap-4">
                  <>
                    <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                    <SelectF name="technician_id" label="Técnico" def={o.assigned_technician_user_id ?? ''} placeholder="Sem responsável" opts={techs.map((t) => ({ value: t.user_id, label: `${t.name}${t.profile === 'technician' ? '' : t.profile === 'manager' ? ' (gestor)' : ' (proprietário)'}` }))} />
                  </>
                </OsForm>
              </Card>
            ) : null}
            {can('schedule') ? (
              <Card title={o.execution_status === 'scheduled' ? 'Reagendar' : 'Agendar atendimento'} description="Exige técnico e janela válida (até 14 dias).">
                <OsForm action={scheduleOrder} submit="Agendar" reset={false} className="grid gap-4 sm:grid-cols-3">
                  <>
                    <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                    <div className="sm:col-span-3"><SelectF name="technician_id" label="Técnico" def={o.assigned_technician_user_id ?? ''} placeholder="Escolha" required opts={techs.map((t) => ({ value: t.user_id, label: t.name }))} /></div>
                    <TextF name="sched_date" label="Data" type="date" def={local?.date ?? ''} required />
                    <TextF name="sched_start" label="Início" type="time" def={local?.time ?? ''} required />
                    <TextF name="sched_end" label="Fim" type="time" def={endLocal?.time ?? ''} required />
                  </>
                </OsForm>
                {can('unschedule') ? <div className="mt-3"><ActionButton action={unscheduleOrder} fields={{ order: o.id, version: v }} label="Desfazer agendamento" confirm="Voltar a ordem para «Aberta», sem janela?" /></div> : null}
              </Card>
            ) : null}
          </div>
        </Section>
      ) : null}

      {mgr && can('edit') ? (
        <Section title="Editar dados da ordem">
          <Disclosure summary="Alterar assunto, descrição, prioridade ou autorização">
            <OsForm action={updateOrder} submit="Salvar alterações" reset={false}>
              <>
                <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                <TextF name="subject" label="Assunto" def={o.subject} required max={160} span />
                <SelectF name="priority" label="Prioridade" def={o.priority} opts={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
                <SelectF name="quote_mode" label="Autorização da execução" span def={o.quote_mode} opts={[{ value: 'required', label: 'Exige orçamento aprovado' }, { value: 'authorized', label: 'Executar sem orçamento (justificativa)' }]} />
                <AreaF name="problem_description" label="Descrição da solicitação" def={o.problem_description} max={4000} />
                <AreaF name="authorization_justification" label="Justificativa (execução sem orçamento)" def={o.authorization_justification} max={1000} />
              </>
            </OsForm>
          </Disclosure>
        </Section>
      ) : null}

      {mgr ? (
        <Section title="Link de acompanhamento do cliente" description="O cliente vê o resumo, o orçamento publicado, as atualizações e os arquivos que você compartilhar, e pode aprovar o orçamento e aceitar a conclusão. O aceite simples registra uma manifestação pelo link, sem verificação certificada de identidade.">
          <Card>
            {can('link') ? (
              <LinkBox orderId={o.id} active={!!d.link} expiresLabel={d.link ? formatInstant(Date.parse(d.link.expires_at), c.tz) : null} lastUsedLabel={d.link?.last_used_at ? formatInstant(Date.parse(d.link.last_used_at), c.tz) : null} />
            ) : <p className="text-sm text-muted">Esta ordem não gera link de acompanhamento.</p>}
          </Card>
        </Section>
      ) : null}

      {mgr && (can('confirm') || can('cancel') || can('reopen')) ? (
        <Section title="Outras ações da gestão">
          <div className="grid gap-3">
            {can('confirm') ? <ActionButton action={confirmDraft} fields={{ order: o.id, version: v }} label="Confirmar rascunho (abrir a ordem)" variant="primary" /> : null}
            {can('reopen') ? (
              <Disclosure summary={o.execution_status === 'closed' ? 'Reabrir ordem encerrada (só o proprietário; explícito e auditado)' : 'Reabrir para execução (ex.: o cliente contestou)'}>
                <OsForm action={reopenOrder} submit="Reabrir para execução" reset={false} className="grid gap-4 sm:grid-cols-2">
                  <>
                    <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                    <SelectF name="technician_id" label="Técnico (se a ordem estiver sem responsável)" placeholder="Manter o atual" opts={techs.map((t) => ({ value: t.user_id, label: t.name }))} />
                    <TextF name="reason" label="Motivo da reabertura" required max={500} hint="Mínimo de 10 caracteres. A próxima conclusão gera nova versão e novo pedido de aceite." />
                  </>
                </OsForm>
              </Disclosure>
            ) : null}
            {can('cancel') ? (
              <Disclosure summary="Cancelar ordem" tone="danger">
                <OsForm action={cancelOrder} submit="Cancelar ordem" variant="danger" reset={false} className="grid gap-4 sm:grid-cols-2">
                  <>
                    <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                    <TextF name="reason" label="Motivo do cancelamento" required max={500} span />
                    <CheckF name="ack" label="Entendo que o link de acompanhamento será revogado" />
                  </>
                </OsForm>
              </Disclosure>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}
