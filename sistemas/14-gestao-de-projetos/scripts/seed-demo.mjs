#!/usr/bin/env node
// Carrega a empresa de DEMONSTRAÇÃO («Agência Prisma», dados fictícios) no Supabase LOCAL em execução.
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
with org as (select id from public.organizations where slug = 'agencia-prisma'),
p as (select p.* from public.projects p join org on org.id = p.organization_id),
t as (select t.*, c.semantic_status as sem, p.status as pstatus, p.archived_at as parch from public.tasks t join p on p.id = t.project_id join public.project_columns c on c.id = t.column_id)
select 'projetos', count(*) from p
union all select 'futuro', (select count(*) from public.task_events e join t on t.id = e.task_id where e.created_at > now() + interval '1 minute')
  + (select count(*) from public.project_events e join p on p.id = e.project_id where e.created_at > now() + interval '1 minute')
  + (select count(*) from public.task_comments c join t on t.id = c.task_id where c.created_at > now() + interval '1 minute')
  + (select count(*) from t where created_at > now() + interval '1 minute' or completed_at > now() + interval '1 minute' or blocked_at > now() + interval '1 minute')
union all select 'concluida_sem_data', count(*) from t where (sem = 'done') <> (completed_at is not null)
union all select 'concluida_com_obrigatorio_pendente', count(*) from t where sem = 'done' and exists (select 1 from public.task_checklist_items i where i.task_id = t.id and i.required and i.completed_at is null)
union all select 'projeto_concluido_com_tarefa_aberta', count(*) from p where status = 'completed' and exists (select 1 from t x where x.project_id = p.id and x.archived_at is null and x.sem <> 'done')
union all select 'responsavel_sem_acesso', count(*) from t where assignee_user_id is not null and archived_at is null and not exists (select 1 from public.project_members m where m.project_id = t.project_id and m.user_id = t.assignee_user_id)
  and not exists (select 1 from public.organization_members o where o.organization_id = t.organization_id and o.user_id = t.assignee_user_id and o.role in ('owner', 'admin', 'manager'))
union all select 'planejado', count(*) from p where status = 'planned'
union all select 'ativo', count(*) from p where status = 'active'
union all select 'concluido', count(*) from p where status = 'completed'
union all select 'cancelado', count(*) from p where status = 'cancelled'
union all select 'arquivado', count(*) from p where archived_at is not null
union all select 'todo', count(*) from t where sem = 'todo' and archived_at is null
union all select 'em_andamento', count(*) from t where sem = 'in_progress' and archived_at is null
union all select 'revisao', count(*) from t where sem = 'review' and archived_at is null
union all select 'concluidas', count(*) from t where sem = 'done' and archived_at is null
union all select 'arquivadas', count(*) from t where archived_at is not null
union all select 'atrasadas', count(*) from t where sem <> 'done' and archived_at is null and pstatus not in ('cancelled') and parch is null and due_date < (now() at time zone 'America/Sao_Paulo')::date
union all select 'sem_prazo', count(*) from t where due_date is null and archived_at is null
union all select 'bloqueadas', count(*) from t where blocked_at is not null
union all select 'sem_responsavel', count(*) from t where assignee_user_id is null and archived_at is null and sem <> 'done'
union all select 'checklists', count(*) from public.task_checklist_items i join t on t.id = i.task_id
union all select 'comentarios', count(*) from public.task_comments c join t on t.id = c.task_id
union all select 'notificacoes', count(*) from public.notifications n join p on p.id = n.project_id
union all select 'etiquetas', count(*) from public.project_labels l join p on p.id = l.project_id
union all select 'tarefas', count(*) from t;
`);
if (check.status !== 0) { console.error('Falha na conferência:\n' + check.stderr); process.exit(1); }
const rows = Object.fromEntries(check.stdout.split('\n').map((l) => l.trim()).filter((l) => l.includes('|')).map((l) => l.split('|').map((x) => x.trim())));
const zero = ['futuro', 'concluida_sem_data', 'concluida_com_obrigatorio_pendente', 'projeto_concluido_com_tarefa_aberta', 'responsavel_sem_acesso'];
const atLeast1 = ['planejado', 'ativo', 'concluido', 'cancelado', 'arquivado', 'todo', 'em_andamento', 'revisao', 'concluidas', 'arquivadas', 'atrasadas', 'sem_prazo', 'bloqueadas', 'sem_responsavel', 'checklists', 'comentarios', 'notificacoes', 'etiquetas'];
const bad = [...zero.filter((k) => rows[k] !== '0'), ...atLeast1.filter((k) => !(Number(rows[k]) >= 1))];
if (bad.length || Number(rows.projetos) < 5) {
  console.error('Demonstração incoerente (' + bad.join(', ') + '):', JSON.stringify(rows));
  process.exit(1);
}
mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true });
// um banco recém-criado não tem o segundo fator do proprietário: descarta o segredo TOTP de uma instalação anterior
rmSync(join(root, 'node_modules', '.cache', 'pj-e2e-owner-secret.txt'), { force: true });
writeFileSync(join(root, 'node_modules', '.cache', 'pj-demo-credentials.json'), JSON.stringify({ password, users: ['dono', 'gestor', 'ana', 'bruno', 'carla', 'diego', 'leitor'].map((u) => `${u}@demo.exemplo`) }));
console.log(`Demonstração carregada: ${rows.projetos} projetos (${rows.planejado} planejado, ${rows.ativo} ativos, ${rows.concluido} concluído, ${rows.cancelado} cancelado, ${rows.arquivado} arquivado) e ${rows.tarefas} tarefas.`);
console.log(`Destaques: ${rows.atrasadas} atrasada(s), ${rows.bloqueadas} bloqueada(s), ${rows.sem_responsavel} sem responsável, ${rows.sem_prazo} sem prazo, ${rows.comentarios} comentário(s), ${rows.notificacoes} notificação(ões).`);
console.log('Usuários (@demo.exemplo): dono (proprietário), gestor, ana, bruno, carla, diego (colaboradores) e leitor (Leitor da empresa).');
console.log(`Senha desta instalação: ${password}`);
console.log('(Guardada só em node_modules/.cache. O proprietário cadastra o 2º fator no primeiro acesso.)');
