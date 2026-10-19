import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { ActionButton } from '@/components/pj/fields';
import { DateTimeLocal } from '@/components/pj/bits';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/pj/actions/tasks';
import { loadNotifications } from '@/lib/pj/data';
import { pageCtx, projectKey, taskKey } from '@/lib/pj/page';
import { NOTIFICATION_LABEL } from '@/lib/pj/present';

export const metadata: Metadata = { title: 'Notificações' };

// Notificações internas (não dependem de e-mail). Só aparecem enquanto você ainda enxerga o projeto; o texto vem do recurso ATUAL, nunca de uma cópia.
export default async function NotificationsPage() {
  const c = await pageCtx();
  const n = await loadNotifications(c);
  const unread = n.rows.filter((r) => !r.read_at).length;
  return (
    <>
      <PageHeader title="Notificações" description="Tarefa atribuída, novos comentários em tarefas suas e reaberturas. Você nunca é notificado das suas próprias ações.">
        {unread > 0 ? <ActionButton action={markAllNotificationsRead} fields={{}} label="Marcar todas como lidas" /> : null}
      </PageHeader>
      {n.rows.length === 0 ? <EmptyState title="Nenhuma notificação." description="Quando alguém atribuir uma tarefa a você ou comentar em uma tarefa sua, o aviso aparece aqui." /> : (
        <ul className="space-y-2">
          {n.rows.map((r) => {
            const t = r.task_id ? n.tasks.get(r.task_id) : undefined;
            const p = n.projects.get(r.project_id);
            const href = r.task_id ? `/tarefas/${r.task_id}` : `/projetos/${r.project_id}`;
            return (
              <li key={r.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${r.read_at ? 'border-border bg-card' : 'border-primary bg-card'}`}>
                <div>
                  <p><strong>{NOTIFICATION_LABEL[r.kind] ?? r.kind}</strong>{r.read_at ? null : <span className="ml-2 rounded-full bg-primary px-2 text-xs text-primary-foreground">Nova</span>}</p>
                  <p className="mt-0.5"><Link href={href} className="underline underline-offset-2">{t && p ? `${taskKey(c.settings.project_prefix, p.project_number, t.task_number)} · ${t.title}` : p ? `${projectKey(c.settings.project_prefix, p.project_number)} · ${p.name}` : 'Abrir'}</Link></p>
                  <p className="mt-0.5 text-xs text-muted">{r.actor_user_id ? n.names[r.actor_user_id] ?? 'Alguém' : 'Sistema'} · <DateTimeLocal value={r.created_at} tz={c.tz} /></p>
                </div>
                {!r.read_at ? <ActionButton action={markNotificationRead} fields={{ id: r.id }} label="Marcar como lida" /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
