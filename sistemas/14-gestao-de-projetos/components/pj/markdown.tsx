import type { ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/pj/markdown';

// Desenha a árvore de lib/pj/markdown.ts com elementos React: nenhum HTML do usuário é interpretado (tudo que não é marcação conhecida aparece como texto).
function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return n.v;
      case 'br': return <br key={i} />;
      case 'b': return <strong key={i}>{renderInline(n.c)}</strong>;
      case 'i': return <em key={i}>{renderInline(n.c)}</em>;
      case 'code': return <code key={i} className="rounded bg-black/5 px-1 py-0.5 text-[0.85em] dark:bg-white/10">{n.v}</code>;
      case 'a': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">{renderInline(n.c)}</a>;
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  if (b.t === 'p') return <p key={i} className="whitespace-pre-wrap break-words">{renderInline(b.c)}</p>;
  const items = b.items.map((it, k) => <li key={k}>{renderInline(it)}</li>);
  return b.t === 'ul' ? <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul> : <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol>;
}

export function Markdown({ text }: { text: string }) {
  return <div className="space-y-2 text-sm leading-relaxed">{parseMarkdown(text).map(renderBlock)}</div>;
}
