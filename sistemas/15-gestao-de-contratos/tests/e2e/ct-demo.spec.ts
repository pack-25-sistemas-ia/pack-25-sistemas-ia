// Passeio pela demonstração («Consultoria Meridiano»): contratos em todas as situações, painel com números reais e visões por perfil.
import { expect, test, type Page } from '@playwright/test';
import { DEMO, expectNoServerError, loginAs } from './ct-helpers';

test.describe.configure({ mode: 'serial' });
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kpi = async (page: Page, label: string): Promise<string> => (await page.locator('p', { hasText: new RegExp(`^${esc(label)}$`) }).first().locator('xpath=following-sibling::p[1]').innerText()).trim();

test('painel da gestão: números do cenário, definições visíveis e «Sem dados» honesto', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Painel de contratos');
  expect(await kpi(page, 'Contratos ativos')).toBe('6');
  expect(await kpi(page, 'Vigentes hoje')).toBe('4');
  expect(await kpi(page, 'Fim em até 30 dias')).toBe('1');
  expect(await kpi(page, 'Fim em até 60 / 90 dias')).toBe('2 / 2');
  expect(await kpi(page, 'Fim de vigência atingido')).toBe('1');
  expect(await kpi(page, 'Avisos próximos (30 dias)')).toBe('1');
  expect(await kpi(page, 'Prazos de aviso ultrapassados')).toBe('1');
  expect(await kpi(page, 'Sem responsável')).toBe('2');
  expect(await kpi(page, 'Obrigações pendentes')).toBe('3');
  expect(await kpi(page, 'Obrigações atrasadas')).toBe('1');
  expect(await kpi(page, 'Reajustes previstos (60 dias)')).toBe('1');
  expect(await kpi(page, 'Renovações (12 meses)')).toBe('1');
  await expect(page.getByText(/o sistema só sinaliza; não renova nem rescinde sozinho/).first()).toBeVisible(); // definição visível, não só tooltip
  await expect(page.getByText(/Mensal e anual NÃO são somados/)).toBeVisible();
  await expect(page.getByText(/2 contrato\(s\) ativo\(s\) sem valor cadastrado/)).toBeVisible(); // desconhecido nunca vira zero
  await expect(page.getByText('R$ 7.354,00 em 3 contrato(s)')).toBeVisible(); // mensais: 3.500 + 1.254 + 2.600
  await expect(page.getByText('R$ 18.000,00 em 1 contrato(s)')).toBeVisible(); // anual
  await expectNoServerError(page, 'painel');
});

test('lista de contratos: todas as situações aparecem com texto e cor, e os filtros funcionam', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/contratos');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contratos');
  for (const t of ['Manutenção e suporte de TI', 'Fornecimento contínuo de material de escritório', 'Licenciamento de software de gestão', 'Consultoria em processos', 'Limpeza e conservação predial', 'Serviço de impressão gerenciada', 'Locação de equipamentos de som', 'Contrato de patrocínio (em elaboração)']) {
    await expect(page.getByRole('link', { name: t }).first()).toBeVisible();
  }
  const row = (n: string) => page.getByRole('row', { name: new RegExp(n) });
  await expect(row('Serviço de impressão')).toContainText('Rescindido');
  await expect(row('Licenciamento de software')).toContainText('A iniciar');
  await expect(row('Locação de equipamentos')).toContainText('Fim de vigência atingido');
  await expect(row('Consultoria em processos')).toContainText('Próximo do fim');
  await expect(row('Fornecimento contínuo')).toContainText('Prazo indeterminado');
  await expect(row('patrocínio')).toContainText('Rascunho');
  await page.goto('/contratos?term=ending30');
  await expect(page.getByRole('row')).toHaveCount(2); // cabeçalho + Consultoria em processos
  await page.goto('/contratos?q=impress');
  await expect(page.getByRole('link', { name: 'Serviço de impressão gerenciada' })).toBeVisible();
  await page.goto('/contratos?q=xyznada');
  await expect(page.getByText('Nenhum contrato encontrado').first()).toBeVisible();
});

test('contrato com reajuste simulado e contrato com reajuste já aplicado', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/contratos');
  await page.getByRole('link', { name: 'Manutenção e suporte de TI' }).first().click();
  await page.waitForURL(/\/contratos\/[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Valores e reajustes' }).click();
  await expect(page.getByText('Simulação em aberto — o contrato ainda NÃO foi alterado')).toBeVisible();
  await expect(page.getByText('R$ 3.682,00').first()).toBeVisible(); // 350000 × 1,052
  await expect(page.getByText('R$ 3.500,00').first()).toBeVisible(); // valor vigente intacto
  await page.goto('/contratos');
  await page.getByRole('link', { name: 'Consultoria em processos' }).first().click();
  await page.getByRole('link', { name: 'Valores e reajustes' }).click();
  await expect(page.getByRole('row', { name: /Reajuste/ }).first()).toContainText('R$ 1.254,00'); // 1.200 × 1,045
  await expect(page.getByRole('row', { name: /Valor inicial/ })).toContainText('R$ 1.200,00');
  await page.getByRole('link', { name: 'Histórico' }).click();
  await expect(page.getByText(/Reajuste aplicado: R\$ 1\.200,00 → R\$ 1\.254,00/)).toBeVisible();
  await page.getByRole('link', { name: 'Prazos e obrigações' }).click();
  await expect(page.getByRole('row', { name: /Receber o relatório final/ })).toContainText('Concluída');
});

test('contrato renovado e rescindido preservam o histórico', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/contratos');
  await page.getByRole('link', { name: 'Limpeza e conservação predial' }).first().click();
  await page.getByRole('link', { name: 'Aditivos e renovações' }).click();
  await expect(page.getByRole('row', { name: /Renovação/ })).toContainText('Renovação por 12 meses');
  await page.getByRole('link', { name: 'Documentos' }).click();
  await expect(page.getByText('Termo de renovação').first()).toBeVisible();
  await page.goto('/contratos');
  await page.getByRole('link', { name: 'Serviço de impressão gerenciada' }).first().click();
  await expect(page.getByText('Rescindido').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reabrir contrato' }).or(page.locator('summary', { hasText: 'Reabrir contrato' })).first()).toBeVisible();
  await expect(page.locator('summary', { hasText: 'Editar dados' })).toHaveCount(0); // rescindido é somente consulta
});

test('colaboradores enxergam só os contratos vinculados; o CPF/CNPJ nunca aparece para eles', async ({ page }) => {
  await loginAs(page, DEMO.ana);
  await page.goto('/contratos');
  await expect(page.getByRole('row')).toHaveCount(3); // cabeçalho + Manutenção + Consultoria
  await expect(page.getByRole('link', { name: 'Fornecimento contínuo de material de escritório' })).toHaveCount(0);
  await page.goto('/partes');
  await expect(page.getByRole('columnheader', { name: 'CPF/CNPJ' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('11.222.333/0001-81');
  await loginAs(page, DEMO.bruno);
  await page.goto('/contratos');
  await expect(page.getByText('Nenhum contrato encontrado').first()).toBeVisible();
  await loginAs(page, DEMO.leitor);
  await page.goto('/contratos');
  await expect(page.getByRole('row')).toHaveCount(2); // cabeçalho + Manutenção (como leitor)
  await page.getByRole('link', { name: 'Manutenção e suporte de TI' }).first().click();
  await expect(page.locator('summary', { hasText: 'Editar dados' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ativar contrato' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Documentos' }).click();
  await expect(page.getByText('Adicionar documento')).toHaveCount(0);
});
