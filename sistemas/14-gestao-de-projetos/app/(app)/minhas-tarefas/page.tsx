import type { Metadata } from 'next';
import { EmptyState, PageHeader } from '@/components/ui/primitives';
import { Section } from '@/components/pj/bits';
import { TaskTable } from '@/components/pj/task-table';
import { loadMyOpenTasks, plus7 } from '@/lib/pj/data';
import { pageCtx } from '@/lib/pj/page';
import { BUCKETS, BUCKET_LABEL, dueBucket, type DueBucket } from '@/lib/pj/status';

export const metadata: Metadata = { title: 'Minhas tarefas' };

// Lista por data (sem calendário visual): atrasadas, hoje, próximos sete dias, depois e sem prazo. Só tarefas de projetos autorizados: ao remover o acesso, a tarefa some daqui.
export default async function MyTasksPage() {
  const c = await pageCtx(['owner', 'manager', 'collaborator']);
  const rows = await loadMyOpenTasks(c);
  const limit = plus7(c.today);
  const groups = new Map<DueBucket, typeof rows>(BUCKETS.map((b) => [b, []]));
  for (const t of rows) groups.get(dueBucket(t.due_date, c.today, limit))!.push(t);
  return (
    <>
      <PageHeader title="Minhas tarefas" description="Tarefas abertas atribuídas a você, por data de vencimento (no fuso da empresa). Vencer hoje ainda não é atraso." />
      {rows.length === 0 ? <EmptyState title="Você não tem tarefas abertas." description="Quando alguém atribuir uma tarefa a você, ela aparece aqui e você recebe uma notificação." /> : null}
      {BUCKETS.map((b) => {
        const list = groups.get(b)!;
        if (list.length === 0) return null;
        return (
          <Section key={b} title={`${BUCKET_LABEL[b]} (${list.length})`}>
            <TaskTable rows={list} prefix={c.settings.project_prefix} today={c.today} names={{ [c.userId]: 'Você' }} />
          </Section>
        );
      })}
    </>
  );
}
