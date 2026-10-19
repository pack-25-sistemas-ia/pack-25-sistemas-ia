import type { Metadata } from 'next';
import { AreaF, ActionButton, PjForm, SelectF, TextF } from '@/components/pj/fields';
import { Disclosure, Section, TD, TH, TableShell, LabelChip } from '@/components/pj/bits';
import { ProjectShell } from '@/components/pj/project-shell';
import {
  addColumn, archiveProject, deleteColumn, deleteLabel, moveColumn, renameColumn, saveLabel, setProjectStatus, updateProject,
} from '@/lib/pj/actions/projects';
import { loadProject } from '@/lib/pj/data';
import { pageCtx } from '@/lib/pj/page';
import { PROJECT_STATUS_LABEL, SEMANTIC_LABEL, SEMANTICS, canArchive, canLeadRole, nextProjectStatuses, projectAllows, statusNeedsReason } from '@/lib/pj/status';

export const metadata: Metadata = { title: 'Configurações do projeto' };

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await pageCtx();
  const view = await loadProject(c, id);
  const p = view.project;
  const lead = canLeadRole(view.role);
  const state = { status: p.status, archived: p.archived_at !== null };
  const writable = lead && projectAllows(state, 'organize');
  const next = nextProjectStatuses(p.status);
  if (!lead) {
    return (
      <ProjectShell c={c} view={view} current="configuracoes">
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Somente a liderança do projeto (líder, gestor ou proprietário) altera as configurações. Você pode consultar as etapas e etiquetas abaixo.</p>
        <Section title="Etapas do quadro"><ul className="list-disc pl-5 text-sm">{view.columns.map((x) => <li key={x.id}>{x.name} — {SEMANTIC_LABEL[x.semantic_status]}</li>)}</ul></Section>
        <Section title="Etiquetas"><div className="flex flex-wrap gap-2">{view.labels.length ? view.labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />) : <span className="text-sm text-muted">Nenhuma etiqueta.</span>}</div></Section>
      </ProjectShell>
    );
  }
  return (
    <ProjectShell c={c} view={view} current="configuracoes">
      {writable ? (
        <Section title="Dados do projeto">
          <PjForm action={updateProject} submit="Salvar dados" pending="Salvando…" reset={false} className="grid max-w-3xl gap-4 sm:grid-cols-4">
            <input type="hidden" name="project" value={p.id} /><input type="hidden" name="version" value={p.version} />
            <div className="sm:col-span-4"><TextF name="name" label="Nome do projeto" def={p.name} required max={120} /></div>
            <AreaF name="description" label="Descrição" def={p.description} max={4000} />
            <TextF name="start_date" label="Início" type="date" def={p.start_date} /><TextF name="due_date" label="Entrega" type="date" def={p.due_date} />
          </PjForm>
        </Section>
      ) : null}

      {!p.archived_at ? (
        <Section title="Status do projeto" description="Planejado prepara tarefas; ativo executa; pausado bloqueia movimentações de execução; concluído e cancelado são somente consulta. Concluir exige tratar as tarefas abertas (concluir ou arquivar). Reabrir e cancelar exigem motivo.">
          {next.length === 0 ? <p className="text-sm text-muted">Nenhuma mudança de status disponível.</p> : (
            <PjForm action={setProjectStatus} submit="Alterar status" pending="Alterando…" reset={false} className="grid max-w-3xl gap-4 sm:grid-cols-4">
              <input type="hidden" name="project" value={p.id} /><input type="hidden" name="version" value={p.version} />
              <SelectF name="status" label={`Novo status (atual: ${PROJECT_STATUS_LABEL[p.status]})`} required opts={next.map((s) => ({ value: s, label: `${PROJECT_STATUS_LABEL[s]}${statusNeedsReason(p.status, s) ? ' — exige motivo' : ''}` }))} span />
              <TextF name="reason" label="Motivo (obrigatório ao cancelar ou reabrir)" max={500} span />
            </PjForm>
          )}
        </Section>
      ) : null}

      {canArchive(state) || p.archived_at ? (
        <Section title="Arquivamento" description="Arquivar não apaga nada: o projeto sai das listas padrão e fica somente para consulta, com todo o histórico.">
          <PjForm action={archiveProject} submit={p.archived_at ? 'Desarquivar projeto' : 'Arquivar projeto'} variant={p.archived_at ? 'secondary' : 'danger'} pending="Salvando…" reset={false} className="grid max-w-3xl gap-4 sm:grid-cols-4">
            <input type="hidden" name="project" value={p.id} /><input type="hidden" name="version" value={p.version} /><input type="hidden" name="archive" value={p.archived_at ? '0' : '1'} />
            <TextF name="reason" label="Motivo (opcional)" max={500} span />
          </PjForm>
        </Section>
      ) : null}

      <Section title="Etapas do quadro" description="O status da tarefa é o TIPO da etapa onde ela está. É preciso manter ao menos uma etapa «A fazer» e uma «Concluído». Renomear não muda o tipo; etapa com tarefas só é excluída com realocação para etapa do mesmo tipo.">
        <TableShell caption="Etapas do quadro">
          <thead><tr className="border-b border-border"><th className={TH} scope="col">Etapa</th><th className={TH} scope="col">Tipo</th>{writable ? <th className={TH} scope="col">Ações</th> : null}</tr></thead>
          <tbody>
            {view.columns.map((col, i) => {
              const same = view.columns.filter((x) => x.id !== col.id && x.semantic_status === col.semantic_status);
              return (
                <tr key={col.id} className="border-b border-border align-top last:border-0">
                  <td className={TD}>{col.name}</td><td className={TD}>{SEMANTIC_LABEL[col.semantic_status]}</td>
                  {writable ? (
                    <td className={TD}>
                      <div className="flex flex-wrap gap-2">
                        {i > 0 ? <ActionButton action={moveColumn} fields={{ project: p.id, board: String(p.board_version), column: col.id, dir: 'up' }} label="Subir" /> : null}
                        {i < view.columns.length - 1 ? <ActionButton action={moveColumn} fields={{ project: p.id, board: String(p.board_version), column: col.id, dir: 'down' }} label="Descer" /> : null}
                      </div>
                      <div className="mt-2"><Disclosure summary="Renomear">
                        <PjForm action={renameColumn} submit="Renomear" pending="Salvando…" reset={false} className="grid gap-3">
                          <input type="hidden" name="project" value={p.id} /><input type="hidden" name="column" value={col.id} /><TextF name="name" label="Novo nome" def={col.name} required max={40} />
                        </PjForm>
                      </Disclosure></div>
                      <div className="mt-2"><Disclosure summary="Excluir etapa" tone="danger">
                        <PjForm action={deleteColumn} submit="Excluir etapa" variant="danger" pending="Excluindo…" reset={false} className="grid gap-3">
                          <input type="hidden" name="project" value={p.id} /><input type="hidden" name="board" value={p.board_version} /><input type="hidden" name="column" value={col.id} />
                          <SelectF name="move_to" label="Se houver tarefas, mover para" placeholder="(etapa vazia: nenhuma)" opts={same.map((x) => ({ value: x.id, label: x.name }))} hint="Só etapas do mesmo tipo." />
                        </PjForm>
                      </Disclosure></div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
        {writable ? (
          <div className="mt-4"><PjForm action={addColumn} submit="Adicionar etapa" pending="Adicionando…" className="grid max-w-3xl gap-4 sm:grid-cols-4">
            <input type="hidden" name="project" value={p.id} /><input type="hidden" name="board" value={p.board_version} />
            <TextF name="name" label="Nome da nova etapa" required max={40} span />
            <SelectF name="semantic" label="Tipo (status funcional)" def="in_progress" opts={SEMANTICS.map((s) => ({ value: s, label: SEMANTIC_LABEL[s] }))} />
          </PjForm></div>
        ) : null}
      </Section>

      <Section title="Etiquetas" description="Marcadores do projeto (até 40). Cada etiqueta pertence a este projeto.">
        <div className="mb-3 flex flex-wrap gap-2">{view.labels.length ? view.labels.map((l) => <LabelChip key={l.id} name={l.name} color={l.color} />) : <span className="text-sm text-muted">Nenhuma etiqueta.</span>}</div>
        {writable ? (
          <>
            <PjForm action={saveLabel} submit="Criar etiqueta" pending="Salvando…" className="grid max-w-3xl gap-4 sm:grid-cols-4">
              <input type="hidden" name="project" value={p.id} />
              <TextF name="name" label="Nome da etiqueta" required max={30} span /><TextF name="color" label="Cor (#RRGGBB)" def="#2563eb" max={7} />
            </PjForm>
            {view.labels.length ? (
              <div className="mt-4 space-y-2">
                {view.labels.map((l) => (
                  <Disclosure key={l.id} summary={`Editar ou remover «${l.name}»`}>
                    <PjForm action={saveLabel} submit="Salvar etiqueta" pending="Salvando…" reset={false} className="grid gap-3 sm:grid-cols-4">
                      <input type="hidden" name="project" value={p.id} /><input type="hidden" name="label" value={l.id} />
                      <TextF name="name" label="Nome" def={l.name} required max={30} span /><TextF name="color" label="Cor (#RRGGBB)" def={l.color} max={7} />
                    </PjForm>
                    <div className="mt-3"><ActionButton action={deleteLabel} fields={{ project: p.id, label: l.id }} label="Remover etiqueta" variant="danger" confirm="Remover a etiqueta de todas as tarefas?" /></div>
                  </Disclosure>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </Section>
    </ProjectShell>
  );
}
