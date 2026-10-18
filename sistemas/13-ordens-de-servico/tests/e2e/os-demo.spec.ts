// Passeio pela demonstração («Assistência Horizonte»): ordens em todos os estados, orçamento pendente, retrabalho, agenda sobreposta e painel com números reais.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, expectNoServerError, loginAs } from './os-helpers';

test.describe.configure({ mode: 'serial' });

async function openByNumber(page: Page, n: string) {
  await page.goto(`/ordens?q=${n}`);
  await page.getByRole('row', { name: new RegExp(n) }).getByRole('link', { name: n }).click();
  await page.waitForURL(/\/ordens\/[0-9a-f-]{36}/);
}

test('painel da gestão: situação atual, período, definições e «Sem dados» honesto', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel');
  for (const k of ['Backlog', 'Abertas', 'Agendadas', 'Em execução', 'Pausadas', 'Concluídas aguardando aceite', 'Não atribuídas', 'Atrasadas (previsão)', 'Encerradas no período', 'Canceladas no período', 'Retrabalho (reaberturas)']) {
    await expect(page.getByText(k, { exact: true }).first(), k).toBeVisible();
  }
  await expect(page.getByText('Atraso da PREVISÃO').first()).toBeVisible(); // definição visível, não só tooltip
  await expect(page.getByText(/Tempo corrido entre a abertura e a conclusão/).first()).toBeVisible();
  await expect(page.getByText('não é receita recebida nem faturamento').first()).toBeVisible();
  await expect(page.getByText(/Período: .* base temporal: fuso America\/Sao_Paulo/)).toBeVisible();
  // período no passado: sem ordens abertas/encerradas no período, mas o backlog segue sendo a foto do momento
  await page.goto('/dashboard?from=2020-01-01&to=2020-01-31');
  await expect(page.getByText('Sem dados').first()).toBeVisible();
  await expectNoServerError(page, 'painel');
  // período inválido não derruba a página
  await page.goto('/dashboard?from=2020-01-01&to=2023-01-31');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel');
});

test('lista e quadro por status, filtros e busca por número', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/ordens');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ordens de serviço');
  await expect(page.getByRole('row', { name: /OS-00001/ })).toBeVisible();
  await page.goto('/ordens?status=paused');
  await expect(page.getByRole('row', { name: /OS-00007/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /OS-00001/ })).toHaveCount(0);
  await page.goto('/ordens?late=1');
  await expect(page.getByRole('row', { name: /OS-00010/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /OS-00010/ }).getByText('Atrasada')).toBeVisible();
  await page.goto('/ordens?tech=none&status=backlog');
  await expect(page.getByRole('row', { name: /OS-00011/ })).toBeVisible();
  await page.goto('/ordens?q=OS-00005');
  await expect(page.getByRole('row')).toHaveCount(2); // cabeçalho + 1
  await page.goto('/ordens?view=board');
  for (const col of ['Abertas', 'Agendadas', 'Em execução', 'Pausadas', 'Concluídas']) await expect(page.getByRole('heading', { name: new RegExp(`^${col}`) }).first(), col).toBeVisible();
  await expect(page.getByRole('link', { name: /OS-00007/ })).toBeVisible();
  await expectNoServerError(page, 'quadro');
});

test('ordem pausada com nova versão de orçamento pendente: retomada bloqueada e histórico de versões', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await openByNumber(page, 'OS-00007');
  await expect(page.getByText('Pausada', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/versão de orçamento publicada aguardando a decisão do cliente/i).first()).toBeVisible();
  await page.goto(page.url().split('?')[0] + '?tab=orcamento');
  await expect(page.getByText('Versão 1 — Aprovado')).toBeVisible();
  await expect(page.getByText('Versão 2 — Publicado (aguardando decisão)')).toBeVisible();
  await expect(page.getByText(/Pendente/).first()).toBeVisible();
  // a gestão registra a decisão manualmente: aparece COMO registro manual
  await page.getByText('Registrar a decisão do cliente manualmente').click();
  await page.getByLabel('Nome de quem decidiu').fill('João Pereira');
  await page.getByLabel('Justificativa do registro manual').fill('Cliente aprovou por telefone na presença da gestora.');
  await page.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect(page.getByText(/Decisão registrada manualmente pela equipe/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(/registro MANUAL da equipe/).first()).toBeVisible();
  await expect(page.getByText(/Registro manual pela equipe \(não é uma ação autenticada do cliente\)/).first()).toBeVisible();
  // agora a retomada é permitida
  await page.goto(page.url().split('?')[0]!);
  await page.getByRole('button', { name: 'Retomar execução' }).first().click();
  await expect(page.getByText('Execução retomada.').first()).toBeVisible();
});

test('retrabalho: conclusão contestada e refeita preserva as duas versões e os aceites', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await openByNumber(page, 'OS-00001');
  await expect(page.getByText('Encerrada', { exact: true }).first()).toBeVisible();
  await page.goto(page.url().split('?')[0] + '?tab=execucao');
  await expect(page.getByText('Conclusão — versão 2 (atual)')).toBeVisible();
  await expect(page.getByText('Conclusão — versão 1')).toBeVisible();
  await expect(page.getByText('Contestada', { exact: true })).toBeVisible();
  await expect(page.getByText('Aceita', { exact: true })).toBeVisible();
  await expect(page.getByText(/Divergência de peças justificada/).first()).toBeVisible();
  await page.goto(page.url().split('?')[0] + '?tab=historico');
  for (const t of ['Reaberta para execução', 'Conclusão contestada', 'Conclusão aceita', 'Ordem encerrada']) await expect(page.getByText(t, { exact: true }).first(), t).toBeVisible();
  await page.goto(page.url().split('?')[0] + '?tab=orcamento');
  await expect(page.getByText('Custos internos', { exact: true })).toBeVisible();
  await expect(page.getByText('3 horas de mão de obra')).toBeVisible();
});

test('agenda semanal mostra a janela sobreposta como alerta; clientes, serviços, peças, modelos e relatórios carregam', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agenda de atendimentos');
  await expect(page.getByText('Sobreposição').first()).toBeVisible();
  for (const [path, h1] of [['/clientes', 'Clientes'], ['/equipamentos', 'Equipamentos'], ['/servicos', 'Catálogo de serviços'], ['/pecas', 'Catálogo de peças'], ['/modelos-checklist', 'Modelos de checklist'], ['/relatorios', 'Relatórios']] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1);
    await expectNoServerError(page, path);
  }
  await page.goto('/clientes');
  await page.getByRole('link', { name: 'Padaria Estrela Ltda' }).click();
  await expect(page.getByText('11.222.333/0001-81').or(page.locator('input[value="11.222.333/0001-81"]'))).toBeVisible(); // CPF/CNPJ só na ficha, só para a gestão
  await page.goto('/modelos-checklist');
  await page.getByRole('link', { name: 'Manutenção de ar-condicionado' }).click();
  await expect(page.getByLabel('Item 1: pergunta ou tarefa')).toHaveValue('Filtros limpos?');
});

test('técnico: vê só o que é dele, sem cadastros nem relatórios; proprietário configura a empresa', async ({ page }) => {
  await loginAs(page, DEMO.t2);
  await page.goto('/minhas-ordens');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Minhas ordens');
  await expect(page.getByRole('link', { name: 'Clientes' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Relatórios' })).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.getByText('Valor de orçamentos aprovados')).toHaveCount(0); // sem valores comerciais
  await loginAs(page, DEMO.dono);
  await page.goto('/configuracoes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configurações');
  await expect(page.getByRole('heading', { name: 'Equipe técnica' })).toBeVisible();
  await expect(page.getByText('Rafael Tavares')).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoServerError(page, 'auditoria');
});
