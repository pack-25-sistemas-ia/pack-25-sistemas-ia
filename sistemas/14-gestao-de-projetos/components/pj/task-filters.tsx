import { FilterForm, FInput, FSelect, type Opt } from './bits';
import type { SearchParams } from '@/lib/pj/query';
import { PRIORITIES, PRIORITY_LABEL, SEMANTICS, SEMANTIC_LABEL } from '@/lib/pj/status';

/** Filtros por URL (GET): projeto, etapa, responsável, prioridade, etiqueta, datas, atrasadas, bloqueadas, sem responsável e ordenação. Funcionam sem JavaScript. */
export function TaskFilters({ sp, clear, projects, people, labels, showProject = true }: { sp: SearchParams; clear: string; projects?: Opt[]; people: Opt[]; labels?: Opt[]; showProject?: boolean }) {
  return (
    <FilterForm clear={clear}>
      <FInput name="q" label="Buscar (número ou título)" sp={sp} />
      {showProject && projects ? <FSelect name="project" label="Projeto" sp={sp} opts={projects} /> : null}
      <FSelect name="stage" label="Etapa" sp={sp} opts={SEMANTICS.map((s) => ({ value: s, label: SEMANTIC_LABEL[s] }))} />
      <FSelect name="assignee" label="Responsável" sp={sp} opts={[{ value: 'me', label: 'Eu' }, { value: 'none', label: 'Sem responsável' }, ...people]} />
      <FSelect name="priority" label="Prioridade" sp={sp} opts={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
      {labels ? <FSelect name="label" label="Etiqueta" sp={sp} opts={labels} /> : null}
      <FInput name="from" label="Vence a partir de" sp={sp} type="date" />
      <FInput name="to" label="Vence até" sp={sp} type="date" />
      <FSelect name="late" label="Atraso" sp={sp} placeholder="Todas" opts={[{ value: '1', label: 'Só atrasadas' }]} />
      <FSelect name="blocked" label="Impedimento" sp={sp} placeholder="Todas" opts={[{ value: '1', label: 'Só bloqueadas' }]} />
      <FSelect name="archived" label="Arquivadas" sp={sp} placeholder="Ocultar" opts={[{ value: '1', label: 'Incluir' }]} />
      <FSelect name="sort" label="Ordenar por" sp={sp} placeholder="Vencimento" opts={[{ value: 'priority', label: 'Prioridade' }, { value: 'updated', label: 'Última atualização' }, { value: 'created', label: 'Criação' }]} />
    </FilterForm>
  );
}
