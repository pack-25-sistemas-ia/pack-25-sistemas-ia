// Fluxo principal das Ordens de Serviço contra o Supabase real (app compilado): os 12 passos do prompt mestre (o 13º, técnico no celular, está em os-responsive.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import { DEMO, loginAs, tag } from './os-helpers';

test.describe.configure({ mode: 'serial' });
const T = tag();
const CUSTOMER = `Cliente E2E ${T}`;
const SUBJECT = `E2E Ar-condicionado barulhento ${T}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==', 'base64');
let orderUrl = '';
let orderId = '';
let publicLink = '';

/** CPF válido ALEATÓRIO por execução (o documento é único por empresa: reexecutar o teste não pode colidir). */
function randomCpf(): { raw: string; masked: string; wrong: string } {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (d.every((x) => x === d[0])) d[8] = (d[8]! + 1) % 10;
  const dv = (n: number[]) => { const s = n.reduce((a, x, i) => a + x * (n.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  const a = dv(d); const b = dv([...d, a]);
  const raw = [...d, a, b].join('');
  const fmt = (r: string) => r.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  const wrongRaw = raw.slice(0, 10) + String((b + 1) % 10);
  return { raw, masked: fmt(raw), wrong: fmt(wrongRaw) };
}
const CPF = randomCpf();

const kpi = async (page: Page, label: string): Promise<string> => (await page.locator('p', { hasText: new RegExp(`^${label}$`) }).first().locator('xpath=following-sibling::p[1]').innerText()).trim();

test('1. gestão cadastra o cliente (CPF validado) com endereço e equipamento', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/clientes');
  await page.getByText('Cadastrar novo cliente').click();
  await page.getByLabel('Nome ou razão social').first().fill(CUSTOMER);
  await page.getByLabel('CPF ou CNPJ (opcional)').fill(CPF.wrong); // dígito verificador errado
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await expect(page.getByText('CPF ou CNPJ inválido (confira os dígitos).')).toBeVisible();
  await page.getByLabel('CPF ou CNPJ (opcional)').fill(CPF.masked);
  await page.getByLabel('Telefone').first().fill('(11) 98888-0001');
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  await page.waitForURL(/\/clientes\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CUSTOMER);
  // endereço e equipamento
  await page.locator('summary', { hasText: 'Adicionar endereço' }).click();
  const addr = page.locator('details', { hasText: 'Adicionar endereço' }).first();
  await addr.getByLabel('Identificação').fill('Casa');
  await addr.getByLabel('Logradouro').fill('Rua dos Testes');
  await addr.getByLabel('Número').fill('42');
  await addr.getByLabel('Cidade').fill('São Paulo');
  await addr.getByLabel('UF').fill('sp');
  await addr.getByRole('button', { name: 'Adicionar endereço' }).click();
  await expect(page.getByText('Endereço adicionado.').first()).toBeVisible();
  await page.locator('summary', { hasText: 'Adicionar equipamento' }).click();
  const eq = page.locator('details', { hasText: 'Adicionar equipamento' }).first();
  await eq.getByLabel('Tipo', { exact: true }).fill('Ar-condicionado split');
  await eq.getByLabel('Marca').fill('Brisa');
  await eq.getByLabel('Modelo').fill('BR-12');
  await eq.getByRole('button', { name: 'Adicionar equipamento' }).click();
  await expect(page.getByText('Equipamento cadastrado.').first()).toBeVisible();
});

test('2. gestão abre a ordem (cliente → dados), com checklist e número gerado', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(`/ordens/nova?q=${encodeURIComponent(CUSTOMER)}`);
  await page.getByRole('link', { name: new RegExp(CUSTOMER) }).click();
  await page.waitForURL(/\/ordens\/nova\?customer=/);
  await page.getByLabel('Assunto').fill(SUBJECT);
  await page.getByLabel('Prioridade').selectOption({ label: 'Alta' });
  await page.getByLabel('Descrição da solicitação').fill('Faz barulho metálico ao ligar e pinga água no piso.');
  await page.getByLabel('Equipamento (opcional)').selectOption({ index: 1 });
  await page.getByLabel('Reparo de eletrodoméstico').check();
  await page.getByRole('button', { name: 'Abrir ordem' }).click();
  await page.waitForURL(/\/ordens\/[0-9a-f-]{36}$/);
  orderUrl = page.url();
  orderId = /\/ordens\/([0-9a-f-]{36})/.exec(orderUrl)![1]!;
  await expect(page.getByRole('heading', { level: 1 })).toContainText(SUBJECT);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/OS-\d{5}/);
  await expect(page.getByText('Aberta', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Exige orçamento aprovado').first()).toBeVisible();
  await expect(page.getByText('Rua dos Testes, 42').first()).toBeVisible(); // snapshot do endereço
});

test('3. sem orçamento aprovado a execução não pode começar; gestão cria e PUBLICA o orçamento (totais recalculados no servidor)', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(`${orderUrl}?tab=orcamento`);
  await page.getByRole('button', { name: 'Criar orçamento' }).click();
  await page.waitForURL(/tab=orcamento/);
  await page.getByLabel('Item 1: catálogo').selectOption({ label: 'Serviço — Diagnóstico técnico' });
  await page.getByLabel('Item 1: quantidade').fill('1');
  await page.getByLabel('Item 2: descrição').fill('Peça especial importada');
  await page.getByLabel('Item 2: quantidade').fill('2');
  await page.getByLabel('Item 2: preço unitário').fill('25,50');
  await page.getByLabel('Desconto fixo (R$)').fill('5');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText(/Rascunho salvo\. Total recalculado pelo sistema: R\$ 136,00/)).toBeVisible();
  await page.reload();
  await expect(page.getByText('Total: R$ 136,00').or(page.getByText(/Total:\s*R\$\s*136,00/))).toBeVisible();
  // desconto maior que o subtotal é recusado
  await page.getByLabel('Desconto fixo (R$)').fill('999');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByText(/desconto.*não pode ser maior que o subtotal/i).first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Publicar orçamento' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Orçamento publicado.').first()).toBeVisible();
  await expect(page.getByText('Publicado (aguardando decisão)').first()).toBeVisible();
  // a execução continua bloqueada enquanto o cliente não decidir
  await page.goto(`${orderUrl}`);
  await expect(page.getByText(/aguardando a decisão do cliente/i).first()).toBeVisible();
});

test('4. gestão gera o link; o CLIENTE vê só o permitido e aprova a versão vigente', async ({ page, browser }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Gerar link de acompanhamento' }).click();
  publicLink = await page.locator('#link-gerado').inputValue();
  expect(publicLink).toMatch(/\/acompanhar\/[A-Za-z0-9_-]{43}$/);
  // nota interna e custo existem, mas NUNCA aparecem para o cliente
  await page.goto(`${orderUrl}?tab=evidencias`);
  await page.getByLabel('Texto').fill('NOTA-INTERNA-E2E: cliente costuma pedir desconto');
  await page.getByLabel('Quem vê').selectOption('internal');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Nota interna registrada.').first()).toBeVisible();
  await page.reload(); // estado limpo (o React reinicia formulários depois da ação)
  await page.getByLabel('Quem vê').selectOption('customer');
  await page.getByLabel('Texto').fill('Visita técnica confirmada para o horário combinado.');
  await page.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Atualização registrada e compartilhada com o cliente.').first()).toBeVisible();
  await page.goto(`${orderUrl}?tab=orcamento`);
  await page.getByText('Registrar custo interno').click();
  await page.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Mão de obra' });
  await page.getByLabel('Descrição').last().fill('CUSTO-INTERNO-E2E');
  await page.getByLabel('Valor (R$)').fill('77,00');
  await page.getByRole('button', { name: 'Registrar custo' }).click();
  await expect(page.getByText(/Custo interno registrado/).first()).toBeVisible();

  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  const res = await p.goto(publicLink);
  expect(res!.status()).toBe(200);
  expect(res!.headers()['referrer-policy']).toBe('no-referrer');
  expect(res!.headers()['x-robots-tag']).toContain('noindex');
  expect(res!.headers()['cache-control']).toContain('no-store');
  await expect(p.getByRole('heading', { level: 1 })).toContainText('Acompanhamento');
  await expect(p.getByText(SUBJECT).first()).toBeVisible();
  await expect(p.getByText('R$ 136,00').first()).toBeVisible();
  await expect(p.getByText('Visita técnica confirmada para o horário combinado.')).toBeVisible();
  const html = await p.content();
  expect(html).not.toContain('NOTA-INTERNA-E2E');
  expect(html).not.toContain('CUSTO-INTERNO-E2E');
  expect(html).not.toContain(CPF.masked);
  expect(html).not.toContain(CPF.raw);
  // aprovar exige nome e confirmação
  await p.getByRole('button', { name: 'Aprovar orçamento' }).click();
  await expect(p.getByText(/Seu nome: mínimo 2 caracteres/).first()).toBeVisible();
  await p.getByLabel('Seu nome completo').fill('Cliente Aprovador E2E');
  await p.getByLabel(/Li o orçamento/).check();
  await p.getByRole('button', { name: 'Aprovar orçamento' }).click();
  await expect(p.getByText('Orçamento aprovado. Obrigado!')).toBeVisible();
  await p.reload();
  await expect(p.getByText(/Aprovado.*por Cliente Aprovador E2E/).first()).toBeVisible();
  await ctx.close();
  // a gestão vê a decisão como ação do cliente pelo link
  await page.goto(`${orderUrl}?tab=orcamento`);
  await expect(page.getByText('pelo link do cliente').first()).toBeVisible();
});

test('5. gestão agenda e atribui o técnico (janela válida; sobreposição é só alerta)', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(orderUrl);
  const card = page.locator('form', { has: page.locator('input[name="sched_date"]') }).first();
  await card.getByLabel('Técnico').selectOption({ label: 'Rafael Tavares' });
  await card.getByLabel('Data').fill(new Date().toISOString().slice(0, 10));
  await card.getByLabel('Início').fill('14:00');
  await card.getByLabel('Fim').fill('13:00');
  await card.getByRole('button', { name: 'Agendar' }).click();
  await expect(page.getByText('O fim precisa ser depois do início.').first()).toBeVisible();
  await card.getByLabel('Fim').fill('16:00');
  await card.getByRole('button', { name: 'Agendar' }).click();
  await expect(page.getByText(/Atendimento agendado\./).first()).toBeVisible();
  await expect(page.getByText('Agendada', { exact: true }).first()).toBeVisible();
  await expect(page.locator('header').getByText(/Responsável: Rafael Tavares/)).toBeVisible();
});

test('6–7. técnico inicia a execução e responde o checklist (obrigatórios bloqueiam a conclusão)', async ({ page }) => {
  await loginAs(page, DEMO.t1);
  await page.goto('/minhas-ordens');
  await page.getByRole('row', { name: new RegExp(SUBJECT) }).getByRole('link').click();
  await page.waitForURL(orderUrl);
  await page.getByRole('button', { name: 'Iniciar execução' }).first().click();
  await expect(page.getByText('Execução iniciada.').first()).toBeVisible();
  await expect(page.getByText('Em execução', { exact: true }).first()).toBeVisible();
  await page.goto(`${orderUrl}?tab=execucao`);
  // tentar concluir sem responder: o servidor recusa
  await page.getByText('Concluir serviço', { exact: true }).first().click();
  await page.getByLabel('Resumo do serviço executado').fill('Tentativa de concluir sem checklist.');
  await page.getByRole('button', { name: 'Concluir serviço' }).last().click();
  await expect(page.getByText(/checklist incompleto/i).first()).toBeVisible();
  // responde os itens obrigatórios
  const items = page.locator('form', { has: page.locator('input[name="item"]') });
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(3);
  for (const label of ['Equipamento liga normalmente?', 'Teste de funcionamento por 30 minutos']) {
    const f = page.locator('form:has(input[name="item"])', { hasText: label }).first();
    await f.getByLabel('Sim').check();
    await f.getByRole('button', { name: 'Salvar resposta' }).click();
    await expect(f.getByText('Resposta registrada.')).toBeVisible();
  }
});

test('8. técnico registra peça (divergência do orçamento) e foto; conclusão exige justificativa', async ({ page }) => {
  await loginAs(page, DEMO.t1);
  await page.goto(`${orderUrl}?tab=execucao`);
  await page.getByText('Registrar peça utilizada').click();
  await page.getByLabel('Peça do catálogo').selectOption({ label: 'TER-01 — Termostato universal' });
  await page.getByLabel('Quantidade', { exact: true }).first().fill('2');
  await page.getByRole('button', { name: 'Registrar uso' }).click();
  await expect(page.getByText('Uso de peça registrado.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('acima do orçado').first()).toBeVisible();
  // estorno referenciado (corrige 1 unidade); a divergência continua (1 > 0)
  await page.getByText('Corrigir um registro (estorno ou ajuste)').click();
  await page.getByLabel('Registro a corrigir').selectOption({ index: 1 });
  await page.getByLabel('Quantidade', { exact: true }).last().fill('1');
  await page.getByLabel('Motivo', { exact: true }).fill('Uma unidade voltou para o veículo');
  await page.getByRole('button', { name: 'Registrar correção' }).click();
  await expect(page.getByText(/Estorno registrado/).first()).toBeVisible();
  // foto: tipo conferido pelos bytes (SVG disfarçado é recusado) e metadados removidos
  await page.goto(`${orderUrl}?tab=evidencias`);
  await page.getByLabel('Categoria', { exact: true }).first().selectOption({ label: 'Depois' });
  await page.locator('input[name="file"]').first().setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await page.getByRole('button', { name: 'Enviar arquivos' }).click();
  await expect(page.getByText(/tipo de arquivo não permitido/i).first()).toBeVisible();
  await page.locator('input[name="file"]').first().setInputFiles({ name: 'depois.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Enviar arquivos' }).click();
  await expect(page.getByText('1 arquivo(s) adicionado(s).').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('img', { name: 'depois.png' })).toBeVisible();
  // a imagem é entregue pelo nosso domínio, autenticada
  const r = await page.request.get(await page.getByRole('img', { name: 'depois.png' }).getAttribute('src') as string);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('image/png');
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
});

test('9. técnico conclui o serviço (divergência justificada) e a conclusão é congelada em versão', async ({ page }) => {
  await loginAs(page, DEMO.t1);
  await page.goto(`${orderUrl}?tab=execucao`);
  await page.getByText('Concluir serviço', { exact: true }).first().click();
  await page.getByLabel('Resumo do serviço executado').fill('Substituí o termostato com defeito e testei o equipamento por 30 minutos.');
  await page.getByRole('button', { name: 'Concluir serviço' }).last().click();
  await expect(page.getByText(/divergência relevante de peças/i).first()).toBeVisible(); // sem justificativa, recusa
  await page.getByLabel('Justificativa da divergência de peças').fill('O termostato não estava no orçamento: o defeito só apareceu no teste.');
  await page.getByRole('button', { name: 'Concluir serviço' }).last().click();
  await expect(page.getByText(/Serviço concluído \(versão 1 da conclusão\)/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Concluída', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Conclusão — versão 1 (atual)')).toBeVisible();
  // concluída não aceita mais edição pelo técnico
  await expect(page.getByRole('button', { name: 'Registrar uso' })).toHaveCount(0);
});

test('10. o CLIENTE aceita a conclusão pelo link', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  await p.goto(publicLink);
  await expect(p.getByText(/Serviço concluído — aguardando o seu aceite/)).toBeVisible();
  await expect(p.getByText('Substituí o termostato com defeito')).toBeVisible();
  await p.getByLabel('Seu nome completo').last().fill('Cliente Aceitante E2E');
  await p.getByLabel(/Entendo que esta resposta fica registrada/).check();
  await p.getByRole('button', { name: 'Aceitar a conclusão' }).click();
  await expect(p.getByText('Conclusão aceita. Obrigado!')).toBeVisible();
  await p.reload();
  await expect(p.getByText(/Conclusão aceita.*por Cliente Aceitante E2E/).first()).toBeVisible();
  await expect(p.getByRole('button', { name: 'Aceitar a conclusão' })).toHaveCount(0); // uma resposta por versão
  await ctx.close();
});

test('10b. foto interna é invisível ao cliente; ao compartilhar, o cliente a vê (token no cabeçalho do Storage, sem chave privilegiada)', async ({ page, browser }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto(`${orderUrl}?tab=evidencias`);
  const src = (await page.getByRole('img', { name: 'depois.png' }).getAttribute('src')) as string;
  const attId = /\/api\/arquivos\/([0-9a-f-]{36})/.exec(src)![1]!;
  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  expect((await p.request.get(`${publicLink}/arquivo/${attId}`)).status(), 'arquivo interno').toBe(404);
  await p.goto(publicLink);
  await expect(p.getByText('Fotos e documentos compartilhados')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compartilhar com o cliente' }).click();
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Arquivo compartilhado com o cliente.').first()).toBeVisible();
  const r = await p.request.get(`${publicLink}/arquivo/${attId}`);
  expect(r.status(), 'arquivo compartilhado').toBe(200);
  expect(r.headers()['content-type']).toBe('image/png');
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  // outro token (inventado) não alcança nada, nem com o id certo
  const fake = publicLink.replace(/[A-Za-z0-9_-]{43}$/, 'A'.repeat(43));
  expect((await p.request.get(`${fake}/arquivo/${attId}`)).status()).toBe(404);
  await p.goto(publicLink);
  await expect(p.getByRole('img', { name: 'depois.png' })).toBeVisible();
  await ctx.close();
});

test('11–12. gestão encerra; PDFs reais e painel refletem os dados', async ({ page }) => {
  await loginAs(page, DEMO.gestor);
  await page.goto('/dashboard');
  const before = Number(await kpi(page, 'Encerradas no período'));
  await page.goto(`${orderUrl}?tab=execucao`);
  await page.getByRole('button', { name: 'Encerrar ordem' }).first().click();
  await expect(page.getByText('Ordem encerrada.').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Encerrada', { exact: true }).first()).toBeVisible();
  // PDFs: orçamento, resumo e relatório de conclusão (conteúdo real, sem notas internas)
  for (const [kind, ref] of [['quote', 1], ['summary', 0], ['completion', 1]] as const) {
    const r = await page.request.get(`/api/pdf/${orderId}/${kind}/${ref}`);
    expect(r.status(), `PDF ${kind}`).toBe(200);
    expect(r.headers()['content-type']).toBe('application/pdf');
    const body = await r.body();
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(2000);
    expect(body.toString('latin1')).not.toContain('NOTA-INTERNA-E2E');
    expect(body.toString('latin1')).not.toContain('CUSTO-INTERNO-E2E');
  }
  // PDF público (pelo link) também é real
  const pub = await page.request.get(`${publicLink}/pdf/completion/1`);
  expect(pub.status()).toBe(200);
  expect((await pub.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // painel
  await page.goto('/dashboard');
  expect(Number(await kpi(page, 'Encerradas no período'))).toBe(before + 1);
  await expect(page.getByText(/Valor de orçamentos aprovados/).first()).toBeVisible();
  await expect(page.getByText('não é receita recebida nem faturamento').first()).toBeVisible();
  // histórico auditável
  await page.goto(`${orderUrl}?tab=historico`);
  for (const t of ['Ordem aberta', 'Orçamento publicado', 'Orçamento aprovado', 'Atendimento agendado', 'Execução iniciada', 'Serviço concluído', 'Conclusão aceita', 'Ordem encerrada']) {
    await expect(page.getByText(t, { exact: true }).first(), t).toBeVisible();
  }
  // depois de encerrada o link continua mostrando o estado final, mas não aceita novas decisões
});
