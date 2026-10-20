#!/usr/bin/env node
// Carrega a empresa de DEMONSTRAÇÃO («Consultoria Meridiano», dados fictícios) no Supabase LOCAL em execução.
//   node scripts/seed-demo.mjs                      → senha aleatória (mostrada uma vez e guardada em node_modules/.cache)
//   DEMO_PASSWORD='...' node scripts/seed-demo.mjs  → senha informada por você
// Segurança: nenhuma credencial fixa fica no repositório. Recusa rodar sem o container do Supabase LOCAL (nunca toca em banco remoto).
// Depois de aplicar, envia PDFs fictícios pelo MESMO caminho do aplicativo (login → Storage privado → ct_add_document) e confere a coerência dos dados.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if (!projectId) { console.error('project_id não encontrado em supabase/config.toml'); process.exit(2); }
const apiPort = /\[api\][^[]*?\nport\s*=\s*(\d+)/.exec(config)?.[1];
const container = `supabase_db_${projectId}`;
const running = spawnSync('docker', ['ps', '--filter', `name=^${container}$`, '--format', '{{.Names}}'], { encoding: 'utf8' });
if (running.status !== 0 || running.stdout.trim() !== container) {
  console.error(`Container ${container} não está em execução. Suba o Supabase local (supabase start) e rode de novo.`);
  process.exit(2);
}
const password = process.env.DEMO_PASSWORD ?? `${randomBytes(9).toString('base64url')}-Aa1`;
if (password.length < 12) { console.error('A senha precisa ter 12 caracteres ou mais.'); process.exit(2); }

const sql = readFileSync(join(root, 'supabase', 'seed-demo.sql'), 'utf8');
const psql = (input, vars = []) => spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...vars.flatMap((v) => ['-v', v]), '-U', 'postgres', '-d', 'postgres'], { input, encoding: 'utf8' });
const r = psql(sql, [`pw=${password}`]);
if (r.status !== 0) { console.error('Falha ao aplicar a demonstração:\n' + r.stderr); process.exit(1); }

// ---------------------------------------------------------------- documentos (PDF fictício, enviado como o aplicativo faria)
const envFile = (name) => { try { return Object.fromEntries(readFileSync(join(root, name), 'utf8').split('\n').map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2]])); } catch { return {}; } };
const e = { ...envFile('.env.local'), ...envFile('.env.e2e') };
const apiUrl = process.env.E2E_SUPABASE_URL ?? e.E2E_SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL ?? `http://127.0.0.1:${apiPort}`;
const anon = process.env.E2E_SUPABASE_ANON_KEY ?? e.E2E_SUPABASE_ANON_KEY ?? e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const pdf = (text) => {
  const stream = `BT /F1 12 Tf 20 70 Td (${text}) Tj ET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`, 'latin1');
};
let documents = 0;
async function uploadDocuments() {
  if (!anon) { console.warn('AVISO: chave anon não encontrada (.env.local); os documentos de demonstração não foram enviados.'); return; }
  const login = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'gestor@demo.exemplo', password }) });
  if (!login.ok) { console.warn('AVISO: não foi possível entrar como gestor para enviar documentos (' + login.status + ').'); return; }
  const jwt = (await login.json()).access_token;
  const org = psql("select id from public.organizations where slug = 'consultoria-meridiano'").stdout.trim();
  const ids = Object.fromEntries(psql("select title || '|' || id from public.contracts where organization_id = '" + org + "'").stdout.trim().split('\n').map((l) => l.split('|')));
  const rpc = async (fn, body) => { const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`); return res.json(); };
  const send = async (contract, text) => {
    const bytes = pdf(text); const path = `${org}/${contract}/${randomBytes(16).toString('hex')}.pdf`;
    const up = await fetch(`${apiUrl}/storage/v1/object/ct-files/${path}`, { method: 'POST', headers: { apikey: anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/pdf' }, body: bytes });
    if (!up.ok) throw new Error('storage: ' + up.status + ' ' + await up.text());
    return { path, mime: 'application/pdf', size: bytes.length, filename: text.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '.pdf', sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const list = [['Manutenção e suporte de TI', 'Contrato principal (assinado)', 'main', ['DEMONSTRACAO - contrato de manutencao v1', 'DEMONSTRACAO - contrato de manutencao v2 revisado']],
    ['Consultoria em processos', 'Proposta aceita', 'attachment', ['DEMONSTRACAO - proposta de consultoria v1']],
    ['Limpeza e conservação predial', 'Termo de renovação', 'amendment', ['DEMONSTRACAO - termo de renovacao v1']]];
  for (const [title, docTitle, type, versions] of list) {
    const contract = ids[title]; if (!contract) throw new Error('contrato não encontrado: ' + title);
    const first = await rpc('ct_add_document', { p_org: org, p_contract: contract, p_idem: crypto.randomUUID(), p_title: docTitle, p_type: type, p_file: await send(contract, versions[0]) });
    documents++;
    for (const v of versions.slice(1)) { await rpc('ct_add_document_version', { p_org: org, p_document: first.document_id, p_idem: crypto.randomUUID(), p_file: await send(contract, v) }); documents++; }
  }
}
try { await uploadDocuments(); } catch (err) { console.error('Falha ao enviar os documentos de demonstração:', String(err.message ?? err)); process.exit(1); }

// ---------------------------------------------------------------- coerência dos dados gerados
const check = psql(`
with org as (select id from public.organizations where slug = 'consultoria-meridiano'),
c as (select c.* from public.contracts c join org on org.id = c.organization_id),
tz as (select (now() at time zone 'America/Sao_Paulo')::date as today)
select 'contratos', count(*) from c
union all select 'futuro', (select count(*) from public.contract_events e join c on c.id = e.contract_id where e.created_at > now() + interval '1 minute')
  + (select count(*) from public.contract_changes x join c on c.id = x.contract_id where x.created_at > now() + interval '1 minute' or x.effective_date > (select today from tz))
  + (select count(*) from public.contract_value_versions v join c on c.id = v.contract_id where v.created_at > now() + interval '1 minute' or v.effective_from > (select today from tz) + 0 and v.source_adjustment_id is not null)
union all select 'rescindido_sem_data', count(*) from c where (lifecycle_status in ('terminated', 'closed')) <> (ended_on is not null)
union all select 'ativo_sem_parte', count(*) from c where lifecycle_status = 'active' and not exists (select 1 from public.contract_parties p where p.contract_id = c.id)
union all select 'prazo_corrente_duplicado', (select count(*) from (select contract_id, deadline_type from public.contract_deadlines d join c on c.id = d.contract_id where d.superseded_at is null group by 1, 2 having count(*) > 1) x)
union all select 'responsavel_sem_acesso', count(*) from c where responsible_user_id is not null and not exists (select 1 from public.organization_members o where o.organization_id = c.organization_id and o.user_id = c.responsible_user_id and o.role in ('owner', 'admin', 'manager'))
  and not exists (select 1 from public.contract_access a where a.contract_id = c.id and a.user_id = c.responsible_user_id and a.contract_role = 'editor')
union all select 'rascunho', count(*) from c where lifecycle_status = 'draft'
union all select 'ativo', count(*) from c where lifecycle_status = 'active'
union all select 'rescindido', count(*) from c where lifecycle_status = 'terminated'
union all select 'a_iniciar', count(*) from c, tz where lifecycle_status = 'active' and start_date > tz.today
union all select 'fim_atingido', count(*) from c, tz where lifecycle_status = 'active' and end_date < tz.today
union all select 'aviso_ultrapassado', count(*) from c, tz where lifecycle_status = 'active' and notice_deadline_date < tz.today and (end_date >= tz.today or indefinite_term)
union all select 'indeterminado', count(*) from c where indefinite_term
union all select 'renovado', count(*) from public.contract_changes x join c on c.id = x.contract_id where x.change_type = 'renewal'
union all select 'aviso_ajustado', count(*) from c where notice_adjusted
union all select 'reajuste_simulado', count(*) from public.contract_adjustments a join c on c.id = a.contract_id where a.status = 'proposed'
union all select 'reajuste_aplicado', count(*) from public.contract_adjustments a join c on c.id = a.contract_id where a.status = 'applied'
union all select 'versoes_de_valor', count(*) from public.contract_value_versions v join c on c.id = v.contract_id
union all select 'obrigacao_pendente', count(*) from public.contract_obligations o join c on c.id = o.contract_id where o.status = 'pending'
union all select 'obrigacao_atrasada', count(*) from public.contract_obligations o join c on c.id = o.contract_id, tz where o.status = 'pending' and o.due_date < tz.today
union all select 'obrigacao_concluida', count(*) from public.contract_obligations o join c on c.id = o.contract_id where o.status = 'completed'
union all select 'documento_multiversao', (select count(*) from (select d.id from public.contract_documents d join c on c.id = d.contract_id join public.contract_document_versions v on v.document_id = d.id group by d.id having count(*) > 1) x)
union all select 'notificacoes', count(*) from public.notifications n join c on c.id = n.contract_id
union all select 'partes', count(*) from public.counterparties p join org on org.id = p.organization_id;
`);
if (check.status !== 0) { console.error('Falha na conferência:\n' + check.stderr); process.exit(1); }
const rows = Object.fromEntries(check.stdout.split('\n').map((l) => l.trim()).filter((l) => l.includes('|')).map((l) => l.split('|').map((x) => x.trim())));
const zero = ['futuro', 'rescindido_sem_data', 'ativo_sem_parte', 'prazo_corrente_duplicado', 'responsavel_sem_acesso'];
const atLeast1 = ['rascunho', 'ativo', 'rescindido', 'a_iniciar', 'fim_atingido', 'aviso_ultrapassado', 'indeterminado', 'renovado', 'aviso_ajustado', 'reajuste_simulado', 'reajuste_aplicado', 'obrigacao_pendente', 'obrigacao_atrasada', 'obrigacao_concluida', 'notificacoes', 'partes'];
if (anon) atLeast1.push('documento_multiversao');
const bad = [...zero.filter((k) => rows[k] !== '0'), ...atLeast1.filter((k) => !(Number(rows[k]) >= 1))];
if (bad.length || Number(rows.contratos) < 8) {
  console.error('Demonstração incoerente (' + bad.join(', ') + '):', JSON.stringify(rows));
  process.exit(1);
}
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
// um banco recém-criado não tem o segundo fator do proprietário: descarta o segredo TOTP de uma instalação anterior
rmSync(join(root, 'node_modules', '.cache', 'ct-e2e-owner-secret.txt'), { force: true });
writeFileSync(join(root, 'node_modules', '.cache', 'ct-demo-credentials.json'), JSON.stringify({ password, users: ['dono', 'gestor', 'ana', 'bruno', 'carla', 'diego', 'leitor'].map((u) => `${u}@demo.exemplo`) }));
console.log(`Demonstração carregada: ${rows.contratos} contratos (${rows.rascunho} rascunho, ${rows.ativo} ativos, ${rows.rescindido} rescindido), ${rows.partes} partes, ${documents} versão(ões) de documento.`);
console.log(`Destaques: ${rows.a_iniciar} a iniciar, ${rows.fim_atingido} com fim atingido, ${rows.aviso_ultrapassado} com aviso ultrapassado, ${rows.indeterminado} indeterminado, ${rows.renovado} renovado, ${rows.reajuste_simulado} reajuste simulado e ${rows.reajuste_aplicado} aplicado, ${rows.obrigacao_atrasada} obrigação atrasada, ${rows.notificacoes} notificação(ões).`);
console.log('Usuários (@demo.exemplo): dono (proprietário), gestor, ana e carla (editoras), bruno e diego (colaboradores, sem vínculo na maioria) e leitor (Leitor da empresa).');
console.log(`Senha desta instalação: ${password}`);
console.log('(Guardada só em node_modules/.cache. O proprietário cadastra o 2º fator no primeiro acesso.)');
