// Segurança da Gestão de Projetos no navegador e na API REST do Supabase: isolamento por projeto, escrita só por RPC, anônimo sem acesso, CSV seguro, revogação imediata e cabeçalhos.
import { expect, test } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL } from './helpers';
import { DEMO, demoPassword, loginAs, tag } from './pj-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();

async function token(email: string): Promise<{ jwt: string; id: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: demoPassword() }) });
  const j = (await res.json()) as { access_token: string; user: { id: string } };
  return { jwt: j.access_token, id: j.user.id };
}
async function rest(jwt: string | null, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON_KEY, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) } });
}
const names = async (jwt: string, table: string, select = 'name'): Promise<string[]> => ((await (await rest(jwt, `${table}?select=${select}`)).json()) as Array<Record<string, string>>).map((r) => r[select.split(',')[0]!]!);

let p3Task = ''; // tarefa do projeto planejado (Carla e Ana participam; Diego e Bruno NÃO)
let p3Project = '';

test('colaborador só enxerga os projetos de que participa — na tela e direto na API', async ({ page }) => {
  const diego = await token(DEMO.diego);
  expect(new Set(await names(diego.jwt, 'projects'))).toEqual(new Set(['Site institucional Prisma', 'Campanha de lançamento — Verão', 'Migração do blog antigo']));
  const ana = await token(DEMO.ana);
  const anaProjects = (await (await rest(ana.jwt, 'projects?select=id,name')).json()) as Array<{ id: string; name: string }>;
  p3Project = anaProjects.find((p) => p.name.startsWith('Relatório trimestral'))!.id;
  const t = (await (await rest(ana.jwt, `tasks?select=id&project_id=eq.${p3Project}&limit=1`)).json()) as Array<{ id: string }>;
  p3Task = t[0]!.id;
  // Diego não vê o projeto nem as tarefas dele (RLS) ...
  expect(await (await rest(diego.jwt, `projects?select=id&id=eq.${p3Project}`)).json()).toEqual([]);
  expect(await (await rest(diego.jwt, `tasks?select=id&id=eq.${p3Task}`)).json()).toEqual([]);
  // ... nem pela tela: 404 real, sem conteúdo
  await loginAs(page, DEMO.diego);
  const r1 = await page.goto(`/tarefas/${p3Task}`);
  expect(r1!.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText('Definir indicadores');
  expect((await page.goto(`/projetos/${p3Project}`))!.status()).toBe(404);
  expect((await page.goto(`/projetos/${p3Project}/lista`))!.status()).toBe(404);
  expect((await page.goto(`/projetos/${p3Project}/atividade`))!.status()).toBe(404);
  expect((await page.request.get(`/api/exportar/tarefas?project=${p3Project}`)).status()).toBe(200);
  const csv = (await (await page.request.get(`/api/exportar/tarefas?project=${p3Project}`)).body()).toString('utf8');
  expect(csv).not.toContain('Definir indicadores'); // exportação respeita o acesso
});

test('ninguém escreve direto em nenhuma tabela; funções exigem papel no projeto; anônimo não alcança nada', async () => {
  const ana = await token(DEMO.ana);
  const leitor = await token(DEMO.leitor);
  const mine = (await (await rest(ana.jwt, 'tasks?select=id,project_id&limit=1')).json()) as Array<{ id: string; project_id: string }>;
  const upd = await rest(ana.jwt, `tasks?id=eq.${mine[0]!.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Invasão' }) });
  expect(upd.status).toBeGreaterThanOrEqual(400);
  expect((await rest(ana.jwt, 'projects', { method: 'POST', body: JSON.stringify({ name: 'Invasor' }) })).status).toBeGreaterThanOrEqual(400);
  expect((await rest(ana.jwt, `task_events?task_id=eq.${mine[0]!.id}`, { method: 'DELETE' })).status).toBeGreaterThanOrEqual(400);
  for (const t of ['project_number_counters', 'task_number_counters', 'mutation_requests', 'pj_rate_limits']) {
    const r = await rest(ana.jwt, `${t}?select=*`);
    expect(r.status === 200 ? await r.json() : [], t).toEqual([]);
  }
  expect((await rest(ana.jwt, 'task_attachments?select=storage_path')).status).toBeGreaterThanOrEqual(400); // o caminho do Storage não é legível pela API
  // função administrativa recusa quem não é gestão; leitor não cria tarefa (mesmo participando)
  const create = await rest(ana.jwt, 'rpc/pj_create_project', { method: 'POST', body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000', p_idem: crypto.randomUUID(), p: { name: 'x' } }) });
  expect(create.status).toBeGreaterThanOrEqual(400);
  const readerProjects = (await (await rest(leitor.jwt, 'projects?select=id&limit=1')).json()) as Array<{ id: string }>;
  const org = (await (await rest(leitor.jwt, 'organization_members?select=organization_id&limit=1')).json()) as Array<{ organization_id: string }>;
  const readerCreate = await rest(leitor.jwt, 'rpc/pj_create_task', { method: 'POST', body: JSON.stringify({ p_org: org[0]!.organization_id, p_project: readerProjects[0]!.id, p_idem: crypto.randomUUID(), p: { title: 'Do leitor' } }) });
  expect(readerCreate.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(await readerCreate.json())).toContain('sem permissão');
  // anônimo
  for (const t of ['projects', 'tasks', 'task_comments', 'task_attachments', 'notifications', 'project_members']) {
    const r = await rest(null, `${t}?select=*`);
    if (r.status === 200) expect(await r.json(), t).toEqual([]); else expect(r.status, t).toBeGreaterThanOrEqual(400);
  }
  const dash = await rest(null, 'rpc/pj_dashboard', { method: 'POST', body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000', p_from: '2026-01-01', p_to: '2026-01-02' }) });
  expect(dash.status).toBeGreaterThanOrEqual(400);
});

test('exportação CSV neutraliza fórmulas de planilha e respeita filtros', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/projetos');
  await page.getByRole('link', { name: 'Campanha de lançamento — Verão' }).click();
  await page.locator('summary', { hasText: 'Nova tarefa' }).click();
  const title = `=HYPERLINK("http://x","clique") ${T}`;
  await page.getByLabel('Título', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.getByText(/Tarefa criada\./).first()).toBeVisible();
  const r = await page.request.get(`/api/exportar/tarefas?q=HYPERLINK`);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/csv');
  const csv = (await r.body()).toString('utf8');
  expect(csv).toContain(`"'=HYPERLINK(""http://x"",""clique"") ${T}"`);
  expect(csv).not.toMatch(/(^|;)=HYPERLINK/m);
  expect((await page.request.get('/api/exportar/tarefas?priority=urgent')).status()).toBe(200);
  const noAuth = await fetch(`${page.url().split('/').slice(0, 3).join('/')}/api/exportar/tarefas`, { redirect: 'manual' });
  expect([401, 302, 307, 308]).toContain(noAuth.status);
});

test('remover o participante revoga o acesso na hora: tarefas, projeto e notificações somem para ele', async ({ page }) => {
  const gestor = await token(DEMO.gestor);
  const ana = await token(DEMO.ana);
  const org = (await (await rest(gestor.jwt, 'organization_members?select=organization_id&limit=1')).json()) as Array<{ organization_id: string }>;
  const before = (await (await rest(ana.jwt, `notifications?select=id&project_id=eq.${p3Project}`)).json()) as unknown[];
  expect(before.length).toBeGreaterThan(0);
  await loginAs(page, DEMO.ana);
  expect((await page.goto(`/tarefas/${p3Task}`))!.status()).toBe(200);
  const rm = await rest(gestor.jwt, 'rpc/pj_remove_member', { method: 'POST', body: JSON.stringify({ p_org: org[0]!.organization_id, p_project: p3Project, p_user: ana.id, p_task_action: 'unassign', p_transfer_to: null }) });
  expect(rm.status).toBe(200);
  expect(await (await rest(ana.jwt, `projects?select=id&id=eq.${p3Project}`)).json()).toEqual([]);
  expect(await (await rest(ana.jwt, `tasks?select=id&project_id=eq.${p3Project}`)).json()).toEqual([]);
  expect(await (await rest(ana.jwt, `notifications?select=id&project_id=eq.${p3Project}`)).json()).toEqual([]); // notificação não expõe projeto inacessível
  expect((await page.goto(`/tarefas/${p3Task}`))!.status()).toBe(404);
  await page.goto('/minhas-tarefas');
  await expect(page.getByText('Definir indicadores do relatório')).toHaveCount(0);
});

test('cabeçalhos de segurança, CSP sem «unsafe-inline» e página do Storage sem listagem anônima', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  const res = await page.goto('/projetos');
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).not.toContain("'unsafe-inline'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/pj-files`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 10 }) });
  const body = (await list.json()) as unknown;
  expect(Array.isArray(body) ? body : []).toEqual([]); // bucket privado: o anônimo não lista nada
  const download = await fetch(`${SUPABASE_URL}/storage/v1/object/public/pj-files/qualquer.pdf`, { headers: { apikey: ANON_KEY } });
  expect(download.status).toBeGreaterThanOrEqual(400);
});
