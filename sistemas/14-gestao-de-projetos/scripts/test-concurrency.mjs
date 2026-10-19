#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova (§13, §21 e §24 do prompt mestre): numeração de projetos e tarefas sem duplicação; criação idempotente sob duplo clique; movimentos simultâneos que nunca perdem nem duplicam cartões;
// versão do quadro (só um vence com a mesma versão); atribuição com versão antiga; conclusão × checklist obrigatório; remoção de participante × criação de tarefa atribuída a ele;
// exclusão de etapa × criação de tarefa; conclusão do projeto × criação de tarefa; comentários simultâneos e idempotentes.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-pj-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const uid = (n) => `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: uid(1), mgr: uid(2), lead: uid(3) };
// 12 gestores (criação simultânea de projetos) e 12 editores (tarefas, movimentos e comentários simultâneos): usuários DIFERENTES, porque o limite de abuso é por usuário e serializaria um só.
for (let i = 1; i <= 12; i++) { U[`g${i}`] = uid(100 + i); U[`e${i}`] = uid(200 + i); }
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina — as sessões entram AO MESMO TEMPO.
const GUN_KEY = 7777014;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, who = 'owner') {
  const head = `select set_config('request.jwt.claims', '{"sub":"${U[who]}","aal":"${who === 'owner' ? 'aal2' : 'aal1'}","email":"${who}@t.invalid"}', true); set local role authenticated;`;
  const wrapped = `begin; ${head} ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit`;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(wrapped);
  });
}
const raw = (sql) => new Promise((resolve) => {
  const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  p.stdin.end(sql);
});
async function armGun() {
  gunOn = true;
  spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', 'core', '-c', `select pg_advisory_lock(${GUN_KEY}); select pg_sleep(${GUN_MS / 1000});`], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const r = await raw("select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'");
    if (r.out.trim() === '1') return;
    await new Promise((res) => setTimeout(res, 100));
  }
}
const one = async (sql, who) => { const r = await psql(sql, who); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };
const sa = async (sql) => { const r = await raw(sql); if (r.code !== 0) throw new Error(r.err); return r.out.split('\n').filter(Boolean).pop(); };
const fire = async (n, make) => { await armGun(); const rs = await Promise.all(Array.from({ length: n }, (_, k) => make(k))); gunOn = false; await new Promise((r) => setTimeout(r, GUN_MS + 200)); return rs; };
const oks = (rs) => rs.filter((r) => r.code === 0).length;
let failed = 0;
const check = (cond, label) => { console.log(`  ${cond ? 'PASS' : 'FALHOU'}: ${label}`); if (!cond) failed++; };
const why = (rs, n) => { if (oks(rs) !== n) console.log('   motivo: ' + rs.find((r) => r.code !== 0)?.err.split('\n')[0]); };

try {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) throw new Error('Docker indisponível');
  const run = docker(['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${randomBytes(16).toString('hex')}`, '-e', 'POSTGRES_DB=core', IMAGE, '-c', 'max_connections=200']);
  if (run.status !== 0) throw new Error(run.stderr);
  for (let i = 0; i < 60; i++) {
    if (docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'core']).status === 0) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);
  }
  for (const f of ['tests/00_harness.sql', ...readdirSync(join(dbDir, 'migrations')).filter((x) => x.endsWith('.sql')).sort().map((x) => `migrations/${x}`)]) {
    const r = await raw(readFileSync(join(dbDir, f), 'utf8'));
    if (r.code !== 0) throw new Error(`${f}: ${r.err}`);
  }
  await raw(`insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@t.invalid')`).join(', ')}`);
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc-pj')`);
  const O = `'${org}'`;
  const mem = (role, keys) => raw(`insert into public.organization_members (organization_id, user_id, role) values ${keys.map((k) => `('${org}', '${U[k]}', '${role}')`).join(', ')}`);
  await mem('manager', ['mgr', ...Array.from({ length: 12 }, (_, i) => `g${i + 1}`)]);
  await mem('member', ['lead', ...Array.from({ length: 12 }, (_, i) => `e${i + 1}`)]);

  const editors = Array.from({ length: 12 }, (_, i) => ({ user_id: U[`e${i + 1}`], role: 'editor' }));
  const mkProject = async (nm, status = 'active') => {
    const members = JSON.stringify([{ user_id: U.lead, role: 'lead' }, ...editors]).replace(/'/g, "''");
    return JSON.parse(await one(`select public.pj_create_project(${O}, '${randomUUID()}', jsonb_build_object('name', '${nm}', 'status', '${status}', 'members', '${members}'::jsonb))`, 'mgr')).id;
  };
  const col = (p, sem, nth = 1) => sa(`select id from (select id, row_number() over (order by position) rn from public.project_columns where project_id = '${p}' and semantic_status = '${sem}') x where rn = ${nth}`);
  const mkTask = async (p, title, extra = '') => JSON.parse(await one(`select public.pj_create_task(${O}, '${p}', '${randomUUID()}', jsonb_build_object('title', '${title}'${extra}))`, 'lead')).id;
  const bv = async (p) => Number(await sa(`select board_version from public.projects where id = '${p}'`));
  const tv = async (t) => Number(await sa(`select version from public.tasks where id = '${t}'`));
  const dense = async (p) => (await sa(`select count(*) from (select column_id, position, row_number() over (partition by column_id order by position) rn from public.tasks where project_id = '${p}' and archived_at is null) x where position <> rn`)) === '0';

  console.log('> 12 gestores criam projetos ao mesmo tempo (número por empresa sem duplicação)');
  const rN = await fire(12, (k) => psql(`select public.pj_create_project(${O}, '${randomUUID()}', jsonb_build_object('name', 'Concorrente ${k}'))`, `g${k + 1}`));
  why(rN, 12);
  check(oks(rN) === 12, 'as 12 criações terminam bem');
  check((await sa(`select count(distinct project_number) from public.projects`)) === '12', 'os 12 números são distintos');
  check((await sa(`select max(project_number) - min(project_number) + 1 from public.projects`)) === '12', 'a sequência é contínua (sem buracos nem MAX+1)');

  console.log('> duplo clique: 8 sessões com a MESMA chave de idempotência');
  const dupKey = randomUUID();
  const rD = await fire(8, () => psql(`select public.pj_create_project(${O}, '${dupKey}', '{"name":"Projeto do duplo clique"}')`, 'mgr'));
  why(rD, 8);
  check(oks(rD) === 8 && new Set(rD.map((r) => r.out)).size === 1, 'todas respondem o mesmo resultado');
  check((await sa(`select count(*) from public.projects where name = 'Projeto do duplo clique'`)) === '1', 'só UM projeto foi criado');

  const P = await mkProject('Projeto Principal');
  console.log('> 12 editores criam tarefas ao mesmo tempo no mesmo projeto');
  const rT = await fire(12, (k) => psql(`select public.pj_create_task(${O}, '${P}', '${randomUUID()}', jsonb_build_object('title', 'Tarefa concorrente ${k}'))`, `e${k + 1}`));
  why(rT, 12);
  check(oks(rT) === 12, 'as 12 criações terminam bem');
  check((await sa(`select count(distinct task_number) from public.tasks where project_id = '${P}'`)) === '12' && (await sa(`select max(task_number) from public.tasks where project_id = '${P}'`)) === '12', 'números de tarefa 1..12 sem repetição');
  check(await dense(P), 'posições 1..n sem buracos nem duplicatas');

  console.log('> 12 movimentos simultâneos de tarefas diferentes para «Em andamento» (sem conferir a versão do quadro)');
  const ids = (await sa(`select string_agg(id::text, ',' order by task_number) from public.tasks where project_id = '${P}'`)).split(',');
  const prog = await col(P, 'in_progress');
  const rM = await fire(12, (k) => psql(`select public.pj_move_task(${O}, '${ids[k]}', '${prog}', null, null)`, `e${k + 1}`));
  why(rM, 12);
  check(oks(rM) === 12, 'os 12 movimentos terminam bem');
  check((await sa(`select count(*) from public.tasks where project_id = '${P}' and column_id = '${prog}'`)) === '12' && await dense(P), 'as 12 tarefas estão na etapa nova, com posições 1..12: nenhum cartão perdido ou duplicado');
  check((await sa(`select count(*) from public.tasks where project_id = '${P}'`)) === '12', 'o total de tarefas continua 12');

  console.log('> 6 sessões movem tarefas diferentes com a MESMA versão do quadro: só uma vence, as outras recebem conflito');
  const rV = await (async () => {
    const v = await bv(P);
    const review = await col(P, 'review');
    return fire(6, (k) => psql(`select public.pj_move_task(${O}, '${ids[k]}', '${review}', null, ${v})`, `e${k + 1}`));
  })();
  check(oks(rV) === 1, `exatamente 1 vence (venceram ${oks(rV)})`);
  check(rV.filter((r) => r.code !== 0).every((r) => /Outra pessoa alterou/.test(r.err)), 'as demais recebem «alterado por outra pessoa» (conflito, nunca sobrescrita silenciosa)');
  check(await dense(P) && (await sa(`select count(*) from public.tasks where project_id = '${P}'`)) === '12', 'o quadro segue íntegro');

  console.log('> 10 sessões reordenam a MESMA etapa ao mesmo tempo (ordem final sempre 1..n)');
  const rR = await fire(10, (k) => psql(`select public.pj_move_task(${O}, '${ids[(k % 5) + 6]}', '${prog}', ${k % 2 === 0 ? 'null' : `'${ids[11]}'`}, null)`, `e${k + 1}`));
  why(rR, 10);
  check(oks(rR) === 10, 'as 10 reordenações terminam bem');
  check(await dense(P) && (await sa(`select count(*) from public.tasks where project_id = '${P}' and archived_at is null`)) === '12', 'posições íntegras e nenhum cartão perdido');

  console.log('> 8 sessões atribuem a MESMA tarefa com a mesma versão: só uma vence');
  const T1 = await mkTask(P, 'Disputada');
  const vv = await tv(T1);
  const rA = await fire(8, (k) => psql(`select public.pj_assign_task(${O}, '${T1}', ${vv}, '${U[`e${k + 1}`]}')`, `e${k + 1}`));
  check(oks(rA) === 1, `exatamente 1 atribuição vence (venceram ${oks(rA)})`);
  check(rA.filter((r) => r.code !== 0).every((r) => /Outra pessoa alterou/.test(r.err)), 'as demais recebem conflito de versão');
  check((await sa(`select count(*) from public.task_events where task_id = '${T1}' and event_type = 'assignee_changed'`)) === '1', 'um único evento de responsável');

  console.log('> concluir × adicionar item obrigatório (12 rodadas): nunca uma tarefa concluída com obrigatório pendente');
  const done = await col(P, 'done');
  let badChk = 0;
  for (let i = 0; i < 12; i++) {
    const T = await mkTask(P, `Checklist ${i}`);
    await one(`select public.pj_move_task(${O}, '${T}', '${prog}', null, null)`, 'lead');
    const rr = await fire(2, (k) => (k === 0
      ? psql(`select public.pj_move_task(${O}, '${T}', '${done}', null, null)`, 'e1')
      : psql(`select public.pj_add_checklist_item(${O}, '${T}', 'Obrigatório tardio', true)`, 'e2')));
    const concluida = (await sa(`select count(*) from public.tasks t join public.project_columns c on c.id = t.column_id where t.id = '${T}' and c.semantic_status = 'done'`)) === '1';
    const pend = Number(await sa(`select count(*) from public.task_checklist_items where task_id = '${T}' and required and completed_at is null`));
    const ok = (concluida && (await sa(`select count(*) from public.task_checklist_items where task_id = '${T}'`)) === '0' && oks(rr) >= 1) || (!concluida && pend === 1);
    if (!ok || (concluida && pend > 0)) badChk++;
  }
  check(badChk === 0, 'em todas as rodadas: ou concluiu primeiro (e o item foi recusado) ou o item entrou e a conclusão foi recusada');

  console.log('> remover participante × criar tarefa atribuída a ele (6 rodadas)');
  let badMem = 0;
  for (let i = 0; i < 6; i++) {
    const victim = `e${12 - i}`;
    const rr = await fire(2, (k) => (k === 0
      ? psql(`select public.pj_remove_member(${O}, '${P}', '${U[victim]}', 'unassign', null)`, 'lead')
      : psql(`select public.pj_create_task(${O}, '${P}', '${randomUUID()}', jsonb_build_object('title', 'Para o removido ${i}', 'assignee_user_id', '${U[victim]}'))`, 'e1')));
    const stillMember = (await sa(`select count(*) from public.project_members where project_id = '${P}' and user_id = '${U[victim]}'`)) === '1';
    const orphans = Number(await sa(`select count(*) from public.tasks t where t.project_id = '${P}' and t.archived_at is null and t.assignee_user_id = '${U[victim]}'`));
    if (!stillMember && orphans > 0) badMem++;
    void rr;
  }
  check(badMem === 0, 'nunca sobra tarefa aberta atribuída a quem deixou de participar');

  console.log('> excluir etapa (com realocação) × criar tarefa nela (6 rodadas)');
  let badCol = 0;
  for (let i = 0; i < 6; i++) {
    const c2 = await one(`select public.pj_add_column(${O}, '${P}', null, 'Temporária ${i}', 'todo')`, 'lead');
    const todo = await col(P, 'todo');
    await one(`select public.pj_create_task(${O}, '${P}', '${randomUUID()}', jsonb_build_object('title', 'Já na temporária ${i}', 'column_id', '${c2}'))`, 'lead');
    await fire(2, (k) => (k === 0
      ? psql(`select public.pj_delete_column(${O}, '${P}', null, '${c2}', '${todo}')`, 'lead')
      : psql(`select public.pj_create_task(${O}, '${P}', '${randomUUID()}', jsonb_build_object('title', 'Corrida na temporária ${i}', 'column_id', '${c2}'))`, 'e1')));
    const missing = Number(await sa(`select count(*) from public.tasks t where t.project_id = '${P}' and not exists (select 1 from public.project_columns c where c.id = t.column_id)`));
    if (missing > 0 || !(await dense(P))) badCol++;
  }
  check(badCol === 0, 'nenhuma tarefa fica sem etapa e as posições seguem íntegras');

  console.log('> concluir o projeto × criar tarefa (6 rodadas): nunca projeto concluído com tarefa aberta');
  let badProj = 0;
  for (let i = 0; i < 6; i++) {
    const Q = await mkProject(`Projeto de encerramento ${i}`);
    const rr = await fire(2, (k) => (k === 0
      ? psql(`select public.pj_set_project_status(${O}, '${Q}', (select version from public.projects where id = '${Q}'), 'completed')`, 'lead')
      : psql(`select public.pj_create_task(${O}, '${Q}', '${randomUUID()}', jsonb_build_object('title', 'Chegou tarde'))`, 'e1')));
    const st = await sa(`select status from public.projects where id = '${Q}'`);
    const open = Number(await sa(`select count(*) from public.tasks t join public.project_columns c on c.id = t.column_id where t.project_id = '${Q}' and t.archived_at is null and c.semantic_status <> 'done'`));
    if (st === 'completed' && open > 0) badProj++;
    void rr;
  }
  check(badProj === 0, 'ou o projeto concluiu antes (e a tarefa foi recusada) ou a tarefa entrou e a conclusão foi recusada');

  console.log('> 12 comentários simultâneos e duplo envio com a mesma chave');
  const T2 = await mkTask(P, 'Com comentários');
  const rC = await fire(12, (k) => psql(`select public.pj_add_comment(${O}, '${T2}', '${randomUUID()}', 'Comentário ${k}')`, `e${(k % 6) + 1}`));
  why(rC, 12);
  check(oks(rC) === 12 && (await sa(`select count(*) from public.task_comments where task_id = '${T2}'`)) === '12', 'os 12 comentários entram');
  const ck = randomUUID();
  const rC2 = await fire(8, () => psql(`select public.pj_add_comment(${O}, '${T2}', '${ck}', 'Comentário repetido')`, 'e1'));
  check(oks(rC2) === 8 && (await sa(`select count(*) from public.task_comments where body = 'Comentário repetido'`)) === '1', 'duplo envio não duplica o comentário');

  console.log('> invariantes finais');
  check((await sa(`select count(*) from (select column_id, position from public.tasks where archived_at is null group by 1, 2 having count(*) > 1) x`)) === '0', 'nenhuma posição repetida no quadro');
  check((await sa(`select count(*) from public.tasks t join public.project_columns c on c.id = t.column_id where (c.semantic_status = 'done') <> (t.completed_at is not null)`)) === '0', 'completed_at coerente com a etapa «Concluído»');
  check((await sa(`select count(*) from public.tasks t where t.archived_at is null and t.assignee_user_id is not null and not exists (select 1 from public.project_members m where m.project_id = t.project_id and m.user_id = t.assignee_user_id) and not exists (select 1 from public.organization_members o where o.organization_id = t.organization_id and o.user_id = t.assignee_user_id and o.role in ('owner', 'admin', 'manager'))`)) === '0', 'todo responsável de tarefa aberta tem acesso ao projeto');
  check((await sa(`select count(*) from public.projects p where p.status = 'completed' and exists (select 1 from public.tasks t join public.project_columns c on c.id = t.column_id where t.project_id = p.id and t.archived_at is null and c.semantic_status <> 'done')`)) === '0', 'nenhum projeto concluído com tarefa aberta');
} catch (e) {
  console.error('ERRO: ' + (e instanceof Error ? e.message : e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed ? `CONCORRÊNCIA: ${failed} FALHA(S)` : 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM');
process.exit(failed ? 1 : 0);
