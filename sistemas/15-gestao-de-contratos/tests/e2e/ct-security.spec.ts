// Segurança da Gestão de Contratos no navegador e na API REST do Supabase: isolamento por contrato, escrita só por RPC, documentos privados no Storage,
// agendador por token, acesso removido na hora e cabeçalhos.
import { expect, test } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL } from './helpers';
import { DEMO, loginAs } from './ct-helpers';
import { demoPassword } from './ct-helpers';

test.describe.configure({ mode: 'serial' });

async function token(email: string): Promise<{ jwt: string; id: string }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: demoPassword() }) });
  const j = (await res.json()) as { access_token: string; user: { id: string } };
  return { jwt: j.access_token, id: j.user.id };
}
async function rest(jwt: string | null, path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: ANON_KEY, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) } });
}
const titles = async (jwt: string): Promise<string[]> => ((await (await rest(jwt, 'contracts?select=title')).json()) as Array<{ title: string }>).map((r) => r.title);

test('colaborador só enxerga os contratos a que foi vinculado — direto na API e na tela', async ({ page }) => {
  const ana = await token(DEMO.ana);
  expect(new Set(await titles(ana.jwt))).toEqual(new Set(['Manutenção e suporte de TI', 'Consultoria em processos']));
  const bruno = await token(DEMO.bruno);
  expect(await titles(bruno.jwt)).toEqual([]);
  const gestor = await token(DEMO.gestor);
  const all = (await (await rest(gestor.jwt, 'contracts?select=id,title')).json()) as Array<{ id: string; title: string }>;
  expect(all.length).toBe(8);
  const forn = all.find((c) => c.title.startsWith('Fornecimento'))!;
  expect(await (await rest(ana.jwt, `contracts?select=id&id=eq.${forn.id}`)).json()).toEqual([]);
  expect(await (await rest(ana.jwt, `contract_value_versions?select=id&contract_id=eq.${forn.id}`)).json()).toEqual([]);
  expect(await (await rest(ana.jwt, `contract_events?select=id&contract_id=eq.${forn.id}`)).json()).toEqual([]);
  await loginAs(page, DEMO.ana);
  expect((await page.goto(`/contratos/${forn.id}`))!.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText('Fornecimento contínuo');
});

test('ninguém escreve direto em tabela alguma; anônimo não alcança nada; CPF/CNPJ só para a gestão', async () => {
  const ana = await token(DEMO.ana);
  const gestor = await token(DEMO.gestor);
  const one = (await (await rest(ana.jwt, 'contracts?select=id&limit=1')).json()) as Array<{ id: string }>;
  expect((await rest(ana.jwt, `contracts?id=eq.${one[0]!.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Invasão' }) })).status).toBeGreaterThanOrEqual(400);
  expect((await rest(ana.jwt, 'contracts', { method: 'POST', body: JSON.stringify({ title: 'Invasor' }) })).status).toBeGreaterThanOrEqual(400);
  expect((await rest(ana.jwt, `contract_events?contract_id=eq.${one[0]!.id}`, { method: 'DELETE' })).status).toBeGreaterThanOrEqual(400);
  for (const t of ['contract_number_counters', 'mutation_requests', 'ct_rate_limits', 'ct_job_tokens', 'reminder_deliveries']) {
    const r = await rest(ana.jwt, `${t}?select=*`);
    expect(r.status === 200 ? await r.json() : [], t).toEqual([]);
  }
  expect(((await (await rest(gestor.jwt, 'counterparty_documents?select=document_number')).json()) as unknown[]).length).toBeGreaterThan(0);
  expect(await (await rest(ana.jwt, 'counterparty_documents?select=document_number')).json()).toEqual([]);
  expect((await rest(ana.jwt, 'contract_document_versions?select=storage_path')).status).toBeGreaterThanOrEqual(400); // o caminho do Storage não é legível
  const mgr = await rest(ana.jwt, 'rpc/ct_create_contract', { method: 'POST', body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000', p_idem: crypto.randomUUID(), p: { title: 'x' } }) });
  expect(mgr.status).toBeGreaterThanOrEqual(400);
  for (const t of ['contracts', 'contract_documents', 'counterparties', 'notifications', 'contract_obligations']) {
    const r = await rest(null, `${t}?select=*`);
    if (r.status === 200) expect(await r.json(), t).toEqual([]); else expect(r.status, t).toBeGreaterThanOrEqual(400);
  }
  const dash = await rest(null, 'rpc/ct_dashboard', { method: 'POST', body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000' }) });
  expect(dash.status).toBeGreaterThanOrEqual(400);
});

test('documentos ficam no Storage privado: quem tem acesso baixa, quem não tem não baixa, anônimo não lista', async () => {
  const gestor = await token(DEMO.gestor);
  const ana = await token(DEMO.ana);
  const bruno = await token(DEMO.bruno);
  const org = ((await (await rest(gestor.jwt, 'organization_members?select=organization_id&limit=1')).json()) as Array<{ organization_id: string }>)[0]!.organization_id;
  const versions = (await (await rest(gestor.jwt, 'contract_document_versions?select=id,original_filename')).json()) as Array<{ id: string; original_filename: string }>;
  expect(versions.length).toBeGreaterThanOrEqual(3);
  const info = async (jwt: string, id: string) => (await rest(jwt, 'rpc/ct_document_info', { method: 'POST', body: JSON.stringify({ p_org: org, p_version: id }) }));
  const manut = versions.find((v) => v.original_filename.includes('contrato-de-manutencao'))!;
  const meta = (await (await info(gestor.jwt, manut.id)).json()) as { path: string };
  expect((await info(bruno.jwt, manut.id)).status).toBeGreaterThanOrEqual(400); // sem vínculo nem sabe o caminho
  const get = (jwt: string | null) => fetch(`${SUPABASE_URL}/storage/v1/object/${jwt ? 'authenticated' : 'public'}/ct-files/${meta.path}`, { headers: { apikey: ANON_KEY, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}) } });
  expect((await get(ana.jwt)).status).toBe(200); // Ana é editora desse contrato
  expect((await get(bruno.jwt)).status).toBeGreaterThanOrEqual(400); // Bruno não tem vínculo: a política do Storage nega
  expect((await get(null)).status).toBeGreaterThanOrEqual(400);
  const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/ct-files`, { method: 'POST', headers: { apikey: ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 10 }) });
  const body = (await list.json()) as unknown;
  expect(Array.isArray(body) ? body : []).toEqual([]);
  // envio fora do caminho esperado ou de quem não edita é recusado
  const up = (jwt: string, p: string) => fetch(`${SUPABASE_URL}/storage/v1/object/ct-files/${p}`, { method: 'POST', headers: { apikey: ANON_KEY, authorization: `Bearer ${jwt}`, 'content-type': 'application/pdf' }, body: '%PDF-1.4\n%%EOF\n' });
  expect((await up(bruno.jwt, `${org}/${manut.id}/${'a'.repeat(32)}.pdf`)).status).toBeGreaterThanOrEqual(400);
  expect((await up(ana.jwt, `${org}/nao-e-um-contrato/arquivo.pdf`)).status).toBeGreaterThanOrEqual(400);
});

test('agendador: token da empresa, idempotente, sem sessão e sem service_role', async ({ page, request }) => {
  const sem = await request.post('/api/jobs/lembretes');
  expect(sem.status()).toBe(401);
  expect((await request.post('/api/jobs/lembretes', { headers: { authorization: `Bearer ${'0'.repeat(64)}` } })).status()).toBe(401);
  expect((await request.get('/api/jobs/lembretes')).status()).toBe(405);
  await loginAs(page, DEMO.dono);
  await page.goto('/configuracoes');
  await page.getByRole('button', { name: 'Gerar novo token' }).click();
  const t1 = (await page.getByTestId('job-token').innerText()).trim();
  expect(t1).toMatch(/^[0-9a-f]{64}$/);
  const ok = await request.post('/api/jobs/lembretes', { headers: { authorization: `Bearer ${t1}` } });
  expect(ok.status()).toBe(200);
  const j1 = (await ok.json()) as { sent: number; errors: number };
  expect(j1.errors).toBe(0);
  const again = (await (await request.post('/api/jobs/lembretes', { headers: { authorization: `Bearer ${t1}` } })).json()) as { sent: number };
  expect(again.sent).toBe(0); // repetir não duplica
  await page.getByRole('button', { name: 'Gerar novo token' }).click();
  await expect(page.getByTestId('job-token')).not.toHaveText(t1);
  expect((await request.post('/api/jobs/lembretes', { headers: { authorization: `Bearer ${t1}` } })).status()).toBe(401); // girar invalida o anterior
});

test('remover o acesso vale na hora: contrato, documento e notificações somem para a pessoa', async () => {
  const gestor = await token(DEMO.gestor);
  const carla = await token(DEMO.carla);
  const org = ((await (await rest(gestor.jwt, 'organization_members?select=organization_id&limit=1')).json()) as Array<{ organization_id: string }>)[0]!.organization_id;
  const forn = ((await (await rest(gestor.jwt, 'contracts?select=id&title=like.Fornecimento*')).json()) as Array<{ id: string }>)[0]!.id;
  expect((await titles(carla.jwt)).some((t) => t.startsWith('Fornecimento'))).toBe(true);
  const rm = await rest(gestor.jwt, 'rpc/ct_set_access', { method: 'POST', body: JSON.stringify({ p_org: org, p_contract: forn, p_user: carla.id, p_role: null }) });
  expect(rm.status).toBe(200);
  expect((await titles(carla.jwt)).some((t) => t.startsWith('Fornecimento'))).toBe(false);
  expect(await (await rest(carla.jwt, `contract_obligations?select=id&contract_id=eq.${forn}`)).json()).toEqual([]);
  expect(await (await rest(carla.jwt, `notifications?select=id&contract_id=eq.${forn}`)).json()).toEqual([]);
});

test('cabeçalhos de segurança e CSP sem «unsafe-inline»', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  const res = await page.goto('/contratos');
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).not.toContain("'unsafe-inline'");
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
});
