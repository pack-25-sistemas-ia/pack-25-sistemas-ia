/** «Checklist» do formulário de tarefa: uma linha por item; o prefixo «!» marca o item como OBRIGATÓRIO (impede concluir a tarefa enquanto pendente). Máximo de 50 itens de até 200 caracteres. */
export function parseChecklistLines(raw: string): Array<{ title: string; required: boolean }> {
  return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 50)
    .map((l) => (l.startsWith('!') ? { title: l.slice(1).trim().slice(0, 200), required: true } : { title: l.slice(0, 200), required: false }))
    .filter((i) => i.title.length > 0);
}
