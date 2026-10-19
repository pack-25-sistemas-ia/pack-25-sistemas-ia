import type { Metadata } from 'next';
import Link from 'next/link';
import { DateTimeLocal, Pagination } from '@/components/pj/bits';
import { ProjectShell } from '@/components/pj/project-shell';
import { loadActivity, loadProject, nameOf } from '@/lib/pj/data';
import { pageCtx, taskKey } from '@/lib/pj/page';
import { describeEvent } from '@/lib/pj/present';
import { pageFrom, one, type SearchParams } from '@/lib/pj/query';

export const metadata: Metadata = { title: 'Atividade do projeto' };

export default async function ActivityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await pageCtx();
  const view = await loadProject(c, id);
  const page = pageFrom(one(sp.page));
  const { events, taskTitles, total } = await loadActivity(c, id, page);
  const who = (uid: string | null | undefined) => nameOf(view.people, uid);
  return (
    <ProjectShell c={c} view={view} current="atividade">
      <p className="mb-3 text-sm text-muted">Histórico imutável do projeto e de suas tarefas (mais recentes primeiro). Comentários não são copiados para cá.</p>
      {events.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Sem atividade registrada.</p> : (
        <ol className="space-y-3">
          {events.map((e) => {
            const t = e.task_id ? taskTitles.get(e.task_id) : undefined;
            return (
              <li key={`${e.scope}-${e.id}`} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <p>
                  {t && e.task_id ? <><Link className="font-medium underline underline-offset-2" href={`/tarefas/${e.task_id}`}>{taskKey(c.settings.project_prefix, view.project.project_number, t.task_number)} {t.title}</Link>: </> : null}
                  {describeEvent(e.event_type, e.data, (uid) => who(uid))}
                </p>
                <p className="mt-1 text-xs text-muted">{e.actor_kind === 'system' ? 'Sistema' : who(e.actor_user_id)} · <DateTimeLocal value={e.created_at} tz={c.tz} /></p>
              </li>
            );
          })}
        </ol>
      )}
      <Pagination base={`/projetos/${id}/atividade`} sp={sp} page={page} total={total} size={40} />
    </ProjectShell>
  );
}
