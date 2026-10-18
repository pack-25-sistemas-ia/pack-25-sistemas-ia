'use server';

import { z } from 'zod';
import { fail, succeed, type ActionState } from '@/lib/actions/result';
import { bust, dbMessage, formObject, guarded, parse, type SaveResult } from '../action-kit';
import { parseMoney } from '../money';
import { email, flag, optText, optUuid, phone, text, uuid, validDocument } from '../validation';

// Cadastros (clientes, contatos, endereços, equipamentos, serviços, peças, modelos de checklist). Só a gestão grava.
// Cada ação valida a entrada aqui, chama a função os_* (que valida de novo e confere a empresa) e devolve mensagem útil sem detalhes técnicos.
const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const customerSchema = z.object({
  id: optUuid, name: text(2, 160, 'Nome ou razão social'), kind: z.enum(['person', 'company'], { message: 'Escolha o tipo de cliente.' }),
  email, phone, document: z.string().trim().max(30, 'Documento longo demais.').optional(), internal_notes: optText(2000, 'Observações internas'), active: flag,
});
export async function saveCustomer(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(customerSchema, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!p.ok) return p.state;
  const d = p.data;
  const doc = validDocument(d.document ?? '');
  if (doc === null) return fail('CPF ou CNPJ inválido.', { document: ['CPF ou CNPJ inválido (confira os dígitos).'] }, values);
  return guarded('manager', 'saveCustomer', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_save_customer', { p_org: org, p_id: d.id ?? null, p: strip({ name: d.name, kind: d.kind, email: d.email, phone: d.phone, document: doc, internal_notes: d.internal_notes, active: d.active }) });
    if (error) return fail(dbMessage(error, 'Já existe um cliente com este CPF/CNPJ.'), undefined, values);
    bust('/clientes', '/ordens/nova');
    return { ...succeed(d.id ? 'Cliente salvo.' : 'Cliente cadastrado.'), id: data as string, redirectTo: d.id ? undefined : `/clientes/${data as string}` };
  });
}

const contactSchema = z.object({ customer_id: uuid(), id: optUuid, name: text(2, 120, 'Nome do contato'), role_label: optText(60, 'Função'), phone, email, is_primary: flag, active: flag });
export async function saveContact(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(contactSchema, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('manager', 'saveContact', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_save_contact', { p_org: org, p_customer: d.customer_id, p_id: d.id ?? null, p: strip({ name: d.name, role_label: d.role_label, phone: d.phone, email: d.email, is_primary: d.is_primary, active: d.active }) });
    if (error) return fail(dbMessage(error), undefined, values);
    bust(`/clientes/${d.customer_id}`);
    return succeed(d.id ? 'Contato salvo.' : 'Contato adicionado.');
  });
}

const addressSchema = z.object({
  customer_id: uuid(), id: optUuid, label: text(2, 60, 'Identificação'), street: text(2, 160, 'Logradouro'), number: optText(20, 'Número'), complement: optText(80, 'Complemento'), district: optText(80, 'Bairro'),
  city: text(2, 80, 'Cidade'), state: z.string().trim().length(2, 'UF: use 2 letras (ex.: SP).').regex(/^[A-Za-z]{2}$/, 'UF: use 2 letras (ex.: SP).'), postal_code: optText(12, 'CEP'), reference: optText(200, 'Referência'), is_default: flag, active: flag,
});
export async function saveAddress(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(addressSchema, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!p.ok) return p.state;
  const d = p.data;
  const cep = (d.postal_code ?? '').replace(/\D/g, '');
  if (cep && cep.length !== 8) return fail('CEP inválido.', { postal_code: ['CEP precisa ter 8 dígitos.'] }, values);
  return guarded('manager', 'saveAddress', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_save_address', { p_org: org, p_customer: d.customer_id, p_id: d.id ?? null, p: strip({ label: d.label, street: d.street, number: d.number, complement: d.complement, district: d.district, city: d.city, state: d.state.toUpperCase(), postal_code: cep || undefined, reference: d.reference, is_default: d.is_default, active: d.active }) });
    if (error) return fail(dbMessage(error), undefined, values);
    bust(`/clientes/${d.customer_id}`, '/ordens/nova');
    return succeed(d.id ? 'Endereço salvo.' : 'Endereço adicionado.');
  });
}

const equipmentSchema = z.object({ customer_id: uuid(), id: optUuid, kind: text(2, 80, 'Tipo do equipamento'), brand: optText(80, 'Marca'), model: optText(80, 'Modelo'), serial_number: optText(80, 'Número de série'), notes: optText(1000, 'Observações'), active: flag });
export async function saveEquipment(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(equipmentSchema, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!p.ok) return p.state;
  const d = p.data;
  return guarded('manager', 'saveEquipment', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_save_equipment', { p_org: org, p_customer: d.customer_id, p_id: d.id ?? null, p: strip({ kind: d.kind, brand: d.brand, model: d.model, serial_number: d.serial_number, notes: d.notes, active: d.active }) });
    if (error) return fail(dbMessage(error), undefined, values);
    bust(`/clientes/${d.customer_id}`, '/equipamentos', '/ordens/nova');
    return succeed(d.id ? 'Equipamento salvo.' : 'Equipamento cadastrado.');
  });
}

const serviceSchema = z.object({ id: optUuid, name: text(2, 120, 'Nome do serviço'), description: optText(500, 'Descrição'), unit: text(1, 16, 'Unidade'), price: z.string().trim(), active: flag });
export async function saveService(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(serviceSchema, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!p.ok) return p.state;
  const d = p.data;
  const cents = parseMoney(d.price);
  if (cents === null) return fail('Preço de referência inválido.', { price: ['Informe um valor válido (ex.: 150,00).'] }, values);
  return guarded('manager', 'saveService', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_save_service', { p_org: org, p_id: d.id ?? null, p: strip({ name: d.name, description: d.description, unit: d.unit, reference_price_cents: Number(cents), active: d.active }) });
    if (error) return fail(dbMessage(error, 'Já existe um serviço com este nome.'), undefined, values);
    bust('/servicos', '/ordens');
    return succeed(d.id ? 'Serviço salvo.' : 'Serviço cadastrado.');
  });
}

const partSchema = z.object({ id: optUuid, code: text(1, 40, 'Código'), name: text(2, 120, 'Nome da peça'), unit: text(1, 16, 'Unidade'), price: z.string().trim(), active: flag });
export async function savePart(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const p = parse(partSchema, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!p.ok) return p.state;
  const d = p.data;
  const cents = parseMoney(d.price);
  if (cents === null) return fail('Preço de referência inválido.', { price: ['Informe um valor válido (ex.: 35,00).'] }, values);
  return guarded('manager', 'savePart', async ({ ctx, org }) => {
    const { error } = await ctx.supabase.rpc('os_save_part', { p_org: org, p_id: d.id ?? null, p: strip({ code: d.code, name: d.name, unit: d.unit, reference_price_cents: Number(cents), active: d.active }) });
    if (error) return fail(dbMessage(error, 'Já existe uma peça com este código.'), undefined, values);
    bust('/pecas');
    return succeed(d.id ? 'Peça salva.' : 'Peça cadastrada.');
  });
}

// ---- modelos de checklist: linhas fixas no formulário (funciona sem JavaScript); linhas em branco são ignoradas
const templateHead = z.object({ id: optUuid, name: text(2, 100, 'Nome do modelo'), description: optText(300, 'Descrição'), active: flag, rows: z.coerce.number().int().min(1).max(100) });
export async function saveTemplate(_prev: ActionState, fd: FormData): Promise<SaveResult> {
  const values = formObject(fd);
  const h = parse(templateHead, { ...values, active: values.active ?? (values.id ? '' : 'on') }, values);
  if (!h.ok) return h.state;
  const items: Array<Record<string, unknown>> = [];
  const errors: Record<string, string[]> = {};
  for (let i = 1; i <= h.data.rows; i++) {
    const label = (values[`i${i}_label`] ?? '').trim();
    if (!label) continue;
    const kind = values[`i${i}_kind`] ?? 'boolean';
    if (!['boolean', 'text', 'number', 'select'].includes(kind)) { errors[`i${i}_kind`] = ['Tipo inválido.']; continue; }
    if (label.length < 2 || label.length > 200) { errors[`i${i}_label`] = ['O texto do item deve ter entre 2 e 200 caracteres.']; continue; }
    const options = kind === 'select' ? (values[`i${i}_options`] ?? '').split(/[;\n]/).map((s) => s.trim()).filter(Boolean) : undefined;
    if (kind === 'select' && (!options || options.length < 2 || options.length > 20 || options.some((o) => o.length > 60))) { errors[`i${i}_options`] = ['Informe de 2 a 20 opções separadas por ponto e vírgula (até 60 caracteres cada).']; continue; }
    const rule = values[`i${i}_note_rule`] ?? 'never';
    if (!['never', 'on_negative', 'always'].includes(rule)) { errors[`i${i}_note_rule`] = ['Regra inválida.']; continue; }
    items.push(strip({ label, kind, options, required: !!values[`i${i}_required`], allow_na: !!values[`i${i}_allow_na`], require_photo: !!values[`i${i}_require_photo`], note_rule: rule }));
  }
  if (Object.keys(errors).length) return fail('Revise os itens destacados.', errors, values);
  if (items.length === 0) return fail('Preencha ao menos um item do checklist.', undefined, values);
  return guarded('manager', 'saveTemplate', async ({ ctx, org }) => {
    const { data, error } = await ctx.supabase.rpc('os_save_template', { p_org: org, p_id: h.data.id ?? null, p_name: h.data.name, p_description: h.data.description ?? null, p_active: h.data.active, p_items: items });
    if (error) return fail(dbMessage(error, 'Já existe um modelo com este nome.'), undefined, values);
    bust('/modelos-checklist', '/ordens/nova');
    return { ...succeed(h.data.id ? 'Modelo salvo. Ordens que já usaram o modelo não mudam.' : 'Modelo criado.'), id: data as string, redirectTo: h.data.id ? undefined : '/modelos-checklist' };
  });
}
