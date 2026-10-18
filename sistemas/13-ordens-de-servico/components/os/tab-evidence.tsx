import type { ReactNode } from 'react';
import { ActionButton, AreaF, FileF, OsForm, SelectF } from './fields';
import { DateTimeLocal, Section } from './bits';
import type { TabProps } from './tab-summary';
import { Badge, Card } from '@/components/ui/primitives';
import { addFiles, addUpdate, setAttachmentVisibility } from '@/lib/os/actions/execution';
import { CATEGORY_LABEL, isManager } from '@/lib/os/status';

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function EvidenceTab({ c, d, actions, me }: TabProps): ReactNode {
  const o = d.order;
  const mgr = isManager(c.profile);
  const frozen = o.execution_status === 'closed' || o.execution_status === 'cancelled';
  const who = (id: string | null) => (id ? (id === me ? 'você' : d.names[id] ?? '—') : '—');
  const cats = ['before', 'during', 'after', 'document'] as const;
  const canAdd = actions.includes('files') && !frozen;
  const visOpts = mgr ? [{ value: 'internal', label: 'Interna (só a equipe)' }, { value: 'customer', label: 'Compartilhada com o cliente' }] : [{ value: 'internal', label: 'Interna (só a equipe)' }];

  return (
    <>
      <Section title="Fotos e documentos" description="Antes, durante e depois do serviço. Arquivos ficam em armazenamento privado; só a equipe com acesso à ordem os abre e só o que a gestão compartilha aparece para o cliente. Metadados das fotos (como localização) são removidos.">
        {canAdd ? (
          <Card title="Adicionar fotos ou documentos">
            <OsForm action={addFiles} submit="Enviar arquivos" pending="Enviando…" reset className="grid gap-4 sm:grid-cols-4">
              <>
                <input type="hidden" name="order" value={o.id} />
                <SelectF name="category" label="Categoria" required def="during" opts={cats.map((k) => ({ value: k, label: CATEGORY_LABEL[k] }))} hint="PDF só como «Documento»." />
                <SelectF name="visibility" label="Visibilidade" def="internal" opts={visOpts} span hint={mgr ? undefined : 'A gestão decide o que é compartilhado com o cliente.'} />
                <FileF />
              </>
            </OsForm>
          </Card>
        ) : null}
        {d.attachments.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum arquivo nesta ordem.</p> : (
          <div className="mt-5 grid gap-6">
            {cats.map((cat) => {
              const list = d.attachments.filter((a) => a.category === cat);
              if (!list.length) return null;
              return (
                <div key={cat}>
                  <h3 className="mb-2 text-sm font-semibold">{CATEGORY_LABEL[cat]}</h3>
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((a) => (
                      <li key={a.id} className="rounded-lg border border-border bg-card p-3">
                        {a.content_type.startsWith('image/') ? (
                          <a href={`/api/arquivos/${a.id}`} className="mb-2 block overflow-hidden rounded-md border border-border bg-black/5">
                            {/* <img> e não next/image: a CSP é estrita e o arquivo vem do mesmo domínio (rota autenticada) */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/arquivos/${a.id}`} alt={a.original_filename} loading="lazy" className="h-36 w-full object-cover" />
                          </a>
                        ) : null}
                        <p className="break-words text-sm font-medium"><a className="underline underline-offset-2" href={`/api/arquivos/${a.id}?download=1`}>{a.original_filename}</a></p>
                        <p className="mt-1 text-xs text-muted">{size(a.size_bytes)} · por {who(a.uploaded_by)} · <DateTimeLocal value={a.created_at} tz={c.tz} /></p>
                        <p className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={a.visibility === 'customer' ? 'warning' : 'neutral'}>{a.visibility === 'customer' ? 'Visível ao cliente' : 'Interno'}</Badge>
                          {mgr && !frozen ? <ActionButton action={setAttachmentVisibility} fields={{ order: o.id, attachment: a.id, visibility: a.visibility === 'customer' ? 'internal' : 'customer' }} label={a.visibility === 'customer' ? 'Ocultar do cliente' : 'Compartilhar com o cliente'} confirm={a.visibility === 'customer' ? undefined : 'O cliente poderá ver este arquivo pelo link. Compartilhar?'} /> : null}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Notas e atualizações" description="Notas internas ficam só com a equipe. Atualizações compartilhadas aparecem no link do cliente. Notas não podem ser editadas: registre uma nova para corrigir.">
        {!frozen && actions.includes('note') ? (
          <Card title="Nova nota ou atualização">
            <OsForm action={addUpdate} submit="Registrar" pending="Registrando…" reset className="grid gap-4 sm:grid-cols-4">
              <>
                <input type="hidden" name="order" value={o.id} />
                <SelectF name="visibility" label="Quem vê" required def="internal" span opts={[{ value: 'internal', label: 'Nota interna (só a equipe)' }, { value: 'customer', label: 'Atualização compartilhada com o cliente' }]} />
                <SelectF name="category" label="Categoria dos arquivos" def="during" opts={cats.map((k) => ({ value: k, label: CATEGORY_LABEL[k] }))} />
                <AreaF name="body" label="Texto" max={4000} />
                <FileF label="Fotos ou PDF (opcional)" />
              </>
            </OsForm>
          </Card>
        ) : null}
        <div className="mt-5 grid gap-3">
          {d.updates.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhuma nota registrada.</p> : d.updates.map((u) => (
            <article key={u.id} className={`rounded-lg border p-3 ${u.visibility === 'customer' ? 'border-warning' : 'border-border'} bg-card`}>
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted"><Badge tone={u.visibility === 'customer' ? 'warning' : 'neutral'}>{u.visibility === 'customer' ? 'Compartilhada com o cliente' : 'Nota interna'}</Badge>{who(u.author_user_id)} · <DateTimeLocal value={u.created_at} tz={c.tz} /></p>
              <p className="whitespace-pre-wrap text-sm">{u.body}</p>
              {d.attachments.filter((a) => a.update_id === u.id).length ? <p className="mt-2 text-xs text-muted">Arquivos: {d.attachments.filter((a) => a.update_id === u.id).map((a) => a.original_filename).join(', ')}</p> : null}
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
