// Fluxo principal da Gestão de Projetos contra o Supabase real (app compilado): os passos 1–12 do prompt mestre (o 13º, celular e teclado, está em pj-responsive.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import { DEMO, loginAs, tag } from './pj-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();
const PROJECT = `Projeto E2E ${T}`;
const TASK = `Tarefa E2E ${T}`;
let projectUrl = '';
let taskUrl = '';

const addForm = (page: Page) => page.locator('form', { has: page.getByRole('button', { name: 'Adicionar ao projeto' }) });
const kpi = async (page: Page, label: string): Promise<number> => Number((await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::p[1]').innerText()).trim());

test('1. gestor cria o projeto (planejado ou ativo) e cai no quadro com as quatro etapas', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/projetos/novo');
  await page.getByLabel('Nome do projeto').fill(PROJECT);
  await page.getByLabel('Descrição (opcional)').fill('Projeto criado pelo teste de ponta a ponta.');
  await page.getByLabel('Como começa').selectOption('active');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await page.waitForURL(/\/projetos\/[0-9a-f-]{36}$/);
  projectUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROJECT);
  for (const col of ['A fazer', 'Em andamento', 'Em revisão', 'Concluído']) await expect(page.getByRole('heading', { name: col, level: 3 }), col).toBeVisible();
  await expect(page.getByText(/Este projeto ainda não tem tarefas/)).toBeVisible();
});

test('2. gestor adiciona participantes com papéis (editor e leitor) e o papel «Leitor» da empresa só pode ser leitor', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(`${projectUrl}/membros`);
  await addForm(page).getByLabel('Pessoa', { exact: true }).selectOption({ label: 'Ana Ribeiro (Colaborador)' });
  await addForm(page).getByLabel('Papel no projeto').selectOption('editor');
  await page.getByRole('button', { name: 'Adicionar ao projeto' }).click();
  await expect(page.getByText('Participante adicionado.').first()).toBeVisible();
  await page.goto(`${projectUrl}/membros`);
  await addForm(page).getByLabel('Pessoa', { exact: true }).selectOption({ label: 'Eduardo Leitor (Leitor)' });
  await addForm(page).getByLabel('Papel no projeto').selectOption('editor');
  await page.getByRole('button', { name: 'Adicionar ao projeto' }).click();
  await expect(page.getByText(/só pode ser leitor no projeto/i).first()).toBeVisible();
  await page.goto(`${projectUrl}/membros`);
  await addForm(page).getByLabel('Pessoa', { exact: true }).selectOption({ label: 'Eduardo Leitor (Leitor)' });
  await addForm(page).getByLabel('Papel no projeto').selectOption('reader');
  await page.getByRole('button', { name: 'Adicionar ao projeto' }).click();
  await expect(page.getByText('Participante adicionado.').first()).toBeVisible();
  await page.goto(`${projectUrl}/membros`);
  await expect(page.getByRole('row', { name: /Ana Ribeiro/ })).toContainText('Editor', { timeout: 15000 });
  await expect(page.getByRole('row', { name: /Eduardo Leitor/ })).toContainText('Leitor', { timeout: 15000 });
});

test('3 e 4. gestor cria a tarefa com checklist obrigatório e atribui à Ana', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(projectUrl);
  await page.locator('summary', { hasText: 'Nova tarefa' }).click();
  const form = page.locator('form', { has: page.getByRole('button', { name: 'Criar tarefa' }) });
  await form.getByLabel('Título', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.getByText(/Título: mínimo 2 caracteres/)).toBeVisible();
  await form.getByLabel('Título', { exact: true }).fill(TASK);
  await form.getByLabel('Descrição (opcional)').first().fill('Descrição **da tarefa**.');
  await form.getByLabel('Prioridade').selectOption('high');
  await form.getByLabel('Responsável (opcional)').selectOption({ label: 'Ana Ribeiro' });
  await form.getByLabel('Vencimento (opcional)').fill('2020-01-02'); // no passado de propósito: aparece como atrasada
  await form.getByLabel('Checklist (opcional)').fill('! Revisar com o cliente\nExportar PDF');
  await page.getByRole('button', { name: 'Criar tarefa' }).click();
  await expect(page.getByText(/Tarefa criada\./).first()).toBeVisible();
  const card = page.getByRole('link', { name: TASK });
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL(/\/tarefas\/[0-9a-f-]{36}$/);
  taskUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TASK);
  await expect(page.getByText('Atrasada').first()).toBeVisible();
  await expect(page.getByText('Ana Ribeiro').first()).toBeVisible();
});

test('5. colaboradora acessa «Minhas tarefas», vê a tarefa atrasada e a notificação de atribuição', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  await page.goto('/minhas-tarefas');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minhas tarefas');
  await expect(page.getByRole('heading', { name: /^Atrasadas \(/ })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(TASK) })).toContainText('Atrasada');
  await page.goto('/notificacoes');
  await expect(page.getByText('Tarefa atribuída a você').first()).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(TASK) }).first()).toBeVisible();
});

test('6 e 7. colaboradora atualiza o checklist e comenta (Markdown seguro)', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  await page.goto(taskUrl);
  await page.getByRole('button', { name: 'Concluir item' }).first().click();
  await expect(page.getByText('Item concluído.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Concluído por Ana Ribeiro/)).toBeVisible();
  await page.getByLabel('Novo comentário').fill('Cliente aprovou. **Pode seguir** e <script>alert(1)</script>');
  await page.getByRole('button', { name: 'Publicar comentário' }).click();
  await expect(page.getByText('Comentário publicado.').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('strong', { hasText: 'Pode seguir' })).toBeVisible();
  await expect(page.getByText('<script>alert(1)</script>')).toBeVisible(); // HTML aparece como TEXTO, nunca é executado
  expect(await page.locator('script', { hasText: 'alert(1)' }).count()).toBe(0);
});

test('8 e 9. colaboradora move a tarefa entre etapas pelo menu (sem arrastar) e conclui', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  await page.goto(projectUrl);
  const card = page.locator('li[data-card-id]', { hasText: TASK });
  await card.locator('summary', { hasText: 'Mover…' }).click();
  await card.getByLabel('Etapa de destino').selectOption({ label: 'Em andamento' });
  await card.getByRole('button', { name: 'Mover tarefa' }).click();
  await expect(page.getByText('Tarefa movida.').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('section[data-column-id]', { hasText: 'Em andamento' }).locator('li[data-card-id]', { hasText: TASK })).toBeVisible();
  // pelo detalhe da tarefa: concluir
  await page.goto(taskUrl);
  await page.locator('summary', { hasText: 'Mover para outra etapa' }).click();
  await page.getByLabel('Etapa de destino').selectOption({ label: 'Concluído (Concluído)' });
  await page.getByRole('button', { name: 'Mover tarefa' }).click();
  await expect(page.getByText('Tarefa concluída.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Concluída em').first()).toBeVisible();
  await expect(page.getByText(/Tarefa concluída/).first()).toBeVisible(); // evento no histórico
});

test('10. o painel reflete os dados reais (concluídas no período, projeto sem atraso) e a lista exporta CSV seguro', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(`${projectUrl}/visao-geral`);
  await expect(page.getByText(/base temporal: fuso America\/Sao_Paulo/)).toBeVisible();
  expect(await kpi(page, 'Concluídas no período')).toBe(1);
  expect(await kpi(page, 'Tarefas abertas')).toBe(0);
  expect(await kpi(page, 'Atrasadas')).toBe(0); // concluída não é atrasada
  await expect(page.getByRole('row', { name: new RegExp(PROJECT) }).first()).toContainText('100%');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel');
  await expect(page.getByText('Atrasadas', { exact: true }).first()).toBeVisible();
  const csv = await page.request.get(`/api/exportar/tarefas?project=${projectUrl.split('/').pop()}`);
  expect(csv.status()).toBe(200);
  const body = (await csv.body()).toString('utf8');
  expect(body.startsWith('﻿Tarefa;Título;Projeto')).toBe(true);
  expect(body).toContain(TASK);
});

test('11. gestor conclui o projeto (sem tarefas abertas), que vira somente consulta, e o reabre com motivo', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(`${projectUrl}/configuracoes`);
  await page.getByLabel(/Novo status/).selectOption('completed');
  await page.getByRole('button', { name: 'Alterar status' }).click();
  await expect(page.getByText('Projeto concluído e somente para consulta.').first()).toBeVisible();
  await page.goto(projectUrl);
  await expect(page.getByText(/Projeto concluído: somente para consulta/).first()).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Nova tarefa' })).toHaveCount(0);
  await page.goto(`${projectUrl}/configuracoes`);
  const status = page.locator('form', { has: page.getByRole('button', { name: 'Alterar status' }) });
  await status.getByLabel(/Novo status/).selectOption('active');
  await status.getByRole('button', { name: 'Alterar status' }).click();
  await expect(page.getByText(/Informe o motivo/).first()).toBeVisible(); // reabrir exige motivo
  await status.getByLabel(/Motivo/).fill('Cliente pediu um ajuste final');
  await status.getByLabel(/Novo status/).selectOption('active');
  await status.getByRole('button', { name: 'Alterar status' }).click();
  await expect(page.getByText('Projeto ativo.').first()).toBeVisible();
  await page.goto(`${projectUrl}/atividade`);
  await expect(page.getByText(/Projeto reaberto/).first()).toBeVisible();
});

test('12. leitor continua sem permissão de alterar: vê o projeto e as tarefas, sem ações', async ({ page }) => {
  await loginAs(page, DEMO.leitor);
  await page.goto(projectUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROJECT);
  await expect(page.locator('summary', { hasText: 'Nova tarefa' })).toHaveCount(0);
  await expect(page.locator('summary', { hasText: 'Mover…' })).toHaveCount(0);
  await page.goto(taskUrl);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TASK);
  await expect(page.getByText(/acesso de consulta/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar comentário' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mover tarefa' })).toHaveCount(0);
  await page.goto('/minhas-tarefas');
  expect((await page.goto('/minhas-tarefas'))!.status()).toBe(404); // leitor não recebe tarefas
});
