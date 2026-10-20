'use client';

import { FormMessage, SubmitButton } from '@/components/ui/client';
import { rotateJobToken } from '@/lib/ct/actions/jobs';
import { useCtAction } from './use-ct-action';

/** Gera (ou troca) o token do agendador. O texto aparece UMA vez, aqui; no banco fica só o hash. */
export function TokenForm({ endpoint }: { endpoint: string }) {
  const [state, formAction, ref] = useCtAction(rotateJobToken, { reset: false });
  const token = state.ok ? state.values?.token : undefined;
  return (
    <form ref={ref} action={formAction} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingText="Gerando…" variant="secondary">Gerar novo token</SubmitButton><FormMessage state={state} /></div>
      {token ? (
        <div className="rounded-lg border border-warning/40 bg-card p-3 text-sm" role="status">
          <p className="font-medium">Copie agora — não será mostrado de novo:</p>
          <code className="mt-1 block break-all rounded bg-black/5 p-2 text-xs dark:bg-white/10" data-testid="job-token">{token}</code>
          <p className="mt-2 text-xs text-muted">Exemplo: <code>curl -X POST -H &quot;Authorization: Bearer {'<token>'}&quot; {endpoint}</code></p>
        </div>
      ) : null}
    </form>
  );
}
