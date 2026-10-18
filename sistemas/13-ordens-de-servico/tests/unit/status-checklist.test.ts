import { describe, expect, it } from 'vitest';
import { checklistProblems, checklistProgress, validateAnswer, type ChecklistItem } from '@/lib/os/checklist';
import { formatDuration, countOrNoData } from '@/lib/os/indicators';
import { acceptanceState, availableActions, awaitingAcceptance, canClose, canCustomerDecide, canTransition, isLate, STATUSES, type Status } from '@/lib/os/status';

describe('máquina de estados', () => {
  const allowed: Array<[Status, Status]> = [
    ['draft', 'open'], ['draft', 'cancelled'], ['open', 'scheduled'], ['open', 'in_progress'], ['open', 'cancelled'], ['scheduled', 'open'], ['scheduled', 'in_progress'], ['scheduled', 'cancelled'],
    ['in_progress', 'paused'], ['in_progress', 'completed'], ['in_progress', 'cancelled'], ['paused', 'in_progress'], ['paused', 'cancelled'], ['completed', 'closed'], ['completed', 'in_progress'], ['closed', 'in_progress'],
  ];
  it('aceita exatamente as transições previstas (espelho do gatilho do banco)', () => {
    for (const a of STATUSES) for (const b of STATUSES) expect(canTransition(a, b), `${a} → ${b}`).toBe(allowed.some(([x, y]) => x === a && y === b));
  });
  it('cancelada é final; concluída só encerra ou reabre; encerrada só reabre', () => {
    expect(STATUSES.filter((s) => canTransition('cancelled', s))).toEqual([]);
    expect(STATUSES.filter((s) => canTransition('completed', s))).toEqual(['in_progress', 'closed']);
    expect(STATUSES.filter((s) => canTransition('closed', s))).toEqual(['in_progress']);
    expect(canTransition('open', 'completed')).toBe(false); // não pula a execução
    expect(canTransition('paused', 'completed')).toBe(false); // retomar antes de concluir
  });
});

describe('permissões por perfil (o que a tela oferece; o banco recusa o resto)', () => {
  it('técnico: só executa a ordem atribuída a ele, sem orçamento, atribuição, cancelamento ou encerramento', () => {
    const mine = availableActions({ status: 'in_progress', profile: 'technician', assignedToMe: true });
    expect(mine).toEqual(expect.arrayContaining(['pause', 'complete', 'checklist', 'parts', 'note', 'files']));
    for (const forbidden of ['quote', 'assign', 'cancel', 'close', 'cost', 'link', 'edit', 'reopen'] as const) expect(mine).not.toContain(forbidden);
    expect(availableActions({ status: 'open', profile: 'technician', assignedToMe: true })).toContain('start');
    expect(availableActions({ status: 'paused', profile: 'technician', assignedToMe: true })).toContain('resume');
    const others = availableActions({ status: 'in_progress', profile: 'technician', assignedToMe: false });
    for (const forbidden of ['pause', 'complete', 'checklist', 'parts', 'start'] as const) expect(others).not.toContain(forbidden);
  });
  it('gestor: gerencia, mas só o proprietário reabre ordem encerrada', () => {
    const m = availableActions({ status: 'open', profile: 'manager', assignedToMe: false });
    expect(m).toEqual(expect.arrayContaining(['edit', 'assign', 'schedule', 'quote', 'cost', 'link', 'cancel', 'start']));
    expect(availableActions({ status: 'closed', profile: 'manager', assignedToMe: false })).not.toContain('reopen');
    expect(availableActions({ status: 'closed', profile: 'owner', assignedToMe: false })).toContain('reopen');
    expect(availableActions({ status: 'completed', profile: 'manager', assignedToMe: false })).toEqual(expect.arrayContaining(['close', 'reopen']));
  });
  it('ordens canceladas e encerradas não têm edição livre', () => {
    expect(availableActions({ status: 'cancelled', profile: 'owner', assignedToMe: false })).toEqual([]);
    const closed = availableActions({ status: 'closed', profile: 'owner', assignedToMe: false });
    for (const forbidden of ['edit', 'assign', 'quote', 'note', 'files', 'parts', 'complete'] as const) expect(closed).not.toContain(forbidden);
  });
});

describe('aceite da conclusão (versão corrente)', () => {
  const accepted1 = [{ completionVersion: 1, decision: 'accepted' }];
  it('aguardando aceite = concluída sem aceite válido da versão atual', () => {
    expect(awaitingAcceptance({ status: 'completed', completionVersion: 1 }, [])).toBe(true);
    expect(awaitingAcceptance({ status: 'completed', completionVersion: 1 }, accepted1)).toBe(false);
    expect(awaitingAcceptance({ status: 'completed', completionVersion: 2 }, accepted1)).toBe(true); // aceite antigo não vale
    expect(awaitingAcceptance({ status: 'completed', completionVersion: 1 }, [{ completionVersion: 1, decision: 'contested' }])).toBe(true);
    expect(awaitingAcceptance({ status: 'in_progress', completionVersion: 1 }, [])).toBe(false);
  });
  it('o cliente só decide a versão corrente, uma vez, com a ordem concluída', () => {
    expect(canCustomerDecide({ status: 'completed', completionVersion: 2 }, 2, accepted1).ok).toBe(true);
    expect(canCustomerDecide({ status: 'completed', completionVersion: 2 }, 1, accepted1).reason).toMatch(/substituída/);
    expect(canCustomerDecide({ status: 'completed', completionVersion: 1 }, 1, accepted1).reason).toMatch(/já recebeu/);
    expect(canCustomerDecide({ status: 'closed', completionVersion: 1 }, 1, []).ok).toBe(false);
    expect(canCustomerDecide({ status: 'in_progress', completionVersion: 1 }, 1, []).ok).toBe(false);
  });
  it('encerrar exige aceite da conclusão corrente; aceite antigo não encerra a nova', () => {
    expect(canClose({ status: 'completed', completionVersion: 1 }, accepted1).ok).toBe(true);
    expect(canClose({ status: 'completed', completionVersion: 2 }, accepted1).reason).toMatch(/versão 2/);
    expect(canClose({ status: 'completed', completionVersion: 1 }, [{ completionVersion: 1, decision: 'contested' }]).ok).toBe(false);
    expect(canClose({ status: 'in_progress', completionVersion: 1 }, accepted1).ok).toBe(false);
  });
  it('estado do aceite é separado do estado operacional', () => {
    expect(acceptanceState({ completionVersion: 0 }, [])).toBe('none');
    expect(acceptanceState({ completionVersion: 1 }, [])).toBe('pending');
    expect(acceptanceState({ completionVersion: 1 }, accepted1)).toBe('accepted');
    expect(acceptanceState({ completionVersion: 2 }, accepted1)).toBe('pending');
    expect(acceptanceState({ completionVersion: 1 }, [{ completionVersion: 1, decision: 'contested' }])).toBe('contested');
  });
});

describe('indicadores', () => {
  it('atraso é da PREVISÃO: só backlog com janela encerrada', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(isLate({ status: 'scheduled', scheduledEndAt: '2026-10-17T11:00:00Z' }, now)).toBe(true);
    expect(isLate({ status: 'scheduled', scheduledEndAt: '2026-10-17T13:00:00Z' }, now)).toBe(false);
    expect(isLate({ status: 'completed', scheduledEndAt: '2026-10-10T11:00:00Z' }, now)).toBe(false);
    expect(isLate({ status: 'cancelled', scheduledEndAt: '2026-10-10T11:00:00Z' }, now)).toBe(false);
    expect(isLate({ status: 'open', scheduledEndAt: null }, now)).toBe(false);
  });
  it('durações em tempo corrido e «Sem dados» sem números fictícios', () => {
    expect(formatDuration(null)).toBe('Sem dados');
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(30)).toBe('menos de 1 min');
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe('3 h 20 min');
    expect(formatDuration(2 * 86400 + 4 * 3600)).toBe('2 d 4 h');
    expect(formatDuration(3 * 86400)).toBe('3 d');
    expect(countOrNoData(0, false)).toBe('Sem dados');
    expect(countOrNoData(0, true)).toBe('0');
  });
});

describe('checklist (espelho das regras do servidor)', () => {
  const base: ChecklistItem = { id: 'i', kind: 'boolean', label: 'Item', options: null, required: false, allowNa: false, requirePhoto: false, noteRule: 'never', answered: false, notApplicable: false, answerBool: null, note: null, photoCount: 0 };
  it('valida o tipo da resposta', () => {
    expect(validateAnswer(base, { boolean: true })).toBeNull();
    expect(validateAnswer(base, { text: 'sim' })).toMatch(/sim ou não/);
    expect(validateAnswer({ ...base, kind: 'number' }, { number: 12.5 })).toBeNull();
    expect(validateAnswer({ ...base, kind: 'number' }, { number: Number.NaN })).toMatch(/número/);
    expect(validateAnswer({ ...base, kind: 'text' }, { text: '   ' })).toMatch(/entre 1 e 1000/);
    expect(validateAnswer({ ...base, kind: 'select', options: ['Boa', 'Ruim'] }, { option: 'Boa' })).toBeNull();
    expect(validateAnswer({ ...base, kind: 'select', options: ['Boa', 'Ruim'] }, { option: 'Péssima' })).toMatch(/opções/);
  });
  it('«não se aplica» só quando o item permite; justificativa quando configurada', () => {
    expect(validateAnswer(base, { notApplicable: true })).toMatch(/não admite/);
    expect(validateAnswer({ ...base, allowNa: true }, { notApplicable: true })).toBeNull();
    expect(validateAnswer({ ...base, noteRule: 'on_negative' }, { boolean: false })).toMatch(/justificativa/);
    expect(validateAnswer({ ...base, noteRule: 'on_negative' }, { boolean: false, note: 'Queimado' })).toBeNull();
    expect(validateAnswer({ ...base, noteRule: 'on_negative' }, { boolean: true })).toBeNull();
    expect(validateAnswer({ ...base, noteRule: 'on_negative', allowNa: true }, { notApplicable: true })).toMatch(/justificativa/);
    expect(validateAnswer({ ...base, noteRule: 'always' }, { boolean: true })).toMatch(/exige justificativa/);
  });
  it('pendências que impedem a conclusão', () => {
    const items: ChecklistItem[] = [
      { ...base, id: '1', label: 'Obrigatório', required: true },
      { ...base, id: '2', label: 'Com foto', required: true, requirePhoto: true, answered: true, answerBool: true },
      { ...base, id: '3', label: 'Opcional sem resposta' },
      { ...base, id: '4', label: 'Negativo sem nota', answered: true, answerBool: false, noteRule: 'on_negative' },
      { ...base, id: '5', label: 'NA sem foto exigida', answered: true, notApplicable: true, allowNa: true, requirePhoto: true },
    ];
    expect(checklistProblems(items)).toEqual([
      'Item obrigatório sem resposta: Obrigatório',
      'Foto obrigatória pendente: Com foto',
      'Justificativa obrigatória para resposta negativa: Negativo sem nota',
    ]);
    expect(checklistProblems(items.map((i) => (i.id === '2' ? { ...i, photoCount: 1 } : i)).filter((i) => i.id === '2')).length).toBe(0);
    expect(checklistProgress(items)).toEqual({ total: 5, answered: 3, required: 2, requiredAnswered: 1 });
  });
});
