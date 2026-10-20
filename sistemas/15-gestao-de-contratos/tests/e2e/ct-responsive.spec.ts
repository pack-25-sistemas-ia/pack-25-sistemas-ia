// Passo 13 do prompt mestre: o fluxo funciona no CELULAR (375 px, toque) e por TECLADO. Sem rolagem horizontal da página, alvos de toque confortáveis,
// prazos próximos em destaque, documentos consultáveis e formulários utilizáveis.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, loginAs } from './ct-helpers';

test.describe.configure({ mode: 'serial' });

async function noHorizontalScroll(page: Page, label: string) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `${label}: sem rolagem horizontal da página (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
}

test.describe('celular', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('visão geral, contratos em cartões e prazos legíveis, sem rolagem horizontal', async ({ page }) => {
    await loginAs(page, DEMO.gestor);
    for (const path of ['/dashboard', '/contratos', '/prazos', '/prazos?vista=calendario', '/partes', '/obrigacoes', '/reajustes', '/notificacoes', '/relatorios', '/arquivados', '/contratos/novo', '/configuracoes']) {
      await page.goto(path);
      await noHorizontalScroll(page, path);
    }
    await page.goto('/contratos');
    await expect(page.getByRole('list', { name: 'Contratos' }).locator('li').first()).toBeVisible(); // cartões no celular (a tabela fica oculta)
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Próximos 30 dias' })).toBeVisible(); // prazos próximos em destaque
    await page.getByText('Menu', { exact: true }).tap();
    await expect(page.getByRole('link', { name: 'Prazos e calendário' }).first()).toBeVisible();
  });

  test('consulta de contrato e documentos pelo celular (colaboradora) e formulário com campos grandes o bastante', async ({ page }) => {
    await loginAs(page, DEMO.ana);
    await page.goto('/contratos');
    await page.getByRole('link', { name: 'Manutenção e suporte de TI' }).first().tap();
    await page.waitForURL(/\/contratos\/[0-9a-f-]{36}$/);
    await noHorizontalScroll(page, 'contrato');
    await page.getByRole('link', { name: 'Documentos' }).tap();
    await expect(page.getByRole('heading', { name: 'Contrato principal (assinado)' })).toBeVisible();
    await expect(page.getByRole('link', { name: /contrato-de-manutencao/ }).first()).toBeVisible();
    await noHorizontalScroll(page, 'documentos');
    await page.getByRole('link', { name: 'Prazos e obrigações' }).tap();
    await noHorizontalScroll(page, 'prazos do contrato');
    await page.locator('summary', { hasText: 'Nova obrigação' }).tap();
    const title = page.getByLabel('Título', { exact: true });
    expect((await title.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    const btn = page.getByRole('button', { name: 'Criar obrigação' });
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe('teclado', () => {
  test('o link «Ir para o conteúdo» é o primeiro foco, e criar obrigação funciona só com o teclado', async ({ page }) => {
    await loginAs(page, DEMO.ana);
    await page.goto('/contratos');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused();
    await page.getByRole('link', { name: 'Manutenção e suporte de TI' }).first().click();
    await page.getByRole('link', { name: 'Prazos e obrigações' }).click();
    const summary = page.locator('summary', { hasText: 'Nova obrigação' });
    await summary.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Título', { exact: true }).focus();
    await page.keyboard.type('Obrigação criada pelo teclado');
    await page.getByLabel('Data', { exact: true }).fill(new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Criar obrigação' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Obrigação criada.').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('row', { name: /Obrigação criada pelo teclado/ })).toBeVisible();
  });
});
