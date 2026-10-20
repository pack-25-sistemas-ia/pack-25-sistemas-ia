// Fluxo principal da Gestão de Contratos contra o Supabase real (app compilado): passos 1–12 do prompt mestre (o 13º, celular, está em ct-responsive.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import { DEMO, brDate, loginAs, plusDays, tag, todayBR } from './ct-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();
const TITLE = `Contrato E2E ${T}`;
const PARTY = `Parte E2E ${T}`;
let contractUrl = '';
const tab = (name: string) => `${contractUrl}?aba=${name}`;
const form = (page: Page, submit: string) => page.locator('form', { has: page.getByRole('button', { name: submit, exact: true }) });
const disclose = async (page: Page, summary: string) => { const d = page.locator('details', { has: page.locator('summary', { hasText: summary }) }).first(); if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').first().click(); };

test('1. gestão cadastra a parte (CNPJ validado, guardado à parte)', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/partes');
  await disclose(page, 'Cadastrar parte');
  const f = form(page, 'Cadastrar');
  await f.getByLabel('Nome ou razão social').fill(PARTY);
  await f.getByLabel('CPF/CNPJ (opcional)').fill('11.111.111/0001-11');
  await f.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await expect(page.getByText(/CPF\/CNPJ inválido/).first()).toBeVisible(); // dígitos verificadores conferidos
  await f.getByLabel('CPF/CNPJ (opcional)').fill('00.000.000/0001-91');
  await f.getByRole('button', { name: 'Cadastrar', exact: true }).click();
  await expect(page.getByText('Parte cadastrada.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(PARTY) })).toContainText('00.000.000/0001-91'); // a gestão enxerga o documento completo
});

test('2. gestão cria o contrato (rascunho) com valor e regra de reajuste', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/contratos/novo');
  await page.getByLabel('Título do contrato').fill(TITLE);
  await page.getByLabel('Parte do contrato').selectOption({ label: PARTY });
  await page.getByLabel('Papel da parte').fill('Contratada');
  await page.getByLabel('Início da vigência').fill(plusDays(-10));
  await page.getByLabel('Fim da vigência', { exact: true }).fill(plusDays(45));
  await page.getByLabel('Aviso (dias antes)').fill('30');
  await disclose(page, 'Valor e reajuste');
  await page.getByLabel('Valor (R$)').fill('1.000,00');
  await page.getByLabel('Periodicidade').selectOption('monthly');
  await page.getByLabel('Reajuste a cada (meses)').fill('12');
  await page.getByLabel('Próximo reajuste').fill(plusDays(0));
  await page.getByRole('button', { name: 'Criar rascunho' }).click();
  await page.waitForURL(/\/contratos\/[0-9a-f-]{36}$/);
  contractUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE);
  await expect(page.getByText('Rascunho').first()).toBeVisible();
  await expect(page.getByText('R$ 1.000,00').first()).toBeVisible();
  await expect(page.getByText(brDate(plusDays(15))).first()).toBeVisible(); // aviso = fim − 30 dias
});

test('3. anexa o documento (privado, PDF conferido pelos bytes) e uma segunda versão', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(tab('documentos'));
  await disclose(page, 'Adicionar documento');
  const f = form(page, 'Adicionar documento');
  await f.getByLabel('Título do documento').fill('Contrato assinado');
  await f.locator('input[type=file]').setInputFiles({ name: 'contrato.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nversao um\n') });
  await f.getByRole('button', { name: 'Adicionar documento', exact: true }).click();
  await expect(page.getByText('Documento adicionado (versão 1).').first()).toBeVisible();
  await page.reload();
  await disclose(page, 'Enviar nova versão');
  const g = form(page, 'Enviar versão');
  await g.locator('input[type=file]').setInputFiles({ name: 'contrato-v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nversao dois\n') });
  await g.getByRole('button', { name: 'Enviar versão', exact: true }).click();
  await expect(page.getByText(/Nova versão adicionada/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: /v2/ })).toContainText('Atual');
  await expect(page.getByRole('row', { name: /v1/ })).toContainText('contrato.pdf'); // a versão anterior continua preservada
  const dl = await page.request.get((await page.getByRole('link', { name: 'contrato-v2.pdf' }).getAttribute('href'))!);
  expect(dl.status()).toBe(200);
  expect(dl.headers()['content-disposition']).toContain('attachment');
  expect(dl.headers()['x-content-type-options']).toBe('nosniff');
  expect((await dl.body()).toString('latin1')).toContain('versao dois');
});

test('4. concede acesso à Ana, define-a como responsável e ativa o contrato', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(contractUrl);
  await disclose(page, 'Vincular, mudar o papel ou remover acesso');
  const a = form(page, 'Salvar acesso');
  await a.getByLabel('Pessoa', { exact: true }).selectOption({ label: 'Ana Ribeiro (Colaborador)' });
  await a.getByLabel('Papel no contrato').selectOption('editor');
  await a.getByRole('button', { name: 'Salvar acesso' }).click();
  await expect(page.getByText('Acesso salvo.').first()).toBeVisible();
  await page.reload();
  await disclose(page, 'Trocar o responsável');
  const r = form(page, 'Salvar responsável');
  await r.getByLabel('Responsável', { exact: true }).selectOption({ label: 'Ana Ribeiro' });
  await r.getByRole('button', { name: 'Salvar responsável' }).click();
  await expect(page.getByText(/Responsável definido/).first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ativar contrato' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(/Contrato ativado/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ativo').first()).toBeVisible();
});

test('5. configura obrigação (responsável Ana) e ajusta o prazo de aviso com justificativa', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(tab('prazos'));
  await disclose(page, 'Nova obrigação');
  const o = form(page, 'Criar obrigação');
  await o.getByLabel('Título', { exact: true }).fill(`Enviar relatório ${T}`);
  await o.getByLabel('Data', { exact: true }).fill(plusDays(3));
  await o.getByLabel('Responsável', { exact: true }).selectOption({ label: 'Ana Ribeiro' });
  await o.getByRole('button', { name: 'Criar obrigação' }).click();
  await expect(page.getByText('Obrigação criada.').first()).toBeVisible();
  await page.reload();
  await disclose(page, 'Prazo de aviso');
  const n = form(page, 'Salvar aviso');
  await n.getByLabel('Ajuste manual do prazo').fill(plusDays(10));
  await n.getByRole('button', { name: 'Salvar aviso' }).click();
  await expect(page.getByText(/justificativa do ajuste manual/i).first()).toBeVisible(); // ajuste manual sem justificativa é recusado
  await n.getByLabel('Justificativa do ajuste').fill('A cláusula 7 conta 35 dias');
  await n.getByRole('button', { name: 'Salvar aviso' }).click();
  await expect(page.getByText(/ajustado manualmente/).first()).toBeVisible();
  await page.reload();
  await disclose(page, 'Revisões anteriores');
  await expect(page.getByText('Prazo de aviso (ajustado)').first()).toBeVisible();
});

test('6. calendário e lista de prazos mostram o contrato (sem depender do agendador)', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/prazos');
  await expect(page.getByRole('link', { name: new RegExp(TITLE) }).first()).toBeVisible();
  await page.goto('/prazos?vista=calendario');
  await expect(page.getByRole('heading', { level: 2 })).toContainText(/\d{4}/);
  await expect(page.getByRole('link', { name: /Fim de vigência|Prazo de aviso|Obrigação/ }).first()).toBeVisible();
});

test('7 e 8. simula o reajuste (não altera nada), aplica com confirmação e consulta o histórico de valores', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(tab('valores'));
  await disclose(page, 'Simular reajuste');
  const s = form(page, 'Simular');
  await s.getByLabel('Percentual (%)').fill('5,5');
  await s.getByLabel('Referência', { exact: true }).fill('IPCA');
  await s.getByRole('button', { name: 'Simular', exact: true }).click();
  await expect(page.getByText(/O contrato NÃO foi alterado/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Simulação em aberto — o contrato ainda NÃO foi alterado')).toBeVisible();
  await expect(page.getByText('R$ 1.055,00').first()).toBeVisible(); // prévia
  await expect(page.getByRole('row', { name: /Valor inicial/ })).toHaveCount(1);
  await expect(page.getByRole('row', { name: /Reajuste$/ })).toHaveCount(0); // ainda não há versão de reajuste
  // aplicar exige confirmação
  await page.getByRole('button', { name: 'Aplicar reajuste' }).click();
  await expect(page.getByText(/Marque a confirmação/).first()).toBeVisible();
  await page.getByLabel(/Confirmo aplicar este reajuste/).check();
  await page.getByRole('button', { name: 'Aplicar reajuste' }).click();
  await expect(page.getByText(/Reajuste aplicado/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: /Valor inicial/ })).toContainText('R$ 1.000,00');
  await expect(page.getByRole('row', { name: /Reajuste/ }).first()).toContainText('R$ 1.055,00');
  await expect(page.getByRole('row', { name: /R\$ 1\.055,00.*Vigente|Vigente.*R\$ 1\.055,00/ }).first()).toBeVisible();
});

test('9. registra a renovação manual (período anterior preservado no histórico)', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(tab('aditivos'));
  await disclose(page, 'Registrar renovação');
  const f = form(page, 'Registrar renovação');
  await f.getByLabel('Nova data de fim').fill(plusDays(410));
  await f.getByLabel('Justificativa').fill('Renovação por mais 12 meses, conforme cláusula 12');
  await f.getByRole('button', { name: 'Registrar renovação' }).click();
  await expect(page.getByText(/Contrato renovado/).first()).toBeVisible();
  await page.reload();
  const row = page.getByRole('row', { name: /Renovação/ });
  await expect(row).toContainText(brDate(plusDays(45))); // antes
  await expect(row).toContainText(brDate(plusDays(410))); // depois
});

test('10 e 11. processa os lembretes e a Ana recebe a notificação da obrigação', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/configuracoes');
  await page.getByRole('button', { name: 'Processar lembretes agora' }).click();
  await expect(page.getByText(/Lembretes processados: \d+ enviado/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Processar lembretes agora' }).click(); // idempotente: repetir não duplica
  await expect(page.getByText(/Lembretes processados: 0 enviado/).first()).toBeVisible();
  await loginAs(page, DEMO.ana);
  await page.goto('/notificacoes');
  const item = page.getByRole('listitem').filter({ hasText: 'Obrigação com prazo se aproximando' }).filter({ hasText: TITLE });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(brDate(plusDays(3)));
  await expect(page.getByRole('listitem').filter({ hasText: 'Você foi definido(a) como responsável' }).filter({ hasText: TITLE })).toHaveCount(1);
});

test('12. exporta o CSV (sem CPF/CNPJ nem links de arquivo; fórmulas neutralizadas)', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  const r = await page.request.get(`/api/exportar/contratos?q=${encodeURIComponent(TITLE)}`);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('text/csv');
  const csv = (await r.body()).toString('utf8');
  expect(csv.startsWith('﻿Contrato;Título;Partes')).toBe(true);
  expect(csv).toContain(TITLE);
  expect(csv).toContain('R$ 1.055,00');
  expect(csv).not.toContain('00.000.000/0001-91');
  expect(csv).not.toContain('/api/arquivos');
  expect((await page.request.get('/api/exportar/contratos?tipo=prazos')).status()).toBe(200);
  expect(todayBR()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
