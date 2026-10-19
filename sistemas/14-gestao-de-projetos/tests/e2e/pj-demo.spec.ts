// Passeio pela demonstração («Agência Prisma»): projetos em todos os estados, tarefas atrasadas/bloqueadas/sem prazo, painel com números reais, Minhas tarefas por data e visões por perfil.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, expectNoServerError, loginAs } from './pj-helpers';

test.describe.configure({ mode: 'serial' });

const kpi = async (page: Page, label: string): Promise<number> => Number((await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::p[1]').innerText()).trim());

async function openProject(page: Page, name: string) {
  await page.goto('/projetos');
  await page.getByRole('link', { name }).click();
  await page.waitForURL(/\/projetos\/[0-9a-f-]{36}/);
}

test('painel da gestão: situação atual com os números do cenário, definições visíveis e «Sem dados» honesto', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel');
  expect(await kpi(page, 'Projetos ativos')).toBe(2);
  expect(await kpi(page, 'Tarefas abertas')).toBe(17);
  expect(await kpi(page, 'Atrasadas')).toBe(3);
  expect(await kpi(page, 'Bloqueadas')).toBe(1);
  expect(await kpi(page, 'Sem responsável')).toBe(5);
  expect(await kpi(page, 'Concluídas no período')).toBe(4);
  await expect(page.getByText(/Vencer hoje ainda não é atraso/).first()).toBeVisible(); // definição visível, não só tooltip
  await expect(page.getByText(/não uma medida de produtividade/).first()).toBeVisible();
  await expect(page.getByText(/base temporal: fuso America\/Sao_Paulo/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Relatório trimestral/ })).toContainText('0%');
  // período no passado: nada concluído «no período», mas a situação atual permanece
  await page.goto('/dashboard?from=2020-01-01&to=2020-01-31');
  expect(await kpi(page, 'Concluídas no período')).toBe(0);
  expect(await kpi(page, 'Tarefas abertas')).toBe(17);
  await expectNoServerError(page, 'painel');
  await page.goto('/dashboard?from=2020-01-01&to=2023-01-31'); // período inválido não derruba a página
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('lista de projetos, projeto concluído e arquivados', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/projetos');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meus projetos');
  for (const n of ['Site institucional Prisma', 'Campanha de lançamento — Verão', 'Relatório trimestral de clientes', 'Rebranding — Cliente Horizonte']) await expect(page.getByRole('link', { name: n }), n).toBeVisible();
  await expect(page.getByRole('link', { name: 'Migração do blog antigo' })).toHaveCount(0); // arquivado sai das listas padrão
  await page.goto('/projetos?status=completed');
  await expect(page.getByRole('link', { name: 'Rebranding — Cliente Horizonte' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Site institucional Prisma' })).toHaveCount(0);
  await openProject(page, 'Rebranding — Cliente Horizonte');
  await expect(page.getByText(/Projeto concluído: somente para consulta/).first()).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Nova tarefa' })).toHaveCount(0);
  await page.goto('/arquivados');
  await expect(page.getByRole('link', { name: 'Migração do blog antigo' })).toBeVisible();
  await page.getByRole('link', { name: 'Migração do blog antigo' }).click();
  await expect(page.getByText(/Projeto arquivado: somente para consulta/).first()).toBeVisible();
});

test('quadro do projeto principal: etapas, atraso e bloqueio em texto, filtros no servidor e visão em lista', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await openProject(page, 'Site institucional Prisma');
  for (const col of ['A fazer', 'Em andamento', 'Em revisão', 'Concluído']) await expect(page.getByRole('heading', { name: col, level: 3 }), col).toBeVisible();
  const wire = page.locator('li[data-card-id]', { hasText: 'Wireframes da home' });
  await expect(wire).toContainText('Atrasada');
  await expect(wire).toContainText('☑ 0/2');
  await expect(page.locator('li[data-card-id]', { hasText: 'Formulário de contato' })).toContainText('Bloqueada');
  await expect(page.locator('li[data-card-id]', { hasText: 'Mapa do site' })).toContainText('Concluída');
  await expect(page.getByText('Ideia descartada: animação de abertura')).toHaveCount(0); // arquivada fora do quadro
  // filtro «só atrasadas» (no servidor)
  await page.getByLabel('Atraso').selectOption('1');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.locator('li[data-card-id]')).toHaveCount(2);
  await expect(page.getByText(/Há filtros ativos/)).toBeVisible();
  // lista com paginação/filtros do servidor
  await page.goto(page.url().split('?')[0] + '/lista');
  await expect(page.getByRole('row', { name: /Formulário de contato/ })).toContainText('Bloqueada');
  await page.goto(page.url().split('?')[0] + '?late=1&blocked=1');
  await expect(page.getByRole('row', { name: /Formulário de contato/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Wireframes da home/ })).toHaveCount(0);
  await expectNoServerError(page, 'lista');
});

test('Todas as tarefas: filtros combinados, busca por número e exportação', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/tarefas?late=1');
  await expect(page.getByRole('row')).toHaveCount(4); // cabeçalho + 3 atrasadas
  await page.goto('/tarefas?unassigned=1&stage=todo');
  await expect(page.getByRole('row', { name: /Banco de imagens/ })).toBeVisible();
  await page.goto('/tarefas?q=Wireframes');
  await expect(page.getByRole('row')).toHaveCount(2);
  await page.goto('/tarefas?archived=1&q=descartada');
  await expect(page.getByRole('row', { name: /Ideia descartada/ })).toContainText('Arquivada');
  await expect(page.getByRole('link', { name: /Exportar CSV/ })).toBeVisible();
});

test('colaboradora: Minhas tarefas por data, notificações e acesso só aos projetos dela', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  await page.goto('/minhas-tarefas');
  await expect(page.getByRole('heading', { name: 'Atrasadas (2)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Próximos sete dias (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Depois (2)' })).toBeVisible();
  await page.goto('/notificacoes');
  await expect(page.getByText('Tarefa atribuída a você').first()).toBeVisible();
  await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
  await expect(page.getByText('Notificações marcadas como lidas.').first()).toBeVisible();
  await page.goto('/projetos');
  await expect(page.getByRole('link', { name: 'Site institucional Prisma' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rebranding — Cliente Horizonte' })).toHaveCount(0); // não participa
  await page.goto('/dashboard');
  expect(await kpi(page, 'Projetos ativos')).toBe(2);
});

test('projeto planejado prepara mas não executa; leitor da empresa só consulta', async ({ page }) => {
  await loginAs(page, DEMO.carla);
  await openProject(page, 'Relatório trimestral de clientes');
  await expect(page.getByText(/Projeto planejado: prepare as tarefas/).first()).toBeVisible();
  const card = page.locator('li[data-card-id]').first();
  await card.locator('summary', { hasText: 'Mover…' }).click();
  const blocked = card.getByRole('option', { name: /Em andamento \(exige projeto ativo\)/ });
  expect(await blocked.evaluate((o) => (o as HTMLOptionElement).disabled)).toBe(true);
  await loginAs(page, DEMO.leitor);
  await page.goto('/projetos');
  await expect(page.getByRole('link', { name: 'Site institucional Prisma' })).toBeVisible();
  await openProject(page, 'Site institucional Prisma');
  await expect(page.locator('summary', { hasText: 'Mover…' })).toHaveCount(0);
  await expect(page.getByText('Seu papel:')).toContainText('Leitor');
  expect((await page.goto('/configuracoes'))!.status()).toBe(404);
});
