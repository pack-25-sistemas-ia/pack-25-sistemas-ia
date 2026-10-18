// Passo 13 do prompt mestre: o fluxo do técnico funciona no CELULAR (375 px, toque). Sem rolagem horizontal, alvos de toque confortáveis, botões claros de iniciar/pausar/concluir,
// upload de foto, lista em cartões e página do cliente legível.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, loginAs, tag } from './os-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();
const SUBJECT = `E2E celular compressor ${T}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==', 'base64');
let orderUrl = '';
let publicLink = '';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

async function noHorizontalScroll(page: Page, label: string) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `${label}: sem rolagem horizontal (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
}
/** Abre um painel recolhível pelo toque, sem fechá-lo se já estiver aberto (alguns abrem sozinhos quando não há pendências). */
async function openPanel(page: Page, summary: string) {
  const d = page.locator('details', { has: page.locator('summary', { hasText: summary }) }).first();
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('summary').tap();
}
async function tapTarget(page: Page, name: string | RegExp, label: string) {
  const b = page.getByRole('button', { name }).first();
  await expect(b, label).toBeVisible();
  const box = await b.boundingBox();
  expect(box!.height, `${label}: alvo de toque com pelo menos 40 px`).toBeGreaterThanOrEqual(40);
  return b;
}

test('gestão (celular) abre uma ordem autorizada sem orçamento para o técnico e gera o link', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/ordens/nova?q=Oficina');
  await page.getByRole('link', { name: /Oficina Rápida/ }).click();
  await page.getByLabel('Assunto').fill(SUBJECT);
  await page.getByLabel('Descrição da solicitação').fill('O compressor desarma e não mantém pressão.');
  await page.getByLabel('Técnico responsável').selectOption({ label: 'Carla Nogueira' });
  await page.getByLabel('Autorização da execução').selectOption('authorized');
  await page.getByLabel('Justificativa (só para execução sem orçamento)').fill('Urgência: a oficina está parada; autorizado por telefone pelo gerente.');
  await page.getByRole('button', { name: 'Abrir ordem' }).click();
  await page.waitForURL(/\/ordens\/[0-9a-f-]{36}$/);
  orderUrl = page.url();
  await noHorizontalScroll(page, 'detalhe da ordem (gestão)');
  await page.getByRole('button', { name: 'Gerar link de acompanhamento' }).click();
  publicLink = await page.locator('#link-gerado').inputValue();
  expect(publicLink).toContain('/acompanhar/');
});

test('técnico (celular): lista em cartões, iniciar, peça, foto, pausar, retomar e concluir', async ({ page }) => {
  await loginAs(page, DEMO.t2);
  await page.goto('/minhas-ordens');
  await noHorizontalScroll(page, 'minhas ordens');
  // no celular a lista é de CARTÕES (a tabela fica oculta)
  const card = page.getByRole('link', { name: new RegExp(SUBJECT) });
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(orderUrl);
  await noHorizontalScroll(page, 'detalhe da ordem (técnico)');
  const start = await tapTarget(page, 'Iniciar execução', 'Iniciar');
  await start.tap();
  await expect(page.getByText('Execução iniciada.').first()).toBeVisible();
  await page.goto(`${orderUrl}?tab=execucao`);
  await noHorizontalScroll(page, 'aba Execução');
  // peça
  await openPanel(page, 'Registrar peça utilizada');
  await page.getByLabel('Peça do catálogo').selectOption({ label: 'CAP-40 — Capacitor 40 µF' });
  await page.getByLabel('Quantidade', { exact: true }).first().fill('1');
  await (await tapTarget(page, 'Registrar uso', 'Registrar uso')).tap();
  await expect(page.getByText('Uso de peça registrado.').first()).toBeVisible();
  // foto (o seletor de arquivo do celular oferece a câmera)
  await page.goto(`${orderUrl}?tab=evidencias`);
  await noHorizontalScroll(page, 'aba Evidências');
  await page.locator('input[name="file"]').first().setInputFiles({ name: 'celular.png', mimeType: 'image/png', buffer: PNG });
  await (await tapTarget(page, 'Enviar arquivos', 'Enviar arquivos')).tap();
  await expect(page.getByText('1 arquivo(s) adicionado(s).').first()).toBeVisible();
  // pausar (motivo obrigatório) e retomar
  await page.goto(`${orderUrl}?tab=execucao`);
  await openPanel(page, 'Pausar execução');
  await page.getByLabel('Motivo da pausa').fill('Aguardando peça do fornecedor');
  await (await tapTarget(page, 'Pausar', 'Pausar')).tap();
  await expect(page.getByText('Execução pausada.').first()).toBeVisible();
  await page.goto(`${orderUrl}?tab=execucao`);
  await (await tapTarget(page, 'Retomar execução', 'Retomar')).tap();
  await expect(page.getByText('Execução retomada.').first()).toBeVisible();
  // concluir
  await page.goto(`${orderUrl}?tab=execucao`);
  await openPanel(page, 'Concluir serviço');
  await page.getByLabel('Resumo do serviço executado').fill('Troquei o capacitor e a válvula de retenção; pressão estável em 8 bar.');
  await (await tapTarget(page, 'Concluir serviço', 'Concluir')).tap();
  await expect(page.getByText(/Serviço concluído \(versão 1 da conclusão\)/).first()).toBeVisible();
  await noHorizontalScroll(page, 'após concluir');
});

test('cliente (celular): página legível, sem rolagem horizontal, formulário de aceite utilizável', async ({ page }) => {
  await page.goto(publicLink);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Acompanhamento');
  await noHorizontalScroll(page, 'página do cliente');
  await expect(page.getByText(/Serviço concluído — aguardando o seu aceite/)).toBeVisible();
  const accept = await tapTarget(page, 'Aceitar a conclusão', 'Aceitar');
  const box = await page.getByLabel('Seu nome completo').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); // campos confortáveis ao toque
  await accept.scrollIntoViewIfNeeded();
  await page.getByLabel('Seu nome completo').fill('Gerente da Oficina');
  await page.getByLabel(/Entendo que esta resposta/).check();
  await accept.tap();
  await expect(page.getByText('Conclusão aceita. Obrigado!')).toBeVisible();
});

test('painel e quadro continuam utilizáveis no celular', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  for (const path of ['/dashboard', '/ordens', '/ordens?view=board', '/agenda', '/clientes', '/ordens/nova']) {
    await page.goto(path);
    await noHorizontalScroll(page, path);
  }
  // menu recolhível
  await page.goto('/dashboard');
  await page.getByText('Menu', { exact: true }).tap();
  await expect(page.getByRole('link', { name: 'Ordens de serviço' }).first()).toBeVisible();
});
