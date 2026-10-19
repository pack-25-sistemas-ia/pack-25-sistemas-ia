'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type DragEvent } from 'react';
import { moveTaskIntent } from '@/lib/pj/actions/tasks';
import { SEMANTIC_LABEL, type Priority, type Semantic } from '@/lib/pj/status';
import { formatDateBR } from '@/lib/pj/time';
import { cn } from '@/lib/utils';
import { Avatar, LabelChip, PriorityPill } from './bits';

export type BoardCard = {
  id: string; key: string; title: string; priority: Priority; dueDate: string | null; overdue: boolean; assignee: string | null; blockedReason: string | null;
  labels: Array<{ name: string; color: string }>; checklist: { done: number; total: number }; completed: boolean;
};
export type BoardColumn = { id: string; name: string; semantic: Semantic; cards: BoardCard[] };

type Props = {
  columns: BoardColumn[]; boardVersion: number; canEdit: boolean;
  /** «organize»: pode reordenar/mover dentro do mesmo tipo; «execute»: pode mudar de tipo de etapa. */
  organize: boolean; execute: boolean; readOnlyReason: string | null;
  /** Com filtros ativos a ordem NÃO é persistida: mover entre etapas insere ao final do destino. */
  filtered: boolean; truncated: boolean;
};

const signature = (cols: BoardColumn[]) => cols.map((c) => `${c.id}:${c.cards.map((x) => x.id).join('.')}`).join('|');

/**
 * Quadro Kanban. Arrastar é um atalho (desktop); TODA movimentação também existe como menu «Mover» com campos nativos (teclado, leitor de tela, celular).
 * O servidor decide tudo (versão do quadro, trava, ordem): a tela só envia a INTENÇÃO e se corrige se o servidor recusar.
 */
export function Board({ columns, boardVersion, canEdit, organize, execute, readOnlyReason, filtered, truncated }: Props) {
  const router = useRouter();
  const [cols, setCols] = useState(columns);
  const [board, setBoard] = useState(boardVersion);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const dragging = useRef<string | null>(null);
  const sig = signature(columns);
  // o servidor é a fonte da verdade: ao chegar um estado novo (refresh), a cópia local é substituída (reinício de estado derivado, sem efeito)
  const serverKey = `${sig}|${boardVersion}`;
  const [seen, setSeen] = useState(serverKey);
  if (seen !== serverKey) { setSeen(serverKey); setCols(columns); setBoard(boardVersion); }

  async function move(taskId: string, columnId: string, before: string | null) {
    if (busy) return;
    const prev = cols;
    const fromCol = prev.find((c) => c.cards.some((x) => x.id === taskId));
    const toCol = prev.find((c) => c.id === columnId);
    if (!fromCol || !toCol) return;
    const card = fromCol.cards.find((x) => x.id === taskId)!;
    if (fromCol.semantic !== toCol.semantic && !execute) {
      setMsg({ text: readOnlyReason ?? 'O projeto não está ativo: não é possível mudar a tarefa de tipo de etapa.', error: true });
      return;
    }
    const beforeId = filtered ? null : before;
    // atualização otimista (com reversão se o servidor recusar)
    const next = prev.map((c) => {
      const without = c.cards.filter((x) => x.id !== taskId);
      if (c.id !== columnId) return { ...c, cards: without };
      const idx = beforeId ? without.findIndex((x) => x.id === beforeId) : -1;
      return { ...c, cards: idx < 0 ? [...without, card] : [...without.slice(0, idx), card, ...without.slice(idx)] };
    });
    setCols(next);
    setBusy(true);
    setMsg({ text: 'Salvando a movimentação…', error: false });
    const r = await moveTaskIntent({ task: taskId, column: columnId, before: beforeId, board });
    setBusy(false);
    if (r.ok) {
      if (r.board) setBoard(r.board);
      setMsg({ text: r.message, error: false });
      router.refresh();
    } else {
      setCols(prev);
      setMsg({ text: r.conflict ? `${r.message} O quadro foi recarregado com o estado atual.` : r.message, error: true });
      if (r.conflict) router.refresh();
    }
  }

  const onDrop = (e: DragEvent<HTMLElement>, columnId: string) => {
    e.preventDefault();
    const id = dragging.current ?? e.dataTransfer.getData('text/plain');
    dragging.current = null;
    if (!id) return;
    const target = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null;
    const over = target?.dataset.cardId ?? null;
    void move(id, columnId, over && over !== id ? over : null);
  };

  return (
    <div>
      <p role={msg?.error ? 'alert' : 'status'} aria-live="polite" className={cn('mb-3 min-h-5 text-sm', msg?.error ? 'text-danger' : 'text-muted')}>{msg?.text ?? ''}</p>
      {filtered ? <p className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted">Há filtros ativos: a ordem dentro da etapa não é alterada neste modo; ao mover entre etapas a tarefa entra no fim da etapa de destino.</p> : null}
      {truncated ? <p className="mb-3 rounded-md border border-border bg-card px-3 py-2 text-xs text-warning">Este quadro tem muitas tarefas e mostra só as primeiras. Use os filtros ou a visão em lista.</p> : null}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" role="list" aria-label="Etapas do quadro">
        {cols.map((c) => (
          <section key={c.id} role="listitem" aria-label={`${c.name} (${c.cards.length})`} data-column-id={c.id}
            className="flex w-[85vw] shrink-0 snap-start flex-col rounded-lg border border-border bg-black/[0.03] p-2 sm:w-72 dark:bg-white/[0.03]"
            onDragOver={(e) => { if (canEdit && organize) e.preventDefault(); }} onDrop={(e) => { if (canEdit && organize) onDrop(e, c.id); }}>
            <header className="mb-2 flex items-baseline justify-between gap-2 px-1">
              <h3 className="text-sm font-semibold">{c.name}</h3>
              <span className="text-xs text-muted" title={SEMANTIC_LABEL[c.semantic]}>{c.name === SEMANTIC_LABEL[c.semantic] ? c.cards.length : `${SEMANTIC_LABEL[c.semantic]} · ${c.cards.length}`}</span>
            </header>
            <ul className="flex min-h-12 flex-col gap-2" aria-label={`Tarefas em ${c.name}`}>
              {c.cards.length === 0 ? <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted">Nenhuma tarefa nesta etapa.</li> : null}
              {c.cards.map((card) => (
                <TaskCardView key={card.id} card={card} columns={cols} current={c.id} canEdit={canEdit && organize} execute={execute} readOnlyReason={readOnlyReason}
                  onDragStart={() => { dragging.current = card.id; }}
                  onMove={(col, where) => { const first = cols.find((x) => x.id === col)?.cards.find((x) => x.id !== card.id)?.id ?? null; void move(card.id, col, where === 'start' ? first : null); }} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function TaskCardView({ card, columns, current, canEdit, execute, readOnlyReason, onDragStart, onMove }: {
  card: BoardCard; columns: BoardColumn[]; current: string; canEdit: boolean; execute: boolean; readOnlyReason: string | null; onDragStart: () => void; onMove: (col: string, where: 'start' | 'end') => void;
}) {
  const uid = useId();
  const sem = columns.find((c) => c.id === current)?.semantic ?? 'todo';
  const [col, setCol] = useState(current);
  const [where, setWhere] = useState<'start' | 'end'>('end');
  return (
    <li data-card-id={card.id} draggable={canEdit} onDragStart={(e) => { e.dataTransfer.setData('text/plain', card.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      className={cn('rounded-md border border-border bg-card p-3 text-sm shadow-sm', canEdit && 'cursor-grab active:cursor-grabbing', card.completed && 'opacity-90')}>
      <p className="text-xs text-muted">{card.key}</p>
      <Link href={`/tarefas/${card.id}`} className="mt-0.5 block font-medium hover:underline">{card.title}</Link>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityPill priority={card.priority} />
        {card.blockedReason ? <span className="inline-flex items-center rounded-full border border-danger px-2 py-0.5 text-xs text-danger" title={card.blockedReason}>Bloqueada</span> : null}
        {card.overdue ? <span className="inline-flex items-center rounded-full border border-danger px-2 py-0.5 text-xs text-danger">Atrasada</span> : null}
        {card.completed ? <span className="inline-flex items-center rounded-full border border-success px-2 py-0.5 text-xs text-success">Concluída</span> : null}
      </div>
      {card.labels.length ? <div className="mt-2 flex flex-wrap gap-1">{card.labels.map((l) => <LabelChip key={l.name} name={l.name} color={l.color} />)}</div> : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1">{card.assignee ? <><Avatar name={card.assignee} /><span className="max-w-28 truncate">{card.assignee}</span></> : 'Sem responsável'}</span>
        <span className="flex items-center gap-2">
          {card.checklist.total ? <span title="Itens do checklist concluídos">☑ {card.checklist.done}/{card.checklist.total}</span> : null}
          <span>{card.dueDate ? `Vence ${formatDateBR(card.dueDate)}` : 'Sem prazo'}</span>
        </span>
      </div>
      {canEdit ? (
        <details className="mt-2">
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md border border-border px-2 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5">Mover…</summary>
          <div className="mt-2 grid gap-2 rounded-md border border-border p-2">
            <label className="grid gap-1 text-xs" htmlFor={`${uid}c`}>Etapa de destino
              <select id={`${uid}c`} value={col} onChange={(e) => setCol(e.target.value)} className="min-h-10 rounded-md border border-border bg-card px-2 text-sm">
                {columns.map((c) => {
                  const blocked = c.semantic !== sem && !execute;
                  return <option key={c.id} value={c.id} disabled={blocked}>{c.name}{blocked ? ' (exige projeto ativo)' : ''}</option>;
                })}
              </select>
            </label>
            <fieldset className="flex gap-3 text-xs"><legend className="sr-only">Posição na etapa</legend>
              <label className="inline-flex items-center gap-1"><input type="radio" name={`${uid}w`} checked={where === 'start'} onChange={() => setWhere('start')} /> No início</label>
              <label className="inline-flex items-center gap-1"><input type="radio" name={`${uid}w`} checked={where === 'end'} onChange={() => setWhere('end')} /> No fim</label>
            </fieldset>
            <button type="button" onClick={() => onMove(col, where)} className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90">Mover tarefa</button>
            {!execute && readOnlyReason ? <p className="text-xs text-muted">{readOnlyReason}</p> : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}
