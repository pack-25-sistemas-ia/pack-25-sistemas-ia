// Checklist: espelho TS das regras que o banco aplica em os_answer_checklist e os_checklist_problems.
// A tela usa isto para orientar (campos obrigatórios, pendências); quem decide é SEMPRE o servidor — a contagem do navegador nunca vale.
export type ChecklistKind = 'boolean' | 'text' | 'number' | 'select';
export type NoteRule = 'never' | 'on_negative' | 'always';

export type ChecklistItem = {
  id: string; kind: ChecklistKind; label: string; options: string[] | null; required: boolean; allowNa: boolean; requirePhoto: boolean; noteRule: NoteRule;
  answered: boolean; notApplicable: boolean; answerBool: boolean | null; note: string | null; photoCount: number;
};

export type Answer = { boolean?: boolean; text?: string; number?: number; option?: string; notApplicable?: boolean; note?: string };

/** Valida uma resposta contra a definição do item (mesmas mensagens do banco). Devolve a mensagem de erro ou null. */
export function validateAnswer(item: Pick<ChecklistItem, 'kind' | 'options' | 'allowNa' | 'noteRule'>, a: Answer): string | null {
  const note = a.note?.trim() || null;
  if (note && note.length > 500) return 'A justificativa deve ter no máximo 500 caracteres.';
  if (a.notApplicable) {
    if (!item.allowNa) return 'Este item não admite «não se aplica».';
  } else {
    switch (item.kind) {
      case 'boolean': if (typeof a.boolean !== 'boolean') return 'Responda sim ou não.'; break;
      case 'text': { const t = a.text?.trim() ?? ''; if (t.length < 1 || t.length > 1000) return 'A resposta deve ter entre 1 e 1000 caracteres.'; break; }
      case 'number': if (typeof a.number !== 'number' || !Number.isFinite(a.number)) return 'Informe um número.'; if (Math.abs(a.number) >= 1_000_000_000) return 'Número fora do permitido.'; break;
      case 'select': if (!a.option || !(item.options ?? []).includes(a.option)) return 'Escolha uma das opções.'; break;
    }
  }
  if (item.noteRule === 'always' && !note) return 'Este item exige justificativa.';
  if (item.noteRule === 'on_negative' && (a.notApplicable || (item.kind === 'boolean' && a.boolean === false)) && !note) return 'Respostas negativas ou «não se aplica» exigem justificativa neste item.';
  return null;
}

/** Pendências que impedem a conclusão (a mesma lista que o banco devolve em os_checklist_problems). */
export function checklistProblems(items: readonly ChecklistItem[]): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (!i.answered) {
      if (i.required) out.push(`Item obrigatório sem resposta: ${i.label}`);
      continue;
    }
    if (i.notApplicable && !i.allowNa) { out.push(`Item não admite «não se aplica»: ${i.label}`); continue; }
    if (i.requirePhoto && !i.notApplicable && i.photoCount === 0) out.push(`Foto obrigatória pendente: ${i.label}`);
    if (i.noteRule === 'always' && !i.note) out.push(`Justificativa obrigatória: ${i.label}`);
    else if (i.noteRule === 'on_negative' && (i.notApplicable || i.answerBool === false) && !i.note) out.push(`Justificativa obrigatória para resposta negativa: ${i.label}`);
  }
  return out;
}

export function checklistProgress(items: readonly ChecklistItem[]): { total: number; answered: number; required: number; requiredAnswered: number } {
  return {
    total: items.length,
    answered: items.filter((i) => i.answered).length,
    required: items.filter((i) => i.required).length,
    requiredAnswered: items.filter((i) => i.required && i.answered).length,
  };
}

export const KIND_LABEL: Record<ChecklistKind, string> = { boolean: 'Sim / não', text: 'Texto', number: 'Número', select: 'Seleção' };
export const NOTE_RULE_LABEL: Record<NoteRule, string> = { never: 'Nunca', on_negative: 'Quando a resposta for «não» ou «não se aplica»', always: 'Sempre' };
