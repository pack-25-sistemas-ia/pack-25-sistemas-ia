// Comentários: texto simples ou Markdown SANITIZADO. Nada de HTML: o texto vira uma árvore (parágrafos, listas, negrito, itálico, código e links http/https)
// e a interface a desenha com elementos React (que escapam todo o resto). Tags como <script> aparecem como texto.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'br' }
  | { t: 'a'; href: string; c: Inline[] };
export type Block = { t: 'p'; c: Inline[] } | { t: 'ul'; items: Inline[][] } | { t: 'ol'; items: Inline[][] };

const MAX_LINK = 2000;
export const safeHref = (u: string): string | null => {
  if (u.length > MAX_LINK || /[\s<>"'`]/.test(u)) return null;
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;
  } catch { return null; }
};

const BARE_URL = /^https?:\/\/[^\s<>"'`)\]]+/i;

/** Marcações em linha: `código`, **negrito**, *itálico* / _itálico_, [texto](url) e URLs soltas. Marcação sem fechamento vira texto comum. */
export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (depth < 3 && rest.startsWith('**')) {
      const end = s.indexOf('**', i + 2);
      if (end > i + 2) { flush(); out.push({ t: 'b', c: parseInline(s.slice(i + 2, end), depth + 1) }); i = end + 2; continue; }
    }
    if (depth < 3 && (s[i] === '*' || s[i] === '_') && s[i + 1] !== s[i] && s[i + 1] !== ' ' && (i === 0 || /[\s(]/.test(s[i - 1]!))) {
      const end = s.indexOf(s[i]!, i + 1);
      if (end > i + 1 && s[end - 1] !== ' ' && (end + 1 >= s.length || /[\s.,;:!?)]/.test(s[end + 1]!))) { flush(); out.push({ t: 'i', c: parseInline(s.slice(i + 1, end), depth + 1) }); i = end + 1; continue; }
    }
    if (s[i] === '[') {
      const m = /^\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]{1,2000})\)/i.exec(rest);
      const href = m ? safeHref(m[2]!) : null;
      if (m && href) { flush(); out.push({ t: 'a', href, c: [{ t: 'text', v: m[1]! }] }); i += m[0].length; continue; }
    }
    if ((s[i] === 'h' || s[i] === 'H') && (i === 0 || /[\s(]/.test(s[i - 1]!))) {
      const m = BARE_URL.exec(rest);
      if (m) {
        const trimmed = m[0].replace(/[.,;:!?]+$/, '');
        const href = safeHref(trimmed);
        if (href) { flush(); out.push({ t: 'a', href, c: [{ t: 'text', v: trimmed }] }); i += trimmed.length; continue; }
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return out;
}

const withBreaks = (lines: string[]): Inline[] => lines.flatMap((l, k) => (k === 0 ? parseInline(l) : [{ t: 'br' } as Inline, ...parseInline(l)]));

/** Blocos: parágrafos (linha em branco separa; quebra simples vira <br>), listas «- item»/«* item» e «1. item». Limita o tamanho para não gerar árvores gigantes. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').slice(0, 8000).split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const endPara = () => { if (para.length) { blocks.push({ t: 'p', c: withBreaks(para) }); para = []; } };
  const endList = () => { if (list) { blocks.push({ t: list.kind, items: list.items.map((x) => parseInline(x)) }); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = /^\s{0,3}[-*]\s+(.+)$/.exec(line);
    const ol = /^\s{0,3}\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (ul || ol) {
      endPara();
      const kind = ul ? 'ul' : 'ol';
      if (list && list.kind !== kind) endList();
      list ??= { kind, items: [] };
      if (list.items.length < 100) list.items.push((ul ?? ol)![1]!);
      continue;
    }
    if (line.trim() === '') { endPara(); endList(); continue; }
    endList();
    para.push(line);
  }
  endPara(); endList();
  return blocks.slice(0, 200);
}

/** Texto puro do comentário (para pré-visualizações e buscas): sem marcações. */
export function plainText(src: string): string {
  const walk = (n: Inline[]): string => n.map((x) => (x.t === 'text' || x.t === 'code' ? x.v : x.t === 'br' ? ' ' : walk(x.c))).join('');
  return parseMarkdown(src).map((b) => (b.t === 'p' ? walk(b.c) : b.items.map(walk).join(' '))).join(' ').replace(/\s+/g, ' ').trim();
}
