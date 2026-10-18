#!/usr/bin/env node
// Carrega a empresa de DEMONSTRAÇÃO («Assistência Horizonte», dados fictícios) no Supabase LOCAL em execução.
//   node scripts/seed-demo.mjs                      → senha aleatória (mostrada uma vez e guardada em node_modules/.cache)
//   DEMO_PASSWORD='...' node scripts/seed-demo.mjs  → senha informada por você
// Segurança: nenhuma credencial fixa fica no repositório. Recusa rodar sem o container do Supabase LOCAL (nunca toca em banco remoto).
// Depois de aplicar, confere a coerência (nada no futuro, ordem temporal, todos os estados e situações presentes) e sai com erro se algo estiver errado.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(root, 'supabase', 'config.toml'), 'utf8'))?.[1];
if (!projectId) { console.error('project_id não encontrado em supabase/config.toml'); process.exit(2); }
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

// coerência dos dados gerados
const check = psql(`
with org as (select id from public.organizations where slug = 'assistencia-horizonte'),
o as (select o.* from public.service_orders o join org on org.id = o.organization_id),
ev as (select e.* from public.order_events e join o on o.id = e.service_order_id)
select 'ordens', count(*) from o
union all select 'futuro', (select count(*) from ev where created_at > now() + interval '1 minute')
  + (select count(*) from public.order_updates u join o on o.id = u.service_order_id where u.created_at > now() + interval '1 minute')
  + (select count(*) from o where created_at > now() + interval '1 minute' or started_at > now() + interval '1 minute' or completed_at > now() + interval '1 minute' or closed_at > now() + interval '1 minute' or cancelled_at > now() + interval '1 minute')
  + (select count(*) from public.order_part_usage p join o on o.id = p.service_order_id where p.registered_at > now() + interval '1 minute')
  + (select count(*) from public.quote_versions q join o on o.id = q.service_order_id where q.published_at > now() + interval '1 minute')
  + (select count(*) from public.quote_decisions d join o on o.id = d.service_order_id where d.decided_at > now() + interval '1 minute')
  + (select count(*) from public.order_completions c join o on o.id = c.service_order_id where c.completed_at > now() + interval '1 minute')
  + (select count(*) from public.completion_acceptances a join o on o.id = a.service_order_id where a.decided_at > now() + interval '1 minute')
union all select 'marcos_fora_de_ordem', (select count(*) from o where (started_at is not null and started_at < created_at) or (completed_at is not null and started_at is not null and completed_at < started_at) or (closed_at is not null and completed_at is not null and closed_at < completed_at))
  + (select count(*) from public.quote_decisions d join public.quote_versions q on q.id = d.quote_version_id where d.decided_at < q.published_at)
  + (select count(*) from public.completion_acceptances a join public.order_completions c on c.service_order_id = a.service_order_id and c.completion_version = a.completion_version where a.decided_at < c.completed_at)
union all select 'iniciada_sem_aprovacao', count(*) from o where started_at is not null and quote_mode = 'required' and not exists (select 1 from public.quote_decisions d where d.service_order_id = o.id and d.decision = 'approved' and d.decided_at <= o.started_at)
union all select 'encerrada_sem_aceite', count(*) from o where execution_status = 'closed' and not exists (select 1 from public.completion_acceptances a where a.service_order_id = o.id and a.completion_version = o.completion_version and a.decision = 'accepted')
union all select 'rascunho', count(*) from o where execution_status = 'draft'
union all select 'aberta', count(*) from o where execution_status = 'open'
union all select 'agendada', count(*) from o where execution_status = 'scheduled'
union all select 'em_execucao', count(*) from o where execution_status = 'in_progress'
union all select 'pausada', count(*) from o where execution_status = 'paused'
union all select 'concluida', count(*) from o where execution_status = 'completed'
union all select 'encerrada', count(*) from o where execution_status = 'closed'
union all select 'cancelada', count(*) from o where execution_status = 'cancelled'
union all select 'atrasada', count(*) from o where execution_status in ('open','scheduled','in_progress','paused') and scheduled_end_at < now()
union all select 'sem_responsavel', count(*) from o where assigned_technician_user_id is null and execution_status in ('open','scheduled','in_progress','paused')
union all select 'sem_orcamento_autorizada', count(*) from o where quote_mode = 'authorized'
union all select 'orcamento_aprovado', count(*) from public.quote_versions q join o on o.id = q.service_order_id where q.status = 'approved'
union all select 'orcamento_recusado', count(*) from public.quote_versions q join o on o.id = q.service_order_id where q.status = 'rejected'
union all select 'orcamento_pendente', count(*) from public.quote_versions q join o on o.id = q.service_order_id where q.status = 'published'
union all select 'orcamento_substituido_ou_v2', count(*) from public.quote_versions q join o on o.id = q.service_order_id where q.version_number >= 2
union all select 'conclusao_contestada', count(*) from public.completion_acceptances a join o on o.id = a.service_order_id where a.decision = 'contested'
union all select 'conclusao_refeita', count(*) from o where completion_version >= 2
union all select 'aceite_manual', count(*) from public.completion_acceptances a join o on o.id = a.service_order_id where a.channel = 'staff_manual'
union all select 'decisao_cliente_link', count(*) from public.quote_decisions d join o on o.id = d.service_order_id where d.channel = 'customer_link'
union all select 'divergencia_pecas', count(*) from o where execution_status in ('in_progress','paused','completed') and private.os_parts_divergence(o.id) is not null and exists (select 1 from jsonb_array_elements(private.os_parts_divergence(o.id)) x where (x ->> 'relevant')::boolean)
union all select 'agenda_sobreposta', count(*) from o a where a.execution_status = 'scheduled' and exists (select 1 from o b where b.id <> a.id and b.execution_status = 'scheduled' and b.assigned_technician_user_id = a.assigned_technician_user_id and b.scheduled_start_at < a.scheduled_end_at and b.scheduled_end_at > a.scheduled_start_at)
union all select 'checklists', count(*) from public.order_checklist_items c join o on o.id = c.service_order_id
union all select 'custos_internos', count(*) from public.order_internal_costs c join o on o.id = c.service_order_id
union all select 'notas_internas', count(*) from public.order_updates u join o on o.id = u.service_order_id where u.visibility = 'internal'
union all select 'notas_cliente', count(*) from public.order_updates u join o on o.id = u.service_order_id where u.visibility = 'customer';
`);
if (check.status !== 0) { console.error('Falha na conferência:\n' + check.stderr); process.exit(1); }
const rows = Object.fromEntries(check.stdout.split('\n').map((l) => l.trim()).filter((l) => l.includes('|')).map((l) => l.split('|').map((x) => x.trim())));
const zero = ['futuro', 'marcos_fora_de_ordem', 'iniciada_sem_aprovacao', 'encerrada_sem_aceite'];
const atLeast1 = ['rascunho', 'aberta', 'agendada', 'em_execucao', 'pausada', 'concluida', 'encerrada', 'cancelada', 'atrasada', 'sem_responsavel', 'sem_orcamento_autorizada', 'orcamento_aprovado', 'orcamento_recusado',
  'orcamento_pendente', 'orcamento_substituido_ou_v2', 'conclusao_contestada', 'conclusao_refeita', 'aceite_manual', 'decisao_cliente_link', 'divergencia_pecas', 'agenda_sobreposta', 'checklists', 'custos_internos', 'notas_internas', 'notas_cliente'];
const bad = [...zero.filter((k) => rows[k] !== '0'), ...atLeast1.filter((k) => !(Number(rows[k]) >= 1))];
if (bad.length || Number(rows.ordens) < 14) {
  console.error('Demonstração incoerente (' + bad.join(', ') + '):', JSON.stringify(rows));
  process.exit(1);
}
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
// um banco recém-criado não tem o segundo fator do proprietário: descarta o segredo TOTP de uma instalação anterior
rmSync(join(root, 'node_modules', '.cache', 'os-e2e-owner-secret.txt'), { force: true });
writeFileSync(join(root, 'node_modules', '.cache', 'os-demo-credentials.json'), JSON.stringify({ password, users: ['dono', 'gestor', 'tecnico1', 'tecnico2', 'tecnico3'].map((u) => `${u}@demo.exemplo`) }));
console.log(`Demonstração carregada: ${rows.ordens} ordens (${rows.rascunho} rascunho, ${rows.aberta} abertas, ${rows.agendada} agendadas, ${rows.em_execucao} em execução, ${rows.pausada} pausada, ${rows.concluida} concluídas, ${rows.encerrada} encerradas, ${rows.cancelada} cancelada).`);
console.log(`Destaques: ${rows.atrasada} atrasada(s), ${rows.divergencia_pecas} com divergência de peças, ${rows.orcamento_pendente} orçamento(s) pendente(s), ${rows.conclusao_contestada} conclusão(ões) contestada(s), ${rows.agenda_sobreposta} janela(s) sobreposta(s).`);
console.log('Usuários (@demo.exemplo): dono (proprietário), gestor, tecnico1…3.');
console.log(`Senha desta instalação: ${password}`);
console.log('(Guardada só em node_modules/.cache. O proprietário cadastra o 2º fator no primeiro acesso.)');
