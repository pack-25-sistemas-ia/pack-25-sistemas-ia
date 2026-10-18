#!/usr/bin/env node
// Teste de mutação das regras críticas (domínio TypeScript E banco): quebra cada regra DE PROPÓSITO numa cópia do código e exige que a suíte reprove.
// Se alguma mutação sobreviver, falta teste.
//   suite 'unit' → vitest nos testes do domínio (tests/unit/*)
//   suite 'db'   → pnpm test:db (testes SQL com fixtures à mão: 50, 51, 55, 60 e 70)
//   suite 'conc' → pnpm test:concurrency (sessões simultâneas reais; rode SEM outra carga na máquina)
// Cada mutação aponta para a definição VIVA (as migrações não redefinem funções umas das outras).
// Uso: node scripts/mutation-check.mjs [--only <trecho do nome>] [--jobs 3] [--check]
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split('|') : null;
const wanted = (m) => !only || only.some((o) => m.name.includes(o));
const jobs = Number(args.includes('--jobs') ? args[args.indexOf('--jobs') + 1] : 3);

const L = 'lib/os/';
// { name, file (trecho do arquivo de migração) | ts (caminho do arquivo TS), find, replace, nth (qual ocorrência; omitido = única), suite }
const M = [
  // Mutações EQUIVALENTES foram retiradas de propósito (a regra tem uma segunda camada que produz o mesmo efeito observável): formato do token (o hash não casaria),
  // técnico de outra ordem (já invisível em os_load_order), responsável inválido na abertura (o gatilho repete a regra), saldo líquido zero das peças (sem efeito na divergência),
  // segmento JPEG truncado (sem SOS o arquivo é recusado do mesmo jeito) travas da ordem redundantes com a trava da versão do orçamento, e a proteção de apagar a conclusão (a exclusão em cascata do aceite, também protegido, barra do mesmo jeito).
  // ---------------------------------------------------------------- TS: dinheiro e quantidades
  { name: 'dinheiro/arredondamento: meio para cima', ts: `${L}money.ts`, find: 'return (prod + 500n) / 1000n;', replace: 'return prod / 1000n;' },
  { name: 'dinheiro/arredondamento: limiar de 0,5', ts: `${L}money.ts`, find: 'return (prod + 500n) / 1000n;', replace: 'return (prod + 499n) / 1000n;' },
  { name: 'dinheiro/centavos: milhar', ts: `${L}money.ts`, find: ".replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.')", replace: '' },
  { name: 'dinheiro/centavos: zero à esquerda', ts: `${L}money.ts`, find: ".toString().padStart(2, '0')}`;\n}\n\n/** «1.234,56»", replace: ".toString().padStart(1, '0')}`;\n}\n\n/** «1.234,56»" },
  { name: 'dinheiro/centavos: sinal negativo', ts: `${L}money.ts`, find: "${neg ? '-' : ''}R$", replace: 'R$' },
  { name: 'dinheiro/leitura: 3 casas em dinheiro', ts: `${L}money.ts`, find: '(frac && !/^\\d{1,2}$/.test(frac))', replace: '(frac && !/^\\d{1,3}$/.test(frac))' },
  { name: 'dinheiro/leitura: teto', ts: `${L}money.ts`, find: 'return cents <= MAX_UNIT_PRICE_CENTS ? cents : null;', replace: 'return cents;' },
  { name: 'quantidade/leitura: 4 casas aceitas', ts: `${L}money.ts`, find: '/^\\d+(\\.\\d{1,3})?$/', replace: '/^\\d+(\\.\\d{1,4})?$/' },
  { name: 'quantidade/leitura: zero aceito', ts: `${L}money.ts`, find: 'return milli > 0n && milli <= MAX_QUANTITY_MILLI ? milli : null;', replace: 'return milli >= 0n && milli <= MAX_QUANTITY_MILLI ? milli : null;' },
  { name: 'quantidade/leitura: teto', ts: `${L}money.ts`, find: 'return milli > 0n && milli <= MAX_QUANTITY_MILLI ? milli : null;', replace: 'return milli > 0n ? milli : null;' },
  { name: 'quantidade/formato: zeros finais', ts: `${L}money.ts`, find: ".padStart(3, '0').replace(/0+$/, '')", replace: ".padStart(3, '0')" },
  // ---------------------------------------------------------------- TS: orçamento
  { name: 'orçamento: desconto maior que o subtotal', ts: `${L}quote.ts`, find: 'if (discountCents > subtotalCents) throw', replace: 'if (discountCents > subtotalCents + 1000000n) throw' },
  { name: 'orçamento: desconto igual ao subtotal recusado', ts: `${L}quote.ts`, find: 'if (discountCents > subtotalCents) throw', replace: 'if (discountCents >= subtotalCents) throw' },
  { name: 'orçamento: desconto negativo', ts: `${L}quote.ts`, find: "  if (discountCents < 0n) throw new QuoteError('O desconto não pode ser negativo.');\n", replace: '' },
  { name: 'orçamento: quantidade zero', ts: `${L}quote.ts`, find: 'if (it.quantityMilli <= 0n ||', replace: 'if (it.quantityMilli < 0n ||' },
  { name: 'orçamento: preço negativo', ts: `${L}quote.ts`, find: 'if (it.unitPriceCents < 0n ||', replace: 'if (false ||' },
  { name: 'orçamento: limite de itens', ts: `${L}quote.ts`, find: 'if (items.length > MAX_QUOTE_ITEMS)', replace: 'if (items.length > MAX_QUOTE_ITEMS * 10)' },
  { name: 'orçamento: total = subtotal sem desconto', ts: `${L}quote.ts`, find: 'totalCents: subtotalCents - discountCents', replace: 'totalCents: subtotalCents' },
  { name: 'orçamento: expirado na hora exata', ts: `${L}quote.ts`, find: 'if (!(until > nowMs))', replace: 'if (!(until >= nowMs))' },
  { name: 'orçamento: substituído decidível', ts: `${L}quote.ts`, find: "if (q.status === 'superseded') return", replace: "if (false) return" },
  { name: 'orçamento: já decidido decidível', ts: `${L}quote.ts`, find: "if (q.status === 'approved' || q.status === 'rejected') return", replace: "if (false) return" },
  { name: 'orçamento: rascunho decidível', ts: `${L}quote.ts`, find: "if (q.status !== 'published') return", replace: "if (false) return" },
  { name: 'orçamento: execução autorizada ignorada', ts: `${L}quote.ts`, find: "if (order.quoteMode === 'authorized') return null;", replace: '' },
  { name: 'orçamento: versão pendente não bloqueia', ts: `${L}quote.ts`, find: "if (quotes.some((q) => q.status === 'published')) return", replace: "if (false) return" },
  { name: 'orçamento: início sem aprovação', ts: `${L}quote.ts`, find: "if (!quotes.some((q) => q.status === 'approved')) return", replace: "if (false) return" },
  // ---------------------------------------------------------------- TS: estados, permissões e aceite
  { name: 'estado: aberta pula a execução', ts: `${L}status.ts`, find: "case 'open': return to === 'scheduled' || to === 'in_progress' || to === 'cancelled';", replace: "case 'open': return to === 'scheduled' || to === 'in_progress' || to === 'cancelled' || to === 'completed';" },
  { name: 'estado: pausada conclui direto', ts: `${L}status.ts`, find: "case 'paused': return to === 'in_progress' || to === 'cancelled';", replace: "case 'paused': return to === 'in_progress' || to === 'cancelled' || to === 'completed';" },
  { name: 'estado: concluída não reabre', ts: `${L}status.ts`, find: "case 'completed': return to === 'closed' || to === 'in_progress';", replace: "case 'completed': return to === 'closed';" },
  { name: 'estado: encerrada não reabre', ts: `${L}status.ts`, find: "case 'closed': return to === 'in_progress';", replace: "case 'closed': return false;" },
  { name: 'estado: cancelada reabre', ts: `${L}status.ts`, find: 'default: return false;\n  }\n}\n\nexport type Action', replace: "default: return from === 'cancelled';\n  }\n}\n\nexport type Action" },
  { name: 'ações: técnico cancela', ts: `${L}status.ts`, find: "out.push('link', 'cancel');", replace: "out.push('link');\n  }\n  if (mgr || exec) {\n    out.push('cancel');" },
  { name: 'ações: técnico de outra ordem executa', ts: `${L}status.ts`, find: "const exec = mgr || (profile === 'technician' && assignedToMe);", replace: "const exec = mgr || profile === 'technician';" },
  { name: 'ações: gestor reabre encerrada', ts: `${L}status.ts`, find: "if (profile === 'owner') out.push('reopen');", replace: "out.push('reopen');" },
  { name: 'ações: encerrada edita', ts: `${L}status.ts`, find: "if (status === 'closed') {\n    if (profile === 'owner')", replace: "if (status === 'closed') {\n    if (mgr) out.push('edit', 'quote');\n    if (profile === 'owner')" },
  { name: 'ações: cancelada com ações', ts: `${L}status.ts`, find: "if (status === 'cancelled') return out;", replace: "if (status === 'cancelled') return ['note'];" },
  { name: 'atraso: concluída conta como atrasada', ts: `${L}status.ts`, find: 'return BACKLOG.includes(o.status) && !!o.scheduledEndAt', replace: "return o.status !== 'cancelled' && !!o.scheduledEndAt" },
  { name: 'atraso: janela exata', ts: `${L}status.ts`, find: 'Date.parse(o.scheduledEndAt) < nowMs', replace: 'Date.parse(o.scheduledEndAt) <= nowMs' },
  { name: 'aceite: qualquer versão vale', ts: `${L}status.ts`, find: "!acceptances.some((a) => a.completionVersion === o.completionVersion && a.decision === 'accepted');\n}", replace: "!acceptances.some((a) => a.decision === 'accepted');\n}" },
  { name: 'aceite: contestação vale como aceite', ts: `${L}status.ts`, find: "!acceptances.some((a) => a.completionVersion === o.completionVersion && a.decision === 'accepted');\n}", replace: "!acceptances.some((a) => a.completionVersion === o.completionVersion);\n}" },
  { name: 'aceite: versão antiga decide', ts: `${L}status.ts`, find: "if (version !== o.completionVersion) return", replace: "if (false) return" },
  { name: 'aceite: decidir duas vezes', ts: `${L}status.ts`, find: "if (acceptances.some((a) => a.completionVersion === version)) return", replace: "if (false) return" },
  { name: 'aceite: ordem não concluída decide', ts: `${L}status.ts`, find: "if (o.status !== 'completed') return { ok: false, reason: 'Esta ordem não está aguardando o seu aceite.' };", replace: '' },
  { name: 'encerramento: aceite antigo encerra', ts: `${L}status.ts`, find: "if (!acceptances.some((a) => a.completionVersion === o.completionVersion && a.decision === 'accepted')) {", replace: "if (!acceptances.some((a) => a.decision === 'accepted')) {" },
  { name: 'encerramento: sem aceite', ts: `${L}status.ts`, find: "if (!acceptances.some((a) => a.completionVersion === o.completionVersion && a.decision === 'accepted')) {", replace: 'if (false) {' },
  { name: 'aceite: estado pendente', ts: `${L}status.ts`, find: "if (!a) return 'pending';", replace: "if (!a) return 'none';" },
  // ---------------------------------------------------------------- TS: checklist
  { name: 'checklist: N/A em qualquer item', ts: `${L}checklist.ts`, find: "if (!item.allowNa) return 'Este item não admite «não se aplica».';", replace: '' },
  { name: 'checklist: justificativa em resposta negativa', ts: `${L}checklist.ts`, find: "if (item.noteRule === 'on_negative' && (a.notApplicable || (item.kind === 'boolean' && a.boolean === false)) && !note)", replace: "if (false)" },
  { name: 'checklist: justificativa sempre', ts: `${L}checklist.ts`, find: "if (item.noteRule === 'always' && !note)", replace: 'if (false)' },
  { name: 'checklist: opção fora da lista', ts: `${L}checklist.ts`, find: "if (!a.option || !(item.options ?? []).includes(a.option)) return 'Escolha uma das opções.';", replace: "if (!a.option) return 'Escolha uma das opções.';" },
  { name: 'checklist: resposta booleana não conferida', ts: `${L}checklist.ts`, find: "if (typeof a.boolean !== 'boolean') return 'Responda sim ou não.';", replace: '' },
  { name: 'checklist: obrigatório sem resposta', ts: `${L}checklist.ts`, find: "if (i.required) out.push(`Item obrigatório sem resposta: ${i.label}`);", replace: '' },
  { name: 'checklist: foto obrigatória', ts: `${L}checklist.ts`, find: 'if (i.requirePhoto && !i.notApplicable && i.photoCount === 0)', replace: 'if (false)' },
  { name: 'checklist: foto exigida em N/A', ts: `${L}checklist.ts`, find: 'if (i.requirePhoto && !i.notApplicable && i.photoCount === 0)', replace: 'if (i.requirePhoto && i.photoCount === 0)' },
  { name: 'checklist: número infinito', ts: `${L}checklist.ts`, find: "if (typeof a.number !== 'number' || !Number.isFinite(a.number)) return 'Informe um número.';", replace: "if (typeof a.number !== 'number') return 'Informe um número.';" },
  // ---------------------------------------------------------------- TS: arquivos e metadados
  { name: 'arquivo/tipo: PNG', ts: `${L}attachments.ts`, find: 'startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && b.length > 33', replace: 'startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]) && b.length > 33' },
  { name: 'arquivo/tipo: PDF', ts: `${L}attachments.ts`, find: 'startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) && b.length > 8', replace: 'startsWith(b, [0x25, 0x50, 0x44, 0x46]) && b.length > 8' },
  { name: 'arquivo/tipo: WebP', ts: `${L}attachments.ts`, find: 'startsWith(b, [0x57, 0x45, 0x42, 0x50], 8) && b.length > 20', replace: 'b.length > 20' },
  { name: 'arquivo/nome: barras', ts: `${L}attachments.ts`, find: 'name.replace(/[\\\\/\\x00-\\x1f"]/g', replace: 'name.replace(/[\\x00-\\x1f"]/g' },
  { name: 'arquivo/nome: tamanho', ts: `${L}attachments.ts`, find: '.trim().slice(0, 180)', replace: '.trim().slice(0, 1800)' },
  { name: 'arquivo/caminho: conteúdo', ts: `${L}attachments.ts`, find: '.update(`${idem}:${index}:`).update(bytes)', replace: '.update(`${idem}:${index}:`)' },
  { name: 'arquivo/limite: quantidade', ts: `${L}attachments.ts`, find: 'if (raw.length > MAX_FILES)', replace: 'if (raw.length > MAX_FILES + 50)' },
  { name: 'arquivo/limite: tamanho', ts: `${L}attachments.ts`, find: 'if (f.size > max)', replace: 'if (f.size > max * 100)' },
  { name: 'arquivo/limite: teto de segurança', ts: `${L}attachments.ts`, find: 'const max = Math.min(ctx.maxBytes, HARD_MAX_BYTES);', replace: 'const max = ctx.maxBytes;' },
  { name: 'foto/JPEG: EXIF mantido', ts: `${L}attachments.ts`, find: "if (ascii(body, 0, 6) === 'Exif\\0\\0') orientation ??= readOrientation(body.subarray(6)); }", replace: "if (ascii(body, 0, 6) === 'Exif\\0\\0') orientation ??= readOrientation(body.subarray(6)); kept.push(seg); }" },
  { name: 'foto/JPEG: comentário mantido', ts: `${L}attachments.ts`, find: "else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) { /* APP3", replace: "else if ((marker >= 0xe3 && marker <= 0xef)) { /* APP3" },
  { name: 'foto/JPEG: IPTC mantido', ts: `${L}attachments.ts`, find: "else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe)", replace: "else if (marker === 0xfe)" },
  { name: 'foto/JPEG: orientação perdida', ts: `${L}attachments.ts`, find: 'if (orientation && orientation !== 1) {', replace: 'if (false) {' },
  { name: 'foto/JPEG: JFIF descartado', ts: `${L}attachments.ts`, find: 'if (marker === 0xe0) kept.push(seg); // JFIF', replace: 'if (marker === 0xe0) { /* descartado */ }' },
  { name: 'foto/JPEG: sem dados da imagem', ts: `${L}attachments.ts`, find: '  if (!sos) return null;\n  const head', replace: '  const head' },
  { name: 'foto/PNG: texto mantido', ts: `${L}attachments.ts`, find: "const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);", replace: "const PNG_DROP = new Set(['eXIf', 'zTXt', 'iTXt', 'tIME']);" },
  { name: 'foto/PNG: EXIF mantido', ts: `${L}attachments.ts`, find: "const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);", replace: "const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME']);" },
  { name: 'foto/PNG: sem IHDR', ts: `${L}attachments.ts`, find: "if (first && type !== 'IHDR') return null;", replace: '' },
  { name: 'foto/PNG: truncado', ts: `${L}attachments.ts`, find: 'return null; // sem IEND: arquivo truncado/malformado', replace: 'return concat(kept);' },
  { name: 'foto/WebP: XMP mantido', ts: `${L}attachments.ts`, find: "} else if (id !== 'XMP ') chunks.push({ id, data });", replace: '} else chunks.push({ id, data });' },
  { name: 'foto/WebP: flags do VP8X', ts: `${L}attachments.ts`, find: 'flags[0] = (flags[0]! & ~0x0c) | (keepOrientation ? 0x08 : 0);', replace: 'flags[0] = flags[0]!;' },
  { name: 'foto/WebP: tamanho do RIFF', ts: `${L}attachments.ts`, find: 'const total = 4 + body.reduce((n, c) => n + c.length, 0);', replace: 'const total = 3 + body.reduce((n, c) => n + c.length, 0);' },
  { name: 'foto/orientação: valor inválido', ts: `${L}attachments.ts`, find: 'return v >= 1 && v <= 8 ? v : null;', replace: 'return v;' },
  { name: 'foto/orientação: arquivo malformado quebra', ts: `${L}attachments.ts`, find: "if (tiff.length < 14) return null;", replace: '' },
  // ---------------------------------------------------------------- TS: token, CSV, indicadores
  { name: 'token/formato', ts: `${L}token.ts`, find: 'export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;', replace: 'export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;' },
  { name: 'token/entropia', ts: `${L}token.ts`, find: 'return randomBytes(32).toString', replace: 'return randomBytes(16).toString' },
  { name: 'token/hash do texto', ts: `${L}token.ts`, find: "createHash('sha256').update(token, 'utf8')", replace: "createHash('sha256').update(token.slice(1), 'utf8')" },
  { name: 'token/origem sem sal', ts: `${L}token.ts`, find: "createHmac('sha256', salt).update(`os-source-v1:${ip}`)", replace: "createHmac('sha256', 'x').update(`os-source-v1:${ip}`)" },
  { name: 'token/sal curto', ts: `${L}token.ts`, find: 'if (s.length < 32) throw', replace: 'if (s.length < 1) throw' },
  { name: 'csv: «=» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[+\\-@\\t\\r]/.test(s);' },
  { name: 'csv: «+» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=\\-@\\t\\r]/.test(s);' },
  { name: 'csv: «-» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=+@\\t\\r]/.test(s);' },
  { name: 'csv: «@» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=+\\-\\t\\r]/.test(s);' },
  { name: 'csv: aspas não duplicadas', ts: `${L}csv.ts`, find: '"${safe.replace(/"/g, \'""\')}"', replace: '"${safe}"' },
  { name: 'csv: ponto e vírgula não protegido', ts: `${L}csv.ts`, find: '/[";\\n]/.test(safe)', replace: '/["\\n]/.test(safe)' },
  { name: 'csv: quebra de linha mantida', ts: `${L}csv.ts`, find: "const s = v.replace(/\\r?\\n/g, ' ');", replace: 'const s = v;' },
  { name: 'indicadores: dias', ts: `${L}indicators.ts`, find: 'const d = Math.floor(s / 86400);', replace: 'const d = Math.floor(s / 86000);' },
  { name: 'indicadores: sem dados', ts: `${L}indicators.ts`, find: "if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'Sem dados';", replace: "if (seconds === null || seconds === undefined) return 'Sem dados';" },
  { name: 'indicadores: contador sem dados', ts: `${L}indicators.ts`, find: "if (!hasData || n === null || n === undefined) return 'Sem dados';", replace: "if (n === null || n === undefined) return 'Sem dados';" },
  // ---------------------------------------------------------------- TS: validação (CPF/CNPJ e janela)
  { name: 'validação/CPF: dígito verificador', ts: `${L}validation.ts`, find: 'return dv(9, w1) === digits[9] && dv(10, w2) === digits[10] ? d : null;', replace: 'return dv(9, w1) === digits[9] ? d : null;' },
  { name: 'validação/CNPJ: dígito verificador', ts: `${L}validation.ts`, find: 'return dv(12, w1) === digits[12] && dv(13, w2) === digits[13] ? d : null;', replace: 'return dv(12, w1) === digits[12] ? d : null;' },
  { name: 'validação/documento: sequência repetida', ts: `${L}validation.ts`, find: "|| /^(\\d)\\1+$/.test(d)", replace: '' },
  { name: 'validação/janela: fim antes do início', ts: `${L}validation.ts`, find: 'if (b <= a) return', replace: 'if (b < a) return' },
  { name: 'validação/janela: fuso da empresa', ts: `${L}validation.ts`, find: 'const a = localToInstant(d.date, d.start, tz);', replace: "const a = localToInstant(d.date, d.start, 'UTC');" },
  { name: 'validação/janela: 24:00 como início', ts: `${L}validation.ts`, find: "if (!isTime(d.start) || d.start === '24:00')", replace: 'if (!isTime(d.start))' },
  // ---------------------------------------------------------------- banco: regra de iniciar/retomar, conclusão, reabertura, encerramento
  { name: 'banco/iniciar: execução autorizada ignorada', file: 'os_orders.sql', find: "  if o.quote_mode = 'authorized' then return null; end if;", replace: '' },
  { name: 'banco/iniciar: versão pendente não bloqueia', file: 'os_orders.sql', find: "  if exists (select 1 from public.quote_versions where service_order_id = p_order and status = 'published') then", replace: '  if false then' },
  { name: 'banco/iniciar: sem aprovação', file: 'os_orders.sql', find: "  if not exists (select 1 from public.quote_versions where service_order_id = p_order and status = 'approved') then", replace: '  if false then' },
  { name: 'banco/iniciar: sem responsável', file: 'os_orders.sql', find: "  if o.assigned_technician_user_id is null then raise exception 'defina o técnico responsável antes de iniciar'", replace: "  if false then raise exception 'defina o técnico responsável antes de iniciar'" },
  { name: 'banco/iniciar: estado inválido', file: 'os_orders.sql', find: "if o.execution_status not in ('open', 'scheduled') then raise exception 'só ordens abertas ou agendadas podem ser iniciadas'", replace: "if false then raise exception 'só ordens abertas ou agendadas podem ser iniciadas'" },
  { name: 'banco/pausa: motivo obrigatório', file: 'os_orders.sql', find: "rsn := private.os_req_text(p_reason, 3, 300, 'Motivo da pausa');", replace: "rsn := private.os_req_text(p_reason, 0, 300, 'Motivo da pausa');" },
  { name: 'banco/retomar: bloqueio de orçamento ignorado', file: 'os_orders.sql', find: "  if o.assigned_technician_user_id is null then raise exception 'defina o técnico responsável antes de retomar' using errcode = '23514'; end if;\n  blk := private.os_exec_block(p_order);\n  if blk is not null then raise exception '%', blk using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/conclusão: checklist não validado', file: 'os_orders.sql', find: '  if cardinality(probs) > 0 then', replace: '  if false then' },
  { name: 'banco/conclusão: divergência sem justificativa', file: 'os_orders.sql', find: '  if relevant and (dn is null or char_length(dn) < 10) then', replace: '  if false then' },
  { name: 'banco/conclusão: justificativa curta', file: 'os_orders.sql', find: '(dn is null or char_length(dn) < 10)', replace: '(dn is null)' },
  { name: 'banco/conclusão: versão não incrementa', file: 'os_orders.sql', find: '  cv := o.completion_version + 1;', replace: '  cv := o.completion_version;' },
  { name: 'banco/conclusão: resumo vazio', file: 'os_orders.sql', find: "sm := private.os_req_text(p_summary, 5, 4000, 'Resumo do serviço');", replace: "sm := private.os_req_text(p_summary, 0, 4000, 'Resumo do serviço');" },
  { name: 'banco/conclusão: só em execução', file: 'os_orders.sql', find: "if o.execution_status <> 'in_progress' then raise exception 'só ordens em execução podem ser concluídas", replace: "if false then raise exception 'só ordens em execução podem ser concluídas" },
  { name: 'banco/conclusão: peças sem saldo líquido', file: 'os_orders.sql', find: "group by coalesce(u.part_id::text, 'd:' || lower(btrim(u.description))) having sum(u.quantity) <> 0) x;", replace: "group by coalesce(u.part_id::text, 'd:' || lower(btrim(u.description))) having true) x;" },
  { name: 'banco/reabrir: encerrada por gestor', file: 'os_orders.sql', find: "if o.execution_status = 'closed' and not private.os_is_owner(p_org) then raise exception", replace: "if false then raise exception" },
  { name: 'banco/reabrir: motivo curto', file: 'os_orders.sql', find: "rsn := private.os_req_text(p_reason, 10, 500, 'Motivo da reabertura');", replace: "rsn := private.os_req_text(p_reason, 0, 500, 'Motivo da reabertura');" },
  { name: 'banco/reabrir: sem registro na ordem', file: 'os_orders.sql', find: "  insert into public.order_updates (organization_id, service_order_id, author_user_id, visibility, body) values (p_org, p_order, (select auth.uid()), 'internal', 'Ordem reaberta para execução. Motivo: ' || rsn);", replace: '' },
  { name: 'banco/encerrar: sem aceite', file: 'os_orders.sql', find: "  if not exists (select 1 from public.completion_acceptances a where a.service_order_id = p_order and a.completion_version = o.completion_version and a.decision = 'accepted') then", replace: '  if false then' },
  { name: 'banco/encerrar: aceite de qualquer versão', file: 'os_orders.sql', find: "where a.service_order_id = p_order and a.completion_version = o.completion_version and a.decision = 'accepted') then", replace: "where a.service_order_id = p_order and a.decision = 'accepted') then" },
  { name: 'banco/encerrar: contestação encerra', file: 'os_orders.sql', find: "where a.service_order_id = p_order and a.completion_version = o.completion_version and a.decision = 'accepted') then", replace: "where a.service_order_id = p_order and a.completion_version = o.completion_version) then" },
  { name: 'banco/cancelar: motivo', file: 'os_orders.sql', find: "rsn := private.os_req_text(p_reason, 5, 500, 'Motivo do cancelamento');", replace: "rsn := private.os_req_text(p_reason, 0, 500, 'Motivo do cancelamento');" },
  { name: 'banco/cancelar: link continua válido', file: 'os_orders.sql', find: "  update public.public_access_tokens set revoked_at = now() where service_order_id = p_order and revoked_at is null;\n  update public.quote_versions set status = 'superseded'", replace: "  update public.quote_versions set status = 'superseded'" },
  { name: 'banco/cancelar: proposta pendente continua', file: 'os_orders.sql', find: "  update public.quote_versions set status = 'superseded' where service_order_id = p_order and status = 'published';\n  perform private.os_event(p_org, p_order, 'cancelled'", replace: "  perform private.os_event(p_org, p_order, 'cancelled'" },
  // ---------------------------------------------------------------- banco: checklist, peças, agenda, abertura
  { name: 'banco/checklist: N/A em item que não permite', file: 'os_orders.sql', find: "    if not i.allow_na then raise exception 'este item não admite «não se aplica»' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/checklist: justificativa em resposta negativa', file: 'os_orders.sql', find: "if i.note_rule = 'on_negative' and (na or ab = false) and nt is null then", replace: 'if false then' },
  { name: 'banco/checklist: justificativa sempre', file: 'os_orders.sql', find: "if i.note_rule = 'always' and nt is null then raise exception 'este item exige justificativa'", replace: "if false then raise exception 'este item exige justificativa'" },
  { name: 'banco/checklist: opção fora da lista', file: 'os_orders.sql', find: "if ao is null or not exists (select 1 from jsonb_array_elements_text(i.options) opt where opt = ao) then", replace: 'if ao is null then' },
  { name: 'banco/checklist: pendência de foto', file: 'os_orders.sql', find: "      if photos = 0 then out := out || ('Foto obrigatória pendente: ' || i.label); end if;", replace: '' },
  { name: 'banco/checklist: item obrigatório', file: 'os_orders.sql', find: "      if i.required then out := out || ('Item obrigatório sem resposta: ' || i.label); end if;", replace: '' },
  { name: 'banco/checklist: respondido fora da execução', file: 'os_orders.sql', find: "if o.execution_status not in ('in_progress', 'paused') then raise exception 'o checklist é respondido durante a execução (inicie a ordem)'", replace: "if false then raise exception 'o checklist é respondido durante a execução (inicie a ordem)'" },
  { name: 'banco/peças: registro fora da execução', file: 'os_orders.sql', find: "if o.execution_status not in ('in_progress', 'paused') then raise exception 'peças são registradas durante a execução'", replace: "if false then raise exception 'peças são registradas durante a execução'" },
  { name: 'banco/peças: estorno acima do saldo', file: 'os_orders.sql', find: '  if net + q < 0 then raise exception', replace: '  if false then raise exception' },
  { name: 'banco/peças: estorno com sinal positivo', file: 'os_orders.sql', find: "if p_kind = 'reversal' then q := -abs(q); end if;", replace: '' },
  { name: 'banco/peças: motivo da correção', file: 'os_orders.sql', find: "rsn := private.os_req_text(p_reason, 3, 300, 'Motivo da correção');", replace: "rsn := private.os_req_text(p_reason, 0, 300, 'Motivo da correção');" },
  { name: 'banco/peças: divergência por peça orçada', file: 'os_orders.sql', find: "'relevant', uq > qq", replace: "'relevant', uq <> qq" },
  { name: 'banco/peças: uso no futuro', file: 'os_orders.sql', find: "if ua > now() + interval '1 day' then raise exception", replace: 'if false then raise exception' },
  { name: 'banco/agenda: janela invertida', file: 'os_orders.sql', find: "if p_end <= p_start then raise exception", replace: 'if false then raise exception' },
  { name: 'banco/agenda: janela máxima', file: 'os_orders.sql', find: "if p_end > p_start + interval '14 days' then", replace: "if false then" },
  { name: 'banco/agenda: alerta de sobreposição', file: 'os_orders.sql', find: 'and o.scheduled_start_at < p_end and o.scheduled_end_at > p_start;', replace: 'and false;' },
  { name: 'banco/agenda: agendar sem técnico', file: 'os_orders.sql', find: "if p_technician is null then raise exception 'escolha o técnico responsável para agendar'", replace: "if false then raise exception 'escolha o técnico responsável para agendar'" },
  { name: 'banco/abertura: justificativa sem orçamento', file: 'os_orders.sql', find: "if qm = 'authorized' and (just is null or char_length(just) < 10) then raise exception 'informe a justificativa (mínimo 10 caracteres) para executar sem orçamento' using errcode = '22023'; end if;\n  if qm = 'required' then just := null; end if;", replace: "if qm = 'required' then just := null; end if;" },
  { name: 'banco/abertura: endereço de outro cliente', file: 'os_orders.sql', find: "if addr is not null and not exists (select 1 from public.customer_addresses where id = addr and organization_id = p_org and customer_id = cust and active) then raise exception 'endereço inválido para este cliente' using errcode = '22023'; end if;\n  if eq", replace: 'if eq' },
  { name: 'banco/abertura: cliente inativo', file: 'os_orders.sql', find: "if not exists (select 1 from public.customers where id = cust and organization_id = p_org and active) then", replace: "if not exists (select 1 from public.customers where id = cust and organization_id = p_org) then" },
  { name: 'banco/abertura: idempotência', file: 'os_orders.sql', find: "  prev := private.os_idem(p_org, uid, p_idem, 'open_order', hash);\n  if prev is not null then return prev; end if;", replace: '' },
  { name: 'banco/abertura: snapshot', file: 'os_orders.sql', find: '  sv := private.os_take_snapshot(p_org, oid, cust, addr, eq, cont, null);', replace: '' },
  { name: 'banco/abertura: modelo não copiado', file: 'os_orders.sql', find: "for tpl in select value #>> '{}' from jsonb_array_elements(p -> 'template_ids') loop perform private.os_apply_template(p_org, oid, tpl::uuid); end loop;", replace: '' },
  { name: 'banco/abertura: status agendada', file: 'os_orders.sql', find: "when tech is not null and ws is not null then 'scheduled' else 'open' end;", replace: "else 'open' end;" },
  { name: 'banco/versão: ordem desatualizada aceita', file: 'os_helpers.sql', find: "  if p_expected is not null and o.version <> p_expected then perform private.os_conflict(); end if;", replace: '' },
  { name: 'banco/versão: técnico de outra ordem carrega', file: 'os_helpers.sql', find: "if not found or not private.os_order_visible(p_org, o.assigned_technician_user_id) then raise exception 'ordem de serviço não encontrada'", replace: "if not found then raise exception 'ordem de serviço não encontrada'" },
  { name: 'banco/idempotência: outro conteúdo com a mesma chave', file: 'os_helpers.sql', find: "if r.scope <> p_scope or r.request_hash <> p_hash then raise", replace: 'if false then raise' },
  { name: 'banco/numeração: contador', file: 'os_helpers.sql', find: "on conflict (organization_id) do update set last_number = c.last_number + 1 returning last_number into n;", replace: "on conflict (organization_id) do update set last_number = c.last_number returning last_number into n;" },
  { name: 'banco/documento: dígito verificador', file: 'os_helpers.sql', find: "return dv1 = substr(d, 10, 1)::integer and dv2 = substr(d, 11, 1)::integer;", replace: "return dv1 = substr(d, 10, 1)::integer;" },
  { name: 'banco/anexo: caminho de outra ordem', file: 'os_helpers.sql', find: "if path is null or path !~ ('^' || p_org::text || '/' || p_order::text || '/[0-9a-f]{32}\\.(jpg|png|webp|pdf)$') then", replace: 'if path is null then' },
  { name: 'banco/anexo: tipo de arquivo', file: 'os_helpers.sql', find: "if mime is null or mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf') then", replace: 'if mime is null then' },
  { name: 'banco/anexo: tamanho', file: 'os_helpers.sql', find: "if sz < 1 or sz > maxb then", replace: 'if sz < 1 then' },
  { name: 'banco/anexo: PDF só como documento', file: 'os_helpers.sql', find: "if mime = 'application/pdf' and cat <> 'document' then", replace: 'if false then' },
  // ---------------------------------------------------------------- banco: orçamento
  { name: 'banco/orçamento: desconto maior que o subtotal', file: 'os_quotes.sql', find: '  if disc > sub then raise exception', replace: '  if false then raise exception' },
  { name: 'banco/orçamento: total recalculado', file: 'os_quotes.sql', find: 'update public.quote_versions set subtotal_cents = sub, discount_cents = disc, total_cents = sub - disc where id = p_quote;', replace: 'update public.quote_versions set discount_cents = disc where id = p_quote;' },
  { name: 'banco/orçamento: casas decimais', file: 'os_quotes.sql', find: 'if qty <> round(qty, 3) then', replace: 'if false then' },
  { name: 'banco/orçamento: arredondamento da linha', file: 'os_quotes.sql', find: 'values (p_org, p_quote, pos, kd, sid, pid, ds, un, qty, price, round(qty * price));', replace: 'values (p_org, p_quote, pos, kd, sid, pid, ds, un, qty, price, floor(qty * price));' },
  { name: 'banco/orçamento: rascunho desatualizado', file: 'os_quotes.sql', find: '  if p_expected is not null and q.version <> p_expected then perform private.os_conflict(); end if;\n  if o.execution_status in (\'completed\', \'closed\', \'cancelled\') then raise exception \'ordem % não aceita alterações de orçamento\', o.execution_status using errcode = \'23514\'; end if;\n  if jsonb_typeof', replace: "  if jsonb_typeof" },
  { name: 'banco/orçamento: publicar vazio', file: 'os_quotes.sql', find: "  if n = 0 then raise exception 'adicione ao menos um item antes de publicar'", replace: "  if false then raise exception 'adicione ao menos um item antes de publicar'" },
  { name: 'banco/orçamento: nova publicação substitui', file: 'os_quotes.sql', find: "  update public.quote_versions set status = 'superseded' where service_order_id = q.service_order_id and status = 'published';\n  update public.quote_versions set status = 'published'", replace: "  update public.quote_versions set status = 'published'" },
  { name: 'banco/orçamento: validade futura', file: 'os_quotes.sql', find: "  if vu <= now() then raise exception 'a validade do orçamento precisa ser futura'", replace: "  if false then raise exception 'a validade do orçamento precisa ser futura'" },
  { name: 'banco/orçamento: snapshot na publicação', file: 'os_quotes.sql', find: 'snapshot_version = private.os_snapshot_current(q.service_order_id)', replace: 'snapshot_version = 1' },
  { name: 'banco/orçamento: expirada aceita', file: 'os_quotes.sql', find: "  if q.valid_until <= now() then raise exception 'esta versão do orçamento expirou", replace: "  if false then raise exception 'esta versão do orçamento expirou" },
  { name: 'banco/orçamento: substituída aceita', file: 'os_quotes.sql', find: "  if q.status = 'superseded' then raise exception", replace: "  if false then raise exception" },
  { name: 'banco/orçamento: dupla decisão', file: 'os_quotes.sql', find: "  if q.status in ('approved', 'rejected') then raise exception", replace: "  if false then raise exception" },
  { name: 'banco/orçamento: decisão de rascunho', file: 'os_quotes.sql', find: "  if q.status <> 'published' then raise exception 'este orçamento ainda não foi publicado'", replace: "  if false then raise exception 'este orçamento ainda não foi publicado'" },
  { name: 'banco/orçamento: ordem encerrada decide', file: 'os_quotes.sql', find: "  if o.execution_status in ('closed', 'cancelled') then raise exception 'esta ordem não aceita mais decisões'", replace: "  if false then raise exception 'esta ordem não aceita mais decisões'" },
  { name: 'banco/orçamento: justificativa manual', file: 'os_quotes.sql', find: "jst := private.os_req_text(p_justification, 10, 500, 'Justificativa');", replace: "jst := private.os_req_text(p_justification, 0, 500, 'Justificativa');" },
  { name: 'banco/orçamento: evidência de outra ordem', file: 'os_quotes.sql', find: "  if p_evidence is not null and not exists (select 1 from public.order_attachments where id = p_evidence and service_order_id = q.service_order_id and organization_id = p_org) then", replace: '  if false then' },
  { name: 'banco/orçamento: texto aceito', file: 'os_quotes.sql', find: "case when p_channel = 'staff_manual' then ' da versão ' else ' a versão ' end", replace: "case when p_channel = 'staff_manual' then ' a versão ' else ' a versão ' end" },
  // ---------------------------------------------------------------- banco: link público e aceite
  { name: 'banco/link: token expirado', file: 'os_public.sql', find: "or t.revoked_at is not null or t.expires_at <= now() then", replace: "or t.revoked_at is not null then" },
  { name: 'banco/link: token revogado', file: 'os_public.sql', find: "or t.revoked_at is not null or t.expires_at <= now() then", replace: "or t.expires_at <= now() then" },
  { name: 'banco/link: limite de falhas não acumula', file: 'os_public.sql', find: "perform private.os_rate_bump('pubfail:' || src, 600);\n    return null;\n  end if;\n  select * into t", replace: "return null;\n  end if;\n  select * into t" },
  { name: 'banco/link: origem barrada continua passando', file: 'os_public.sql', find: "if private.os_rate_peek('pubfail:' || src, 600) >= 20 then raise exception", replace: "if false then raise exception" },
  { name: 'banco/link: um link ativo por ordem', file: 'os_public.sql', find: "  update public.public_access_tokens set revoked_at = now() where service_order_id = p_order and revoked_at is null;\n  insert into public.public_access_tokens", replace: "  insert into public.public_access_tokens" },
  { name: 'banco/link: hash inválido', file: 'os_public.sql', find: "if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception", replace: "if p_token_hash is null then raise exception" },
  { name: 'banco/link: ordem cancelada gera link', file: 'os_public.sql', find: "if o.execution_status in ('draft', 'cancelled') then raise exception 'ordens em rascunho ou canceladas não têm link de acompanhamento'", replace: "if false then raise exception 'ordens em rascunho ou canceladas não têm link de acompanhamento'" },
  { name: 'banco/público: nota interna na projeção', file: 'os_public.sql', find: "from public.order_updates u where u.service_order_id = o.id and u.visibility = 'customer'),", replace: "from public.order_updates u where u.service_order_id = o.id),", },
  { name: 'banco/público: arquivo interno na projeção', file: 'os_public.sql', find: "from public.order_attachments a where a.service_order_id = o.id and a.visibility = 'customer'),", replace: "from public.order_attachments a where a.service_order_id = o.id)," },
  { name: 'banco/público: arquivo interno por id', file: 'os_public.sql', find: "where id = p_attachment and service_order_id = t.service_order_id and visibility = 'customer';", replace: "where id = p_attachment and service_order_id = t.service_order_id;" },
  { name: 'banco/público: arquivo de outra ordem', file: 'os_public.sql', find: "where id = p_attachment and service_order_id = t.service_order_id and visibility = 'customer';", replace: "where id = p_attachment and visibility = 'customer';" },
  { name: 'banco/público: rascunho na projeção', file: 'os_public.sql', find: "where service_order_id = o.id and status in ('published', 'approved', 'rejected')", replace: "where service_order_id = o.id" },
  { name: 'banco/público: decidir versão de outra ordem', file: 'os_public.sql', find: "select * into q from public.quote_versions where id = p_quote and service_order_id = o.id;", replace: "select * into q from public.quote_versions where id = p_quote;" },
  { name: 'banco/público: nome obrigatório', file: 'os_public.sql', find: "nm := private.os_req_text(p_name, 2, 120, 'Seu nome');\n  perform private.os_decide_quote", replace: "nm := p_name;\n  perform private.os_decide_quote" },
  { name: 'banco/aceite: versão antiga', file: 'os_public.sql', find: "if p_completion_version is distinct from o.completion_version then raise exception", replace: "if false then raise exception" },
  { name: 'banco/aceite: ordem não concluída', file: 'os_public.sql', find: "if o.execution_status <> 'completed' then raise exception 'esta ordem não está aguardando o seu aceite'", replace: "if false then raise exception 'esta ordem não está aguardando o seu aceite'" },
  { name: 'banco/aceite: resposta duplicada', file: 'os_public.sql', find: "if exists (select 1 from public.completion_acceptances where service_order_id = o.id and completion_version = o.completion_version) then raise exception 'esta conclusão já recebeu uma resposta' using errcode = '23514'; end if;\n  insert into public.completion_acceptances (organization_id, service_order_id, completion_version, decision, channel, declared_name, accepted_text, note, evidence)", replace: "insert into public.completion_acceptances (organization_id, service_order_id, completion_version, decision, channel, declared_name, accepted_text, note, evidence)" },
  { name: 'banco/aceite: contestação sem motivo', file: 'os_public.sql', find: "if p_decision = 'contested' and (nt is null or char_length(nt) < 5) then raise exception 'conte o que precisa ser revisto (mínimo 5 caracteres)'", replace: "if false then raise exception 'conte o que precisa ser revisto (mínimo 5 caracteres)'" },
  { name: 'banco/aceite: registro manual sem justificativa', file: 'os_public.sql', find: "jst := private.os_req_text(p_justification, 10, 500, 'Justificativa'); nt :=", replace: "jst := coalesce(p_justification, 'sem justificativa informada'); nt :=" },
  { name: 'banco/aceite: texto montado no banco', file: 'os_public.sql', find: "values (o.organization_id, o.id, o.completion_version, p_decision, 'customer_link', nm, private.os_completion_text(o.id, o.completion_version, p_decision, 'customer_link'), nt,", replace: "values (o.organization_id, o.id, o.completion_version, p_decision, 'customer_link', nm, 'texto livre sem relação com a conclusão aceita pelo cliente', nt," },
  { name: 'banco/storage: política pública do arquivo', file: 'os_storage.sql', find: "and a.storage_path = p_name and a.visibility = 'customer');", replace: "and a.storage_path = p_name);" },
  { name: 'banco/storage: token expirado', file: 'os_storage.sql', find: "where t.token_hash = sha256(convert_to(tok, 'UTF8')) and t.revoked_at is null and t.expires_at > now()", replace: "where t.token_hash = sha256(convert_to(tok, 'UTF8')) and t.revoked_at is null" },
  // ---------------------------------------------------------------- banco: acesso (RLS), guardas e integridade
  { name: 'banco/acesso: técnico vê todas as ordens', file: 'os_access.sql', find: "when 'technician' then coalesce(tech = (select auth.uid()), false)", replace: "when 'technician' then true" },
  { name: 'banco/acesso: leitor com perfil', file: 'os_access.sql', find: "when 'member' then case when private.os_tech_active(org, (select auth.uid())) then 'technician' end\n    else null end;\n$$;\ncreate function private.os_is_owner", replace: "when 'member' then case when private.os_tech_active(org, (select auth.uid())) then 'technician' end\n    else 'technician' end;\n$$;\ncreate function private.os_is_owner" },
  { name: 'banco/acesso: técnico desativado', file: 'os_access.sql', find: "when 'member' then case when private.os_tech_active(org, (select auth.uid())) then 'technician' end\n    else null end;\n$$;\ncreate function private.os_is_owner", replace: "when 'member' then 'technician'\n    else null end;\n$$;\ncreate function private.os_is_owner" },
  { name: 'banco/acesso: técnico lê custos', file: 'os_access.sql', find: "create policy os_costs_read on public.order_internal_costs for select to authenticated using (private.os_is_manager(organization_id));", replace: "create policy os_costs_read on public.order_internal_costs for select to authenticated using (private.os_is_staff(organization_id));" },
  { name: 'banco/acesso: técnico lê CPF/CNPJ', file: 'os_access.sql', find: "create policy os_customer_private_read on public.customer_private for select to authenticated using (private.os_is_manager(organization_id));", replace: "create policy os_customer_private_read on public.customer_private for select to authenticated using (private.os_is_staff(organization_id));" },
  { name: 'banco/acesso: técnico lê rascunho', file: 'os_access.sql', find: "(status <> 'draft' or private.os_is_manager(organization_id)));\ncreate policy os_quote_items_read", replace: "true);\ncreate policy os_quote_items_read" },
  { name: 'banco/acesso: técnico lê eventos de custo', file: 'os_access.sql', find: "(event_type not like 'cost%' or private.os_is_manager(organization_id)));", replace: "true);" },
  { name: 'banco/acesso: técnico lê cliente sem ordem', file: 'os_access.sql', find: "when 'technician' then exists (select 1 from public.service_orders o where o.organization_id = org and o.customer_id = cust and o.assigned_technician_user_id = (select auth.uid()))", replace: "when 'technician' then true" },
  { name: 'banco/acesso: hash do token legível', file: 'os_access.sql', find: "grant select (id, organization_id, service_order_id, expires_at, revoked_at, created_at, last_used_at) on public.public_access_tokens to authenticated;", replace: "grant select on public.public_access_tokens to authenticated;" },
  { name: 'banco/guarda: MFA nas funções', file: 'os_guards.sql', find: "if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;\n  prof := private.os_profile(p_org);", replace: "prof := private.os_profile(p_org);" },
  { name: 'banco/guarda: nível proprietário', file: 'os_guards.sql', find: "when 'owner' then prof = 'owner'\n    when 'manager' then prof in ('owner', 'manager')", replace: "when 'owner' then prof in ('owner', 'manager')\n    when 'manager' then prof in ('owner', 'manager')" },
  { name: 'banco/guarda: nível gestão', file: 'os_guards.sql', find: "when 'manager' then prof in ('owner', 'manager')\n    else true end;", replace: "when 'manager' then true\n    else true end;" },
  { name: 'banco/guarda: transição inválida', file: 'os_guards.sql', find: "or (old.execution_status = 'completed' and new.execution_status in ('closed', 'in_progress'))", replace: "or (old.execution_status = 'completed' and new.execution_status in ('closed', 'in_progress', 'open'))" },
  { name: 'banco/guarda: encerrada editável', file: 'os_guards.sql', find: "if old.execution_status in ('completed', 'closed', 'cancelled') and new.execution_status = old.execution_status", replace: "if old.execution_status in ('cancelled') and new.execution_status = old.execution_status" },
  { name: 'banco/guarda: iniciar sem responsável', file: 'os_guards.sql', find: "if new.execution_status = 'in_progress' and old.execution_status <> 'in_progress' and new.assigned_technician_user_id is null then", replace: 'if false then' },
  { name: 'banco/guarda: identidade da ordem', file: 'os_guards.sql', find: "if new.id <> old.id or new.order_number <> old.order_number or new.customer_id <> old.customer_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then", replace: 'if false then' },
  { name: 'banco/guarda: versão não incrementa', file: 'os_guards.sql', find: "then new.version := old.version + 1; end if;\n  return new;\nend $$;\nrevoke all on function private.os_order_guard()", replace: "then new.version := old.version; end if;\n  return new;\nend $$;\nrevoke all on function private.os_order_guard()" },
  { name: 'banco/guarda: responsável inválido no gatilho', file: 'os_guards.sql', find: "and not private.os_assignable(new.organization_id, new.assigned_technician_user_id) then\n    raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '23514';\n  end if;\n  if new.completion_version", replace: "and false then\n    raise exception 'responsável inválido: precisa ser membro ativo da empresa com perfil operacional' using errcode = '23514';\n  end if;\n  if new.completion_version" },
  { name: 'banco/guarda: conclusão pula versão', file: 'os_guards.sql', find: "if new.completion_version < old.completion_version or new.completion_version > old.completion_version + 1 then", replace: 'if false then' },
  { name: 'banco/guarda: orçamento publicado editável', file: 'os_guards.sql', find: "if old.status <> 'draft'\n     and (to_jsonb(new) - 'status' - 'version' - 'updated_at')", replace: "if false\n     and (to_jsonb(new) - 'status' - 'version' - 'updated_at')" },
  { name: 'banco/guarda: transição de orçamento', file: 'os_guards.sql', find: "or (old.status = 'published' and new.status in ('approved', 'rejected', 'superseded'))) then", replace: "or (old.status = 'published' and new.status in ('approved', 'rejected', 'superseded')) or old.status in ('approved', 'rejected')) then" },
  { name: 'banco/guarda: itens do orçamento publicado', file: 'os_guards.sql', find: "if st is not null and st <> 'draft' then raise exception 'itens de orçamento publicado são imutáveis", replace: "if false then raise exception 'itens de orçamento publicado são imutáveis" },
  { name: 'banco/guarda: decisão editável', file: 'os_guards.sql', find: "foreach t in array array['service_order_snapshots', 'quote_decisions', 'order_part_usage', 'order_internal_costs', 'order_updates', 'order_completions', 'completion_acceptances', 'order_events'] loop", replace: "foreach t in array array['service_order_snapshots', 'order_part_usage', 'order_internal_costs', 'order_updates', 'order_completions', 'completion_acceptances', 'order_events'] loop" },
  { name: 'banco/guarda: aceite editável', file: 'os_guards.sql', find: "'order_updates', 'order_completions', 'completion_acceptances', 'order_events'] loop", replace: "'order_updates', 'order_completions', 'order_events'] loop" },
  { name: 'banco/guarda: anexo editável', file: 'os_guards.sql', find: "if (to_jsonb(new) - 'visibility') is distinct from (to_jsonb(old) - 'visibility') then", replace: 'if false then' },
  { name: 'banco/guarda: link prorrogável', file: 'os_guards.sql', find: "if (to_jsonb(new) - 'revoked_at' - 'last_used_at') is distinct from (to_jsonb(old) - 'revoked_at' - 'last_used_at')", replace: "if false" },
  { name: 'banco/guarda: estrutura do checklist', file: 'os_guards.sql', find: "if (to_jsonb(new) - answer) is distinct from (to_jsonb(old) - answer) then", replace: 'if false then' },
  { name: 'banco/guarda: pausa reaberta', file: 'os_guards.sql', find: "or new.reason <> old.reason or old.ended_at is not null then", replace: "or new.reason <> old.reason then" },
  { name: 'banco/guarda: organização do registro', file: 'os_guards.sql', find: "if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar'", replace: "if false then raise exception 'a organização do registro não pode mudar'" },
  { name: 'banco/guarda: sair da empresa mantém ordens', file: 'os_guards.sql', find: "perform private.os_release_orders(old.organization_id, old.user_id, 'member_removed');", replace: '' },
  { name: 'banco/guarda: em execução fica sem pausa ao sair', file: 'os_guards.sql', find: "insert into public.order_pauses (organization_id, service_order_id, reason) values (p_org, o.id, 'Responsável deixou de atuar na empresa');", replace: '' },
  { name: 'banco/guarda: agendada continua sem responsável', file: 'os_guards.sql', find: "update public.service_orders set execution_status = 'open', assigned_technician_user_id = null, scheduled_start_at = null, scheduled_end_at = null where id = o.id;\n    else\n      update public.service_orders set assigned_technician_user_id = null where id = o.id;", replace: "update public.service_orders set assigned_technician_user_id = null where id = o.id;\n    else\n      update public.service_orders set assigned_technician_user_id = null where id = o.id;" },
  { name: 'banco/guarda: limite de tentativas', file: 'os_guards.sql', find: "if h > p_max then raise exception 'Muitas tentativas em pouco tempo.", replace: "if false then raise exception 'Muitas tentativas em pouco tempo." },
  // ---------------------------------------------------------------- banco: cadastros e painel
  { name: 'banco/cadastro: CPF/CNPJ válido', file: 'os_registry.sql', find: "if doc is not null and not private.os_valid_document(doc) then raise exception", replace: "if false then raise exception" },
  { name: 'banco/cadastro: técnico desativa o próprio acesso', file: 'os_registry.sql', find: "if p_user = (select auth.uid()) then raise exception 'você não pode desativar o próprio acesso'", replace: "if false then raise exception 'você não pode desativar o próprio acesso'" },
  { name: 'banco/cadastro: desativar sem liberar ordens', file: 'os_registry.sql', find: "    n := private.os_release_orders(p_org, p_user, 'technician_deactivated');", replace: '    n := 0;' },
  { name: 'banco/cadastro: configurações só do proprietário', file: 'os_registry.sql', find: "perform private.os_guard(p_org, 'owner');\n  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;\n  update public.os_settings set", replace: "perform private.os_guard(p_org, 'manager');\n  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;\n  update public.os_settings set" },
  { name: 'banco/cadastro: modelo sem itens', file: 'os_registry.sql', find: "or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then", replace: "or jsonb_array_length(p_items) > 100 then" },
  { name: 'banco/cadastro: preço de referência negativo', file: 'os_registry.sql', find: "if pr < 0 or pr > 1000000000 then raise exception 'preço de referência fora do permitido' using errcode = '22023'; end if;\n  if p_id is null then\n    insert into public.service_catalog", replace: "if p_id is null then\n    insert into public.service_catalog" },
  { name: 'banco/painel: backlog', file: 'os_reads.sql', find: "backlog as (select * from scope where execution_status in ('open', 'scheduled', 'in_progress', 'paused')),", replace: "backlog as (select * from scope where execution_status in ('open', 'scheduled', 'in_progress')),", },
  { name: 'banco/painel: aguardando aceite com versão antiga', file: 'os_reads.sql', find: "and not exists (select 1 from public.completion_acceptances a where a.service_order_id = o.id and a.completion_version = o.completion_version and a.decision = 'accepted')),\n    'closed_in_period'", replace: "and not exists (select 1 from public.completion_acceptances a where a.service_order_id = o.id and a.decision = 'accepted')),\n    'closed_in_period'" },
  { name: 'banco/painel: atrasadas', file: 'os_reads.sql', find: "'late', (select count(*) from backlog where scheduled_end_at is not null and scheduled_end_at < now()),", replace: "'late', (select count(*) from scope where scheduled_end_at is not null and scheduled_end_at < now())," },
  { name: 'banco/painel: técnico vê todas', file: 'os_reads.sql', find: "(prof <> 'technician' or o.assigned_technician_user_id = uid)),", replace: "true)," },
  { name: 'banco/painel: técnico vê valores', file: 'os_reads.sql', find: "'approved_value', case when prof = 'technician' then null else", replace: "'approved_value', case when false then null else" },
  { name: 'banco/painel: período máximo', file: 'os_reads.sql', find: "or p_to - p_from > 366 then", replace: "then" },
  { name: 'banco/painel: fuso', file: 'os_reads.sql', find: "f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;", replace: "f := p_from::timestamp at time zone 'UTC'; t := (p_to + 1)::timestamp at time zone 'UTC';" },
  { name: 'banco/painel: valor aprovado da última versão', file: 'os_reads.sql', find: "where q.organization_id = p_org and q.status = 'approved' and q.service_order_id in (select id from scope)\n    order by q.service_order_id, q.version_number desc),", replace: "where q.organization_id = p_org and q.status = 'approved' and q.service_order_id in (select id from scope)\n    order by q.service_order_id, q.version_number asc)," },
  { name: 'banco/painel: tempo de ciclo', file: 'os_reads.sql', find: "extract(epoch from (completed_at - created_at)) as secs", replace: "extract(epoch from (completed_at - coalesce(started_at, created_at))) as secs" },
  { name: 'banco/documento: rascunho vira documento', file: 'os_reads.sql', find: "select * into q from public.quote_versions where service_order_id = p_order and version_number = p_ref and status <> 'draft';", replace: "select * into q from public.quote_versions where service_order_id = p_order and version_number = p_ref;" },
  { name: 'banco/documento: snapshot atual no orçamento', file: 'os_reads.sql', find: "    sv := q.snapshot_version;\n  elsif p_kind = 'completion' then", replace: "    sv := private.os_snapshot_current(p_order);\n  elsif p_kind = 'completion' then" },
  { name: 'banco/documento: técnico de outra ordem', file: 'os_reads.sql', find: "if not private.os_can_see_order(p_org, p_order) then raise exception 'ordem de serviço não encontrada' using errcode = 'P0002'; end if;\n  return private.os_document_data", replace: "return private.os_document_data" },
  // ---------------------------------------------------------------- banco: privilégios e integridade
  { name: 'banco/privilégio: função administrativa executável por anon', file: 'os_privileges.sql', find: "execute format('revoke all on function %s from public, anon', f.sig);\n    execute format('grant execute on function %s to authenticated', f.sig);\n    if f.proname like 'os\\_public\\_%' then", replace: "execute format('revoke all on function %s from public', f.sig);\n    execute format('grant execute on function %s to authenticated', f.sig);\n    if f.proname like 'os\\_public\\_%' then" },
  { name: 'banco/privilégio: porta pública sem anon', file: 'os_privileges.sql', find: "      execute format('grant execute on function %s to anon', f.sig);\n", replace: '' },
  { name: 'banco/privilégio: função interna exposta', file: 'os_privileges.sql', find: "if f.proname in ('os_role', 'os_tech_active'", replace: "if true or f.proname in ('os_role', 'os_tech_active'" },
  { name: 'banco/integridade: número repetido', file: 'os_schema.sql', find: '  unique (organization_id, order_number),\n', replace: '' },
  { name: 'banco/integridade: dois rascunhos', file: 'os_schema.sql', find: 'create unique index quote_versions_one_draft_uq on public.quote_versions (service_order_id) where status = \'draft\';', replace: '' },
  { name: 'banco/integridade: duas versões publicadas', file: 'os_schema.sql', find: 'create unique index quote_versions_one_published_uq on public.quote_versions (service_order_id) where status = \'published\';', replace: '' },
  { name: 'banco/integridade: duas decisões na versão', file: 'os_schema.sql', find: '  quote_version_id uuid not null unique,\n  decision text not null check (decision in (\'approved\', \'rejected\')),', replace: '  quote_version_id uuid not null,\n  decision text not null check (decision in (\'approved\', \'rejected\')),' },
  { name: 'banco/integridade: dois aceites na versão', file: 'os_schema.sql', find: "  unique (service_order_id, completion_version),\n  check (decision = 'accepted' or note is not null),", replace: "  check (decision = 'accepted' or note is not null)," },
  { name: 'banco/integridade: dois links ativos', file: 'os_schema.sql', find: 'create unique index public_access_tokens_active_uq on public.public_access_tokens (service_order_id) where revoked_at is null;', replace: '' },
  { name: 'banco/integridade: cliente de outra empresa na ordem', file: 'os_schema.sql', find: '  foreign key (customer_id, organization_id) references public.customers (id, organization_id),\n  foreign key (address_id', replace: '  foreign key (customer_id) references public.customers (id),\n  foreign key (address_id' },
  { name: 'banco/integridade: equipamento de outro cliente', file: 'os_schema.sql', find: '  foreign key (equipment_id, organization_id, customer_id) references public.equipment (id, organization_id, customer_id),', replace: '  foreign key (equipment_id, organization_id) references public.equipment (id, organization_id),' },
  { name: 'banco/integridade: peça de outra empresa no orçamento', file: 'os_schema.sql', find: '  foreign key (part_id, organization_id) references public.part_catalog (id, organization_id)\n);\n\n-- Uma decisão por versão', replace: '  foreign key (part_id) references public.part_catalog (id)\n);\n\n-- Uma decisão por versão' },
  { name: 'banco/integridade: total da linha', file: 'os_schema.sql', find: '  check (line_total_cents = round(quantity * unit_price_cents)),', replace: '' },
  { name: 'banco/integridade: total do orçamento', file: 'os_schema.sql', find: '  check (discount_cents <= subtotal_cents and total_cents = subtotal_cents - discount_cents),', replace: '' },
  { name: 'banco/integridade: decisão manual sem justificativa', file: 'os_schema.sql', find: "  check ((channel = 'staff_manual') = (justification is not null)),\n  foreign key (quote_version_id, organization_id)", replace: "  foreign key (quote_version_id, organization_id)" },
  { name: 'banco/integridade: estorno sem referência', file: 'os_schema.sql', find: "or (entry_kind = 'reversal' and quantity < 0 and reference_usage_id is not null and reason is not null)", replace: "or (entry_kind = 'reversal' and quantity < 0)" },
  { name: 'banco/integridade: agendada sem técnico', file: 'os_schema.sql', find: "  check (execution_status <> 'scheduled' or (assigned_technician_user_id is not null and scheduled_start_at is not null)),", replace: '' },
  { name: 'banco/integridade: janela máxima', file: 'os_schema.sql', find: "check (scheduled_end_at is null or (scheduled_end_at > scheduled_start_at and scheduled_end_at <= scheduled_start_at + interval '14 days')),", replace: "check (scheduled_end_at is null or scheduled_end_at > scheduled_start_at)," },
  { name: 'banco/integridade: execução sem orçamento sem justificativa', file: 'os_schema.sql', find: "  check ((quote_mode = 'authorized') = (authorization_justification is not null)),", replace: '' },
  { name: 'banco/integridade: pausa aberta duplicada', file: 'os_schema.sql', find: 'create unique index order_pauses_open_uq on public.order_pauses (service_order_id) where ended_at is null;', replace: '' },
  // ---------------------------------------------------------------- concorrência (sessões simultâneas reais)
  { name: 'conc/trava: ordem sem trava de linha', file: 'os_helpers.sql', find: 'if p_lock then select * into o from public.service_orders where id = p_order and organization_id = p_org for update;', replace: 'if p_lock then select * into o from public.service_orders where id = p_order and organization_id = p_org;', suite: 'conc' },
  { name: 'conc/numeração: MAX + 1', file: 'os_helpers.sql', find: "insert into public.order_number_counters as c (organization_id, last_number) values (p_org, 1)\n  on conflict (organization_id) do update set last_number = c.last_number + 1 returning last_number into n;", replace: "select coalesce(max(order_number), 0) + 1 into n from public.service_orders where organization_id = p_org;", suite: 'conc' },
  { name: 'conc/idempotência: chave sem reserva', file: 'os_helpers.sql', find: "insert into public.mutation_requests (organization_id, user_id, idempotency_key, scope, request_hash) values (p_org, p_uid, p_key, p_scope, p_hash) on conflict do nothing;\n  get diagnostics n = row_count;\n  if n = 1 then return null; end if;", replace: "n := 1;\n  if n = 1 then return null; end if;", suite: 'conc' },
  { name: 'conc/peças: saldo negativo sob concorrência', file: 'os_orders.sql', find: '  o := private.os_load_order(p_org, p_order, true, null);\n  if not private.os_can_execute(o) then raise exception \'sem permissão\' using errcode = \'42501\'; end if;\n  if o.execution_status not in (\'in_progress\', \'paused\') then raise exception \'correções de peças', replace: '  o := private.os_load_order(p_org, p_order, false, null);\n  if not private.os_can_execute(o) then raise exception \'sem permissão\' using errcode = \'42501\'; end if;\n  if o.execution_status not in (\'in_progress\', \'paused\') then raise exception \'correções de peças', suite: 'conc' },
];

const migDir = join(root, 'supabase', 'migrations');
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql'));
const SCRIPT = { db: 'test-db.mjs', conc: 'test-concurrency.mjs' };
const kindOf = (m) => m.suite ?? (m.ts ? 'unit' : 'db');

function runSuite(dir, suite) {
  return new Promise((resolve) => {
    const cmd = suite === 'unit'
      ? [join(dir, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'tests/unit']
      : [join(dir, 'scripts', SCRIPT[suite])];
    const p = spawn(process.execPath, cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

function applyMutation(path, mutate) {
  const text = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  const parts = text.split(mutate.find);
  const nth = mutate.nth ?? 1;
  if (parts.length < 2) throw new Error(`mutação sem alvo: ${mutate.name}`);
  if (parts.length > 2 && !mutate.nth) throw new Error(`mutação ambígua (${parts.length - 1} ocorrências): ${mutate.name}`);
  if (nth > parts.length - 1) throw new Error(`mutação sem a ocorrência ${nth}: ${mutate.name}`);
  writeFileSync(path, parts.slice(0, nth).join(mutate.find) + mutate.replace + parts.slice(nth).join(mutate.find));
}

function workspace(label, mutate, suite) {
  const dir = mkdtempSync(join(tmpdir(), `pack25-os-mut-${label}-`));
  if (suite === 'unit') {
    for (const d of ['lib', 'tests', 'app', 'components']) cpSync(join(root, d), join(dir, d), { recursive: true });
    for (const f of ['vitest.config.ts', 'tsconfig.json', 'package.json']) cpSync(join(root, f), join(dir, f));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
    if (mutate) applyMutation(join(dir, mutate.ts), mutate);
    return dir;
  }
  mkdirSync(join(dir, 'scripts'));
  for (const s of Object.values(SCRIPT)) cpSync(join(root, 'scripts', s), join(dir, 'scripts', s));
  cpSync(join(root, 'supabase'), join(dir, 'supabase'), { recursive: true });
  if (mutate) applyMutation(join(dir, 'supabase', 'migrations', files.find((x) => x.includes(mutate.file))), mutate);
  return dir;
}

if (args.includes('--check')) {
  // só confere se cada mutação encontra o seu alvo (rápido; não roda suítes)
  let bad = 0;
  for (const m of M) {
    const path = m.ts ? join(root, m.ts) : join(migDir, files.find((x) => x.includes(m.file)) ?? '');
    const n = readFileSync(path, 'utf8').replaceAll('\r\n', '\n').split(m.find).length - 1;
    if (!(n >= 1 && (m.nth ? m.nth <= n : n === 1))) { bad++; console.log(`SEM ALVO ÚNICO (${n} ocorrências): ${m.name}`); }
  }
  console.log(bad ? `${bad} mutação(ões) com alvo inválido` : `${M.length} mutações com alvo válido`);
  process.exit(bad ? 1 : 0);
}

const todo = M.filter(wanted);
for (const suite of new Set(todo.map(kindOf))) {
  const base = workspace(`base-${suite}`, null, suite);
  const baseline = await runSuite(base, suite);
  rmSync(base, { recursive: true, force: true });
  if (baseline.code !== 0) {
    console.error(`A suíte «${suite}» sem mutação já reprova; corrija antes.\n` + baseline.out.slice(-1500));
    process.exit(2);
  }
}

const survived = [];
const broken = [];
let next = 0;
async function worker() {
  while (next < todo.length) {
    const m = todo[next++];
    const suite = kindOf(m);
    let dir;
    try {
      dir = workspace(String(next), m, suite);
    } catch (e) {
      console.log(`SEM ALVO    ${m.name} — ${e.message}`);
      broken.push(m.name);
      continue;
    }
    const r = await runSuite(dir, suite);
    rmSync(dir, { recursive: true, force: true });
    const killed = r.code !== 0;
    console.log(`${killed ? 'MORTA     ' : 'SOBREVIVEU '} ${m.name}`);
    if (!killed) survived.push(m.name);
  }
}
// a suíte de concorrência é sensível a carga: roda sozinha, depois das demais
const light = todo.filter((m) => kindOf(m) !== 'conc');
const heavy = todo.filter((m) => kindOf(m) === 'conc');
const all = todo.slice();
todo.length = 0;
todo.push(...light);
next = 0;
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
todo.length = 0;
todo.push(...heavy);
next = 0;
await Promise.all(Array.from({ length: 1 }, worker));
console.log(`\n${all.length - survived.length - broken.length}/${all.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (survived.length || broken.length) process.exit(1);
