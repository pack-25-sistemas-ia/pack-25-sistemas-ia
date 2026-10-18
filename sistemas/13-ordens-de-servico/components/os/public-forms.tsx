'use client';

import { useId, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { FormMessage } from '@/components/ui/client';
import { Button } from '@/components/ui/primitives';
import { publicCompletionDecide, publicQuoteDecide } from '@/lib/os/actions/public';
import { useOsAction } from './use-os-action';

/** Botão de envio que carrega a ESCOLHA (name/value vão no FormData) e se desliga enquanto envia (evita duplo clique). */
function Choice({ name, value, variant, pendingText, children }: { name: string; value: string; variant: 'primary' | 'secondary'; pendingText: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return <Button type="submit" name={name} value={value} variant={variant} disabled={pending} aria-busy={pending} className="min-h-12 px-5 text-base">{pending ? pendingText : children}</Button>;
}

const inputCls = 'mt-1 min-h-12 w-full rounded-md border border-border bg-card px-3 text-base';

/** Decisão do cliente sobre a versão VIGENTE do orçamento. O texto aceito é o que o banco montou e que aparece aqui; o servidor revalida versão, validade e token. */
export function PublicQuoteForm({ token, quoteId, textAccept, textReject }: { token: string; quoteId: string; textAccept: string; textReject: string }) {
  const [state, formAction, ref] = useOsAction(publicQuoteDecide, { reset: false });
  const id = useId();
  const err = (k: string) => state.fieldErrors?.[k]?.[0];
  return (
    <form ref={ref} action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="quote" value={quoteId} />
      <div>
        <label htmlFor={`${id}-name`} className="text-sm font-medium">Seu nome completo</label>
        <input id={`${id}-name`} name="name" autoComplete="name" maxLength={120} required className={inputCls} defaultValue={state.values?.name ?? ''} aria-invalid={err('name') ? true : undefined} />
        {err('name') ? <p className="mt-1 text-sm text-danger" role="alert">{err('name')}</p> : null}
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="text-sm font-medium">Observação (opcional)</label>
        <textarea id={`${id}-note`} name="note" rows={2} maxLength={1000} className={inputCls} defaultValue={state.values?.note ?? ''} />
      </div>
      <div className="rounded-md border border-border p-3 text-sm">
        <p className="font-medium">Ao aprovar, você declara:</p>
        <p className="mt-1 text-muted">{textAccept}</p>
        <p className="mt-2 font-medium">Ao recusar:</p>
        <p className="mt-1 text-muted">{textReject}</p>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="confirm" className="mt-1 size-5" /> Li o orçamento e entendo que esta resposta fica registrada com a data e a hora.</label>
      {err('confirm') ? <p className="text-sm text-danger" role="alert">{err('confirm')}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Choice name="decision" value="approved" variant="primary" pendingText="Enviando…">Aprovar orçamento</Choice>
        <Choice name="decision" value="rejected" variant="secondary" pendingText="Enviando…">Recusar orçamento</Choice>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

/** Aceite ou contestação da conclusão (versão corrente). Contestar exige dizer o que precisa ser revisto. */
export function PublicCompletionForm({ token, version, textAccept, textContest }: { token: string; version: number; textAccept: string; textContest: string }) {
  const [state, formAction, ref] = useOsAction(publicCompletionDecide, { reset: false });
  const id = useId();
  const err = (k: string) => state.fieldErrors?.[k]?.[0];
  return (
    <form ref={ref} action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="completion" value={String(version)} />
      <div>
        <label htmlFor={`${id}-name`} className="text-sm font-medium">Seu nome completo</label>
        <input id={`${id}-name`} name="name" autoComplete="name" maxLength={120} required className={inputCls} defaultValue={state.values?.name ?? ''} aria-invalid={err('name') ? true : undefined} />
        {err('name') ? <p className="mt-1 text-sm text-danger" role="alert">{err('name')}</p> : null}
      </div>
      <div>
        <label htmlFor={`${id}-note`} className="text-sm font-medium">Observação (obrigatória se for contestar)</label>
        <textarea id={`${id}-note`} name="note" rows={3} maxLength={1000} className={inputCls} defaultValue={state.values?.note ?? ''} aria-invalid={err('note') ? true : undefined} />
        {err('note') ? <p className="mt-1 text-sm text-danger" role="alert">{err('note')}</p> : null}
      </div>
      <div className="rounded-md border border-border p-3 text-sm">
        <p className="font-medium">Ao aceitar, você declara:</p><p className="mt-1 text-muted">{textAccept}</p>
        <p className="mt-2 font-medium">Ao contestar:</p><p className="mt-1 text-muted">{textContest}</p>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" name="confirm" className="mt-1 size-5" /> Entendo que esta resposta fica registrada com a data e a hora.</label>
      {err('confirm') ? <p className="text-sm text-danger" role="alert">{err('confirm')}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Choice name="decision" value="accepted" variant="primary" pendingText="Enviando…">Aceitar a conclusão</Choice>
        <Choice name="decision" value="contested" variant="secondary" pendingText="Enviando…">Contestar</Choice>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
