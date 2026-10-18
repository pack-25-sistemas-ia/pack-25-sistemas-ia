// Segurança das Ordens de Serviço no navegador e na API REST do Supabase: isolamento do técnico, dados restritos, portas públicas, exportação, links inválidos e cabeçalhos.
import { expect, test } from '@playwright/test';
import { ANON_KEY, SUPABASE_URL } from './helpers';
import { DEMO, demoPassword, loginAs, tag } from './os-helpers';

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

let t1Order = ''; // uma ordem do técnico 1 (demonstração)

test('técnico só enxerga as ordens atribuídas a ele — na tela e direto na API', async ({ page }) => {
  const a = await token(DEMO.t1);
  const b = await token(DEMO.t2);
  const mine = (await (await rest(a.jwt, 'service_orders?select=id,assigned_technician_user_id,execution_status')).json()) as Array<{ id: string; assigned_technician_user_id: string }>;
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.every((o) => o.assigned_technician_user_id === a.id)).toBe(true);
  t1Order = mine[0]!.id;
  const others = (await (await rest(b.jwt, `service_orders?select=id&id=eq.${t1Order}`)).json()) as unknown[];
  expect(others).toEqual([]);
  // tela: o técnico 2 recebe 404 real na ordem do técnico 1 (sem conteúdo)
  await loginAs(page, DEMO.t2);
  const res = await page.goto(`/ordens/${t1Order}`);
  expect(res!.status()).toBe(404);
  await expect(page.locator('body')).not.toContainText('Padaria');
  expect((await page.request.get(`/api/pdf/${t1Order}/summary/0`)).status()).toBe(404);
});

test('técnico não lê CPF/CNPJ, custos internos, links nem rascunhos; não escreve direto em nenhuma tabela', async () => {
  const a = await token(DEMO.t1);
  for (const t of ['customer_private', 'order_internal_costs', 'public_access_tokens', 'customer_contacts', 'checklist_templates']) {
    const r = await rest(a.jwt, `${t}?select=*`);
    expect(r.status === 200 ? await r.json() : [], t).toEqual([]);
  }
  const drafts = (await (await rest(a.jwt, 'quote_versions?select=id&status=eq.draft')).json()) as unknown[];
  expect(drafts).toEqual([]);
  const hash = await rest(a.jwt, 'public_access_tokens?select=token_hash');
  expect(hash.status).toBeGreaterThanOrEqual(400); // a coluna do hash nem é legível
  const upd = await rest(a.jwt, `service_orders?id=eq.${t1Order}`, { method: 'PATCH', body: JSON.stringify({ subject: 'Invasão' }) });
  expect(upd.status).toBeGreaterThanOrEqual(400);
  const ins = await rest(a.jwt, 'customers', { method: 'POST', body: JSON.stringify({ name: 'Invasor' }) });
  expect(ins.status).toBeGreaterThanOrEqual(400);
  const del = await rest(a.jwt, `order_events?service_order_id=eq.${t1Order}`, { method: 'DELETE' });
  expect(del.status).toBeGreaterThanOrEqual(400);
  // funções administrativas recusam o técnico
  const open = await rest(a.jwt, 'rpc/os_open_order', { method: 'POST', body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000', p_idem: crypto.randomUUID(), p: {} }) });
  expect(open.status).toBeGreaterThanOrEqual(400);
});

test('anônimo não alcança tabelas nem funções administrativas; só as portas públicas por token', async () => {
  for (const t of ['service_orders', 'customers', 'quote_versions', 'order_updates', 'order_attachments', 'public_access_tokens', 'order_internal_costs']) {
    const r = await rest(null, `${t}?select=*`);
    if (r.status === 200) expect(await r.json(), t).toEqual([]); else expect(r.status, t).toBeGreaterThanOrEqual(400);
  }
  const adm = await rest(null, 'rpc/os_dashboard', { method: 'POST', body: JSON.stringify({ p_org: '00000000-0000-0000-0000-000000000000', p_from: '2026-01-01', p_to: '2026-01-02' }) });
  expect(adm.status).toBeGreaterThanOrEqual(400);
  const view = await rest(null, 'rpc/os_public_view', { method: 'POST', body: JSON.stringify({ p_token: 'x'.repeat(43), p_source: 'e2e-sec' }) });
  expect(view.status).toBe(200);
  expect(await view.json()).toEqual({ error: 'invalid_link' }); // mesma resposta para qualquer link inválido
});

test('link inexistente, malformado e revogado respondem 404 igual; cabeçalhos de segurança na página do cliente', async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (/content security policy|refused to (execute|load|apply)/i.test(m.text())) errors.push(m.text()); });
  for (const bad of ['curto', 'A'.repeat(43), 'B'.repeat(42) + 'é']) {
    const r = await page.goto(`/acompanhar/${bad}`);
    expect(r!.status(), bad).toBe(404);
  }
  // gestão gera e depois revoga um link: a página passa a responder 404
  await loginAs(page, DEMO.gestor);
  await page.goto(`/ordens/${t1Order}`);
  await page.getByRole('button', { name: /Gerar (novo )?link/ }).click();
  const link = await page.locator('#link-gerado').inputValue();
  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  const ok = await p.goto(link);
  expect(ok!.status()).toBe(200);
  const h = ok!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).not.toContain('unsafe-inline');
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cache-control']).toContain('no-store');
  expect(h['x-frame-options']).toBe('DENY');
  await page.getByRole('button', { name: 'Revogar link' }).click();
  await expect(page.getByText('Link revogado.').first()).toBeVisible();
  expect((await p.goto(link))!.status()).toBe(404);
  await ctx.close();
  expect(errors).toEqual([]);
});

test('exportação CSV: só a gestão exporta; fórmulas de planilha são neutralizadas; PDFs do técnico alheio negados', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  // ordem com assunto malicioso para planilha
  const subject = `=HYPERLINK("http://x","clique") ${T}`;
  await page.goto('/ordens/nova?q=Maria');
  await page.getByRole('link', { name: /Maria Souza/ }).click();
  await page.getByLabel('Assunto').fill(subject);
  await page.getByLabel('Descrição da solicitação').fill('Teste de exportação segura.');
  await page.getByRole('button', { name: 'Abrir ordem' }).click();
  await page.waitForURL(/\/ordens\/[0-9a-f-]{36}$/);
  const r = await page.request.get('/api/exportar/ordens?status=open');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/csv');
  const csv = (await r.body()).toString('utf8');
  expect(csv.startsWith('﻿Número;Assunto;Cliente;Status')).toBe(true);
  expect(csv).toContain(`"'=HYPERLINK(""http://x"",""clique"") ${T}"`);
  expect(csv).not.toMatch(/(^|;)=HYPERLINK/m);
  await loginAs(page, DEMO.t1);
  expect((await page.request.get('/api/exportar/ordens')).status()).toBe(403);
  expect((await page.goto('/clientes'))!.status()).toBe(404);
  expect((await page.goto('/relatorios'))!.status()).toBe(404);
  expect((await page.goto('/configuracoes'))!.status()).toBe(404);
  expect((await page.goto('/modelos-checklist'))!.status()).toBe(404);
});
