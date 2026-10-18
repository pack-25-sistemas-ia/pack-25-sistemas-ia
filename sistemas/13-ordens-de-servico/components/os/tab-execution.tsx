import type { ReactNode } from 'react';
import { ActionButton, AreaF, FileF, OsForm, SelectF, TextF } from './fields';
import { DateTimeLocal, Disclosure, Section, TD, TH, TableShell } from './bits';
import { ChecklistItemForm, type ChecklistFormItem } from './order-forms';
import type { TabProps } from './tab-summary';
import { Alert, Badge, Card } from '@/components/ui/primitives';
import { addFiles, addPartUsage, applyTemplate, correctPartUsage } from '@/lib/os/actions/execution';
import { closeOrder, completeOrder, pauseOrder, resumeOrder, startOrder } from '@/lib/os/actions/orders';
import { decideCompletionManual } from '@/lib/os/actions/links';
import { checklistProblems } from '@/lib/os/checklist';
import { formatQuantity, milliFromNumeric } from '@/lib/os/money';
import { acceptanceState, isManager } from '@/lib/os/status';

type Props = TabProps & { parts: Array<{ id: string; code: string; name: string; unit: string }>; templates: Array<{ id: string; name: string }> };

const qty = (q: string | number) => formatQuantity(milliFromNumeric(q));
const KIND: Record<string, string> = { usage: 'Uso', reversal: 'Estorno', adjustment: 'Ajuste' };

export function ExecutionTab({ c, d, actions, parts, templates, me }: Props): ReactNode {
  const o = d.order;
  const v = String(o.version);
  const can = (a: (typeof actions)[number]) => actions.includes(a);
  const mgr = isManager(c.profile);
  const running = o.execution_status === 'in_progress' || o.execution_status === 'paused';
  const photoCount = (id: string) => d.attachments.filter((a) => a.checklist_item_id === id && a.content_type.startsWith('image/')).length;
  const items: ChecklistFormItem[] = d.checklist.map((i) => ({
    id: i.id, kind: i.kind, label: i.label, options: i.options, required: i.required, allowNa: i.allow_na, requirePhoto: i.require_photo, noteRule: i.note_rule, answered: !!i.answered_at, notApplicable: i.not_applicable,
    answerBool: i.answer_bool, answerText: i.answer_text, answerNumber: i.answer_number ? String(Number(i.answer_number)).replace('.', ',') : null, answerOption: i.answer_option, note: i.note, photoCount: photoCount(i.id),
    answeredBy: i.answered_by ? (i.answered_by === me ? 'você' : d.names[i.answered_by] ?? null) : null, answeredAt: i.answered_at,
  }));
  const problems = checklistProblems(items.map((i) => ({ ...i, id: i.id, answerBool: i.answerBool, note: i.note })));
  const serverProblems = d.ready.checklist_problems;
  const divergence = (d.ready.divergence ?? []).filter((x) => x.relevant);
  const groups = Array.from(new Set(items.length ? d.checklist.map((i) => i.group_name) : []));
  const usageBase = d.usage.filter((u) => u.entry_kind === 'usage');
  const net = (u: string) => d.usage.filter((x) => x.id === u || x.reference_usage_id === u).reduce((s, x) => s + Number(x.quantity), 0);
  const currentCompletion = d.completions[0];
  const acc = acceptanceState({ completionVersion: o.completion_version }, d.acceptances.map((a) => ({ completionVersion: a.completion_version, decision: a.decision })));

  return (
    <>
      <Section title="Execução" description="Início, pausa, retomada e conclusão. A conclusão congela o resumo, o checklist e as peças em uma versão; o aceite do cliente vale para essa versão.">
        <Card>
          {d.ready.exec_block && (can('start') || can('resume')) ? <div className="mb-3"><Alert tone="warning">{d.ready.exec_block}</Alert></div> : null}
          <div className="flex flex-wrap items-center gap-3">
            {can('start') ? <ActionButton action={startOrder} fields={{ order: o.id, version: v }} label="Iniciar execução" variant="primary" pending="Iniciando…" /> : null}
            {can('resume') ? <ActionButton action={resumeOrder} fields={{ order: o.id, version: v }} label="Retomar execução" variant="primary" pending="Retomando…" /> : null}
            {!can('start') && !can('resume') && !can('pause') && !can('complete') ? <p className="text-sm text-muted">Estado atual: nenhuma ação de execução disponível para o seu perfil nesta etapa.</p> : null}
          </div>
          {can('pause') ? (
            <div className="mt-4"><Disclosure summary="Pausar execução">
              <OsForm action={pauseOrder} submit="Pausar" reset className="grid gap-4 sm:grid-cols-2">
                <>
                  <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                  <TextF name="reason" label="Motivo da pausa" required max={300} span hint="Ex.: aguardando peça. A pausa registra início e fim; não vira cobrança automática." />
                </>
              </OsForm>
            </Disclosure></div>
          ) : null}
          {can('complete') ? (
            <div className="mt-4"><Disclosure summary="Concluir serviço" tone="primary" open={serverProblems.length === 0 && problems.length === 0 && divergence.length === 0}>
              {serverProblems.length || divergence.length ? (
                <div className="mb-4 space-y-3">
                  {serverProblems.length ? <Alert tone="warning"><p className="font-medium">O checklist ainda tem pendências:</p><ul className="ml-5 list-disc">{serverProblems.map((p) => <li key={p}>{p}</li>)}</ul></Alert> : null}
                  {divergence.length ? <Alert tone="warning"><p className="font-medium">Peças usadas acima do orçamento aprovado:</p><ul className="ml-5 list-disc">{divergence.map((x) => <li key={x.key}>{x.description}: orçado {qty(x.quoted_qty)} · usado {qty(x.used_qty)} {x.unit}</li>)}</ul><p className="mt-1">Justifique abaixo ou peça à gestão uma nova versão do orçamento.</p></Alert> : null}
                </div>
              ) : null}
              <OsForm action={completeOrder} submit="Concluir serviço" pending="Concluindo…" reset={false} className="grid gap-4">
                <>
                  <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                  <AreaF name="summary" label="Resumo do serviço executado" max={4000} hint="O que foi feito, em palavras claras. Aparece no relatório de conclusão do cliente." />
                  {divergence.length ? <AreaF name="divergence_note" label="Justificativa da divergência de peças" max={1000} hint="Obrigatória (mínimo 10 caracteres) quando há peça acima do orçamento aprovado." /> : null}
                </>
              </OsForm>
            </Disclosure></div>
          ) : null}
        </Card>
      </Section>

      <Section title="Checklist" description={items.length ? 'Itens com * são obrigatórios para concluir. A validação final é feita pelo servidor.' : 'Nenhum checklist aplicado a esta ordem.'}>
        {mgr && running === false && o.execution_status !== 'closed' && o.execution_status !== 'cancelled' && o.execution_status !== 'completed' && templates.length ? (
          <div className="mb-3"><Disclosure summary="Aplicar modelo de checklist">
            <OsForm action={applyTemplate} submit="Aplicar modelo" reset className="grid gap-4 sm:grid-cols-2">
              <><input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} /><SelectF name="template" label="Modelo" placeholder="Escolha" required opts={templates.map((t) => ({ value: t.id, label: t.name }))} hint="Os itens são COPIADOS: alterar o modelo depois não muda esta ordem." /></>
            </OsForm>
          </Disclosure></div>
        ) : null}
        {!running && items.length ? <p className="mb-3 text-sm text-muted">O checklist é respondido durante a execução (ordem em andamento).</p> : null}
        <div className="grid gap-5">
          {groups.map((g) => (
            <div key={g}>
              <h3 className="mb-2 text-sm font-semibold">{g}</h3>
              <div className="grid gap-3 lg:grid-cols-2">
                {d.checklist.filter((i) => i.group_name === g).map((row) => {
                  const it = items.find((x) => x.id === row.id)!;
                  return (
                    <div key={row.id} className="grid gap-2">
                      <ChecklistItemForm orderId={o.id} item={it} editable={running && can('checklist')} />
                      {running && can('checklist') && it.requirePhoto ? (
                        <Disclosure summary={`Anexar foto a este item${it.photoCount ? ` (${it.photoCount})` : ''}`}>
                          <OsForm action={addFiles} submit="Enviar foto" reset className="grid gap-3 sm:grid-cols-2" >
                            <>
                              <input type="hidden" name="order" value={o.id} /><input type="hidden" name="item" value={row.id} /><input type="hidden" name="category" value="during" />
                              <FileF name="file" label="Foto do item" hint="JPEG, PNG ou WebP. No celular, abre a câmera." accept="image/jpeg,image/png,image/webp" />
                            </>
                          </OsForm>
                        </Disclosure>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Peças utilizadas" description="Registro de USO (não é controle de estoque). Corrija por estorno ou ajuste: o registro original, o autor e a data são preservados.">
        <Card>
          <TableShell caption="Peças utilizadas" empty={d.usage.length === 0} emptyText="Nenhuma peça registrada nesta ordem.">
            <thead><tr><th className={TH}>Peça</th><th className={TH}>Tipo</th><th className={TH}>Quantidade</th><th className={TH}>Motivo</th><th className={TH}>Registrado por</th><th className={TH}>Quando</th></tr></thead>
            <tbody>
              {d.usage.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className={TD}>{u.description}</td>
                  <td className={TD}><Badge tone={u.entry_kind === 'usage' ? 'neutral' : 'warning'}>{KIND[u.entry_kind]}</Badge></td>
                  <td className={TD}>{qty(u.quantity)} {u.unit}{u.entry_kind === 'usage' ? <span className="ml-2 text-xs text-muted">(saldo {qty(net(u.id))})</span> : null}</td>
                  <td className={TD}>{u.reason ?? '—'}</td>
                  <td className={TD}>{u.registered_by ? (u.registered_by === me ? 'Você' : d.names[u.registered_by] ?? '—') : '—'}</td>
                  <td className={TD}><DateTimeLocal value={u.registered_at} tz={c.tz} /></td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          {d.ready.divergence && d.ready.divergence.length ? (
            <div className="mt-4">
              <p className="mb-1 text-sm font-medium">Orçado × utilizado (orçamento aprovado vigente)</p>
              <TableShell caption="Divergência de peças em relação ao orçamento aprovado">
                <thead><tr><th className={TH}>Peça</th><th className={TH}>Orçado</th><th className={TH}>Utilizado</th><th className={TH}>Diferença</th></tr></thead>
                <tbody>{d.ready.divergence.map((x) => <tr key={x.key} className="border-t border-border"><td className={TD}>{x.description}{x.relevant ? <> <Badge tone="warning">acima do orçado</Badge></> : null}</td><td className={TD}>{qty(x.quoted_qty)} {x.unit}</td><td className={TD}>{qty(x.used_qty)} {x.unit}</td><td className={TD}>{qty(x.delta)} {x.unit}</td></tr>)}</tbody>
              </TableShell>
              <p className="mt-2 text-xs text-muted">Mudar a quantidade utilizada NÃO altera o valor aprovado. Se houver cobrança adicional, a gestão cria uma nova versão do orçamento para aprovação do cliente.</p>
            </div>
          ) : null}
          {running && can('parts') ? (
            <div className="mt-4 grid gap-3">
              <Disclosure summary="Registrar peça utilizada" open={false}>
                <OsForm action={addPartUsage} submit="Registrar uso" reset className="grid gap-4 sm:grid-cols-4">
                  <>
                    <input type="hidden" name="order" value={o.id} />
                    <SelectF name="part_id" label="Peça do catálogo" span placeholder="Outra peça (descrever abaixo)" opts={parts.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} />
                    <TextF name="quantity" label="Quantidade" inputMode="decimal" required placeholder="1" />
                    <TextF name="description" label="Descrição (se não for do catálogo)" max={200} span />
                    <TextF name="unit" label="Unidade" max={16} placeholder="un" />
                  </>
                </OsForm>
              </Disclosure>
              {usageBase.length ? (
                <Disclosure summary="Corrigir um registro (estorno ou ajuste)">
                  <OsForm action={correctPartUsage} submit="Registrar correção" reset className="grid gap-4 sm:grid-cols-4">
                    <>
                      <input type="hidden" name="order" value={o.id} />
                      <SelectF name="usage" label="Registro a corrigir" span required placeholder="Escolha" opts={usageBase.map((u) => ({ value: u.id, label: `${u.description} — ${qty(u.quantity)} ${u.unit} (saldo ${qty(net(u.id))})` }))} />
                      <SelectF name="kind" label="Tipo" required def="reversal" opts={[{ value: 'reversal', label: 'Estorno (devolução)' }, { value: 'adjustment', label: 'Ajuste (+/−)' }]} />
                      <TextF name="quantity" label="Quantidade" inputMode="decimal" required hint="No ajuste, use «-» para reduzir." />
                      <TextF name="reason" label="Motivo" required max={300} span />
                    </>
                  </OsForm>
                </Disclosure>
              ) : null}
            </div>
          ) : null}
        </Card>
      </Section>

      {d.pauses.length ? (
        <Section title="Pausas">
          <TableShell caption="Pausas da execução">
            <thead><tr><th className={TH}>Início</th><th className={TH}>Fim</th><th className={TH}>Motivo</th></tr></thead>
            <tbody>{d.pauses.map((p) => <tr key={p.id} className="border-t border-border"><td className={TD}><DateTimeLocal value={p.started_at} tz={c.tz} /></td><td className={TD}>{p.ended_at ? <DateTimeLocal value={p.ended_at} tz={c.tz} /> : <Badge tone="warning">em andamento</Badge>}</td><td className={TD}>{p.reason}</td></tr>)}</tbody>
          </TableShell>
        </Section>
      ) : null}

      {d.completions.length ? (
        <Section title="Conclusões e aceite" description="Cada conclusão é uma versão congelada. O aceite do cliente vale só para a versão em que foi dado: aceite de versão anterior não encerra uma conclusão nova.">
          <div className="grid gap-3">
            {d.completions.map((cp) => {
              const a = d.acceptances.find((x) => x.completion_version === cp.completion_version);
              const current = cp.completion_version === o.completion_version;
              return (
                <Card key={cp.completion_version} title={`Conclusão — versão ${cp.completion_version}${current ? ' (atual)' : ''}`}>
                  <p className="whitespace-pre-wrap text-sm">{cp.summary}</p>
                  <p className="mt-2 text-xs text-muted">Concluída por {cp.completed_by ? (cp.completed_by === me ? 'você' : d.names[cp.completed_by] ?? 'técnico') : '—'} em <DateTimeLocal value={cp.completed_at} tz={c.tz} />.{cp.divergence_note ? <> Divergência de peças justificada: {cp.divergence_note}</> : null}</p>
                  {cp.parts_snapshot.length ? <p className="mt-1 text-xs text-muted">Peças: {cp.parts_snapshot.map((p) => `${p.description} (${qty(p.quantity)} ${p.unit})`).join('; ')}</p> : null}
                  <p className="mt-3 text-sm">
                    {a ? <><Badge tone={a.decision === 'accepted' ? 'success' : 'danger'}>{a.decision === 'accepted' ? 'Aceita' : 'Contestada'}</Badge> por <strong>{a.declared_name}</strong> em <DateTimeLocal value={a.decided_at} tz={c.tz} /> — {a.channel === 'customer_link' ? 'pelo link do cliente' : 'registro MANUAL da equipe (não é ação autenticada do cliente)'}{a.note ? <>. Observação: {a.note}</> : null}{a.justification ? <>. Justificativa da equipe: {a.justification}</> : null}</> : <Badge tone="warning">{current ? 'Aguardando aceite do cliente' : 'Sem resposta (versão substituída)'}</Badge>}
                  </p>
                </Card>
              );
            })}
          </div>
          {mgr && o.execution_status === 'completed' ? (
            <div className="mt-4 grid gap-3">
              {acc === 'accepted' ? <ActionButton action={closeOrder} fields={{ order: o.id, version: v }} label="Encerrar ordem" variant="primary" pending="Encerrando…" /> : (
                <>
                  <Alert tone="info">{acc === 'contested' ? 'O cliente contestou esta conclusão. Reabra a ordem para corrigir o serviço (aba «Resumo» → «Outras ações»).' : 'Para encerrar, é preciso o aceite do cliente pelo link de acompanhamento ou um registro manual da equipe.'}</Alert>
                  {acc === 'pending' ? (
                    <Disclosure summary="Registrar aceite/contestação manualmente (ex.: o cliente aceitou presencialmente)">
                      <OsForm action={decideCompletionManual} submit="Registrar" reset={false} className="grid gap-4 sm:grid-cols-2">
                        <>
                          <input type="hidden" name="order" value={o.id} /><input type="hidden" name="version" value={v} />
                          <SelectF name="decision" label="Resposta" required def="accepted" opts={[{ value: 'accepted', label: 'Aceitou a conclusão' }, { value: 'contested', label: 'Contestou a conclusão' }]} />
                          <TextF name="declared_name" label="Nome de quem respondeu" required max={120} />
                          <TextF name="justification" label="Justificativa do registro manual" required max={500} span hint="Como e quando o cliente respondeu (mín. 10 caracteres). Aparece como registro manual, não como ação do cliente." />
                          <TextF name="note" label="Observação do cliente (obrigatória ao contestar)" max={1000} span />
                        </>
                      </OsForm>
                    </Disclosure>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {currentCompletion ? null : null}
        </Section>
      ) : null}
    </>
  );
}
