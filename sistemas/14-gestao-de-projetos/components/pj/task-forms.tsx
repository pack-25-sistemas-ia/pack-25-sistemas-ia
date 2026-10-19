import { AreaF, PjForm, SelectF, TextF } from './fields';
import { Disclosure } from './bits';
import { createTask } from '@/lib/pj/actions/tasks';
import type { ProjectView } from '@/lib/pj/data';
import { PRIORITIES, PRIORITY_LABEL, SEMANTIC_LABEL } from '@/lib/pj/status';

/** Pessoas que podem receber a tarefa (acesso ao projeto + permissão de edição). */
export const assignableOptions = (view: ProjectView) => view.people.filter((p) => p.assignable).map((p) => ({ value: p.user_id, label: p.name }));

/** «Nova tarefa»: título, descrição, prioridade, responsável (opcional), datas, etapa, etiquetas e checklist (uma linha por item; «!» = obrigatório). */
export function NewTaskForm({ view, open = false, defaultColumn }: { view: ProjectView; open?: boolean; defaultColumn?: string }) {
  const cols = view.columns.filter((c) => c.semantic_status !== 'done');
  return (
    <Disclosure summary="Nova tarefa" open={open} tone="primary">
      <PjForm action={createTask} submit="Criar tarefa" pending="Criando…" className="grid gap-4 sm:grid-cols-4">
        <input type="hidden" name="project" value={view.project.id} />
        <div className="sm:col-span-4"><TextF name="title" label="Título" required max={200} /></div>
        <AreaF name="description" label="Descrição (opcional)" max={8000} />
        <SelectF name="priority" label="Prioridade" def="normal" opts={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <SelectF name="assignee" label="Responsável (opcional)" placeholder="Sem responsável" opts={assignableOptions(view)} />
        <SelectF name="column" label="Etapa" def={defaultColumn ?? cols[0]?.id} opts={cols.map((c) => ({ value: c.id, label: `${c.name} (${SEMANTIC_LABEL[c.semantic_status]})` }))} />
        <TextF name="start_date" label="Início (opcional)" type="date" />
        <TextF name="due_date" label="Vencimento (opcional)" type="date" />
        {view.labels.length ? (
          <fieldset className="sm:col-span-4"><legend className="mb-1 text-sm font-medium">Etiquetas</legend>
            <div className="flex flex-wrap gap-3">{view.labels.map((l) => <label key={l.id} className="inline-flex min-h-9 items-center gap-1.5 text-sm"><input type="checkbox" name="label_ids" value={l.id} className="size-4" /> {l.name}</label>)}</div>
          </fieldset>
        ) : null}
        <AreaF name="checklist" label="Checklist (opcional)" hint="Uma linha por item. Comece a linha com ! para tornar o item OBRIGATÓRIO (a tarefa só conclui com ele feito)." max={10000} />
      </PjForm>
    </Disclosure>
  );
}
