#!/usr/bin/env node
// Teste de mutação das regras críticas (domínio TypeScript E banco): quebra cada regra DE PROPÓSITO numa cópia do código e exige que a suíte reprove.
// Se alguma mutação sobreviver, falta teste.
//   suite 'unit' → vitest nos testes do domínio (tests/unit/*)
//   suite 'db'   → pnpm test:db (testes SQL: 50, 51, 55, 70 e 80)
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

const L = 'lib/pj/';
// { name, file (trecho do arquivo de migração) | ts (caminho do arquivo TS), find, replace, nth (qual ocorrência; omitido = única), suite }
// Mutantes EQUIVALENTES (ou fora do alcance do Postgres de teste) retirados da lista, cada um com o motivo:
//   - grupo: oitavo dia entra: datas ISO têm tamanho fixo: «plus7 + 9» só mudaria o resultado para datas que começam com o mesmo prefixo, o que não existe
//   - ordem: referência é a própria tarefa: a lista sem a própria tarefa não contém a referência: o resultado é nulo de qualquer forma
//   - markdown: link por colchetes só com http: o link aceito pela expressão ainda passa por safeHref, que recusa tudo fora de http/https: o texto sai igual
//   - texto: NUL aceito: o byte 0 também é menor que 32 e já reprova pela regra seguinte
//   - banco/rls: comentários de todos: a política consulta tasks sob a RLS de quem lê: a visibilidade da tarefa já restringe o comentário
//   - banco/estado: arquivado escreve: projeto arquivado é sempre concluído ou cancelado (gatilho), que já não aceitam escrita
//   - banco/projeto: arquivado muda de status: mudar o status já conta como mudança de conteúdo na mesma condição
//   - banco/projeto: arquivado ativo: todos os caminhos para arquivado+ativo já caem em regras anteriores do mesmo gatilho
//   - banco/etapa: contagem da etapa alterada: o quadro nunca fica sem «A fazer»/«Concluído», então a etapa alterada nunca é a que supre a falta
//   - banco/tarefa: desarquivar: tarefa arquivada já é recusada antes, no mesmo gatilho
//   - banco/aux: ordem inconsistente: defesa: os chamadores montam a lista a partir do estado travado, então a contagem sempre bate
//   - banco/etapa: reordenar incompleto: lista incompleta também reprova na checagem de elementos distintos
//   - banco/tarefa: criar em projeto somente consulta: o gatilho da tabela recusa com a mesma mensagem
//   - banco/tarefa: responsável inválido na criação (função): o gatilho da tabela recusa com a mesma mensagem
//   - banco/tarefa: atribuir a leitor: o gatilho da tabela recusa com a mesma mensagem
//   - banco/painel: aberta em projeto arquivado: projeto arquivado é concluído (sem tarefas abertas) ou cancelado (já excluído)
//   - banco/painel: projetos ativos: projeto ativo nunca está arquivado (gatilho)
//   - banco/esquema: responsável de outra empresa: o gatilho da tabela exige responsável elegível do mesmo projeto
//   - banco/privilégio: função interna exposta: cada migração já revoga o acesso das próprias funções internas; a revogação final é cinto e suspensório
//   - banco/storage: enviar sem poder editar: as políticas do Storage só existem no Supabase real (o Postgres de teste não tem o esquema storage); cobertas por revisão e pelo E2E de segurança
//   - banco/storage: ler sem acesso: idem (Storage)
//   - banco/storage: ler arquivo sem registro: idem (Storage)
//   - banco/storage: remover arquivo com registro: idem (Storage)
//   - banco/storage: remover arquivo recente: idem (Storage)
//   - banco/storage: logotipo por qualquer um: idem (Storage)
//   - banco/storage: caminho de envio: idem (Storage)
//   - conc/numeração: tarefa com MAX + 1: a trava de linha do projeto já serializa a criação; o contador é a segunda defesa
const M = [
  // ---------------------------------------------------------------- TS: papéis e permissões
  { name: 'papel: gestão deixa de ser líder', ts: `${L}status.ts`, find: "if (isManagement(profile)) return 'lead';", replace: 'if (false) return \'lead\';' },
  { name: 'papel: sem perfil tem papel', ts: `${L}status.ts`, find: 'if (profile === null) return null;', replace: '' },
  { name: 'papel: leitor edita', ts: `${L}status.ts`, find: "r === 'lead' || r === 'editor';\nexport const canLeadRole", replace: "r === 'lead' || r === 'editor' || r === 'reader';\nexport const canLeadRole" },
  { name: 'papel: editor lidera', ts: `${L}status.ts`, find: "export const canLeadRole = (r: ProjectRole | null): boolean => r === 'lead';", replace: "export const canLeadRole = (r: ProjectRole | null): boolean => r === 'lead' || r === 'editor';" },
  { name: 'papel: leitor da empresa como editor', ts: `${L}status.ts`, find: "  if (profile === 'viewer') return ['reader'];\n", replace: '' },
  { name: 'papel: gestão como participante explícito', ts: `${L}status.ts`, find: '  if (isManagement(profile)) return [];\n', replace: '' },
  // ---------------------------------------------------------------- TS: estado do projeto
  { name: 'estado: executar em pausado', ts: `${L}status.ts`, find: "return mode === 'execute' ? p.status === 'active' :", replace: "return mode === 'execute' ? (p.status === 'active' || p.status === 'paused') :" },
  { name: 'estado: executar em planejado', ts: `${L}status.ts`, find: "return mode === 'execute' ? p.status === 'active' :", replace: "return mode === 'execute' ? (p.status === 'active' || p.status === 'planned') :" },
  { name: 'estado: organizar em pausado negado', ts: `${L}status.ts`, find: "p.status === 'planned' || p.status === 'active' || p.status === 'paused';\n}", replace: "p.status === 'planned' || p.status === 'active';\n}" },
  { name: 'estado: organizar em concluído', ts: `${L}status.ts`, find: "p.status === 'planned' || p.status === 'active' || p.status === 'paused';\n}", replace: "p.status === 'planned' || p.status === 'active' || p.status === 'paused' || p.status === 'completed';\n}" },
  { name: 'estado: arquivado ainda escreve', ts: `${L}status.ts`, find: '  if (p.archived) return false;\n', replace: '' },
  { name: 'estado: planejado conclui direto', ts: `${L}status.ts`, find: "case 'planned': return to === 'active' || to === 'cancelled';", replace: "case 'planned': return to === 'active' || to === 'cancelled' || to === 'completed';" },
  { name: 'estado: ativo volta a planejado', ts: `${L}status.ts`, find: "case 'active': return to === 'paused' || to === 'completed' || to === 'cancelled';", replace: "case 'active': return to === 'paused' || to === 'completed' || to === 'cancelled' || to === 'planned';" },
  { name: 'estado: pausado conclui direto', ts: `${L}status.ts`, find: "case 'paused': return to === 'active' || to === 'cancelled';", replace: "case 'paused': return to === 'active' || to === 'cancelled' || to === 'completed';" },
  { name: 'estado: concluído não reabre', ts: `${L}status.ts`, find: "    case 'completed':\n    case 'cancelled': return to === 'active';", replace: "    case 'cancelled': return to === 'active';" },
  { name: 'estado: cancelado reabre para pausado', ts: `${L}status.ts`, find: "case 'cancelled': return to === 'active';", replace: "case 'cancelled': return to === 'active' || to === 'paused';" },
  { name: 'estado: cancelar sem motivo', ts: `${L}status.ts`, find: "to === 'cancelled' || ((from === 'completed'", replace: "false || ((from === 'completed'" },
  { name: 'estado: reabrir sem motivo', ts: `${L}status.ts`, find: "|| ((from === 'completed' || from === 'cancelled') && to === 'active');", replace: ';' },
  { name: 'estado: arquivar projeto ativo', ts: `${L}status.ts`, find: "!p.archived && (p.status === 'completed' || p.status === 'cancelled');", replace: "!p.archived && (p.status === 'completed' || p.status === 'cancelled' || p.status === 'active');" },
  { name: 'estado: arquivar duas vezes', ts: `${L}status.ts`, find: "!p.archived && (p.status === 'completed' || p.status === 'cancelled');", replace: "(p.status === 'completed' || p.status === 'cancelled');" },
  { name: 'mover: execução em projeto pausado', ts: `${L}status.ts`, find: 'if (from !== to && !projectAllows(project, \'execute\')) {', replace: 'if (from !== to && false) {' },
  { name: 'mover: organizar em projeto concluído', ts: `${L}status.ts`, find: "if (!projectAllows(project, 'organize')) return { ok: false, reason: 'O projeto não aceita movimentações (concluído, cancelado ou arquivado).' };", replace: '' },
  { name: 'mover: mensagem de pausado trocada', ts: `${L}status.ts`, find: "project.status === 'paused' ? 'Projeto pausado", replace: "project.status === 'planned' ? 'Projeto pausado" },
  { name: 'mover: mesmo tipo exige execução', ts: `${L}status.ts`, find: 'if (from !== to && !projectAllows', replace: 'if (!projectAllows' },
  // ---------------------------------------------------------------- TS: checklist, indicadores, datas, ordem
  { name: 'checklist: opcional bloqueia', ts: `${L}status.ts`, find: 'items.filter((i) => i.required && !i.done).length', replace: 'items.filter((i) => !i.done).length' },
  { name: 'checklist: obrigatório não bloqueia', ts: `${L}status.ts`, find: 'items.filter((i) => i.required && !i.done).length', replace: 'items.filter((i) => false).length' },
  { name: 'checklist: 1 pendente passa', ts: `${L}status.ts`, find: 'return n === 0 ?', replace: 'return n <= 1 ?' },
  { name: 'projeto: conclui com tarefa arquivada pendente', ts: `${L}status.ts`, find: "tasks.filter((t) => !t.archived && t.semantic !== 'done').length", replace: "tasks.filter((t) => t.semantic !== 'done').length" },
  { name: 'projeto: concluída conta como pendente', ts: `${L}status.ts`, find: "tasks.filter((t) => !t.archived && t.semantic !== 'done').length", replace: "tasks.filter((t) => !t.archived).length" },
  { name: 'progresso: sem tarefas = 100%', ts: `${L}status.ts`, find: 'if (total <= 0) return null;', replace: 'if (total <= 0) return 100;' },
  { name: 'progresso: arredondamento', ts: `${L}status.ts`, find: 'return Math.round((100 * done) / total);', replace: 'return Math.floor((100 * done) / total);' },
  { name: 'progresso: base errada', ts: `${L}status.ts`, find: 'return Math.round((100 * done) / total);', replace: 'return Math.round((100 * done) / (total + 1));' },
  { name: 'aberta: arquivada conta', ts: `${L}status.ts`, find: "return !t.archived && t.semantic !== 'done' && p.status !== 'cancelled' && !p.archived;", replace: "return t.semantic !== 'done' && p.status !== 'cancelled' && !p.archived;" },
  { name: 'aberta: concluída conta', ts: `${L}status.ts`, find: "return !t.archived && t.semantic !== 'done' && p.status !== 'cancelled' && !p.archived;", replace: "return !t.archived && p.status !== 'cancelled' && !p.archived;" },
  { name: 'aberta: projeto cancelado conta', ts: `${L}status.ts`, find: "return !t.archived && t.semantic !== 'done' && p.status !== 'cancelled' && !p.archived;", replace: "return !t.archived && t.semantic !== 'done' && !p.archived;" },
  { name: 'aberta: projeto arquivado conta', ts: `${L}status.ts`, find: "return !t.archived && t.semantic !== 'done' && p.status !== 'cancelled' && !p.archived;", replace: "return !t.archived && t.semantic !== 'done' && p.status !== 'cancelled';" },
  { name: 'atraso: vence hoje já é atraso', ts: `${L}status.ts`, find: 't.dueDate !== null && t.dueDate < today', replace: 't.dueDate !== null && t.dueDate <= today' },
  { name: 'atraso: sem prazo atrasa', ts: `${L}status.ts`, find: 't.dueDate !== null && t.dueDate < today', replace: '(t.dueDate === null || t.dueDate < today)' },
  { name: 'atraso: tarefa aberta não exigida', ts: `${L}status.ts`, find: 'return isOpenTask(t, p) && t.dueDate', replace: 'return t.dueDate' },
  { name: 'grupo: hoje vira atrasada', ts: `${L}status.ts`, find: "if (dueDate < today) return 'overdue';", replace: "if (dueDate <= today) return 'overdue';" },
  { name: 'grupo: sétimo dia sai', ts: `${L}status.ts`, find: "if (dueDate <= plus7) return 'next7';", replace: "if (dueDate < plus7) return 'next7';" },
  { name: 'grupo: sem prazo', ts: `${L}status.ts`, find: "if (!dueDate) return 'none';", replace: '' },
  { name: 'aviso: início antes do projeto', ts: `${L}status.ts`, find: '(project.startDate !== null && d < project.startDate)', replace: '(project.startDate !== null && d <= project.startDate)' },
  { name: 'aviso: depois do fim do projeto', ts: `${L}status.ts`, find: '(project.dueDate !== null && d > project.dueDate)', replace: '(project.dueDate !== null && d >= project.dueDate)' },
  { name: 'aviso: início não avisa', ts: `${L}status.ts`, find: "if (start && outside(start)) out.push('A data de início está fora do período do projeto.');", replace: '' },
  { name: 'aviso: vencimento não avisa', ts: `${L}status.ts`, find: "if (due && outside(due)) out.push('O vencimento está fora do período do projeto.');", replace: '' },
  { name: 'datas: início igual ao fim recusado', ts: `${L}status.ts`, find: '!start || !due || start <= due;', replace: '!start || !due || start < due;' },
  { name: 'ordem: referência inexistente aceita', ts: `${L}status.ts`, find: '  if (idx < 0) return null;\n', replace: '' },
  { name: 'ordem: nova tarefa no início', ts: `${L}status.ts`, find: 'if (beforeId === null) return [...rest, taskId];', replace: 'if (beforeId === null) return [taskId, ...rest];' },
  { name: 'ordem: inserção depois da referência', ts: `${L}status.ts`, find: 'return [...rest.slice(0, idx), taskId, ...rest.slice(idx)];', replace: 'return [...rest.slice(0, idx + 1), taskId, ...rest.slice(idx + 1)];' },
  { name: 'ordem: posições com buraco aceitas', ts: `${L}status.ts`, find: '.every((p, i) => p === i + 1)', replace: '.every((p, i) => p >= i + 1)' },
  { name: 'ações: líder-only arquivar liberado', ts: `${L}status.ts`, find: "if (canLeadRole(p.role)) out.push('archive');", replace: "out.push('archive');" },
  { name: 'ações: concluída aceita impedimento', ts: `${L}status.ts`, find: "if (!p.taskDone) out.push('block', 'checklist');", replace: "out.push('block', 'checklist');" },
  { name: 'ações: projeto somente consulta edita', ts: `${L}status.ts`, find: '|| p.taskArchived || isReadOnlyProject(p.project)) return [];', replace: '|| p.taskArchived) return [];' },
  { name: 'ações: tarefa arquivada edita', ts: `${L}status.ts`, find: '|| p.taskArchived || isReadOnlyProject(p.project)) return [];', replace: '|| isReadOnlyProject(p.project)) return [];' },
  // ---------------------------------------------------------------- TS: markdown seguro
  { name: 'markdown: javascript: vira link', ts: `${L}markdown.ts`, find: "return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null;", replace: 'return x.href;' },
  { name: 'markdown: aspas no link', ts: `${L}markdown.ts`, find: '/[\\s<>"\'`]/.test(u)', replace: '/[\\s<>`]/.test(u)' },
  { name: 'markdown: espaço no link', ts: `${L}markdown.ts`, find: '/[\\s<>"\'`]/.test(u)', replace: '/[<>"\'`]/.test(u)' },
  { name: 'markdown: tamanho do link', ts: `${L}markdown.ts`, find: 'if (u.length > MAX_LINK || ', replace: 'if (' },
  { name: 'markdown: negrito', ts: `${L}markdown.ts`, find: "depth < 3 && rest.startsWith('**')", replace: "false && rest.startsWith('**')" },
  { name: 'markdown: código', ts: `${L}markdown.ts`, find: "if (end > i + 1) { flush(); out.push({ t: 'code'", replace: "if (false) { flush(); out.push({ t: 'code'" },
  { name: 'markdown: lista', ts: `${L}markdown.ts`, find: "const ul = /^\\s{0,3}[-*]\\s+(.+)$/.exec(line);", replace: "const ul = null as RegExpExecArray | null;" },
  { name: 'markdown: limite de itens', ts: `${L}markdown.ts`, find: 'if (list.items.length < 100)', replace: 'if (list.items.length < 100000)' },
  { name: 'markdown: limite de blocos', ts: `${L}markdown.ts`, find: 'return blocks.slice(0, 200);', replace: 'return blocks;' },
  { name: 'markdown: limite de texto', ts: `${L}markdown.ts`, find: '.slice(0, 8000).split', replace: '.split' },
  { name: 'markdown: url solta pontuação final', ts: `${L}markdown.ts`, find: "const trimmed = m[0].replace(/[.,;:!?]+$/, '');", replace: 'const trimmed = m[0];' },
  { name: 'markdown: itálico com palavra_com_sublinhado', ts: `${L}markdown.ts`, find: "&& (i === 0 || /[\\s(]/.test(s[i - 1]!))) {\n      const end = s.indexOf(s[i]!, i + 1);", replace: ") {\n      const end = s.indexOf(s[i]!, i + 1);" },
  // ---------------------------------------------------------------- TS: checklist do formulário, anexos de texto, indicadores, chaves
  { name: 'checklist-form: obrigatório pelo !', ts: `${L}checklist.ts`, find: "l.startsWith('!') ? { title: l.slice(1).trim().slice(0, 200), required: true }", replace: "l.startsWith('!') ? { title: l.slice(1).trim().slice(0, 200), required: false }" },
  { name: 'checklist-form: limite de itens', ts: `${L}checklist.ts`, find: '.filter(Boolean).slice(0, 50)', replace: '.filter(Boolean)' },
  { name: 'checklist-form: tamanho do item', ts: `${L}checklist.ts`, find: ': { title: l.slice(0, 200), required: false })', replace: ': { title: l, required: false })' },
  { name: 'checklist-form: item vazio', ts: `${L}checklist.ts`, find: '.filter((i) => i.title.length > 0)', replace: '' },
  { name: 'texto: controle aceito', ts: `${L}attachments.ts`, find: 'if (v === 0 || (v < 32 && v !== 9 && v !== 10 && v !== 13) || v === 127) return null;', replace: 'if (v === 0) return null;' },
  { name: 'texto: tab recusado', ts: `${L}attachments.ts`, find: 'v !== 9 && v !== 10 && v !== 13', replace: 'v !== 10 && v !== 13' },
  { name: 'texto: UTF-8 inválido', ts: `${L}attachments.ts`, find: "try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return null; }\n", replace: '' },
  { name: 'texto: vazio aceito', ts: `${L}attachments.ts`, find: 'if (b.length === 0 || b.length > 2 * 1024 * 1024) return null;', replace: 'if (b.length > 2 * 1024 * 1024) return null;' },
  { name: 'texto: tamanho máximo', ts: `${L}attachments.ts`, find: 'if (b.length === 0 || b.length > 2 * 1024 * 1024) return null;', replace: 'if (b.length === 0) return null;' },
  { name: 'texto: csv pelo nome', ts: `${L}attachments.ts`, find: "? { ext: 'csv', mime: 'text/csv' } : { ext: 'txt', mime: 'text/plain' };", replace: "? { ext: 'txt', mime: 'text/plain' } : { ext: 'txt', mime: 'text/plain' };" },
  { name: 'arquivo/envio: texto antes da checagem de bytes', ts: `${L}attachments.ts`, find: 'const kind = sniff(original) ?? sniffText(original, f.name);', replace: 'const kind = sniffText(original, f.name) ?? sniff(original);' },
  { name: 'indicador: sem tarefas', ts: `${L}indicators.ts`, find: "return p === null ? 'Sem tarefas' : `${p}%`;", replace: "return p === null ? '0%' : `${p}%`;" },
  { name: 'indicador: sem dados', ts: `${L}indicators.ts`, find: "return n === null || n === undefined ? 'Sem dados' : String(n);", replace: "return n === null || n === undefined ? '0' : String(n);" },
  { name: 'indicador: período padrão', ts: `${L}indicators.ts`, find: 'from: addDays(today, -29)', replace: 'from: addDays(today, -30)' },
  { name: 'chave: zeros do projeto', ts: `${L}keys.ts`, find: "String(n).padStart(4, '0')", replace: "String(n).padStart(3, '0')" },
  { name: 'chave: número da tarefa', ts: `${L}keys.ts`, find: '`${projectKey(prefix, project)}-${task}`', replace: '`${projectKey(prefix, project)}${task}`' },
  { name: 'csv: «=» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[+\\-@\\t\\r]/.test(s);' },
  { name: 'csv: «+» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=\\-@\\t\\r]/.test(s);' },
  { name: 'csv: «-» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=+@\\t\\r]/.test(s);' },
  { name: 'csv: «@» não neutralizado', ts: `${L}csv.ts`, find: 'const danger = /^[=+\\-@\\t\\r]/.test(s);', replace: 'const danger = /^[=+\\-\\t\\r]/.test(s);' },
  { name: 'csv: aspas não duplicadas', ts: `${L}csv.ts`, find: '"${safe.replace(/"/g, \'""\')}"', replace: '"${safe}"' },
  { name: 'csv: ponto e vírgula não protegido', ts: `${L}csv.ts`, find: '/[";\\n]/.test(safe)', replace: '/["\\n]/.test(safe)' },
  { name: 'csv: quebra de linha mantida', ts: `${L}csv.ts`, find: "const s = v.replace(/\\r?\\n/g, ' ');", replace: 'const s = v;' },
  { name: 'histórico: movimentação', ts: `${L}present.ts`, find: "case 'task_moved': return `Movida de «${str(data.from)}» para «${str(data.to)}»`;", replace: "case 'task_moved': return `Movida para «${str(data.to)}»`;" },
  { name: 'histórico: responsável removido', ts: `${L}present.ts`, find: "return data.to ? `Responsável: ${data.from ? who(str(data.from)) : 'ninguém'} → ${who(str(data.to))}` : `Responsável removido (era ${who(str(data.from))})`;", replace: "return `Responsável: ${who(str(data.to))}`;" },
  { name: 'cartão: atraso', ts: `${L}present.ts`, find: 'overdue: isOverdue({ dueDate: t.due_date, archived: t.archived_at !== null, semantic }, ctx.project, ctx.today),', replace: 'overdue: false,' },
  { name: 'cartão: concluída pela etapa', ts: `${L}present.ts`, find: 'checklist: t.checklist, completed: semantic === \'done\',', replace: 'checklist: t.checklist, completed: false,' },
  // ---------------------------------------------------------------- banco: acesso e perfis
  { name: 'banco/perfil: leitor da empresa', file: 'pj_access.sql', find: "when 'manager' then 'manager' when 'member' then 'collaborator' when 'viewer' then 'viewer' else null end;\n$$;\ncreate function private.pj_profile_of", replace: "when 'manager' then 'manager' when 'member' then 'collaborator' else null end;\n$$;\ncreate function private.pj_profile_of" },
  { name: 'banco/perfil: gerente vira colaborador', file: 'pj_access.sql', find: "when 'manager' then 'manager' when 'member' then 'collaborator' when 'viewer' then 'viewer' else null end;\n$$;\ncreate function private.pj_profile_of", replace: "when 'manager' then 'collaborator' when 'member' then 'collaborator' when 'viewer' then 'viewer' else null end;\n$$;\ncreate function private.pj_profile_of" },
  { name: 'banco/perfil: gerente (de outra pessoa) vira colaborador', file: 'pj_access.sql', find: "case m.role when 'owner' then 'owner' when 'admin' then 'owner' when 'manager' then 'manager' when 'member' then 'collaborator' when 'viewer' then 'viewer' end", replace: "case m.role when 'owner' then 'owner' when 'admin' then 'owner' when 'manager' then 'collaborator' when 'member' then 'collaborator' when 'viewer' then 'viewer' end" },
  { name: 'banco/papel: gestor é líder', file: 'pj_access.sql', find: "when private.pj_profile_of(p_org, p_uid) in ('owner', 'manager') then 'lead'", replace: "when private.pj_profile_of(p_org, p_uid) in ('owner') then 'lead'" },
  { name: 'banco/papel: colaborador é líder em todos', file: 'pj_access.sql', find: "when private.pj_profile_of(p_org, p_uid) in ('owner', 'manager') then 'lead'", replace: "when private.pj_profile_of(p_org, p_uid) in ('owner', 'manager', 'collaborator') then 'lead'" },
  { name: 'banco/papel: editar inclui leitor', file: 'pj_access.sql', find: "select coalesce(private.pj_project_role(p_org, p_project) in ('lead', 'editor'), false); $$;", replace: "select coalesce(private.pj_project_role(p_org, p_project) in ('lead', 'editor', 'reader'), false); $$;" },
  { name: 'banco/papel: liderar inclui editor', file: 'pj_access.sql', find: "select coalesce(private.pj_project_role(p_org, p_project) = 'lead', false); $$;", replace: "select coalesce(private.pj_project_role(p_org, p_project) in ('lead', 'editor'), false); $$;" },
  { name: 'banco/papel: leitor é responsável', file: 'pj_access.sql', find: "select coalesce(private.pj_project_role_of(p_org, p_project, p_uid) in ('lead', 'editor'), false);", replace: "select coalesce(private.pj_project_role_of(p_org, p_project, p_uid) in ('lead', 'editor', 'reader'), false);" },
  { name: 'banco/acesso: projeto de outra empresa', file: 'pj_access.sql', find: "select exists (select 1 from public.projects p where p.id = p_project and p.organization_id = p_org) and private.pj_project_role(p_org, p_project) is not null;", replace: "select private.pj_project_role(p_org, p_project) is not null;" },
  { name: 'banco/acesso: sem participação vê', file: 'pj_access.sql', find: "and private.pj_project_role(p_org, p_project) is not null;\n$$;\ncreate function private.pj_can_edit_project", replace: ";\n$$;\ncreate function private.pj_can_edit_project" },
  { name: 'banco/rls: projetos de todos', file: 'pj_access.sql', find: "create policy pj_projects_read on public.projects for select to authenticated using (private.pj_can_see_project(organization_id, id));", replace: "create policy pj_projects_read on public.projects for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: tarefas de todos', file: 'pj_access.sql', find: "create policy pj_tasks_read on public.tasks for select to authenticated using (private.pj_can_see_project(organization_id, project_id));", replace: "create policy pj_tasks_read on public.tasks for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: participantes de todos', file: 'pj_access.sql', find: "create policy pj_members_read on public.project_members for select to authenticated using (private.pj_can_see_project(organization_id, project_id));", replace: "create policy pj_members_read on public.project_members for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: etapas de todos', file: 'pj_access.sql', find: "create policy pj_columns_read on public.project_columns for select to authenticated using (private.pj_can_see_project(organization_id, project_id));", replace: "create policy pj_columns_read on public.project_columns for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: etiquetas de todos', file: 'pj_access.sql', find: "create policy pj_labels_read on public.project_labels for select to authenticated using (private.pj_can_see_project(organization_id, project_id));", replace: "create policy pj_labels_read on public.project_labels for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: eventos de tarefa de todos', file: 'pj_access.sql', find: "create policy pj_task_events_read on public.task_events for select to authenticated using (private.pj_can_see_project(organization_id, project_id));", replace: "create policy pj_task_events_read on public.task_events for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: eventos de projeto de todos', file: 'pj_access.sql', find: "create policy pj_project_events_read on public.project_events for select to authenticated using (private.pj_can_see_project(organization_id, project_id));", replace: "create policy pj_project_events_read on public.project_events for select to authenticated using (private.pj_is_member(organization_id));" },
  { name: 'banco/rls: notificações de outros', file: 'pj_access.sql', find: "using (user_id = (select auth.uid()) and private.pj_can_see_project(organization_id, project_id));", replace: "using (private.pj_can_see_project(organization_id, project_id));" },
  { name: 'banco/rls: notificação de projeto perdido', file: 'pj_access.sql', find: "using (user_id = (select auth.uid()) and private.pj_can_see_project(organization_id, project_id));", replace: "using (user_id = (select auth.uid()));" },
  { name: 'banco/rls: configurações para qualquer um', file: 'pj_access.sql', find: "create policy pj_settings_read on public.pj_settings for select to authenticated using (private.pj_is_member(organization_id));", replace: "create policy pj_settings_read on public.pj_settings for select to authenticated using (true);" },
  { name: 'banco/rls: caminho do storage legível', file: 'pj_access.sql', find: "grant select (id, organization_id, task_id, original_filename, mime_type, size_bytes, uploaded_by, created_at) on public.task_attachments to authenticated;", replace: "grant select on public.task_attachments to authenticated;" },
  // ---------------------------------------------------------------- banco: guardas
  { name: 'banco/guarda: MFA nas funções', file: 'pj_guards.sql', find: "  if not private.mfa_ok() then raise exception 'verificação em duas etapas necessária' using errcode = '42501'; end if;\n  prof := private.pj_profile(p_org);", replace: "  prof := private.pj_profile(p_org);" },
  { name: 'banco/guarda: nível proprietário', file: 'pj_guards.sql', find: "case p_level when 'owner' then prof = 'owner' when 'manager' then prof in ('owner', 'manager') else true end;", replace: "case p_level when 'owner' then prof in ('owner', 'manager') when 'manager' then prof in ('owner', 'manager') else true end;" },
  { name: 'banco/guarda: nível gestão', file: 'pj_guards.sql', find: "case p_level when 'owner' then prof = 'owner' when 'manager' then prof in ('owner', 'manager') else true end;", replace: "case p_level when 'owner' then prof = 'owner' when 'manager' then true else true end;" },
  { name: 'banco/guarda: sem sessão', file: 'pj_guards.sql', find: "  if (select auth.uid()) is null then raise exception 'sessão inválida' using errcode = '28000'; end if;\n  if not private.mfa_ok()", replace: "  if not private.mfa_ok()" },
  { name: 'banco/guarda: limite de tentativas', file: 'pj_guards.sql', find: "  if h > p_max then raise exception 'Muitas tentativas em pouco tempo.", replace: "  if false then raise exception 'Muitas tentativas em pouco tempo." },
  { name: 'banco/guarda: organização imutável', file: 'pj_guards.sql', find: "  if new.organization_id is distinct from old.organization_id then raise exception 'a organização do registro não pode mudar' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/guarda: projeto apagável', file: 'pj_guards.sql', find: "foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop", replace: "foreach t in array array['tasks', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop" },
  { name: 'banco/guarda: tarefa apagável', file: 'pj_guards.sql', find: "foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop", replace: "foreach t in array array['projects', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop" },
  { name: 'banco/guarda: comentário apagável', file: 'pj_guards.sql', find: "foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop", replace: "foreach t in array array['projects', 'tasks', 'task_attachments', 'project_events', 'task_events'] loop" },
  { name: 'banco/guarda: evento de tarefa apagável', file: 'pj_guards.sql', find: "foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'project_events', 'task_events'] loop", replace: "foreach t in array array['projects', 'tasks', 'task_comments', 'task_attachments', 'project_events'] loop" },
  { name: 'banco/guarda: comentário editável', file: 'pj_guards.sql', find: "foreach t in array array['task_comments', 'project_events', 'task_events'] loop", replace: "foreach t in array array['project_events', 'task_events'] loop" },
  { name: 'banco/guarda: evento de projeto editável', file: 'pj_guards.sql', find: "foreach t in array array['task_comments', 'project_events', 'task_events'] loop", replace: "foreach t in array array['task_comments', 'task_events'] loop" },
  { name: 'banco/guarda: anexo editável', file: 'pj_guards.sql', find: "create trigger append_task_attachments before update on public.task_attachments for each row execute function private.pj_append_only();", replace: '' },
  { name: 'banco/guarda: notificação relida', file: 'pj_guards.sql', find: " or old.read_at is not null then\n    raise exception 'notificação só pode ser marcada como lida'", replace: " then\n    raise exception 'notificação só pode ser marcada como lida'" },
  { name: 'banco/guarda: notificação reescrita', file: 'pj_guards.sql', find: "if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at')", replace: "if false" },
  { name: 'banco/estado: executar em pausado', file: 'pj_guards.sql', find: "case p_mode when 'execute' then p.status = 'active' else", replace: "case p_mode when 'execute' then p.status in ('active', 'paused') else" },
  { name: 'banco/estado: organizar em concluído', file: 'pj_guards.sql', find: "else p.status in ('planned', 'active', 'paused') end", replace: "else p.status in ('planned', 'active', 'paused', 'completed') end" },
  { name: 'banco/projeto: identidade', file: 'pj_guards.sql', find: "  if new.id <> old.id or new.project_number <> old.project_number or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then\n    raise exception 'identidade do projeto", replace: "  if false then\n    raise exception 'identidade do projeto" },
  { name: 'banco/projeto: versão do quadro diminui', file: 'pj_guards.sql', find: "  if new.board_version < old.board_version then raise exception 'versão do quadro inválida' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/projeto: planejado conclui', file: 'pj_guards.sql', find: "(old.status = 'planned' and new.status in ('active', 'cancelled'))", replace: "(old.status = 'planned' and new.status in ('active', 'cancelled', 'completed'))" },
  { name: 'banco/projeto: ativo volta a planejado', file: 'pj_guards.sql', find: "or (old.status = 'active' and new.status in ('paused', 'completed', 'cancelled'))", replace: "or (old.status = 'active' and new.status in ('paused', 'completed', 'cancelled', 'planned'))" },
  { name: 'banco/projeto: pausado conclui', file: 'pj_guards.sql', find: "or (old.status = 'paused' and new.status in ('active', 'cancelled'))", replace: "or (old.status = 'paused' and new.status in ('active', 'cancelled', 'completed'))" },
  { name: 'banco/projeto: concluído não reabre', file: 'pj_guards.sql', find: "or (old.status in ('completed', 'cancelled') and new.status = 'active')) then", replace: "or (old.status in ('cancelled') and new.status = 'active')) then" },
  { name: 'banco/projeto: concluído reabre para pausado', file: 'pj_guards.sql', find: "or (old.status in ('completed', 'cancelled') and new.status = 'active')) then", replace: "or (old.status in ('completed', 'cancelled') and new.status in ('active', 'paused'))) then" },
  { name: 'banco/projeto: arquivado editável', file: 'pj_guards.sql', find: "  if old.archived_at is not null and new.archived_at is not null and (content_changed or new.status <> old.status) then", replace: "  if false then" },
  { name: 'banco/projeto: concluído editável', file: 'pj_guards.sql', find: "  if old.status in ('completed', 'cancelled') and new.status = old.status and content_changed then", replace: "  if false then" },
  { name: 'banco/projeto: cancelado editável', file: 'pj_guards.sql', find: "  if old.status in ('completed', 'cancelled') and new.status = old.status and content_changed then", replace: "  if old.status in ('completed') and new.status = old.status and content_changed then" },
  { name: 'banco/projeto: arquivar ativo', file: 'pj_guards.sql', find: "  if new.archived_at is not null and old.archived_at is null and new.status not in ('completed', 'cancelled') then", replace: "  if false then" },
  { name: 'banco/projeto: desarquivar e reabrir juntos', file: 'pj_guards.sql', find: "  if new.archived_at is null and old.archived_at is not null and new.status = 'active' and old.status <> 'active' then", replace: "  if false then" },
  { name: 'banco/projeto: conclui com tarefa aberta', file: 'pj_guards.sql', find: "    if pend > 0 then\n      raise exception 'não é possível concluir:", replace: "    if false then\n      raise exception 'não é possível concluir:" },
  { name: 'banco/projeto: tarefa arquivada bloqueia conclusão', file: 'pj_guards.sql', find: "where t.project_id = new.id and t.archived_at is null and c.semantic_status <> 'done';", replace: "where t.project_id = new.id and c.semantic_status <> 'done';" },
  { name: 'banco/projeto: conclusão sem data', file: 'pj_guards.sql', find: "    new.completed_at := coalesce(new.completed_at, clock_timestamp());\n  end if;\n  if new.status <> 'completed' then new.completed_at := null; end if;", replace: "  end if;\n  if new.status <> 'completed' then new.completed_at := null; end if;" },
  { name: 'banco/projeto: conclusão limpa na reabertura', file: 'pj_guards.sql', find: "  if new.status <> 'completed' then new.completed_at := null; end if;", replace: '' },
  { name: 'banco/projeto: versão não sobe', file: 'pj_guards.sql', find: "then new.version := old.version + 1; end if;\n  return new;\nend $$;\nrevoke all on function private.pj_project_guard()", replace: "then new.version := old.version; end if;\n  return new;\nend $$;\nrevoke all on function private.pj_project_guard()" },
  { name: 'banco/etapa: muda de projeto', file: 'pj_guards.sql', find: "  if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.id <> old.id) then raise exception 'a etapa não muda de projeto' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/etapa: projeto somente consulta', file: 'pj_guards.sql', find: "  if not private.pj_bypass() and not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita alterações no quadro", replace: "  if false then raise exception 'o projeto não aceita alterações no quadro" },
  { name: 'banco/etapa: tipo muda com tarefas', file: 'pj_guards.sql', find: "      if has_tasks then raise exception 'não é possível mudar o tipo de uma etapa que tem tarefas", replace: "      if false then raise exception 'não é possível mudar o tipo de uma etapa que tem tarefas" },
  { name: 'banco/etapa: quadro sem A fazer', file: 'pj_guards.sql', find: "  if others_todo < 1 or others_done < 1 then", replace: "  if others_done < 1 then" },
  { name: 'banco/etapa: quadro sem Concluído', file: 'pj_guards.sql', find: "  if others_todo < 1 or others_done < 1 then", replace: "  if others_todo < 1 then" },
  { name: 'banco/participante: projeto somente consulta', file: 'pj_guards.sql', find: "  if not private.pj_bypass() and not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita alterações de participantes", replace: "  if false then raise exception 'o projeto não aceita alterações de participantes" },
  { name: 'banco/participante: gestão explícita', file: 'pj_guards.sql', find: "    if prof in ('owner', 'manager') then raise exception 'proprietário e gestor já têm acesso a todos os projetos'", replace: "    if false then raise exception 'proprietário e gestor já têm acesso a todos os projetos'" },
  { name: 'banco/participante: leitor da empresa como editor', file: 'pj_guards.sql', find: "    if prof = 'viewer' and new.project_role <> 'reader' then", replace: "    if false then" },
  { name: 'banco/participante: remove com tarefa aberta', file: 'pj_guards.sql', find: "    if open_tasks > 0 and not private.pj_bypass() then", replace: "    if false then" },
  { name: 'banco/participante: rebaixar com tarefa aberta', file: 'pj_guards.sql', find: "  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.project_role = 'reader') then", replace: "  if tg_op = 'DELETE' then" },
  { name: 'banco/participante: tarefas arquivadas bloqueiam', file: 'pj_guards.sql', find: "where t.project_id = pid and t.assignee_user_id = old.user_id and t.archived_at is null;\n    if open_tasks", replace: "where t.project_id = pid and t.assignee_user_id = old.user_id;\n    if open_tasks" },
  // task_guard
  { name: 'banco/tarefa: responsável inválido na criação', file: 'pj_guards.sql', find: "    if new.assignee_user_id is not null and not private.pj_assignable(new.organization_id, new.project_id, new.assignee_user_id) then\n      raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '23514';\n    end if;\n    if sem = 'done'", replace: "    if sem = 'done'" },
  { name: 'banco/tarefa: nasce concluída', file: 'pj_guards.sql', find: "    if sem = 'done' then raise exception 'uma tarefa nova não nasce concluída' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/tarefa: projeto somente consulta recebe tarefa', file: 'pj_guards.sql', find: "    if not bypass and not private.pj_writable(new.project_id, 'organize') then raise exception 'o projeto não aceita novas tarefas", replace: "    if false then raise exception 'o projeto não aceita novas tarefas" },
  { name: 'banco/tarefa: identidade', file: 'pj_guards.sql', find: "if new.id <> old.id or new.project_id <> old.project_id or new.task_number <> old.task_number or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then\n    raise exception 'identidade da tarefa", replace: "if false then\n    raise exception 'identidade da tarefa" },
  { name: 'banco/tarefa: arquivada editável', file: 'pj_guards.sql', find: "    if old.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;\n    if not private.pj_writable(new.project_id, 'organize') then raise exception 'o projeto não aceita alterações (concluído", replace: "    if not private.pj_writable(new.project_id, 'organize') then raise exception 'o projeto não aceita alterações (concluído" },
  { name: 'banco/tarefa: projeto somente consulta edita', file: 'pj_guards.sql', find: "    if not private.pj_writable(new.project_id, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;\n    if new.column_id <> old.column_id", replace: "    if new.column_id <> old.column_id" },
  { name: 'banco/tarefa: execução em projeto pausado', file: 'pj_guards.sql', find: "    if new.column_id <> old.column_id and sem is distinct from oldsem and not private.pj_writable(new.project_id, 'execute') then", replace: "    if false then" },
  { name: 'banco/tarefa: execução exigida na mesma semântica', file: 'pj_guards.sql', find: "    if new.column_id <> old.column_id and sem is distinct from oldsem and not", replace: "    if new.column_id <> old.column_id and not" },
  { name: 'banco/tarefa: responsável inválido na edição', file: 'pj_guards.sql', find: "     and not private.pj_assignable(new.organization_id, new.project_id, new.assignee_user_id) then\n    raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '23514';\n  end if;\n  if sem = 'done' and oldsem", replace: "     and false then\n    raise exception 'responsável inválido: precisa participar do projeto com permissão de edição' using errcode = '23514';\n  end if;\n  if sem = 'done' and oldsem" },
  { name: 'banco/tarefa: conclui com obrigatório pendente', file: 'pj_guards.sql', find: "    if pend > 0 then raise exception 'não é possível concluir: % item(ns) obrigatório(s) do checklist pendente(s)'", replace: "    if false then raise exception 'não é possível concluir: % item(ns) obrigatório(s) do checklist pendente(s)'" },
  { name: 'banco/tarefa: opcional bloqueia conclusão', file: 'pj_guards.sql', find: "from public.task_checklist_items i where i.task_id = new.id and i.required and i.completed_at is null;\n    if pend > 0 then raise exception 'não é possível concluir: %", replace: "from public.task_checklist_items i where i.task_id = new.id and i.completed_at is null;\n    if pend > 0 then raise exception 'não é possível concluir: %" },
  { name: 'banco/tarefa: conclusão sem data', file: 'pj_guards.sql', find: "    new.completed_at := clock_timestamp();\n  elsif sem = 'done' then", replace: "  elsif sem = 'done' then" },
  { name: 'banco/tarefa: reabertura mantém conclusão', file: 'pj_guards.sql', find: "  else\n    new.completed_at := null;\n  end if;\n  if (to_jsonb(new) - meta)", replace: "  end if;\n  if (to_jsonb(new) - meta)" },
  { name: 'banco/tarefa: conclusão renovada a cada edição', file: 'pj_guards.sql', find: "  elsif sem = 'done' then\n    new.completed_at := old.completed_at;", replace: "  elsif sem = 'done' then\n    new.completed_at := clock_timestamp();" },
  { name: 'banco/tarefa: versão não sobe', file: 'pj_guards.sql', find: "then new.version := old.version + 1; end if;\n  return new;\nend $$;\nrevoke all on function private.pj_task_guard()", replace: "then new.version := old.version; end if;\n  return new;\nend $$;\nrevoke all on function private.pj_task_guard()" },
  { name: 'banco/tarefa: posição conta como mudança', file: 'pj_guards.sql', find: "meta text[] := array['version', 'updated_at', 'priority_rank', 'position']; sem text;", replace: "meta text[] := array['version', 'updated_at', 'priority_rank']; sem text;" },
  // checklist / comentários / anexos
  { name: 'banco/checklist: tarefa arquivada', file: 'pj_guards.sql', find: "    if t.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;\n    if sem = 'done' then raise exception 'tarefa concluída: reabra", replace: "    if sem = 'done' then raise exception 'tarefa concluída: reabra" },
  { name: 'banco/checklist: tarefa concluída', file: 'pj_guards.sql', find: "    if sem = 'done' then raise exception 'tarefa concluída: reabra a tarefa para alterar o checklist' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/checklist: projeto somente consulta', file: 'pj_guards.sql', find: "    if not private.pj_writable(t.project_id, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;\n    if tg_op = 'UPDATE' and (new.completed_at", replace: "    if tg_op = 'UPDATE' and (new.completed_at" },
  { name: 'banco/checklist: marcar em projeto pausado', file: 'pj_guards.sql', find: "and not private.pj_writable(t.project_id, 'execute') then\n      raise exception 'marcar itens do checklist exige o projeto ativo'", replace: "and false then\n      raise exception 'marcar itens do checklist exige o projeto ativo'" },
  { name: 'banco/checklist: item reescrito', file: 'pj_guards.sql', find: "if tg_op = 'UPDATE' and (to_jsonb(new) - 'completed_at' - 'completed_by') is distinct from (to_jsonb(old) - 'completed_at' - 'completed_by') then", replace: "if false then" },
  { name: 'banco/comentário: tarefa arquivada', file: 'pj_guards.sql', find: "  if t.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;\n  if not private.pj_writable(t.project_id, 'comment')", replace: "  if not private.pj_writable(t.project_id, 'comment')" },
  { name: 'banco/comentário: projeto somente consulta', file: 'pj_guards.sql', find: "  if not private.pj_writable(t.project_id, 'comment') then raise exception 'o projeto não aceita comentários nem anexos", replace: "  if false then raise exception 'o projeto não aceita comentários nem anexos" },
  { name: 'banco/saída: tarefas continuam do ex-membro', file: 'pj_guards.sql', find: "  perform private.pj_release_user(old.organization_id, old.user_id, 'member_removed');\n  -- remove", replace: "  -- remove" },
  { name: 'banco/saída: participações continuam', file: 'pj_guards.sql', find: "  delete from public.project_members where organization_id = old.organization_id and user_id = old.user_id;\n  perform set_config('pj.bypass', 'off', true);\n  return old;", replace: "  perform set_config('pj.bypass', 'off', true);\n  return old;" },
  { name: 'banco/saída: arquivadas continuam atribuídas', file: 'pj_guards.sql', find: "where organization_id = p_org and assignee_user_id = p_user for update loop", replace: "where organization_id = p_org and assignee_user_id = p_user and archived_at is null for update loop" },
  { name: 'banco/saída: sem evento de sistema', file: 'pj_guards.sql', find: "    insert into public.task_events (organization_id, project_id, task_id, event_type, actor_kind, actor_user_id, data)\n      values (p_org, t.project_id, t.id, 'assignee_removed', 'system', (select auth.uid()), jsonb_build_object('reason', p_reason));", replace: "" },
  { name: 'banco/saída: virar leitor mantém tarefas', file: 'pj_guards.sql', find: "    perform private.pj_release_user(old.organization_id, old.user_id, 'role_changed_to_viewer');", replace: "" },
  { name: 'banco/saída: virar leitor mantém papel', file: 'pj_guards.sql', find: "    update public.project_members set project_role = 'reader' where organization_id = old.organization_id and user_id = old.user_id and project_role <> 'reader';", replace: "" },
  { name: 'banco/saída: qualquer mudança de papel libera', file: 'pj_guards.sql', find: "    if new.role <> 'viewer' then return new; end if;", replace: "" },
  // ---------------------------------------------------------------- banco: auxiliares
  { name: 'banco/aux: texto obrigatório vazio', file: 'pj_helpers.sql', find: "if char_length(s) < p_min or char_length(s) > p_max then raise exception '% deve ter entre % e % caracteres'", replace: "if char_length(s) > p_max then raise exception '% deve ter entre % e % caracteres'" },
  { name: 'banco/aux: texto longo demais', file: 'pj_helpers.sql', find: "if char_length(s) < p_min or char_length(s) > p_max then raise exception '% deve ter entre % e % caracteres'", replace: "if char_length(s) < p_min then raise exception '% deve ter entre % e % caracteres'" },
  { name: 'banco/aux: texto opcional longo', file: 'pj_helpers.sql', find: "if s is not null and char_length(s) > p_max then raise exception '% deve ter no máximo % caracteres'", replace: "if false then raise exception '% deve ter no máximo % caracteres'" },
  { name: 'banco/aux: formato de data', file: 'pj_helpers.sql', find: "  if p !~ '^\\d{4}-\\d{2}-\\d{2}$' then raise exception", replace: "  if false then raise exception" },
  { name: 'banco/aux: carga do projeto sem acesso', file: 'pj_helpers.sql', find: "  if not found or private.pj_project_role(p_org, p_project) is null then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;\n  if p_expected is not null and p.version <> p_expected then perform private.pj_conflict('este projeto'); end if;", replace: "  if not found then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;\n  if p_expected is not null and p.version <> p_expected then perform private.pj_conflict('este projeto'); end if;" },
  { name: 'banco/aux: versão do projeto', file: 'pj_helpers.sql', find: "  if p_expected is not null and p.version <> p_expected then perform private.pj_conflict('este projeto'); end if;", replace: '' },
  { name: 'banco/aux: carga da tarefa sem acesso', file: 'pj_helpers.sql', find: "  if not found or private.pj_project_role(p_org, t.project_id) is null then raise exception 'tarefa não encontrada' using errcode = 'P0002'; end if;", replace: "  if not found then raise exception 'tarefa não encontrada' using errcode = 'P0002'; end if;" },
  { name: 'banco/aux: versão da tarefa', file: 'pj_helpers.sql', find: "  if p_expected is not null and t.version <> p_expected then perform private.pj_conflict('esta tarefa'); end if;", replace: '' },
  { name: 'banco/aux: papel exigido edição', file: 'pj_helpers.sql', find: "if r is null or (p_level = 'edit' and r not in ('lead', 'editor')) or (p_level = 'lead' and r <> 'lead') then", replace: "if r is null or (p_level = 'lead' and r <> 'lead') then" },
  { name: 'banco/aux: papel exigido liderança', file: 'pj_helpers.sql', find: "if r is null or (p_level = 'edit' and r not in ('lead', 'editor')) or (p_level = 'lead' and r <> 'lead') then", replace: "if r is null or (p_level = 'edit' and r not in ('lead', 'editor')) then" },
  { name: 'banco/aux: idempotência com outros dados', file: 'pj_helpers.sql', find: "if r.scope <> p_scope or r.request_hash <> p_hash then raise exception", replace: "if false then raise exception" },
  { name: 'banco/aux: chave ausente', file: 'pj_helpers.sql', find: "  if p_key is null then raise exception 'solicitação inválida (chave ausente)' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/aux: posição final', file: 'pj_helpers.sql', find: "select coalesce(max(position), 0) + 1 from public.tasks where column_id = p_column and archived_at is null;", replace: "select coalesce(max(position), 0) from public.tasks where column_id = p_column and archived_at is null;" },
  { name: 'banco/aux: autor notificado', file: 'pj_helpers.sql', find: "where x is not null and x is distinct from me loop", replace: "where x is not null loop" },
  { name: 'banco/aux: notificação sem acesso', file: 'pj_helpers.sql', find: "    if private.pj_project_role_of(p_org, p_project, u) is not null then\n      insert into public.notifications", replace: "    if true then\n      insert into public.notifications" },
  { name: 'banco/aux: destinatários duplicados', file: 'pj_helpers.sql', find: "for u in select distinct x from unnest(p_users) x", replace: "for u in select x from unnest(p_users) x" },
  { name: 'banco/anexo: caminho de outra tarefa', file: 'pj_helpers.sql', find: "if path is null or path !~ ('^' || p_org::text || '/' || p_task::text || '/[0-9a-f]{32}\\.(jpg|png|webp|pdf|txt|csv)$') then", replace: "if path is null then" },
  { name: 'banco/anexo: tipo de arquivo', file: 'pj_helpers.sql', find: "if mime is null or mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv') then", replace: "if mime is null then" },
  { name: 'banco/anexo: tipo e extensão', file: 'pj_helpers.sql', find: "    if (mime, ext) not in (('image/png', 'png'), ('image/jpeg', 'jpg'), ('image/webp', 'webp'), ('application/pdf', 'pdf'), ('text/plain', 'txt'), ('text/csv', 'csv')) then raise exception 'arquivo inválido' using errcode = '22023'; end if;\n", replace: '' },
  { name: 'banco/anexo: tamanho', file: 'pj_helpers.sql', find: "    if sz < 1 or sz > maxb then", replace: "    if sz < 1 then" },
  { name: 'banco/anexo: quantidade por envio', file: 'pj_helpers.sql', find: "jsonb_array_length(p_att) > 5 then raise exception 'envie até 5 arquivos por vez'", replace: "jsonb_array_length(p_att) > 500 then raise exception 'envie até 5 arquivos por vez'" },
  { name: 'banco/anexo: limite da tarefa', file: 'pj_helpers.sql', find: "+ jsonb_array_length(p_att) > 60 then raise exception 'limite de arquivos da tarefa atingido'", replace: "+ jsonb_array_length(p_att) > 6000 then raise exception 'limite de arquivos da tarefa atingido'" },
  { name: 'banco/anexo: nome sanitizado', file: 'pj_helpers.sql', find: "regexp_replace(btrim(coalesce(fname, 'arquivo')), '[\\\\/\\x00-\\x1f]', '_', 'g')", replace: "btrim(coalesce(fname, 'arquivo'))" },
  // ---------------------------------------------------------------- banco: projetos
  { name: 'banco/projeto: criar sem ser gestão', file: 'pj_projects.sql', find: "  perform private.pj_guard(p_org, 'manager');\n  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;\n  perform private.pj_rate_hit('proj:'", replace: "  perform private.pj_guard(p_org, 'member');\n  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;\n  perform private.pj_rate_hit('proj:'" },
  { name: 'banco/projeto: nasce concluído', file: 'pj_projects.sql', find: "  if st not in ('planned', 'active') then raise exception 'um projeto novo começa planejado ou ativo' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/projeto: datas invertidas na criação', file: 'pj_projects.sql', find: "  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois da data de entrega' using errcode = '22023'; end if;\n  st :=", replace: "  st :=" },
  { name: 'banco/projeto: idempotência da criação', file: 'pj_projects.sql', find: "  prev := private.pj_idem(p_org, uid, p_idem, 'create_project', hash);\n  if prev is not null then return prev; end if;", replace: '' },
  { name: 'banco/projeto: etapas iniciais', file: 'pj_projects.sql', find: "    (p_org, pid, 'A fazer', 'todo', 1), (p_org, pid, 'Em andamento', 'in_progress', 2), (p_org, pid, 'Em revisão', 'review', 3), (p_org, pid, 'Concluído', 'done', 4);", replace: "    (p_org, pid, 'A fazer', 'todo', 1), (p_org, pid, 'Concluído', 'done', 2);" },
  { name: 'banco/projeto: participante de fora da empresa', file: 'pj_projects.sql', find: "      if private.pj_profile_of(p_org, muser) is null then raise exception 'participante precisa ser membro da empresa' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/projeto: papel inválido na criação', file: 'pj_projects.sql', find: "      if mrole not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/projeto: editar sem liderança', file: 'pj_projects.sql', find: "  pr := private.pj_load_project(p_org, p_project, true, p_expected);\n  perform private.pj_require(p_org, p_project, 'lead');\n  if jsonb_typeof(p)", replace: "  pr := private.pj_load_project(p_org, p_project, true, p_expected);\n  perform private.pj_require(p_org, p_project, 'edit');\n  if jsonb_typeof(p)" },
  { name: 'banco/projeto: editar projeto somente consulta', file: 'pj_projects.sql', find: "  if not private.pj_writable(p_project, 'organize') then raise exception 'projeto % é somente para consulta", replace: "  if false then raise exception 'projeto % é somente para consulta" },
  { name: 'banco/projeto: datas invertidas na edição', file: 'pj_projects.sql', find: "  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois da data de entrega' using errcode = '22023'; end if;\n  if nm is distinct", replace: "  if nm is distinct" },
  { name: 'banco/projeto: sem mudança sobe versão', file: 'pj_projects.sql', find: "  if cardinality(changed) = 0 then return pr.version; end if;", replace: '' },
  { name: 'banco/status: mudar sem liderança', file: 'pj_projects.sql', find: "  pr := private.pj_load_project(p_org, p_project, true, p_expected);\n  perform private.pj_require(p_org, p_project, 'lead');\n  if p_status is null", replace: "  pr := private.pj_load_project(p_org, p_project, true, p_expected);\n  perform private.pj_require(p_org, p_project, 'edit');\n  if p_status is null" },
  { name: 'banco/status: motivo na reabertura', file: 'pj_projects.sql', find: "  if (reopen or p_status = 'cancelled') and (rsn is null or char_length(rsn) < 5) then", replace: "  if p_status = 'cancelled' and (rsn is null or char_length(rsn) < 5) then" },
  { name: 'banco/status: motivo no cancelamento', file: 'pj_projects.sql', find: "  if (reopen or p_status = 'cancelled') and (rsn is null or char_length(rsn) < 5) then", replace: "  if reopen and (rsn is null or char_length(rsn) < 5) then" },
  { name: 'banco/status: motivo curto', file: 'pj_projects.sql', find: "(rsn is null or char_length(rsn) < 5) then raise exception 'informe o motivo (mínimo 5 caracteres)'", replace: "(rsn is null) then raise exception 'informe o motivo (mínimo 5 caracteres)'" },
  { name: 'banco/status: arquivado muda', file: 'pj_projects.sql', find: "  if pr.archived_at is not null then raise exception 'projeto arquivado: desarquive antes de alterar o status' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/status: reabertura sem aviso aos participantes', file: 'pj_projects.sql', find: "    perform private.pj_notify(p_org, p_project, null, 'project_reopened', (select coalesce(array_agg(user_id), '{}') from public.project_members where project_id = p_project));", replace: '' },
  { name: 'banco/status: reabertura sem evento próprio', file: 'pj_projects.sql', find: "case when reopen then 'project_reopened' else 'status_changed' end", replace: "'status_changed'" },
  { name: 'banco/arquivar: sem liderança', file: 'pj_projects.sql', find: "  pr := private.pj_load_project(p_org, p_project, true, p_expected);\n  perform private.pj_require(p_org, p_project, 'lead');\n  if p_archive is null", replace: "  pr := private.pj_load_project(p_org, p_project, true, p_expected);\n  perform private.pj_require(p_org, p_project, 'edit');\n  if p_archive is null" },
  { name: 'banco/arquivar: repetido', file: 'pj_projects.sql', find: "  if p_archive = (pr.archived_at is not null) then return pr.version; end if;", replace: '' },
  { name: 'banco/participante: sem liderança', file: 'pj_projects.sql', find: "  perform private.pj_load_project(p_org, p_project, true, null);\n  perform private.pj_require(p_org, p_project, 'lead');\n  if p_role is null or p_role not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;\n  if p_user is null", replace: "  perform private.pj_load_project(p_org, p_project, true, null);\n  perform private.pj_require(p_org, p_project, 'edit');\n  if p_role is null or p_role not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;\n  if p_user is null" },
  { name: 'banco/participante: papel inválido', file: 'pj_projects.sql', find: "  if p_role is null or p_role not in ('lead', 'editor', 'reader') then raise exception 'papel de participante inválido' using errcode = '22023'; end if;\n  if p_user is null", replace: "  if p_user is null" },
  { name: 'banco/participante: fora da empresa', file: 'pj_projects.sql', find: "  if p_user is null or private.pj_profile_of(p_org, p_user) is null then raise exception 'a pessoa precisa ser membro da empresa' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/participante: duplicado', file: 'pj_projects.sql', find: "  if exists (select 1 from public.project_members where project_id = p_project and user_id = p_user) then raise exception 'esta pessoa já participa do projeto' using errcode = '23505'; end if;", replace: '' },
  { name: 'banco/participante: papel igual', file: 'pj_projects.sql', find: "  if old_role = p_role then return 0; end if;", replace: '' },
  { name: 'banco/participante: rebaixar sem tratar tarefas', file: 'pj_projects.sql', find: "  if p_role = 'reader' then n := private.pj_handle_assigned(p_org, p_project, p_user, p_task_action, p_transfer_to); end if;", replace: '' },
  { name: 'banco/participante: papel de quem não participa', file: 'pj_projects.sql', find: "  if old_role is null then raise exception 'esta pessoa não participa do projeto' using errcode = 'P0002'; end if;\n  if old_role = p_role", replace: "  if old_role = p_role" },
  { name: 'banco/participante: remover sem tratar tarefas', file: 'pj_projects.sql', find: "  n := private.pj_handle_assigned(p_org, p_project, p_user, p_task_action, p_transfer_to);\n  delete from public.project_members", replace: "  n := 0;\n  delete from public.project_members" },
  { name: 'banco/participante: remover quem não participa', file: 'pj_projects.sql', find: "  if not exists (select 1 from public.project_members where project_id = p_project and user_id = p_user) then raise exception 'esta pessoa não participa do projeto' using errcode = 'P0002'; end if;\n  n :=", replace: "  n :=" },
  { name: 'banco/tratar: sem escolha explícita', file: 'pj_projects.sql', find: "  if p_action is null or p_action not in ('unassign', 'transfer') then", replace: "  if false then" },
  { name: 'banco/tratar: transferir para leitor', file: 'pj_projects.sql', find: "    if p_transfer_to is null or p_transfer_to = p_user or not private.pj_assignable(p_org, p_project, p_transfer_to) then", replace: "    if p_transfer_to is null or p_transfer_to = p_user then" },
  { name: 'banco/tratar: transferir para si mesmo', file: 'pj_projects.sql', find: "    if p_transfer_to is null or p_transfer_to = p_user or not", replace: "    if p_transfer_to is null or not" },
  { name: 'banco/tratar: sem evento da transferência', file: 'pj_projects.sql', find: "    perform private.pj_task_event(p_org, p_project, t.id, case when p_action = 'transfer' then 'assignee_changed' else 'assignee_removed' end,\n      jsonb_build_object('from', p_user, 'to', case when p_action = 'transfer' then p_transfer_to end, 'reason', 'member_change'));", replace: '' },
  { name: 'banco/tratar: sem aviso ao novo responsável', file: 'pj_projects.sql', find: "    if p_action = 'transfer' then perform private.pj_notify(p_org, p_project, t.id, 'task_assigned', array[p_transfer_to]); end if;", replace: '' },
  { name: 'banco/tratar: sem tarefas abertas', file: 'pj_projects.sql', find: "  select count(*) into n from public.tasks where project_id = p_project and assignee_user_id = p_user and archived_at is null;\n  if n = 0 then return 0; end if;", replace: "  return 0;" },
  // etapas e etiquetas
  { name: 'banco/etapa: operar sem liderança', file: 'pj_projects.sql', find: "  pr := private.pj_load_project(p_org, p_project, true, null);\n  perform private.pj_require(p_org, p_project, p_level);\n  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações no quadro (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;", replace: "  pr := private.pj_load_project(p_org, p_project, true, null);\n  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações no quadro (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;" },
  { name: 'banco/etapa: projeto somente consulta', file: 'pj_projects.sql', find: "  perform private.pj_require(p_org, p_project, p_level);\n  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações no quadro (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;", replace: "  perform private.pj_require(p_org, p_project, p_level);" },
  { name: 'banco/etapa: versão do quadro', file: 'pj_projects.sql', find: "  if p_expected_board is not null and pr.board_version <> p_expected_board then perform private.pj_conflict('o quadro'); end if;\n  return pr;", replace: "  return pr;" },
  { name: 'banco/etapa: tipo inválido', file: 'pj_projects.sql', find: "  if p_semantic is null or p_semantic not in ('todo', 'in_progress', 'review', 'done') then raise exception 'tipo de etapa inválido' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/etapa: limite de etapas', file: 'pj_projects.sql', find: "  if n >= 12 then raise exception 'o quadro aceita até 12 etapas' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/etapa: criar não sobe a versão do quadro', file: 'pj_projects.sql', find: "  perform private.pj_bump_board(p_project);\n  perform private.pj_project_event(p_org, p_project, 'column_added'", replace: "  perform private.pj_project_event(p_org, p_project, 'column_added'" },
  { name: 'banco/etapa: posição de inserção', file: 'pj_projects.sql', find: "  update public.project_columns set position = position + 1 where project_id = p_project and position >= pos;", replace: '' },
  { name: 'banco/etapa: renomear altera o tipo', file: 'pj_projects.sql', find: "  update public.project_columns set name = nm where id = p_column;", replace: "  update public.project_columns set name = nm, semantic_status = 'todo' where id = p_column;" },
  { name: 'banco/etapa: reordenar com repetida', file: 'pj_projects.sql', find: " or (select count(distinct x) from unnest(p_ids) x) <> n\n     or exists", replace: "\n     or exists" },
  { name: 'banco/etapa: reordenar etapa de outro projeto', file: 'pj_projects.sql', find: "     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.project_columns c where c.id = x and c.project_id = p_project)) then", replace: "     then" },
  { name: 'banco/etapa: reordenar não sobe versão', file: 'pj_projects.sql', find: "  v := private.pj_bump_board(p_project);\n  perform private.pj_project_event(p_org, p_project, 'columns_reordered'", replace: "  v := 0;\n  perform private.pj_project_event(p_org, p_project, 'columns_reordered'" },
  { name: 'banco/etapa: excluir ocupada sem destino', file: 'pj_projects.sql', find: "    if p_move_to is null then raise exception 'a etapa tem % tarefa(s): escolha para qual etapa do mesmo tipo elas serão movidas', n using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/etapa: destino inválido', file: 'pj_projects.sql', find: "    if not found or dest.id = col.id then raise exception 'etapa de destino inválida' using errcode = '22023'; end if;", replace: "    if not found then raise exception 'etapa de destino inválida' using errcode = '22023'; end if;" },
  { name: 'banco/etapa: destino de outro tipo', file: 'pj_projects.sql', find: "    if dest.semantic_status <> col.semantic_status then raise exception 'a realocação precisa ser para uma etapa do mesmo tipo (%)'", replace: "    if false then raise exception 'a realocação precisa ser para uma etapa do mesmo tipo (%)'" },
  { name: 'banco/etapa: tarefas arquivadas não realocadas', file: 'pj_projects.sql', find: "    update public.tasks set column_id = dest.id where column_id = col.id; -- arquivadas: só trocam de etapa, sem mudar o conteúdo", replace: '' },
  { name: 'banco/etapa: ordem do destino', file: 'pj_projects.sql', find: "update public.tasks t set column_id = dest.id, position = base + r.rn", replace: "update public.tasks t set column_id = dest.id, position = r.rn" },
  { name: 'banco/etapa: etapas não renumeradas', file: 'pj_projects.sql', find: "  update public.project_columns c set position = r.rn from (select id, row_number() over (order by position) rn from public.project_columns where project_id = p_project) r where c.id = r.id;\n  v := private.pj_bump_board(p_project);\n  perform private.pj_project_event(p_org, p_project, 'column_deleted'", replace: "  v := private.pj_bump_board(p_project);\n  perform private.pj_project_event(p_org, p_project, 'column_deleted'" },
  { name: 'banco/etiqueta: criar sem edição', file: 'pj_projects.sql', find: "  perform private.pj_require(p_org, p_project, case when p_id is null then 'edit' else 'lead' end);", replace: "  perform private.pj_require(p_org, p_project, 'edit');" },
  { name: 'banco/etiqueta: editar exige liderança', file: 'pj_projects.sql', find: "  perform private.pj_require(p_org, p_project, case when p_id is null then 'edit' else 'lead' end);", replace: "  perform private.pj_require(p_org, p_project, 'lead');" },
  { name: 'banco/etiqueta: cor inválida', file: 'pj_projects.sql', find: "  if col !~ '^#[0-9a-fA-F]{6}$' then raise exception 'cor inválida (use #RRGGBB)' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/etiqueta: limite', file: 'pj_projects.sql', find: "    if (select count(*) from public.project_labels where project_id = p_project) >= 40 then raise exception 'o projeto aceita até 40 etiquetas' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/etiqueta: projeto somente consulta', file: 'pj_projects.sql', find: "  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;\n  if col !~", replace: "  if col !~" },
  { name: 'banco/etiqueta: remover sem liderança', file: 'pj_projects.sql', find: "  perform private.pj_require(p_org, p_project, 'lead');\n  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;\n  if not exists (select 1 from public.project_labels", replace: "  perform private.pj_require(p_org, p_project, 'edit');\n  if not private.pj_writable(p_project, 'organize') then raise exception 'o projeto não aceita alterações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;\n  if not exists (select 1 from public.project_labels" },
  { name: 'banco/etiqueta: remover de tarefas', file: 'pj_projects.sql', find: "  delete from public.task_labels where label_id = p_label;\n", replace: '' },
  { name: 'banco/config: salvar sem ser proprietário', file: 'pj_projects.sql', find: "  perform private.pj_guard(p_org, 'owner');\n  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;\n  if p ? 'timezone'", replace: "  perform private.pj_guard(p_org, 'manager');\n  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dados inválidos' using errcode = '22023'; end if;\n  if p ? 'timezone'" },
  { name: 'banco/config: fuso inválido', file: 'pj_projects.sql', find: "  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p ->> 'timezone') then raise exception 'fuso horário desconhecido' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/config: logotipo de outro caminho', file: 'pj_projects.sql', find: "  if p_path is not null and (p_path !~ ('^' || p_org::text || '/logo-[0-9a-f]{8,32}\\.(png|jpg|webp)$')) then raise exception", replace: "  if false then raise exception" },
  { name: 'banco/pessoas: lista para qualquer colaborador', file: 'pj_projects.sql', find: "  if not private.pj_is_manager(p_org) and (p_project is null or not private.pj_can_lead_project(p_org, p_project)) then raise exception 'sem permissão' using errcode = '42501'; end if;", replace: '' },
  { name: 'banco/pessoas: nomes de projeto sem acesso', file: 'pj_projects.sql', find: "  if not private.pj_can_see_project(p_org, p_project) then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;\n  return coalesce((\n    select jsonb_agg(jsonb_build_object('user_id', u.id", replace: "  return coalesce((\n    select jsonb_agg(jsonb_build_object('user_id', u.id" },
  { name: 'banco/contexto: notificações de projetos perdidos', file: 'pj_projects.sql', find: "and n.read_at is null\n      and private.pj_can_see_project(n.organization_id, n.project_id)));", replace: "and n.read_at is null));" },
  // ---------------------------------------------------------------- banco: tarefas
  { name: 'banco/tarefa: criar sem edição', file: 'pj_tasks.sql', find: "  pr := private.pj_load_project(p_org, p_project, true, null);\n  perform private.pj_require(p_org, p_project, 'edit');\n  perform private.pj_rate_hit('task:'", replace: "  pr := private.pj_load_project(p_org, p_project, true, null);\n  perform private.pj_rate_hit('task:'" },
  { name: 'banco/tarefa: prioridade inválida', file: 'pj_tasks.sql', find: "  if p is null or p not in ('low', 'normal', 'high', 'urgent') then raise exception 'prioridade inválida' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/tarefa: datas invertidas na criação', file: 'pj_tasks.sql', find: "  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois do vencimento' using errcode = '22023'; end if;\n  if asg is not null", replace: "  if asg is not null" },
  { name: 'banco/tarefa: idempotência da criação', file: 'pj_tasks.sql', find: "  prev := private.pj_idem(p_org, uid, p_idem, 'create_task', hash);\n  if prev is not null then return prev; end if;", replace: '' },
  { name: 'banco/tarefa: etapa de outro projeto', file: 'pj_tasks.sql', find: "    if not found then raise exception 'etapa inválida para este projeto' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/tarefa: etapa concluída na criação', file: 'pj_tasks.sql', find: "  if col.semantic_status = 'done' then raise exception 'uma tarefa nova não pode ser criada em etapa concluída' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/tarefa: criar em execução com projeto planejado', file: 'pj_tasks.sql', find: "  if col.semantic_status <> 'todo' and not private.pj_writable(p_project, 'execute') then raise exception 'só é possível criar tarefas em andamento com o projeto ativo' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/tarefa: etiqueta de outro projeto na criação', file: 'pj_tasks.sql', find: "      if not exists (select 1 from public.project_labels where id = lbl and project_id = p_project and organization_id = p_org) then raise exception 'etiqueta inválida para este projeto' using errcode = '22023'; end if;\n      insert into public.task_labels (organization_id, project_id, task_id, label_id) values (p_org, p_project, tid, lbl)", replace: "      insert into public.task_labels (organization_id, project_id, task_id, label_id) values (p_org, p_project, tid, lbl)" },
  { name: 'banco/tarefa: limite de etiquetas na criação', file: 'pj_tasks.sql', find: "jsonb_array_length(p -> 'label_ids') > 10 then raise exception 'até 10 etiquetas por tarefa' using errcode = '22023'; end if;\n    for lbl in", replace: "jsonb_array_length(p -> 'label_ids') > 1000 then raise exception 'até 10 etiquetas por tarefa' using errcode = '22023'; end if;\n    for lbl in" },
  { name: 'banco/tarefa: limite do checklist na criação', file: 'pj_tasks.sql', find: "jsonb_array_length(p -> 'checklist') > 50 then raise exception 'o checklist aceita até 50 itens' using errcode = '22023'; end if;\n    for item in", replace: "jsonb_array_length(p -> 'checklist') > 5000 then raise exception 'o checklist aceita até 50 itens' using errcode = '22023'; end if;\n    for item in" },
  { name: 'banco/tarefa: sem aviso ao responsável na criação', file: 'pj_tasks.sql', find: "    perform private.pj_task_event(p_org, p_project, tid, 'assignee_changed', jsonb_build_object('from', null, 'to', asg));\n    perform private.pj_notify(p_org, p_project, tid, 'task_assigned', array[asg]);", replace: "    perform private.pj_task_event(p_org, p_project, tid, 'assignee_changed', jsonb_build_object('from', null, 'to', asg));" },
  { name: 'banco/tarefa: avisos de data', file: 'pj_tasks.sql', find: "  if p_start is not null and ((p.start_date is not null and p_start < p.start_date) or (p.due_date is not null and p_start > p.due_date)) then", replace: "  if false then" },
  { name: 'banco/tarefa: avisos de vencimento', file: 'pj_tasks.sql', find: "  if p_due is not null and ((p.start_date is not null and p_due < p.start_date) or (p.due_date is not null and p_due > p.due_date)) then", replace: "  if false then" },
  { name: 'banco/tarefa: editar sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  ttl :=", replace: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  ttl :=" },
  { name: 'banco/tarefa: datas invertidas na edição', file: 'pj_tasks.sql', find: "  if sd is not null and dd is not null and sd > dd then raise exception 'a data de início não pode ser depois do vencimento' using errcode = '22023'; end if;\n  if ttl is distinct", replace: "  if ttl is distinct" },
  { name: 'banco/tarefa: evento de prioridade', file: 'pj_tasks.sql', find: "  if 'priority' = any (changed) then perform private.pj_task_event(p_org, t.project_id, p_task, 'priority_changed'", replace: "  if false then perform private.pj_task_event(p_org, t.project_id, p_task, 'priority_changed'" },
  { name: 'banco/tarefa: evento de datas', file: 'pj_tasks.sql', find: "  if 'dates' = any (changed) then\n    perform private.pj_task_event(p_org, t.project_id, p_task, 'dates_changed'", replace: "  if false then\n    perform private.pj_task_event(p_org, t.project_id, p_task, 'dates_changed'" },
  { name: 'banco/tarefa: atribuir sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  if p_user is not null and not private.pj_assignable", replace: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  if p_user is not null and not private.pj_assignable" },
  { name: 'banco/tarefa: atribuição repetida', file: 'pj_tasks.sql', find: "  if p_user is not distinct from t.assignee_user_id then return t.version; end if;", replace: '' },
  { name: 'banco/tarefa: sem aviso de atribuição', file: 'pj_tasks.sql', find: "  if p_user is not null then perform private.pj_notify(p_org, t.project_id, p_task, 'task_assigned', array[p_user]); end if;", replace: '' },
  // mover
  { name: 'banco/mover: sem permissão de edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, null);\n  perform private.pj_require(p_org, pid, 'edit');\n  if p_board_version", replace: "  t := private.pj_load_task(p_org, p_task, true, null);\n  if p_board_version" },
  { name: 'banco/mover: versão do quadro', file: 'pj_tasks.sql', find: "  if p_board_version is not null and pr.board_version <> p_board_version then perform private.pj_conflict('o quadro'); end if;", replace: '' },
  { name: 'banco/mover: tarefa arquivada', file: 'pj_tasks.sql', find: "  if t.archived_at is not null then raise exception 'tarefa arquivada é somente para consulta' using errcode = '23514'; end if;\n  if not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita movimentações", replace: "  if not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita movimentações" },
  { name: 'banco/mover: projeto somente consulta', file: 'pj_tasks.sql', find: "  if not private.pj_writable(pid, 'organize') then raise exception 'o projeto não aceita movimentações (concluído, cancelado ou arquivado)' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/mover: etapa de outro projeto', file: 'pj_tasks.sql', find: "  if not found then raise exception 'etapa de destino inválida para este projeto' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/mover: execução em projeto pausado (função)', file: 'pj_tasks.sql', find: "  if dst.semantic_status <> src.semantic_status and not private.pj_writable(pid, 'execute') then", replace: "  if false then" },
  { name: 'banco/mover: mensagem de pausado', file: 'pj_tasks.sql', find: "    msg := case when pr.status = 'paused' then 'projeto pausado:", replace: "    msg := case when pr.status = 'active' then 'projeto pausado:" },
  { name: 'banco/mover: referência inválida', file: 'pj_tasks.sql', find: "    if p_before_task = p_task or not exists (select 1 from public.tasks where id = p_before_task and column_id = dst.id and archived_at is null) then raise exception 'posição de referência inválida' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/mover: referência é a própria tarefa', file: 'pj_tasks.sql', find: "    if p_before_task = p_task or not exists", replace: "    if not exists" },
  { name: 'banco/mover: referência arquivada', file: 'pj_tasks.sql', find: "where id = p_before_task and column_id = dst.id and archived_at is null) then raise exception 'posição de referência inválida'", replace: "where id = p_before_task and column_id = dst.id) then raise exception 'posição de referência inválida'" },
  { name: 'banco/mover: nova tarefa no início', file: 'pj_tasks.sql', find: "  if p_before_task is null then ids := ids || p_task;", replace: "  if p_before_task is null then ids := p_task || ids;" },
  { name: 'banco/mover: inserção depois da referência', file: 'pj_tasks.sql', find: "ids := ids[1:idx - 1] || p_task || ids[idx:]; end if;", replace: "ids := ids[1:idx] || p_task || ids[idx + 1:]; end if;" },
  { name: 'banco/mover: sem mudança altera o quadro', file: 'pj_tasks.sql', find: "  if dst.id = src.id and ids = cur then return jsonb_build_object('board_version', pr.board_version, 'version', t.version, 'changed', false); end if;", replace: '' },
  { name: 'banco/mover: origem não reindexada', file: 'pj_tasks.sql', find: "    perform private.pj_reindex_column(src.id);\n", replace: '' },
  { name: 'banco/mover: não sobe a versão do quadro', file: 'pj_tasks.sql', find: "  nb := private.pj_bump_board(pid);\n  select version into v from public.tasks where id = p_task;", replace: "  nb := pr.board_version;\n  select version into v from public.tasks where id = p_task;" },
  { name: 'banco/mover: sem evento de conclusão', file: 'pj_tasks.sql', find: "  if completed then perform private.pj_task_event(p_org, pid, p_task, 'task_completed', '{}'::jsonb); end if;", replace: '' },
  { name: 'banco/mover: sem evento de reabertura', file: 'pj_tasks.sql', find: "    perform private.pj_task_event(p_org, pid, p_task, 'task_reopened', jsonb_build_object('to', dst.name));\n", replace: '' },
  { name: 'banco/mover: reabertura sem aviso', file: 'pj_tasks.sql', find: "    perform private.pj_notify(p_org, pid, p_task, 'task_reopened', array[t.assignee_user_id, t.created_by]);", replace: '' },
  { name: 'banco/mover: reabertura avisa só o responsável', file: 'pj_tasks.sql', find: "array[t.assignee_user_id, t.created_by]);\n  end if;\n  return jsonb_build_object('board_version', nb", replace: "array[t.assignee_user_id]);\n  end if;\n  return jsonb_build_object('board_version', nb" },
  // impedimento, arquivar, etiquetas
  { name: 'banco/impedimento: sem motivo', file: 'pj_tasks.sql', find: "    if char_length(rsn) < 3 then raise exception 'informe o motivo do impedimento (mínimo 3 caracteres)' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/impedimento: tarefa concluída', file: 'pj_tasks.sql', find: "    if sem = 'done' then raise exception 'uma tarefa concluída não pode ser bloqueada' using errcode = '23514'; end if;", replace: '' },
  { name: 'banco/impedimento: sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  select semantic_status into sem", replace: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  select semantic_status into sem" },
  { name: 'banco/impedimento: remover sem estar bloqueada', file: 'pj_tasks.sql', find: "    if t.blocked_at is null then return t.version; end if;", replace: '' },
  { name: 'banco/impedimento: motivo igual', file: 'pj_tasks.sql', find: "    if t.blocked_reason is not distinct from rsn then return t.version; end if;", replace: '' },
  { name: 'banco/impedimento: data original perdida', file: 'pj_tasks.sql', find: "set blocked_at = coalesce(blocked_at, clock_timestamp()), blocked_reason = rsn", replace: "set blocked_at = clock_timestamp(), blocked_reason = rsn" },
  { name: 'banco/arquivar tarefa: sem liderança', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  perform private.pj_require(p_org, t.project_id, 'lead');\n  if t.archived_at is not null then return t.version; end if;", replace: "  t := private.pj_load_task(p_org, p_task, true, p_expected);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  if t.archived_at is not null then return t.version; end if;" },
  { name: 'banco/arquivar tarefa: motivo', file: 'pj_tasks.sql', find: "  if sem <> 'done' and (rsn is null or char_length(rsn) < 5) then", replace: "  if false then" },
  { name: 'banco/arquivar tarefa: motivo curto', file: 'pj_tasks.sql', find: "(rsn is null or char_length(rsn) < 5) then raise exception 'informe o motivo (mínimo 5 caracteres) para arquivar", replace: "(rsn is null) then raise exception 'informe o motivo (mínimo 5 caracteres) para arquivar" },
  { name: 'banco/arquivar tarefa: motivo para concluída', file: 'pj_tasks.sql', find: "  if sem <> 'done' and (rsn is null", replace: "  if (rsn is null" },
  { name: 'banco/etiquetas da tarefa: tarefa arquivada', file: 'pj_tasks.sql', find: "  if t.archived_at is not null or not private.pj_writable(t.project_id, 'organize') then raise exception 'a tarefa não aceita alterações", replace: "  if false then raise exception 'a tarefa não aceita alterações" },
  { name: 'banco/etiquetas da tarefa: limite', file: 'pj_tasks.sql', find: "  if cardinality(ids) > 10 then raise exception 'até 10 etiquetas por tarefa' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/etiquetas da tarefa: de outro projeto', file: 'pj_tasks.sql', find: "    if not exists (select 1 from public.project_labels where id = l and project_id = t.project_id and organization_id = p_org) then raise exception 'etiqueta inválida para este projeto' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/etiquetas da tarefa: sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  if t.archived_at is not null or", replace: "  t := private.pj_load_task(p_org, p_task, true, null);\n  if t.archived_at is not null or" },
  { name: 'banco/etiquetas da tarefa: remover antigas', file: 'pj_tasks.sql', find: "  delete from public.task_labels where task_id = p_task and not (label_id = any (ids));\n", replace: '' },
  // checklist, comentário, anexos
  { name: 'banco/checklist: adicionar sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, true, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  select coalesce(max(position), 0) + 1 into pos", replace: "  t := private.pj_load_task(p_org, p_task, true, null);\n  select coalesce(max(position), 0) + 1 into pos" },
  { name: 'banco/checklist: limite de itens', file: 'pj_tasks.sql', find: "  if pos > 50 then raise exception 'o checklist aceita até 50 itens' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/checklist: marcar sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, i.task_id, true, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  if p_done is null", replace: "  t := private.pj_load_task(p_org, i.task_id, true, null);\n  if p_done is null" },
  { name: 'banco/checklist: item de outra empresa', file: 'pj_tasks.sql', find: "  select * into i from public.task_checklist_items where id = p_item and organization_id = p_org;\n  if not found then raise exception 'item não encontrado' using errcode = 'P0002'; end if;\n  t := private.pj_load_task(p_org, i.task_id, true, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  if p_done is null", replace: "  select * into i from public.task_checklist_items where id = p_item;\n  if not found then raise exception 'item não encontrado' using errcode = 'P0002'; end if;\n  t := private.pj_load_task(p_org, i.task_id, true, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  if p_done is null" },
  { name: 'banco/checklist: marcar duas vezes', file: 'pj_tasks.sql', find: "  if p_done = (i.completed_at is not null) then return; end if;", replace: '' },
  { name: 'banco/checklist: quem concluiu', file: 'pj_tasks.sql', find: "completed_by = case when p_done then (select auth.uid()) end where id = p_item;", replace: "completed_by = (select auth.uid()) where id = p_item;" },
  { name: 'banco/checklist: remover sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, i.task_id, true, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  delete from public.task_checklist_items", replace: "  t := private.pj_load_task(p_org, i.task_id, true, null);\n  delete from public.task_checklist_items" },
  { name: 'banco/comentário: sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, false, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  perform private.pj_rate_hit('cmt:'", replace: "  t := private.pj_load_task(p_org, p_task, false, null);\n  perform private.pj_rate_hit('cmt:'" },
  { name: 'banco/comentário: limite de taxa', file: 'pj_tasks.sql', find: "  perform private.pj_rate_hit('cmt:' || p_org::text || ':' || uid::text, 120, 600);", replace: '' },
  { name: 'banco/comentário: idempotência', file: 'pj_tasks.sql', find: "  prev := private.pj_idem(p_org, uid, p_idem, 'add_comment', private.pj_hash(array[p_task::text, b]));\n  if prev is not null then return (prev ->> 'id')::uuid; end if;", replace: '' },
  { name: 'banco/comentário: sem aviso', file: 'pj_tasks.sql', find: "  perform private.pj_notify(p_org, t.project_id, p_task, 'task_comment', array[t.assignee_user_id, t.created_by]);", replace: '' },
  { name: 'banco/comentário: aviso só ao responsável', file: 'pj_tasks.sql', find: "'task_comment', array[t.assignee_user_id, t.created_by]);", replace: "'task_comment', array[t.assignee_user_id]);" },
  { name: 'banco/anexo: sem edição', file: 'pj_tasks.sql', find: "  t := private.pj_load_task(p_org, p_task, false, null);\n  perform private.pj_require(p_org, t.project_id, 'edit');\n  perform private.pj_rate_hit('att:'", replace: "  t := private.pj_load_task(p_org, p_task, false, null);\n  perform private.pj_rate_hit('att:'" },
  { name: 'banco/anexo: idempotência', file: 'pj_tasks.sql', find: "  if prev is not null then return (prev ->> 'n')::integer; end if;", replace: '' },
  { name: 'banco/anexo: informação sem acesso', file: 'pj_tasks.sql', find: "  if private.pj_project_role(p_org, t.project_id) is null then raise exception 'arquivo não encontrado' using errcode = 'P0002'; end if;", replace: '' },
  { name: 'banco/anexo: informação de outra empresa', file: 'pj_tasks.sql', find: "  select * into a from public.task_attachments where id = p_attachment and organization_id = p_org;", replace: "  select * into a from public.task_attachments where id = p_attachment;" },
  { name: 'banco/notificação: ler a de outro', file: 'pj_tasks.sql', find: "where id = p_id and organization_id = p_org and user_id = (select auth.uid()) and read_at is null;", replace: "where id = p_id and organization_id = p_org and read_at is null;" },
  { name: 'banco/notificação: todas de todos', file: 'pj_tasks.sql', find: "update public.notifications set read_at = clock_timestamp() where organization_id = p_org and user_id = (select auth.uid()) and read_at is null;", replace: "update public.notifications set read_at = clock_timestamp() where organization_id = p_org and read_at is null;" },
  // ---------------------------------------------------------------- banco: painel e exportação
  { name: 'banco/painel: período máximo', file: 'pj_reads.sql', find: "or p_to - p_from > 366 then", replace: "then" },
  { name: 'banco/painel: período invertido', file: 'pj_reads.sql', find: "or p_to < p_from or", replace: "or" },
  { name: 'banco/painel: projeto de fora', file: 'pj_reads.sql', find: "  if p_project is not null and not private.pj_can_see_project(p_org, p_project) then raise exception 'projeto não encontrado' using errcode = 'P0002'; end if;", replace: '' },
  { name: 'banco/painel: projetos de todos', file: 'pj_reads.sql', find: "where p.organization_id = p_org and private.pj_can_see_project(p_org, p.id) and (p_project is null or p.id = p_project)),", replace: "where p.organization_id = p_org and (p_project is null or p.id = p_project)),", },
  { name: 'banco/painel: tarefa arquivada conta', file: 'pj_reads.sql', find: "    where tk.archived_at is null),\n  opened as", replace: "    ),\n  opened as" },
  { name: 'banco/painel: aberta em projeto cancelado', file: 'pj_reads.sql', find: "opened as (select * from base where sem <> 'done' and pstatus <> 'cancelled' and parch is null),", replace: "opened as (select * from base where sem <> 'done' and parch is null)," },
  { name: 'banco/painel: concluída é aberta', file: 'pj_reads.sql', find: "opened as (select * from base where sem <> 'done' and pstatus", replace: "opened as (select * from base where pstatus" },
  { name: 'banco/painel: vence hoje é atrasada', file: 'pj_reads.sql', find: "'overdue', (select count(*) from opened where due_date < today),", replace: "'overdue', (select count(*) from opened where due_date <= today)," },
  { name: 'banco/painel: atrasadas fora das abertas', file: 'pj_reads.sql', find: "'overdue', (select count(*) from opened where due_date < today),", replace: "'overdue', (select count(*) from base where due_date < today)," },
  { name: 'banco/painel: bloqueadas', file: 'pj_reads.sql', find: "'blocked', (select count(*) from opened where blocked_at is not null),", replace: "'blocked', (select count(*) from base where blocked_at is not null)," },
  { name: 'banco/painel: sem responsável', file: 'pj_reads.sql', find: "'unassigned', (select count(*) from opened where assignee_user_id is null),", replace: "'unassigned', (select count(*) from base where assignee_user_id is null)," },
  { name: 'banco/painel: concluídas no período', file: 'pj_reads.sql', find: "'completed_in_period', (select count(*) from base where sem = 'done' and parch is null and completed_at >= f and completed_at < t),", replace: "'completed_in_period', (select count(*) from base where sem = 'done' and parch is null and completed_at >= f)," },
  { name: 'banco/painel: concluídas de projeto arquivado', file: 'pj_reads.sql', find: "where sem = 'done' and parch is null and completed_at >= f and completed_at < t),", replace: "where sem = 'done' and completed_at >= f and completed_at < t)," },
  { name: 'banco/painel: fuso', file: 'pj_reads.sql', find: "f := p_from::timestamp at time zone tz; t := (p_to + 1)::timestamp at time zone tz;", replace: "f := p_from::timestamp at time zone 'UTC'; t := (p_to + 1)::timestamp at time zone 'UTC';" },
  { name: 'banco/painel: hoje', file: 'pj_reads.sql', find: "today := (now() at time zone tz)::date;", replace: "today := (now() at time zone 'UTC')::date;" },
  { name: 'banco/painel: distribuição por etapa em projetos cancelados', file: 'pj_reads.sql', find: "live as (select * from base where pstatus <> 'cancelled' and parch is null)", replace: "live as (select * from base)" },
  { name: 'banco/painel: prioridade de concluídas', file: 'pj_reads.sql', find: "'urgent', (select count(*) from opened where priority = 'urgent')", replace: "'urgent', (select count(*) from live where priority = 'urgent')" },
  { name: 'banco/painel: carga por responsável', file: 'pj_reads.sql', find: "from opened group by 1) x", replace: "from base group by 1) x" },
  { name: 'banco/painel: progresso sem tarefas', file: 'pj_reads.sql', find: "'percent', case when coalesce(s.total, 0) = 0 then null else round(100.0 * s.done / s.total) end)", replace: "'percent', case when coalesce(s.total, 0) = 0 then 100 else round(100.0 * s.done / s.total) end)" },
  { name: 'banco/painel: progresso com arquivadas', file: 'pj_reads.sql', find: "from vis v left join (select project_id, count(*) total, count(*) filter (where sem = 'done') done from base group by 1) s on s.project_id = v.id", replace: "from vis v left join (select project_id, count(*) total, count(*) filter (where sem = 'done') done from base where false group by 1) s on s.project_id = v.id" },
  { name: 'banco/painel: progresso de cancelados', file: 'pj_reads.sql', find: "      where v.archived_at is null and v.status <> 'cancelled')", replace: "      where v.archived_at is null)" },
  { name: 'banco/exportação: tipo inválido', file: 'pj_reads.sql', find: "  if p_kind is null or p_kind !~ '^[a-z_]{2,40}$' then raise exception 'tipo de exportação inválido' using errcode = '22023'; end if;", replace: '' },
  { name: 'banco/exportação: limite de taxa', file: 'pj_reads.sql', find: "  perform private.pj_rate_hit('exp:' || p_org::text || ':' || (select auth.uid())::text, 30, 600);", replace: '' },
  { name: 'banco/exportação: sem auditoria', file: 'pj_reads.sql', find: "  perform private.pj_audit(p_org, 'export', 'export_' || p_kind, null, jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0)));", replace: '' },
  // ---------------------------------------------------------------- banco: esquema (restrições que valem mesmo para SQL direto)
  { name: 'banco/esquema: número de projeto repetido', file: 'pj_schema.sql', find: "  unique (organization_id, project_number),\n", replace: '' },
  { name: 'banco/esquema: número de tarefa repetido', file: 'pj_schema.sql', find: "  unique (project_id, task_number),\n", replace: '' },
  { name: 'banco/esquema: posição repetida', file: 'pj_schema.sql', find: "create unique index tasks_column_position_uq on public.tasks (column_id, position) where archived_at is null;", replace: '' },
  { name: 'banco/esquema: etiqueta repetida', file: 'pj_schema.sql', find: "create unique index project_labels_name_uq on public.project_labels (project_id, lower(btrim(name)));", replace: '' },
  { name: 'banco/esquema: projeto com datas invertidas', file: 'pj_schema.sql', find: "  check (start_date is null or due_date is null or start_date <= due_date),\n  check ((status = 'completed') = (completed_at is not null))", replace: "  check ((status = 'completed') = (completed_at is not null))" },
  { name: 'banco/esquema: tarefa com datas invertidas', file: 'pj_schema.sql', find: "  check (start_date is null or due_date is null or start_date <= due_date),\n  check ((blocked_at is null) = (blocked_reason is null)),", replace: "  check ((blocked_at is null) = (blocked_reason is null))," },
  { name: 'banco/esquema: impedimento sem motivo', file: 'pj_schema.sql', find: "  check ((blocked_at is null) = (blocked_reason is null)),\n  foreign key (project_id, organization_id) references public.projects (id, organization_id),\n  foreign key (column_id", replace: "  foreign key (project_id, organization_id) references public.projects (id, organization_id),\n  foreign key (column_id" },
  { name: 'banco/esquema: projeto concluído sem data', file: 'pj_schema.sql', find: "  check ((status = 'completed') = (completed_at is not null))\n);", replace: "  check (true)\n);" },
  { name: 'banco/esquema: etapa de outro projeto', file: 'pj_schema.sql', find: "  foreign key (column_id, project_id, organization_id) references public.project_columns (id, project_id, organization_id),", replace: "  foreign key (column_id) references public.project_columns (id)," },
  { name: 'banco/esquema: etiqueta de outro projeto', file: 'pj_schema.sql', find: "  foreign key (label_id, project_id, organization_id) references public.project_labels (id, project_id, organization_id)", replace: "  foreign key (label_id) references public.project_labels (id)" },
  { name: 'banco/esquema: participante de outra empresa', file: 'pj_schema.sql', find: "  foreign key (organization_id, user_id) references public.organization_members (organization_id, user_id) on delete cascade\n);\ncreate index project_members_user_idx", replace: "  foreign key (user_id) references auth.users (id) on delete cascade\n);\ncreate index project_members_user_idx" },
  { name: 'banco/esquema: papel de participante', file: 'pj_schema.sql', find: "project_role text not null check (project_role in ('lead', 'editor', 'reader')),", replace: "project_role text not null," },
  { name: 'banco/esquema: tipo de anexo', file: 'pj_schema.sql', find: "mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain', 'text/csv')),", replace: "mime_type text not null," },
  { name: 'banco/esquema: tamanho do anexo', file: 'pj_schema.sql', find: "size_bytes integer not null check (size_bytes between 1 and 10485760),", replace: "size_bytes integer not null," },
  { name: 'banco/esquema: tamanho configurável do anexo', file: 'pj_schema.sql', find: "attachment_max_size_bytes integer not null default 5242880 check (attachment_max_size_bytes between 10240 and 10485760),", replace: "attachment_max_size_bytes integer not null default 5242880," },
  { name: 'banco/esquema: prefixo', file: 'pj_schema.sql', find: "check (project_prefix ~ '^[A-Z0-9]{1,6}$'),", replace: "," },
  { name: 'banco/esquema: item do checklist concluído sem autor', file: 'pj_schema.sql', find: "  check ((completed_at is null) = (completed_by is null)),", replace: '' },
  { name: 'banco/esquema: comentário vazio', file: 'pj_schema.sql', find: "body text not null check (char_length(btrim(body)) between 1 and 4000),", replace: "body text not null," },
  { name: 'banco/esquema: prioridade', file: 'pj_schema.sql', find: "priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),", replace: "priority text not null default 'normal'," },
  { name: 'banco/esquema: status do projeto', file: 'pj_schema.sql', find: "status text not null default 'planned' check (status in ('planned', 'active', 'paused', 'completed', 'cancelled')),", replace: "status text not null default 'planned'," },
  { name: 'banco/esquema: tipo da etapa', file: 'pj_schema.sql', find: "semantic_status text not null check (semantic_status in ('todo', 'in_progress', 'review', 'done')),", replace: "semantic_status text not null," },
  { name: 'banco/esquema: posição da etapa única', file: 'pj_schema.sql', find: "  unique (project_id, position) deferrable initially deferred,\n", replace: '' },
  { name: 'banco/esquema: tipo de notificação', file: 'pj_schema.sql', find: "kind text not null check (kind in ('task_assigned', 'task_comment', 'task_reopened', 'project_reopened')),", replace: "kind text not null," },
  { name: 'banco/esquema: dados do evento', file: 'pj_schema.sql', find: "data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 4096),\n  created_at timestamptz not null default clock_timestamp(),\n  foreign key (task_id, project_id, organization_id)", replace: "data jsonb not null default '{}'::jsonb,\n  created_at timestamptz not null default clock_timestamp(),\n  foreign key (task_id, project_id, organization_id)" },
  // ---------------------------------------------------------------- banco: privilégios e storage
  { name: 'banco/privilégio: função administrativa executável por anon', file: 'pj_privileges.sql', find: "    execute format('revoke all on function %s from public, anon', f.sig);\n    execute format('grant execute on function %s to authenticated', f.sig);\n  end loop;", replace: "    execute format('revoke all on function %s from public', f.sig);\n    execute format('grant execute on function %s to authenticated', f.sig);\n  end loop;" },
  // ---------------------------------------------------------------- concorrência (sessões simultâneas reais)
  { name: 'conc/trava: projeto sem trava de linha', file: 'pj_helpers.sql', find: "  if p_lock then select * into p from public.projects where id = p_project and organization_id = p_org for update;\n  else select * into p from public.projects where id = p_project and organization_id = p_org; end if;", replace: "  select * into p from public.projects where id = p_project and organization_id = p_org;", suite: 'conc' },
  { name: 'conc/trava: tarefa sem trava de linha', file: 'pj_helpers.sql', find: "  if p_lock then select * into t from public.tasks where id = p_task and organization_id = p_org for update;\n  else select * into t from public.tasks where id = p_task and organization_id = p_org; end if;", replace: "  select * into t from public.tasks where id = p_task and organization_id = p_org;", suite: 'conc' },
  { name: 'conc/numeração: projeto com MAX + 1', file: 'pj_helpers.sql', find: "  insert into public.project_number_counters as c (organization_id, last_number) values (p_org, 1)\n  on conflict (organization_id) do update set last_number = c.last_number + 1 returning last_number into n;", replace: "  select coalesce(max(project_number), 0) + 1 into n from public.projects where organization_id = p_org;", suite: 'conc' },
  { name: 'conc/idempotência: chave sem reserva', file: 'pj_helpers.sql', find: "  insert into public.mutation_requests (organization_id, user_id, idempotency_key, scope, request_hash) values (p_org, p_uid, p_key, p_scope, p_hash) on conflict do nothing;\n  get diagnostics n = row_count;\n  if n = 1 then return null; end if;", replace: "  n := 1;\n  if n = 1 then return null; end if;", suite: 'conc' },
  { name: 'conc/versão do quadro: conferência', file: 'pj_tasks.sql', find: "  if p_board_version is not null and pr.board_version <> p_board_version then perform private.pj_conflict('o quadro'); end if;", replace: '', suite: 'conc' },
  { name: 'conc/versão da tarefa: conferência', file: 'pj_helpers.sql', find: "  if p_expected is not null and t.version <> p_expected then perform private.pj_conflict('esta tarefa'); end if;", replace: '', suite: 'conc' },
  { name: 'conc/ordem: duas fases', file: 'pj_helpers.sql', find: "  update public.tasks set position = position + 1000000 where column_id = p_column and archived_at is null;\n  update public.tasks t set position = u.ord", replace: "  update public.tasks t set position = u.ord", suite: 'conc' },
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
    // vigia: uma execução que passa de 10 min travou (ex.: Docker sem resposta) e NÃO conta como mutante morto
    const timer = setTimeout(() => { hung = true; if (process.platform === 'win32') spawn('taskkill', ['/T', '/F', '/PID', String(p.pid)]); else p.kill('SIGKILL'); }, 10 * 60 * 1000);
    let hung = false;
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, hung }); });
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
  const dir = mkdtempSync(join(tmpdir(), `pack25-pj-mut-${label}-`));
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
const hungList = [];
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
    // mutante de concorrência depende de a corrida acontecer: se sobreviver, tenta de novo (até 3 vezes) antes de dar por sobrevivente
    let r = await runSuite(dir, suite);
    for (let tentativa = 1; suite === "conc" && r.code === 0 && !r.hung && tentativa < 3; tentativa++) r = await runSuite(dir, suite);
    rmSync(dir, { recursive: true, force: true });
    if (r.hung) { console.log(`TRAVOU     ${m.name}`); hungList.push(m.name); continue; }
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
console.log(`\n${all.length - survived.length - broken.length - hungList.length}/${all.length} mutações reprovadas pela suíte.`);
if (broken.length) console.error('Mutações sem alvo (o texto mudou):\n- ' + broken.join('\n- '));
if (survived.length) console.error('Sobreviveram:\n- ' + survived.join('\n- '));
if (hungList.length) console.error('Travaram (reexecute só estas com --only): ' + hungList.join(' | '));
if (survived.length || broken.length || hungList.length) process.exit(1);
