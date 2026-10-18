'use client';

import { useId, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/client';
import { createLink, revokeLink } from '@/lib/os/actions/links';
import { answerChecklist } from '@/lib/os/actions/execution';
import type { ChecklistKind, NoteRule } from '@/lib/os/checklist';
import { ConflictNotice } from './fields';
import { useOsAction } from './use-os-action';

export type ChecklistFormItem = {
  id: string; kind: ChecklistKind; label: string; options: string[] | null; required: boolean; allowNa: boolean; requirePhoto: boolean; noteRule: NoteRule;
  answered: boolean; notApplicable: boolean; answerBool: boolean | null; answerText: string | null; answerNumber: string | null; answerOption: string | null; note: string | null; photoCount: number;
  answeredBy: string | null; answeredAt: string | null;
};

const noteHint: Record<NoteRule, string> = { never: '', on_negative: 'Justificativa obrigatória se a resposta for «não» ou «não se aplica».', always: 'Justificativa obrigatória neste item.' };

/** Resposta de um item do checklist: grande o bastante para o toque, com a regra do item explicada. Quem decide é o servidor. */
export function ChecklistItemForm({ orderId, item, editable }: { orderId: string; item: ChecklistFormItem; editable: boolean }) {
  const [state, formAction, ref] = useOsAction(answerChecklist, { reset: false });
  const id = useId();
  const [na, setNa] = useState(item.notApplicable);
  const err = (k: string) => state.fieldErrors?.[k]?.[0];
  return (
    <form ref={ref} action={formAction} className="rounded-lg border border-border bg-card p-3" key={`${item.id}:${item.answeredAt ?? 'novo'}`}>
      <input type="hidden" name="order" value={orderId} />
      <input type="hidden" name="item" value={item.id} />
      <fieldset disabled={!editable} className="grid gap-2">
        <legend className="text-sm font-medium leading-snug">
          {item.label}{item.required ? <span className="ml-1 text-danger" aria-label="obrigatório">*</span> : null}
          {item.requirePhoto ? <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs font-normal">exige foto{item.photoCount ? ` (${item.photoCount} enviada${item.photoCount > 1 ? 's' : ''})` : ' (pendente)'}</span> : null}
        </legend>
        {!na ? (
          <>
            {item.kind === 'boolean' ? (
              <div className="flex gap-3" role="radiogroup" aria-label={item.label}>
                {[['yes', 'Sim'], ['no', 'Não']].map(([v, l]) => (
                  <label key={v} className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                    <input type="radio" name="boolean" value={v} defaultChecked={item.answered && item.answerBool === (v === 'yes')} className="size-4" /> {l}
                  </label>
                ))}
              </div>
            ) : null}
            {item.kind === 'text' ? <textarea name="text" rows={2} maxLength={1000} defaultValue={item.answerText ?? ''} aria-label={item.label} className="min-h-11 w-full rounded-md border border-border bg-card px-3 py-2 text-sm" /> : null}
            {item.kind === 'number' ? <input name="number" inputMode="decimal" defaultValue={item.answerNumber ?? ''} aria-label={item.label} className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm" placeholder="Ex.: 12,5" /> : null}
            {item.kind === 'select' ? (
              <select name="option" defaultValue={item.answerOption ?? ''} aria-label={item.label} className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm">
                <option value="">Escolha…</option>
                {(item.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : null}
          </>
        ) : null}
        {item.allowNa ? (
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="not_applicable" checked={na} onChange={(e) => setNa(e.target.checked)} className="size-4" /> Não se aplica</label>
        ) : null}
        {item.noteRule !== 'never' || item.note ? (
          <div>
            <label htmlFor={`${id}-note`} className="text-xs text-muted">Justificativa {noteHint[item.noteRule] ? `— ${noteHint[item.noteRule]}` : '(opcional)'}</label>
            <input id={`${id}-note`} name="note" maxLength={500} defaultValue={item.note ?? ''} className="mt-1 min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm" />
          </div>
        ) : null}
        {err('number') ? <p className="text-xs text-danger" role="alert">{err('number')}</p> : null}
        {editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="secondary" pendingText="Salvando…">{item.answered ? 'Atualizar resposta' : 'Salvar resposta'}</SubmitButton>
            <FormMessage state={state} /><ConflictNotice state={state} />
            {item.answered && item.answeredAt ? <span className="text-xs text-muted">Respondido{item.answeredBy ? ` por ${item.answeredBy}` : ''}</span> : null}
          </div>
        ) : null}
      </fieldset>
    </form>
  );
}

/** Link de acompanhamento: o endereço completo aparece UMA vez, logo após gerar. Depois só se pode revogar ou gerar outro. */
export function LinkBox({ orderId, active, expiresLabel, lastUsedLabel }: { orderId: string; active: boolean; expiresLabel: string | null; lastUsedLabel: string | null }) {
  const [state, formAction] = useOsAction(createLink, { reset: false });
  const [rState, rAction] = useOsAction(revokeLink, { reset: false });
  const [copied, setCopied] = useState(false);
  const link = (state as { link?: string }).link;
  return (
    <div className="space-y-3">
      {active ? <p className="text-sm">Há um link ativo{expiresLabel ? <> (vale até <strong>{expiresLabel}</strong>)</> : null}{lastUsedLabel ? <>; último acesso em {lastUsedLabel}</> : null}. Por segurança o sistema guarda só um resumo irreversível do endereço: ele não pode ser exibido de novo.</p>
        : <p className="text-sm text-muted">Nenhum link ativo. Gere um para o cliente acompanhar, aprovar o orçamento e aceitar a conclusão.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="order" value={orderId} />
          <SubmitButton variant={active ? 'secondary' : 'primary'} pendingText="Gerando…">{active ? 'Gerar novo link (revoga o atual)' : 'Gerar link de acompanhamento'}</SubmitButton>
          <FormMessage state={state} />
        </form>
        {active ? (
          <form action={rAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="order" value={orderId} />
            <SubmitButton variant="danger" pendingText="Revogando…">Revogar link</SubmitButton>
            <FormMessage state={rState} />
          </form>
        ) : null}
      </div>
      {link ? (
        <div className="rounded-lg border border-success p-3" role="status">
          <label htmlFor="link-gerado" className="text-sm font-medium">Link para enviar ao cliente (copie agora)</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input id="link-gerado" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm" />
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => setCopied(false)); }} className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium">{copied ? 'Copiado' : 'Copiar'}</button>
          </div>
          <p className="mt-2 text-xs text-muted">Quem tiver este endereço vê o resumo, o orçamento publicado e as atualizações compartilhadas — e pode aprovar ou aceitar. Trate-o como uma senha: envie apenas ao cliente.</p>
        </div>
      ) : null}
    </div>
  );
}
