import { AreaF, CellF, CellSelect, CheckF, OsForm, TextF } from './fields';
import { saveTemplate } from '@/lib/os/actions/registry';
import { KIND_LABEL, NOTE_RULE_LABEL } from '@/lib/os/checklist';

export type TemplateItem = { label: string; kind: 'boolean' | 'text' | 'number' | 'select'; options: string[] | null; required: boolean; allow_na: boolean; require_photo: boolean; note_rule: 'never' | 'on_negative' | 'always' };
type Props = { id?: string; name?: string; description?: string | null; active?: boolean; items: TemplateItem[]; extra?: number };

/** Editor do modelo: linhas fixas (funciona sem JavaScript). Linhas em branco são ignoradas. Ordens que já usaram o modelo guardam cópia e NÃO mudam. */
export function TemplateForm({ id, name, description, active = true, items, extra = 5 }: Props) {
  const rows = Math.min(100, items.length + extra);
  return (
    <OsForm action={saveTemplate} submit={id ? 'Salvar modelo' : 'Criar modelo'} reset={false} className="grid gap-4 sm:grid-cols-4">
      <>
        {id ? <input type="hidden" name="id" value={id} /> : null}
        <input type="hidden" name="rows" value={String(rows)} />
        <TextF name="name" label="Nome do modelo" def={name} required max={100} span />
        <CheckF name="active" label="Modelo ativo" def={active} />
        <AreaF name="description" label="Descrição (opcional)" def={description} max={300} />
        <div className="sm:col-span-4 grid gap-3">
          {Array.from({ length: rows }, (_, k) => {
            const n = k + 1; const it = items[k];
            return (
              <fieldset key={n} className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-6">
                <legend className="px-1 text-xs font-medium text-muted">Item {n}</legend>
                <div className="sm:col-span-3"><CellF name={`i${n}_label`} label={`Item ${n}: pergunta ou tarefa`} def={it?.label} max={200} placeholder="Ex.: O equipamento liga normalmente?" /></div>
                <div className="sm:col-span-1"><CellSelect name={`i${n}_kind`} label={`Item ${n}: tipo de resposta`} def={it?.kind ?? 'boolean'} opts={Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))} /></div>
                <div className="sm:col-span-2"><CellF name={`i${n}_options`} label={`Item ${n}: opções (só para seleção, separadas por ;)`} def={it?.options?.join('; ')} max={1200} placeholder="Opções: Boa; Regular; Ruim" /></div>
                <div className="sm:col-span-6 flex flex-wrap items-center gap-x-5 gap-y-1">
                  <CheckF name={`i${n}_required`} label="Obrigatório" def={it?.required} />
                  <CheckF name={`i${n}_allow_na`} label="Permite «não se aplica»" def={it?.allow_na} />
                  <CheckF name={`i${n}_require_photo`} label="Exige foto" def={it?.require_photo} />
                  <div className="min-w-60 flex-1"><CellSelect name={`i${n}_note_rule`} label={`Item ${n}: quando exigir justificativa`} def={it?.note_rule ?? 'never'} opts={Object.entries(NOTE_RULE_LABEL).map(([value, label]) => ({ value, label: `Justificativa: ${label}` }))} /></div>
                </div>
              </fieldset>
            );
          })}
        </div>
        <p className="sm:col-span-4 text-xs text-muted">Mais linhas aparecem depois de salvar. Tipos: «Sim / não», texto livre, número ou seleção entre opções.</p>
      </>
    </OsForm>
  );
}
