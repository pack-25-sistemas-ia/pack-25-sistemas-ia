import type { Metadata } from 'next';
import Link from 'next/link';
import { Board, type BoardColumn } from '@/components/pj/board';
import { FilterForm, FInput, FSelect } from '@/components/pj/bits';
import { ProjectShell } from '@/components/pj/project-shell';
import { NewTaskForm, assignableOptions } from '@/components/pj/task-forms';
import { boardFiltersFrom, hasBoardFilters, loadProject, loadProjectTasks, nameOf } from '@/lib/pj/data';
import { pageCtx, taskKey } from '@/lib/pj/page';
import { toCard } from '@/lib/pj/present';
import { PRIORITIES, PRIORITY_LABEL, canEditRole, projectAllows } from '@/lib/pj/status';
import type { SearchParams } from '@/lib/pj/query';

export const metadata: Metadata = { title: 'Quadro' };

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await pageCtx();
  const view = await loadProject(c, id);
  const f = boardFiltersFrom(sp);
  const { tasks, truncated } = await loadProjectTasks(c, id, f);
  const p = view.project;
  const state = { status: p.status, archived: p.archived_at !== null };
  const semanticOf = (cid: string) => view.columns.find((x) => x.id === cid)?.semantic_status ?? 'todo';
  const labels = new Map(view.labels.map((l) => [l.id, { name: l.name, color: l.color }]));
  const cards = tasks.map((t) => toCard({ ...t, checklist: t.checklist }, {
    key: (n) => taskKey(c.settings.project_prefix, p.project_number, n), semanticOf, labels, nameOf: (uid) => (uid ? nameOf(view.people, uid) : null), project: state, today: c.today,
  }));
  const columns: BoardColumn[] = view.columns.map((col) => ({ id: col.id, name: col.name, semantic: col.semantic_status, cards: cards.filter((_, i) => tasks[i]!.column_id === col.id) }));
  const canEdit = canEditRole(view.role) && projectAllows(state, 'organize');
  const execute = projectAllows(state, 'execute');
  const reason = p.status === 'paused' ? 'Projeto pausado: movimentações de execução ficam bloqueadas até retomar.' : p.status === 'planned' ? 'Projeto ainda não iniciado: ative o projeto para mover tarefas entre etapas de execução.' : null;
  return (
    <ProjectShell c={c} view={view} current="quadro">
      {canEdit ? <div className="mb-4"><NewTaskForm view={view} /></div> : null}
      <FilterForm clear={`/projetos/${id}`}>
        <FInput name="q" label="Buscar (número ou título)" sp={sp} />
        <FSelect name="assignee" label="Responsável" sp={sp} opts={[{ value: 'me', label: 'Eu' }, { value: 'none', label: 'Sem responsável' }, ...assignableOptions(view)]} />
        <FSelect name="priority" label="Prioridade" sp={sp} opts={PRIORITIES.map((x) => ({ value: x, label: PRIORITY_LABEL[x] }))} />
        <FSelect name="label" label="Etiqueta" sp={sp} opts={view.labels.map((l) => ({ value: l.id, label: l.name }))} />
        <FSelect name="late" label="Atraso" sp={sp} placeholder="Todas" opts={[{ value: '1', label: 'Só atrasadas' }]} />
        <FSelect name="blocked" label="Impedimento" sp={sp} placeholder="Todas" opts={[{ value: '1', label: 'Só bloqueadas' }]} />
      </FilterForm>
      {tasks.length === 0 && !hasBoardFilters(f) ? (
        <p className="mb-4 rounded-lg border border-dashed border-border px-4 py-4 text-center text-sm text-muted">Este projeto ainda não tem tarefas. {canEdit ? 'Use «Nova tarefa» acima para criar a primeira e distribuí-la à equipe.' : 'Quando houver tarefas, elas aparecem aqui, organizadas por etapa.'}</p>
      ) : null}
      <Board columns={columns} boardVersion={p.board_version} canEdit={canEditRole(view.role)} organize={projectAllows(state, 'organize')} execute={execute} readOnlyReason={reason} filtered={hasBoardFilters(f)} truncated={truncated} />
      <p className="mt-2 text-xs text-muted">Prefere uma tabela com filtros e paginação? <Link className="underline underline-offset-2" href={`/projetos/${id}/lista`}>Abrir a lista</Link>. Arrastar é opcional: cada cartão tem o menu «Mover…».</p>
    </ProjectShell>
  );
}
