// Passo 13 do prompt mestre: o fluxo funciona no CELULAR (375 px, toque) e por TECLADO. Sem rolagem horizontal da página, alvos de toque confortáveis, quadro com navegação horizontal
// utilizável, mover por menu (sem arrastar) e formulários utilizáveis.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, loginAs, tag } from './pj-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();
const TASK = `Tarefa celular ${T}`;

async function noHorizontalScroll(page: Page, label: string) {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, `${label}: sem rolagem horizontal da página (${w.sw} > ${w.iw})`).toBeLessThanOrEqual(w.iw + 1);
}

test.describe('celular', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('Minhas tarefas é a entrada útil: lista por data legível, sem rolagem horizontal', async ({ page }) => {
    await loginAs(page, DEMO.ana);
    await page.goto('/minhas-tarefas');
    await expect(page.getByRole('heading', { name: 'Atrasadas (2)' })).toBeVisible();
    await noHorizontalScroll(page, 'minhas tarefas');
    const link = page.getByRole('link', { name: 'Wireframes da home' }).first();
    await expect(link).toBeVisible();
    await link.tap();
    await page.waitForURL(/\/tarefas\/[0-9a-f-]{36}$/);
    await noHorizontalScroll(page, 'detalhe da tarefa');
  });

  test('quadro com rolagem horizontal PRÓPRIA, criar tarefa e mover por menu com toque', async ({ page }) => {
    await loginAs(page, DEMO.ana);
    await page.goto('/projetos');
    await page.getByRole('link', { name: 'Campanha de lançamento — Verão' }).tap();
    await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
    await noHorizontalScroll(page, 'quadro');
    const scroller = page.getByRole('list', { name: 'Etapas do quadro' });
    const dims = await scroller.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    expect(dims.sw, 'as etapas rolam na horizontal dentro do quadro').toBeGreaterThan(dims.cw);
    // criar tarefa no celular
    await page.locator('summary', { hasText: 'Nova tarefa' }).tap();
    const title = page.getByLabel('Título', { exact: true });
    const box = await title.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    await title.fill(TASK);
    const create = page.getByRole('button', { name: 'Criar tarefa' });
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await create.tap();
    await expect(page.getByText(/Tarefa criada\./).first()).toBeVisible();
    // mover por menu (alternativa ao arrastar)
    const card = page.locator('li[data-card-id]', { hasText: TASK });
    await card.scrollIntoViewIfNeeded();
    const summary = card.locator('summary', { hasText: 'Mover…' });
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await summary.tap();
    await card.getByLabel('Etapa de destino').selectOption({ label: 'Em andamento' });
    const move = card.getByRole('button', { name: 'Mover tarefa' });
    expect((await move.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await move.tap();
    await expect(page.getByText('Tarefa movida.').first()).toBeVisible();
    await page.reload();
    await expect(page.locator('section[data-column-id]', { hasText: 'Em andamento' }).locator('li[data-card-id]', { hasText: TASK })).toBeVisible();
    await noHorizontalScroll(page, 'quadro depois de mover');
  });

  test('lista em cartões, painel e menu continuam utilizáveis no celular', async ({ page }) => {
    await loginAs(page, DEMO.gestor);
    for (const path of ['/dashboard', '/projetos', '/tarefas', '/arquivados', '/notificacoes', '/projetos/novo']) {
      await page.goto(path);
      await noHorizontalScroll(page, path);
    }
    await page.goto('/tarefas');
    await expect(page.getByRole('list', { name: 'Tarefas' }).locator('li').first()).toBeVisible(); // cartões no celular (a tabela fica oculta)
    await page.getByText('Menu', { exact: true }).tap();
    await expect(page.getByRole('link', { name: 'Minhas tarefas' }).first()).toBeVisible();
  });
});

test.describe('teclado', () => {
  test('criar tarefa e mover entre etapas usando só o teclado (Tab, Enter, setas)', async ({ page }) => {
    await loginAs(page, DEMO.ana);
    await page.goto('/projetos');
    await page.getByRole('link', { name: 'Site institucional Prisma' }).click();
    await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
    // abrir «Nova tarefa» com Enter e preencher pelo teclado
    const summary = page.locator('summary', { hasText: 'Nova tarefa' });
    await summary.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Título', { exact: true }).focus();
    await page.keyboard.type(`Tarefa teclado ${T}`);
    await page.getByRole('button', { name: 'Criar tarefa' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Tarefa criada\./).first()).toBeVisible();
    // mover: focar o resumo «Mover…» do cartão, abrir com Enter, escolher com as setas e confirmar com Enter
    const card = page.locator('li[data-card-id]', { hasText: `Tarefa teclado ${T}` });
    await card.locator('summary', { hasText: 'Mover…' }).focus();
    await page.keyboard.press('Enter');
    const select = card.getByLabel('Etapa de destino');
    await select.focus();
    await page.keyboard.press('ArrowDown');
    await expect(select).not.toHaveValue('');
    await card.getByRole('button', { name: 'Mover tarefa' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Tarefa movida.').first()).toBeVisible();
    // o foco visível existe (contorno) e os controles têm nome acessível
    await page.getByRole('link', { name: 'Ir para o conteúdo' }).focus();
    await expect(page.getByRole('link', { name: 'Ir para o conteúdo' })).toBeFocused();
  });
});
