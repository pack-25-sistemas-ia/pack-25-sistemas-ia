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

import { M } from './mutation-list.mjs';

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
  const dir = mkdtempSync(join(tmpdir(), `pack25-ct-mut-${label}-`));
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
