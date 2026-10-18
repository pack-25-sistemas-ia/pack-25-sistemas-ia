#!/usr/bin/env node
// Concorrência REAL: várias sessões psql simultâneas contra o mesmo banco (dados confirmados, sem rollback).
// Prova (§10, §11, §19 e §22 do prompt mestre): numeração por empresa sem duplicação; abertura idempotente sob duplo clique; início simultâneo (só uma vence); decisão do cliente
// sobre a versão do orçamento × nova publicação (nunca uma decisão em versão substituída); duas decisões sobre a mesma versão; aceite × contestação; encerrar × reabrir;
// uso de peça idempotente e estornos que nunca deixam o saldo negativo.
// Uso: node scripts/test-concurrency.mjs   (requer Docker; banco descartável, sem porta publicada)
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = join(root, 'supabase');
const name = `pack25-os-conc-${randomBytes(4).toString('hex')}`;
const IMAGE = process.env.PG_TEST_IMAGE ?? 'postgres:17-alpine';
const U = { owner: 'ffffffff-0000-4000-8000-0000000000a0', mgr: 'ffffffff-0000-4000-8000-0000000000a1', t1: 'ffffffff-0000-4000-8000-0000000000a2', t2: 'ffffffff-0000-4000-8000-0000000000a3' };
// 12 gestores extras: a abertura simultânea precisa vir de USUÁRIOS DIFERENTES (o limite de abuso é uma linha por usuário e serializaria as chamadas de um mesmo usuário)
for (let i = 3; i <= 14; i++) U[`g${i}`] = `ffffffff-0000-4000-8000-000000001${String(i).padStart(3, '0')}`;
const docker = (a, o = {}) => spawnSync('docker', a, { encoding: 'utf8', ...o });
const sha = (t) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

// «Largada sincronizada»: toda chamada espera um alvo comum (advisory lock) liberado só quando o canhão termina — as sessões entram AO MESMO TEMPO.
const GUN_KEY = 7777013;
const GUN_MS = 3500;
let gunOn = false;
function psql(sql, who = 'owner') {
  const head = who === 'anon'
    ? `select set_config('request.jwt.claims', '{}', true); set local role anon;`
    : `select set_config('request.jwt.claims', '{"sub":"${U[who]}","aal":"${who === 'owner' ? 'aal2' : 'aal1'}","email":"${who}@t.invalid"}', true); set local role authenticated;`;
  const wrapped = `begin; ${head} ${gunOn ? `select pg_advisory_xact_lock_shared(${GUN_KEY});` : ''} ${sql}; commit`;
  return new Promise((resolve) => {
    const p = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'core'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    const t0 = Date.now();
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim(), ms: Date.now() - t0 }));
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
  const org = await one(`select public.create_organization('Empresa Concorrência', 'empresa-conc-os')`);
  const O = `'${org}'`;
  await raw(`insert into public.organization_members (organization_id, user_id, role) values ('${org}', '${U.mgr}', 'manager'), ('${org}', '${U.t1}', 'member'), ('${org}', '${U.t2}', 'member')`);
  await raw(`insert into public.organization_members (organization_id, user_id, role) values ${Array.from({ length: 12 }, (_, i) => `('${org}', '${U[`g${i + 3}`]}', 'manager')`).join(', ')}`);
  const cust = await one(`select public.os_save_customer(${O}, null, '{"name":"Cliente Concorrência"}')`, 'mgr');
  const pt = await one(`select public.os_save_part(${O}, null, '{"code":"P-1","name":"Peça de teste","reference_price_cents":100}')`, 'mgr');

  const openSql = (key, subj, extra = '') => `select public.os_open_order(${O}, '${key}', jsonb_build_object('customer_id', '${cust}', 'subject', '${subj}', 'problem_description', 'texto da ordem'${extra}))`;
  const mkOrder = async (subj, tech = U.t1) => (JSON.parse(await one(openSql(randomUUID(), subj, `, 'technician_id', '${tech}'`), 'mgr'))).id;
  const ver = async (id) => Number(await sa(`select version from public.service_orders where id = '${id}'`));
  // cria + publica orçamento (opcionalmente já aprovado manualmente)
  const publishQuote = async (order, price = 1000) => {
    const q = await one(`select public.os_quote_new_draft(${O}, '${order}')`, 'mgr');
    const v = Number(await sa(`select version from public.quote_versions where id = '${q}'`));
    await one(`select public.os_quote_save_draft(${O}, '${q}', ${v}, jsonb_build_object('valid_date', (current_date + 7)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Serviço', 'unit', 'un', 'quantity', 1, 'unit_price_cents', ${price}))))`, 'mgr');
    const v2 = Number(await sa(`select version from public.quote_versions where id = '${q}'`));
    await one(`select public.os_quote_publish(${O}, '${q}', ${v2})`, 'mgr');
    return q;
  };
  const approveManual = (q) => one(`select public.os_quote_decide_manual(${O}, '${q}', 'approved', 'Cliente', 'Aprovado em conversa registrada.', null, null)`, 'mgr');
  const link = async (order) => { const tk = newToken(); await one(`select public.os_create_link(${O}, '${order}', '${sha(tk)}')`, 'mgr'); return tk; };

  console.log('> 12 gestores abrem ordens ao mesmo tempo (número por empresa sem duplicação)');
  const rN = await fire(12, (k) => psql(openSql(randomUUID(), `Concorrente ${k}`), `g${k + 3}`));
  why(rN, 12);
  check(oks(rN) === 12, 'as 12 aberturas terminam bem');
  check((await sa(`select count(distinct order_number) from public.service_orders`)) === '12', 'os 12 números são distintos');
  check((await sa(`select max(order_number) - min(order_number) + 1 from public.service_orders`)) === '12', 'a sequência é contínua (sem buracos nem MAX+1)');

  console.log('> duplo clique: 8 sessões com a MESMA chave de idempotência');
  const dupKey = randomUUID();
  const before = Number(await sa(`select count(*) from public.service_orders`));
  const rD = await fire(8, () => psql(openSql(dupKey, 'Ordem do duplo clique'), 'mgr'));
  why(rD, 8);
  check(oks(rD) === 8, 'todas as 8 chamadas terminam bem (reenvio devolve a mesma ordem)');
  check(Number(await sa(`select count(*) from public.service_orders`)) === before + 1, 'exatamente UMA ordem nova');
  check((await sa(`select count(*) from public.service_order_snapshots s join public.service_orders o on o.id = s.service_order_id where o.subject = 'Ordem do duplo clique'`)) === '1', 'exatamente UM snapshot inicial');
  check(new Set(rD.map((r) => JSON.parse(r.out.split('\n').filter(Boolean).pop()).id)).size === 1, 'todas as respostas apontam para a mesma ordem');

  console.log('> início simultâneo da mesma ordem com a mesma versão (só uma sessão vence)');
  const o1 = await mkOrder('Início concorrente');
  await approveManual(await publishQuote(o1));
  const v1 = await ver(o1);
  const rS = await fire(6, (k) => psql(`select public.os_start(${O}, '${o1}', ${v1})`, k % 2 ? 'mgr' : 't1'));
  check(oks(rS) === 1, 'somente UMA chamada inicia');
  check(rS.filter((r) => r.code !== 0).every((r) => /alterada por outra pessoa/.test(r.err)), 'as outras recebem «alterada por outra pessoa»');
  check((await sa(`select count(*) from public.order_events where service_order_id = '${o1}' and event_type = 'started'`)) === '1', 'um único evento «iniciada»');

  console.log('> cliente aprova a versão 1 × gestão publica a versão 2, 6 rodadas (nunca decisão em versão substituída)');
  let bad = 0; let approvedFirst = 0; let publishedFirst = 0;
  for (let i = 0; i < 6; i++) {
    const o = await mkOrder(`Aprovação × publicação ${i}`);
    const q1 = await publishQuote(o);
    const tk = await link(o);
    const q2 = await one(`select public.os_quote_new_draft(${O}, '${o}')`, 'mgr');
    const qv = Number(await sa(`select version from public.quote_versions where id = '${q2}'`));
    await one(`select public.os_quote_save_draft(${O}, '${q2}', ${qv}, jsonb_build_object('valid_date', (current_date + 7)::text, 'items', jsonb_build_array(jsonb_build_object('kind', 'service', 'description', 'Serviço revisado', 'unit', 'un', 'quantity', 1, 'unit_price_cents', 2000))))`, 'mgr');
    const qv2 = Number(await sa(`select version from public.quote_versions where id = '${q2}'`));
    const rr = await fire(2, (k) => (k === 0
      ? psql(`select public.os_public_quote_decide('${tk}', 'conc-${i}', '${q1}', 'approved', 'Cliente', null, '{}')`, 'anon')
      : psql(`select public.os_quote_publish(${O}, '${q2}', ${qv2})`, 'mgr')));
    const st1 = await sa(`select status from public.quote_versions where id = '${q1}'`);
    const st2 = await sa(`select status from public.quote_versions where id = '${q2}'`);
    const decisions = Number(await sa(`select count(*) from public.quote_decisions where quote_version_id = '${q1}'`));
    const onSuperseded = Number(await sa(`select count(*) from public.quote_decisions d join public.quote_versions q on q.id = d.quote_version_id where q.status = 'superseded' and q.service_order_id = '${o}'`));
    const ok = (st1 === 'approved' && decisions === 1 && st2 === 'published' && rr[0].code === 0) || (st1 === 'superseded' && decisions === 0 && st2 === 'published' && rr[0].code !== 0);
    if (!ok || onSuperseded !== 0 || rr[1].code !== 0) { bad++; console.log(`   rodada ${i}: v1=${st1} v2=${st2} decisões=${decisions} (${rr.map((r) => r.code).join(',')}) ${rr.find((r) => r.code)?.err.split('\n')[0] ?? ''}`); }
    if (st1 === 'approved') approvedFirst++; else publishedFirst++;
  }
  check(bad === 0, `em todas as rodadas: ou a aprovação entrou antes (${approvedFirst}) ou a publicação substituiu a versão e a aprovação foi recusada (${publishedFirst}); nunca decisão em versão substituída`);

  console.log('> 8 aprovações simultâneas da MESMA versão pelo link');
  const o2 = await mkOrder('Decisão dupla');
  const q = await publishQuote(o2);
  const tk2 = await link(o2);
  const rA = await fire(8, (k) => psql(`select public.os_public_quote_decide('${tk2}', 'conc-a${k}', '${q}', '${k % 2 ? 'approved' : 'rejected'}', 'Cliente ${k}', null, '{}')`, 'anon'));
  check(oks(rA) === 1, 'somente UMA decisão é gravada');
  check(rA.filter((r) => r.code !== 0).every((r) => /já recebeu uma decisão/.test(r.err)), 'as outras recebem «já recebeu uma decisão»');
  check((await sa(`select count(*) from public.quote_decisions where quote_version_id = '${q}'`)) === '1', 'exatamente uma decisão no banco');

  console.log('> aceite × contestação simultâneos da mesma conclusão');
  const o3 = await mkOrder('Aceite concorrente');
  await approveManual(await publishQuote(o3));
  await one(`select public.os_start(${O}, '${o3}', ${await ver(o3)})`, 't1');
  await one(`select public.os_complete(${O}, '${o3}', ${await ver(o3)}, 'Serviço concluído e testado.', null)`, 't1');
  const tk3 = await link(o3);
  const rAc = await fire(6, (k) => psql(`select public.os_public_completion_decide('${tk3}', 'conc-c${k}', 1, '${k % 2 ? 'accepted' : 'contested'}', 'Cliente ${k}', 'motivo de teste', '{}')`, 'anon'));
  check(oks(rAc) === 1, 'somente UMA resposta é gravada para a versão 1');
  check((await sa(`select count(*) from public.completion_acceptances where service_order_id = '${o3}'`)) === '1', 'exatamente uma linha de aceite');

  console.log('> encerrar × reabrir ao mesmo tempo (uma ordem concluída e aceita)');
  const o4 = await mkOrder('Encerrar × reabrir');
  await approveManual(await publishQuote(o4));
  await one(`select public.os_start(${O}, '${o4}', ${await ver(o4)})`, 't1');
  await one(`select public.os_complete(${O}, '${o4}', ${await ver(o4)}, 'Serviço concluído e testado.', null)`, 't1');
  await one(`select public.os_completion_decide_manual(${O}, '${o4}', ${await ver(o4)}, 'accepted', 'Cliente', 'Aceitou presencialmente.', null)`, 'mgr');
  const v4 = await ver(o4);
  const rE = await fire(2, (k) => (k === 0
    ? psql(`select public.os_close(${O}, '${o4}', ${v4})`, 'mgr')
    : psql(`select public.os_reopen(${O}, '${o4}', ${v4}, 'Cliente pediu ajuste final.', null)`, 'owner')));
  check(oks(rE) === 1, 'somente UMA das duas operações vence');
  check(rE.filter((r) => r.code !== 0).every((r) => /alterada por outra pessoa/.test(r.err)), 'a outra recebe «alterada por outra pessoa»');
  const fin = await sa(`select execution_status from public.service_orders where id = '${o4}'`);
  check(fin === 'closed' || fin === 'in_progress', `estado final coerente (${fin})`);

  console.log('> uso de peça: duplo clique idempotente e estornos que nunca deixam o saldo negativo');
  const o5 = await mkOrder('Peças concorrentes');
  await approveManual(await publishQuote(o5));
  await one(`select public.os_start(${O}, '${o5}', ${await ver(o5)})`, 't1');
  const useKey = randomUUID();
  const rU = await fire(8, () => psql(`select public.os_add_part_usage(${O}, '${o5}', '${useKey}', jsonb_build_object('part_id', '${pt}', 'quantity', 2))`, 't1'));
  why(rU, 8);
  check(oks(rU) === 8 && (await sa(`select count(*) from public.order_part_usage where service_order_id = '${o5}'`)) === '1', 'o duplo clique registra UM uso');
  const usage = await sa(`select id from public.order_part_usage where service_order_id = '${o5}'`);
  const rV = await fire(5, () => psql(`select public.os_correct_part_usage(${O}, '${o5}', gen_random_uuid(), '${usage}', 'reversal', 1, 'Devolução de uma unidade')`, 't1'));
  check(oks(rV) === 2, 'só 2 estornos de 1 cabem num uso de 2 (os demais são recusados)');
  check((await sa(`select sum(quantity) from public.order_part_usage where service_order_id = '${o5}'`)) === '0.000', 'saldo líquido zero, nunca negativo');
  check(rV.filter((r) => r.code !== 0).every((r) => /saldo do registro negativo/.test(r.err)), 'recusados com a mensagem do saldo');

  console.log('> invariantes finais');
  check((await sa(`select count(*) from (select order_number from public.service_orders group by organization_id, order_number having count(*) > 1) x`)) === '0', 'nenhum número de ordem repetido');
  check((await sa(`select count(*) from (select service_order_id from public.quote_versions where status = 'published' group by service_order_id having count(*) > 1) x`)) === '0', 'no máximo um orçamento publicado por ordem');
  check((await sa(`select count(*) from (select service_order_id from public.quote_versions where status = 'draft' group by service_order_id having count(*) > 1) x`)) === '0', 'no máximo um rascunho por ordem');
  check((await sa(`select count(*) from (select service_order_id from public.public_access_tokens where revoked_at is null group by service_order_id having count(*) > 1) x`)) === '0', 'no máximo um link ativo por ordem');
  check((await sa(`select count(*) from public.quote_decisions d join public.quote_versions q on q.id = d.quote_version_id where (d.decision = 'approved') <> (q.status = 'approved')`)) === '0', 'decisão e estado da versão sempre coerentes');
  check((await sa(`select count(*) from public.service_orders o where o.execution_status = 'closed' and not exists (select 1 from public.completion_acceptances a where a.service_order_id = o.id and a.completion_version = o.completion_version and a.decision = 'accepted')`)) === '0', 'toda ordem encerrada tem aceite da conclusão corrente');
  check((await sa(`select count(*) from public.service_orders o where o.execution_status in ('in_progress', 'paused') and o.started_at is null`)) === '0', 'toda ordem em execução tem horário de início');
} catch (e) {
  console.error('ERRO: ' + (e instanceof Error ? e.message : e));
  failed++;
} finally {
  docker(['rm', '-f', name]);
}
console.log(failed ? `CONCORRÊNCIA: ${failed} FALHA(S)` : 'CONCORRÊNCIA: TODOS OS TESTES PASSARAM');
process.exit(failed ? 1 : 0);
