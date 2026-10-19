import Link from 'next/link';
import { TD, TH, TableShell, DateOnly, PriorityPill, StagePill } from './bits';
import { globalColumn, globalProject, type GlobalTask } from '@/lib/pj/data';
import { taskKey } from '@/lib/pj/page';
import { isOverdue } from '@/lib/pj/status';

type Props = { rows: GlobalTask[]; prefix: string; today: string; names: Record<string, string>; showProject?: boolean; emptyText?: string };

const who = (names: Record<string, string>, id: string | null) => (id ? names[id] ?? 'Pessoa' : 'Sem responsável');

/** Tabela no desktop e cartões no celular (mesmos dados; só um deles aparece por vez). Atraso, bloqueio e arquivamento aparecem em TEXTO. */
export function TaskTable({ rows, prefix, today, names, showProject = true, emptyText }: Props) {
  const flags = (t: GlobalTask) => {
    const proj = globalProject(t);
    const col = globalColumn(t);
    const late = !!proj && !!col && isOverdue({ dueDate: t.due_date, archived: t.archived_at !== null, semantic: col.semantic_status }, { status: proj.status, archived: proj.archived_at !== null }, today);
    return { late, proj, col };
  };
  return (
    <>
      <div className="hidden md:block">
        <TableShell caption="Tarefas" empty={rows.length === 0} emptyText={emptyText ?? 'Nenhuma tarefa encontrada com estes filtros.'}>
          <thead><tr className="border-b border-border">
            <th className={TH} scope="col">Tarefa</th><th className={TH} scope="col">Título</th>{showProject ? <th className={TH} scope="col">Projeto</th> : null}<th className={TH} scope="col">Etapa</th>
            <th className={TH} scope="col">Prioridade</th><th className={TH} scope="col">Responsável</th><th className={TH} scope="col">Vencimento</th>
          </tr></thead>
          <tbody>
            {rows.map((t) => {
              const { late, proj, col } = flags(t);
              return (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <td className={TD}><Link href={`/tarefas/${t.id}`} className="font-medium underline underline-offset-2">{proj ? taskKey(prefix, proj.project_number, t.task_number) : `#${t.task_number}`}</Link></td>
                  <td className={TD}>{t.title}{t.blocked_at ? <span className="ml-2 text-xs text-danger">Bloqueada</span> : null}{t.archived_at ? <span className="ml-2 text-xs text-muted">Arquivada</span> : null}</td>
                  {showProject ? <td className={TD}>{proj ? <Link href={`/projetos/${t.project_id}`} className="underline underline-offset-2">{proj.name}</Link> : '—'}</td> : null}
                  <td className={TD}>{col ? <StagePill name={col.name} semantic={col.semantic_status} /> : '—'}</td>
                  <td className={TD}><PriorityPill priority={t.priority} /></td>
                  <td className={TD}>{who(names, t.assignee_user_id)}</td>
                  <td className={TD}><DateOnly value={t.due_date} />{late ? <span className="ml-2 text-xs text-danger">Atrasada</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </div>
      <ul className="grid gap-2 md:hidden" aria-label="Tarefas">
        {rows.length === 0 ? <li className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">{emptyText ?? 'Nenhuma tarefa encontrada com estes filtros.'}</li> : null}
        {rows.map((t) => {
          const { late, proj, col } = flags(t);
          return (
            <li key={t.id} className="rounded-lg border border-border bg-card p-3 text-sm">
              <p className="text-xs text-muted">{proj ? taskKey(prefix, proj.project_number, t.task_number) : `#${t.task_number}`}{showProject && proj ? ` · ${proj.name}` : ''}</p>
              <Link href={`/tarefas/${t.id}`} className="mt-0.5 block font-medium underline underline-offset-2">{t.title}</Link>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">{col ? <StagePill name={col.name} semantic={col.semantic_status} /> : null}<PriorityPill priority={t.priority} />
                {t.blocked_at ? <span className="text-xs text-danger">Bloqueada</span> : null}{late ? <span className="text-xs text-danger">Atrasada</span> : null}{t.archived_at ? <span className="text-xs text-muted">Arquivada</span> : null}</div>
              <p className="mt-2 text-xs text-muted">{who(names, t.assignee_user_id)} · Vence <DateOnly value={t.due_date} /></p>
            </li>
          );
        })}
      </ul>
    </>
  );
}
