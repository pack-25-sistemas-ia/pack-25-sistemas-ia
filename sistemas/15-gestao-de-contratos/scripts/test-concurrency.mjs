#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova: numeração de contratos sem duplicação; criação idempotente sob duplo clique; aplicação de reajuste (só uma vence, valor muda uma vez); versões de documento sem repetição;
// edição/encerramento com a mesma versão (só um vence); concluir × cancelar obrigação; remover acesso × criar obrigação atribuída; execução simultânea do job de lembretes sem duplicar avisos.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-ct-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const uid = (n) => `ffffffff-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { owner: uid(1), mgr: uid(2) };
// 12 gestores (criações simultâneas) e 12 editores: usuários DIFERENTES, porque o limite de abuso é por usuário e serializaria um só.
for (let i = 1; i <= 12; i++) { U[`g${i}`] = uid(100 + i); U[`e${i}`] = uid(200 + i); }
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });

// «Largada sincronizada»: toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina — as sessões entram AO MESMO TEMPO.
const GUN_KEY = 7777015;
const GUN_MS = 3500;
let gunOn = false;
function exec(sql) {
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    // vigia: o cliente do Docker pode travar sob carga; uma sessão que passa de 90 s é encerrada e conta como falha (nunca trava o teste)
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: 124, out, err: 'tempo esgotado' }); }, 90_000);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }); });
    p.stdin.end(sql);
  });
}
const raw = exec;
const psql = (sql, who = 'owner') => exec(`begin; select set_config('request.jwt.claims', '{"sub":"${U[who]}","aal":"${who === 'owner' ? 'aal2' : 'aal1'}","email":"${who}@t.invalid"}', true); set local role authenticated; ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit`);
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
const conflict = /Outra pessoa alterou/;

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
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc-ct')`);
  const O = `'${org}'`;
  const mem = (role, keys) => raw(`insert into public.organization_members (organization_id, user_id, role) values ${keys.map((k) => `('${org}', '${U[k]}', '${role}')`).join(', ')}`);
  await mem('manager', ['mgr', ...Array.from({ length: 12 }, (_, i) => `g${i + 1}`)]);
  await mem('member', Array.from({ length: 12 }, (_, i) => `e${i + 1}`));

  const cpId = await one(`select public.ct_save_counterparty(${O}, null, null, '{"person_type":"company","name":"Parte Concorrente"}', '${randomUUID()}')`, 'mgr');
  const access = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ user_id: U[`e${i + 1}`], role: 'editor' }))).replace(/'/g, "''");
  const mkContract = async (title, { value = true, activate = true } = {}) => {
    const body = `jsonb_build_object('title', '${title}', 'start_date', (current_date - 60)::text, 'end_date', (current_date + 300)::text, 'parties', jsonb_build_array(jsonb_build_object('counterparty_id', '${cpId}', 'role_description', 'Contratada')), 'access', '${access}'::jsonb${value ? `, 'value', jsonb_build_object('amount_cents', 100000, 'billing_basis', 'monthly')` : ''})`;
    const id = JSON.parse(await one(`select public.ct_create_contract(${O}, '${randomUUID()}', ${body})`, 'mgr')).id;
    if (activate) await one(`select public.ct_activate_contract(${O}, '${id}', ${await cv(id)})`, 'mgr');
    return id;
  };
  const cv = async (c) => Number(await sa(`select version from public.contracts where id = '${c}'`));
  const file = (c, ext = 'pdf') => `jsonb_build_object('path', '${org}/${c}/${randomBytes(16).toString('hex')}.${ext}', 'mime', 'application/pdf', 'size', 2048, 'filename', 'contrato.${ext}')`;

  console.log('> 12 gestores criam contratos ao mesmo tempo (número por empresa sem duplicação)');
  const rN = await fire(12, (k) => psql(`select public.ct_create_contract(${O}, '${randomUUID()}', jsonb_build_object('title', 'Concorrente ${k}', 'start_date', current_date::text, 'end_date', (current_date + 30)::text))`, `g${k + 1}`));
  why(rN, 12);
  check(oks(rN) === 12, 'as 12 criações terminam bem');
  check((await sa(`select count(distinct contract_number) from public.contracts`)) === '12', 'os 12 números são distintos');
  check((await sa(`select max(contract_number) - min(contract_number) + 1 from public.contracts`)) === '12', 'a sequência é contínua (sem buracos nem MAX+1)');

  console.log('> duplo clique: 8 sessões com a MESMA chave de idempotência');
  const dupKey = randomUUID();
  const rD = await fire(8, () => psql(`select public.ct_create_contract(${O}, '${dupKey}', '{"title":"Contrato do duplo clique","start_date":"2030-01-01","end_date":"2030-12-31"}')`, 'mgr'));
  why(rD, 8);
  check(oks(rD) === 8 && new Set(rD.map((r) => r.out)).size === 1, 'todas respondem o mesmo resultado');
  check((await sa(`select count(*) from public.contracts where title = 'Contrato do duplo clique'`)) === '1', 'só UM contrato foi criado');

  const C = await mkContract('Contrato Principal');

  console.log('> 6 sessões aplicam o MESMO reajuste ao mesmo tempo: só uma vence e o valor muda uma única vez');
  const sim = JSON.parse(await one(`select public.ct_simulate_adjustment(${O}, '${C}', current_date - 1, 10, 'IPCA', null, null, null)`, 'mgr'));
  const rA = await fire(6, (k) => psql(`select public.ct_apply_adjustment(${O}, '${sim.id}')`, k % 2 ? 'mgr' : `g${k + 1}`));
  check(oks(rA) === 1, `exatamente 1 aplicação vence (venceram ${oks(rA)})`);
  check((await sa(`select count(*) from public.contract_value_versions where contract_id = '${C}'`)) === '2', 'duas versões de valor (inicial + reajuste), nunca três');
  check((await sa(`select amount_cents from public.contract_value_versions where contract_id = '${C}' order by effective_from desc limit 1`)) === '110000', 'valor 100000 → 110000, aplicado uma vez só');

  console.log('> 10 sessões enviam NOVA VERSÃO do mesmo documento: números 1..n sem repetição');
  const D = JSON.parse(await one(`select public.ct_add_document(${O}, '${C}', '${randomUUID()}', 'Contrato assinado', 'main', ${file(C)})`, 'e1')).id ?? null;
  const docId = D ?? (await sa(`select id from public.contract_documents where contract_id = '${C}' limit 1`));
  const rV = await fire(10, (k) => psql(`select public.ct_add_document_version(${O}, '${docId}', '${randomUUID()}', ${file(C)})`, `e${(k % 12) + 1}`));
  why(rV, 10);
  check(oks(rV) === 10, 'as 10 versões entram');
  check((await sa(`select count(distinct version_number) || '/' || max(version_number) from public.contract_document_versions where document_id = '${docId}'`)) === '11/11', 'versões 1..11 distintas (1 inicial + 10)');
  check((await sa(`select count(*) from public.contract_document_versions where document_id = '${docId}'`)) === '11', 'nenhuma versão perdida ou duplicada');

  console.log('> duplo envio do mesmo documento (mesma chave de idempotência)');
  const dk = randomUUID();
  const rDD = await fire(8, () => psql(`select public.ct_add_document(${O}, '${C}', '${dk}', 'Anexo repetido', 'other', jsonb_build_object('path', '${org}/${C}/${'ab'.repeat(16)}.pdf', 'mime', 'application/pdf', 'size', 1024, 'filename', 'a.pdf'))`, 'e1'));
  why(rDD, 8);
  check(oks(rDD) === 8 && (await sa(`select count(*) from public.contract_documents where title = 'Anexo repetido'`)) === '1', 'só UM documento criado');

  console.log('> 8 sessões editam o MESMO contrato com a mesma versão: só uma vence');
  const v0 = await cv(C);
  const rU = await fire(8, (k) => psql(`select public.ct_update_contract(${O}, '${C}', ${v0}, jsonb_build_object('title', 'Título ${k}'))`, k < 4 ? 'mgr' : `g${k}`));
  check(oks(rU) === 1, `exatamente 1 edição vence (venceram ${oks(rU)})`);
  check(rU.filter((r) => r.code !== 0).every((r) => conflict.test(r.err)), 'as demais recebem «alterado por outra pessoa» (nunca sobrescrita silenciosa)');

  console.log('> encerrar × editar o mesmo contrato com a mesma versão: só um vence');
  const C2 = await mkContract('Contrato para encerrar');
  const v2 = await cv(C2);
  const rT = await fire(2, (k) => (k === 0
    ? psql(`select public.ct_terminate_contract(${O}, '${C2}', ${v2}, current_date - 1, 'Rescisão amigável')`, 'mgr')
    : psql(`select public.ct_update_contract(${O}, '${C2}', ${v2}, jsonb_build_object('title', 'Editado na corrida'))`, 'g1')));
  check(oks(rT) === 1, `exatamente 1 vence (venceram ${oks(rT)})`);
  why(rT, 2); check(rT.filter((r) => r.code !== 0).every((r) => conflict.test(r.err)), 'o perdedor recebe conflito de versão');

  console.log('> concluir × cancelar a MESMA obrigação (8 rodadas): só um vence e o estado é coerente');
  let badOb = 0;
  for (let i = 0; i < 8; i++) {
    const ob = await one(`select public.ct_save_obligation(${O}, '${C}', null, null, jsonb_build_object('title', 'Obrigação ${i}', 'due_date', (current_date + 20)::text))`, 'e1');
    const vo = Number(await sa(`select version from public.contract_obligations where id = '${ob}'`));
    const rr = await fire(2, (k) => (k === 0
      ? psql(`select public.ct_complete_obligation(${O}, '${ob}', ${vo}, 'feito')`, 'e1')
      : psql(`select public.ct_cancel_obligation(${O}, '${ob}', ${vo}, 'não se aplica')`, 'e2')));
    const st = await sa(`select status || '|' || (completed_at is not null) from public.contract_obligations where id = '${ob}'`);
    if (oks(rr) !== 1 || !['completed|true', 'cancelled|false'].includes(st)) badOb++;
  }
  check(badOb === 0, 'em todas as rodadas exatamente uma operação vence e completed_at acompanha o status');

  console.log('> remover o acesso de quem é responsável × criar obrigação atribuída a ele (6 rodadas)');
  let badAcc = 0;
  for (let i = 0; i < 6; i++) {
    const victim = `e${12 - i}`;
    await fire(2, (k) => (k === 0
      ? psql(`select public.ct_set_access(${O}, '${C}', '${U[victim]}', null, 'unassign', null)`, 'mgr')
      : psql(`select public.ct_save_obligation(${O}, '${C}', null, null, jsonb_build_object('title', 'Para o removido ${i}', 'due_date', (current_date + 15)::text, 'responsible_user_id', '${U[victim]}'))`, 'e1')));
    const hasAccess = (await sa(`select count(*) from public.contract_access where contract_id = '${C}' and user_id = '${U[victim]}'`)) === '1';
    const orphans = Number(await sa(`select count(*) from public.contract_obligations where contract_id = '${C}' and status = 'pending' and responsible_user_id = '${U[victim]}'`));
    if (!hasAccess && orphans > 0) badAcc++;
  }
  check(badAcc === 0, 'nunca sobra obrigação pendente atribuída a quem perdeu o acesso ao contrato');

  console.log('> job de lembretes executado por 6 sessões ao mesmo tempo: nenhum aviso duplicado');
  await sa(`insert into public.contract_obligations (organization_id, contract_id, title, responsible_user_id, due_date) values ('${org}', '${C}', 'Vence em breve', '${U.e1}', current_date + 3)`);
  const rJ = await fire(6, () => exec(`select private.ct_process_reminders('${org}', now(), 'manual')`));
  why(rJ, 6);
  check(oks(rJ) === 6, 'as 6 execuções terminam bem');
  check((await sa(`select count(*) from (select dedupe_key from public.reminder_deliveries group by 1 having count(*) > 1) x`)) === '0', 'nenhuma chave de entrega repetida');
  check((await sa(`select count(*) from (select user_id, kind, source_id, due_date, offset_days from public.notifications where kind like 'reminder%' group by 1,2,3,4,5 having count(*) > 1) x`)) === '0', 'nenhuma notificação duplicada para a mesma pessoa e prazo');

  console.log('> invariantes finais');
  check((await sa(`select count(*) from (select contract_number from public.contracts group by 1 having count(*) > 1) x`)) === '0', 'nenhum número de contrato repetido');
  check((await sa(`select count(*) from (select contract_id, effective_from from public.contract_value_versions group by 1, 2 having count(*) > 1) x`)) === '0', 'nenhum contrato com duas versões de valor na mesma data');
  check((await sa(`select count(*) from public.contract_documents d where not exists (select 1 from public.contract_document_versions v where v.id = d.current_version_id)`)) === '0', 'todo documento tem versão atual existente');
} catch (e) {
  console.error('ERRO: ' + (e instanceof Error ? e.message : e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed ? `CONCORRÊNCIA: ${failed} FALHA(S)` : 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM');
process.exit(failed ? 1 : 0);
