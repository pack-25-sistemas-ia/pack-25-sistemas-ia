import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/primitives';
import { ActionButton, AreaF, CheckF, FileF, PjForm, SelectF, TextF } from '@/components/pj/fields';
import { DateOnly, DateTimeLocal, DefinitionList, Disclosure, LabelChip, PriorityPill, ProjectStatusPill, Section, StagePill } from '@/components/pj/bits';
import { Markdown } from '@/components/pj/markdown';
import { assignableOptions } from '@/components/pj/task-forms';
import {
  addChecklistItem, addComment, archiveTask, assignTask, moveTask, removeChecklistItem, setBlocked, setTaskLabels, toggleChecklistItem, updateTask, uploadAttachments,
} from '@/lib/pj/actions/tasks';
import { loadTask, nameOf } from '@/lib/pj/data';
import { pageCtx, taskKey } from '@/lib/pj/page';
import { describeEvent } from '@/lib/pj/present';
import { PRIORITIES, PRIORITY_LABEL, SEMANTIC_LABEL, availableTaskActions, canLeadRole, checklistProgress, dateWarnings, isOverdue } from '@/lib/pj/status';

export const metadata: Metadata = { title: 'Tarefa' };

const fmtSize = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const c = await pageCtx();
  const d = await loadTask(c, taskId);
  const { task: t, project: view, column } = d;
  const p = view.project;
  const state = { status: p.status, archived: p.archived_at !== null };
  const sem = column?.semantic_status ?? 'todo';
  const actions = availableTaskActions({ role: view.role, project: state, taskArchived: t.archived_at !== null, taskDone: sem === 'done' });
  const can = (a: (typeof actions)[number]) => actions.includes(a);
  const who = (id: string | null | undefined) => nameOf(view.people, id);
  const key = taskKey(c.settings.project_prefix, p.project_number, t.task_number);
  const labels = view.labels.filter((l) => d.labelIds.includes(l.id));
  const progress = checklistProgress(d.checklist.map((i) => ({ required: i.required, done: !!i.completed_at })));
  const overdue = isOverdue({ dueDate: t.due_date, archived: t.archived_at !== null, semantic: sem }, state, c.today);
  const warns = dateWarnings({ startDate: p.start_date, dueDate: p.due_date }, t.start_date, t.due_date);
  const colOptions = view.columns.map((x) => ({ value: x.id, label: `${x.name} (${SEMANTIC_LABEL[x.semantic_status]})` }));
  return (
    <>
      <nav aria-label="Navegação estrutural" className="mb-2 text-sm text-muted"><Link href={`/projetos/${p.id}`} className="underline underline-offset-2">{p.name}</Link> / <span>{key}</span></nav>
      <PageHeader title={t.title}>
        <div className="flex flex-wrap items-center gap-2">
          {column ? <StagePill name={column.name} semantic={column.semantic_status} /> : null}<PriorityPill priority={t.priority} />
          {t.blocked_at ? <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">Bloqueada</span> : null}
          {overdue ? <span className="rounded-full border border-danger px-2 py-0.5 text-xs text-danger">Atrasada</span> : null}
          {t.archived_at ? <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">Arquivada</span> : null}
          <ProjectStatusPill status={p.status} archived={p.archived_at !== null} />
        </div>
      </PageHeader>
      {t.blocked_reason ? <p className="mb-4 rounded-md border border-danger px-3 py-2 text-sm text-danger" role="note"><strong>Impedimento:</strong> {t.blocked_reason}</p> : null}
      {actions.length === 0 ? <p className="mb-4 rounded-md border border-border px-3 py-2 text-sm text-muted" role="note">{t.archived_at ? 'Tarefa arquivada: somente para consulta.' : view.role === 'reader' || view.role === null ? 'Você tem acesso de consulta neste projeto.' : 'O projeto está somente para consulta (concluído, cancelado ou arquivado).'}</p> : null}
      {warns.length ? <p className="mb-4 rounded-md border border-warning px-3 py-2 text-sm text-warning" role="note">{warns.join(' ')}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Descrição">{t.description ? <p className="whitespace-pre-wrap break-words text-sm">{t.description}</p> : <p className="text-sm text-muted">Sem descrição.</p>}</Section>

          <Section title={`Checklist${progress.total ? ` (${progress.done}/${progress.total})` : ''}`} description="Itens obrigatórios (marcados) impedem a conclusão da tarefa enquanto estiverem pendentes.">
            {d.checklist.length === 0 ? <p className="text-sm text-muted">Nenhum item.</p> : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {d.checklist.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className={i.completed_at ? 'text-muted line-through' : ''}>{i.title}{i.required ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs no-underline">Obrigatório</span> : null}{i.completed_at ? <span className="ml-2 text-xs text-success no-underline">Concluído por {who(i.completed_by)}</span> : null}</span>
                    {can('checklist') ? (
                      <span className="flex flex-wrap gap-2">
                        <ActionButton action={toggleChecklistItem} fields={{ item: i.id, done: i.completed_at ? '0' : '1' }} label={i.completed_at ? 'Reabrir item' : 'Concluir item'} />
                        <ActionButton action={removeChecklistItem} fields={{ item: i.id }} label="Remover" variant="danger" confirm="Remover este item?" />
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {can('checklist') ? (
              <div className="mt-3"><PjForm action={addChecklistItem} submit="Adicionar item" pending="Adicionando…" className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="task" value={t.id} />
                <div className="sm:col-span-2"><TextF name="title" label="Novo item" max={200} /></div><CheckF name="required" label="Obrigatório" />
              </PjForm></div>
            ) : null}
          </Section>

          <Section title={`Comentários (${d.comments.length})`}>
            {d.comments.length === 0 ? <p className="text-sm text-muted">Nenhum comentário ainda.</p> : (
              <ul className="space-y-3">
                {d.comments.map((m) => (
                  <li key={m.id} className="rounded-lg border border-border bg-card p-3">
                    <p className="mb-1 text-xs text-muted"><strong className="text-foreground">{who(m.author_user_id)}</strong> · <DateTimeLocal value={m.created_at} tz={c.tz} /></p>
                    <Markdown text={m.body} />
                  </li>
                ))}
              </ul>
            )}
            {can('comment') ? (
              <div className="mt-3"><PjForm action={addComment} submit="Publicar comentário" pending="Publicando…" className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="task" value={t.id} />
                <AreaF name="body" label="Novo comentário" hint="Texto simples ou Markdown (negrito, itálico, listas, código e links). HTML não é interpretado." max={4000} />
              </PjForm></div>
            ) : null}
          </Section>

          <Section title={`Anexos (${d.attachments.length})`} description="Privados: só quem enxerga este projeto abre. Imagens, PDF, TXT e CSV (sem antivírus: use arquivos de fontes confiáveis).">
            {d.attachments.length === 0 ? <p className="text-sm text-muted">Nenhum anexo.</p> : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {d.attachments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>{a.original_filename} <span className="text-xs text-muted">({fmtSize(a.size_bytes)} · {who(a.uploaded_by)})</span></span>
                    <span className="flex gap-3"><Link className="underline underline-offset-2" href={`/api/arquivos/${a.id}`} target="_blank" rel="noopener">Abrir</Link><Link className="underline underline-offset-2" href={`/api/arquivos/${a.id}?download=1`}>Baixar</Link></span>
                  </li>
                ))}
              </ul>
            )}
            {can('attach') ? (
              <div className="mt-3"><PjForm action={uploadAttachments} submit="Enviar arquivos" pending="Enviando…" className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="task" value={t.id} />
                <FileF label="Arquivos (opcional)" hint={`Até 5 por vez; ${fmtSize(c.settings.attachment_max_size_bytes)} cada. Imagem (JPEG, PNG, WebP), PDF, TXT ou CSV.`} accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,text/csv,.txt,.csv" />
              </PjForm></div>
            ) : null}
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="Detalhes">
            <DefinitionList compact items={[
              ['Número', key], ['Etapa', column ? (column.name === SEMANTIC_LABEL[column.semantic_status] ? column.name : `${column.name} (${SEMANTIC_LABEL[column.semantic_status]})`) : '—'], ['Prioridade', PRIORITY_LABEL[t.priority]], ['Responsável', who(t.assignee_user_id)],
              ['Início', <DateOnly key="s" value={t.start_date} />], ['Vencimento', <DateOnly key="d" value={t.due_date} />], ['Criada por', who(t.created_by)],
              ['Criada em', <DateTimeLocal key="c" value={t.created_at} tz={c.tz} />], ['Concluída em', <DateTimeLocal key="x" value={t.completed_at} tz={c.tz} />],
            ]} />
            {labels.length ? <div className="mt-3 flex flex-wrap gap-1">{labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />)}</div> : null}
          </Section>

          {can('move') ? (
            <Disclosure summary="Mover para outra etapa">
              <PjForm action={moveTask} submit="Mover tarefa" pending="Movendo…" reset={false} className="grid gap-3">
                <input type="hidden" name="task" value={t.id} /><input type="hidden" name="board" value={p.board_version} />
                <SelectF name="column" label="Etapa de destino" def={t.column_id} opts={colOptions} />
                <SelectF name="where" label="Posição na etapa" def="end" opts={[{ value: 'end', label: 'No fim' }]} />
                <p className="text-xs text-muted">Concluir exige os itens obrigatórios do checklist feitos; mover para fora de «Concluído» reabre a tarefa e mantém o histórico.</p>
              </PjForm>
            </Disclosure>
          ) : null}
          {can('edit') ? (
            <Disclosure summary="Editar tarefa">
              <PjForm action={updateTask} submit="Salvar alterações" pending="Salvando…" reset={false} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="task" value={t.id} /><input type="hidden" name="version" value={t.version} />
                <div className="sm:col-span-2"><TextF name="title" label="Título" def={t.title} required max={200} /></div>
                <div className="sm:col-span-2"><AreaF name="description" label="Descrição" def={t.description} max={8000} /></div>
                <SelectF name="priority" label="Prioridade" def={t.priority} opts={PRIORITIES.map((x) => ({ value: x, label: PRIORITY_LABEL[x] }))} />
                <span />
                <TextF name="start_date" label="Início" type="date" def={t.start_date} /><TextF name="due_date" label="Vencimento" type="date" def={t.due_date} />
              </PjForm>
            </Disclosure>
          ) : null}
          {can('assign') ? (
            <Disclosure summary="Responsável">
              <PjForm action={assignTask} submit="Salvar responsável" pending="Salvando…" reset={false} className="grid gap-3">
                <input type="hidden" name="task" value={t.id} /><input type="hidden" name="version" value={t.version} />
                <SelectF name="assignee" label="Responsável (um por tarefa)" def={t.assignee_user_id} placeholder="Sem responsável" opts={assignableOptions(view)} hint="Só quem participa do projeto com permissão de edição." />
              </PjForm>
            </Disclosure>
          ) : null}
          {can('labels') && view.labels.length ? (
            <Disclosure summary="Etiquetas">
              <PjForm action={setTaskLabels} submit="Salvar etiquetas" pending="Salvando…" reset={false} className="grid gap-2">
                <input type="hidden" name="task" value={t.id} />
                {view.labels.map((l) => <label key={l.id} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="label_ids" value={l.id} defaultChecked={d.labelIds.includes(l.id)} className="size-4" /> {l.name}</label>)}
              </PjForm>
            </Disclosure>
          ) : null}
          {can('block') ? (
            <Disclosure summary={t.blocked_at ? 'Impedimento (ativo)' : 'Registrar impedimento'}>
              <PjForm action={setBlocked} submit={t.blocked_at ? 'Atualizar impedimento' : 'Registrar impedimento'} pending="Salvando…" reset={false} className="grid gap-3">
                <input type="hidden" name="task" value={t.id} /><input type="hidden" name="version" value={t.version} />
                <TextF name="reason" label="Motivo do impedimento" def={t.blocked_reason} max={500} hint="Não muda a etapa da tarefa." />
              </PjForm>
              {t.blocked_at ? <div className="mt-3"><PjForm action={setBlocked} submit="Remover impedimento" variant="secondary" pending="Removendo…" reset={false} className="grid gap-3"><input type="hidden" name="task" value={t.id} /><input type="hidden" name="version" value={t.version} /><input type="hidden" name="reason" value="" /></PjForm></div> : null}
            </Disclosure>
          ) : null}
          {can('archive') && canLeadRole(view.role) ? (
            <Disclosure summary="Arquivar tarefa" tone="danger">
              <PjForm action={archiveTask} submit="Arquivar" variant="danger" pending="Arquivando…" reset={false} className="grid gap-3">
                <input type="hidden" name="task" value={t.id} /><input type="hidden" name="version" value={t.version} />
                <TextF name="reason" label={sem === 'done' ? 'Motivo (opcional)' : 'Motivo (obrigatório para tarefa não concluída)'} max={500} hint="A tarefa deixa de contar nos indicadores; o histórico é preservado." />
              </PjForm>
            </Disclosure>
          ) : null}

          <Section title="Histórico">
            {d.events.length === 0 ? <p className="text-sm text-muted">Sem eventos.</p> : (
              <ol className="space-y-2 text-sm">
                {d.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-border pl-3">
                    <p>{describeEvent(e.event_type, e.data, (id) => who(id))}</p>
                    <p className="text-xs text-muted">{e.actor_kind === 'system' ? 'Sistema' : who(e.actor_user_id)} · <DateTimeLocal value={e.created_at} tz={c.tz} /></p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </aside>
      </div>
    </>
  );
}
