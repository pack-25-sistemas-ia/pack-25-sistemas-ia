import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState, PageHeader } from '@/components/ui/primitives';
import { DateOnly, DateTimeLocal, Pagination } from '@/components/ct/bits';
import { ActionButton } from '@/components/ct/fields';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/ct/actions/contracts';
import { loadNotifications, peopleNames } from '@/lib/ct/data';
import { contractKey } from '@/lib/ct/keys';
import { pageCtx } from '@/lib/ct/page';
import { NOTIFICATION_LABEL } from '@/lib/ct/present';
import { one, pageFrom, type SearchParams } from '@/lib/ct/query';

export const metadata: Metadata = { title: 'Notificações' };

// Notificações internas (não dependem de e-mail). Só aparecem enquanto você ainda enxerga o contrato; o texto vem do recurso ATUAL, nunca de uma cópia.
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const page = pageFrom(one(sp.page));
  const [n, names] = await Promise.all([loadNotifications(c, page), peopleNames(c)]);
  const unread = n.rows.filter((r) => !r.read_at).length;
  return (
    <>
      <PageHeader title="Notificações" description="Lembretes de fim de vigência, prazo de aviso, reajuste e obrigações, além de atribuições. Você nunca é avisado(a) de contratos que deixou de acessar.">
        {unread > 0 ? <ActionButton action={markAllNotificationsRead} fields={{}} label="Marcar todas como lidas" /> : null}
      </PageHeader>
      {n.rows.length === 0 ? <EmptyState title="Nenhuma notificação." description="Quando um prazo se aproximar ou algo for atribuído a você, aparece aqui." /> : (
        <ul className="grid gap-2" aria-label="Notificações">
          {n.rows.map((r) => {
            const k = n.contracts.get(r.contract_id);
            return (
              <li key={r.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 ${r.read_at ? 'border-border' : 'border-primary'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{NOTIFICATION_LABEL[r.kind] ?? r.kind} {!r.read_at ? <Badge tone="warning">Nova</Badge> : null}</p>
                  <p className="mt-0.5 text-sm"><Link href={`/contratos/${r.contract_id}?aba=prazos`} className="underline underline-offset-2">{k ? `${contractKey(c.settings.contract_prefix, k.contract_number)} · ${k.title}` : 'Contrato'}</Link>
                    {r.due_date ? <> — prazo em <DateOnly value={r.due_date} />{r.offset_days !== null ? ` (${r.offset_days === 0 ? 'no dia' : `${r.offset_days} dia(s) antes`})` : ''}</> : null}
                    {r.actor_user_id ? <> — por {names[r.actor_user_id] ?? 'uma pessoa'}</> : null}</p>
                  <p className="text-xs text-muted"><DateTimeLocal value={r.created_at} tz={c.tz} /></p>
                </div>
                {!r.read_at ? <ActionButton action={markNotificationRead} fields={{ id: r.id }} label="Marcar como lida" /> : null}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination base="/notificacoes" sp={sp} page={page} total={n.total} />
    </>
  );
}
