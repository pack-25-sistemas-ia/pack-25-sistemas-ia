import type { Metadata } from 'next';
import { Disclosure, FInput, FilterForm, TD, TH, TableShell } from '@/components/ct/bits';
import { ActionButton, CtForm, SelectF, TextF } from '@/components/ct/fields';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { saveCounterparty, setCounterpartyActive } from '@/lib/ct/actions/contracts';
import { listCounterparties } from '@/lib/ct/data';
import { pageCtx } from '@/lib/ct/page';
import { one, safeSearch, type SearchParams } from '@/lib/ct/query';

export const metadata: Metadata = { title: 'Partes' };
const TYPES = [{ value: 'company', label: 'Empresa (CNPJ)' }, { value: 'person', label: 'Pessoa física (CPF)' }];
const fmtDoc = (d: string | null | undefined) => (!d ? '' : d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`);

export default async function PartiesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const c = await pageCtx();
  const rows = await listCounterparties(c, safeSearch(one(sp.q)), c.isManager);
  return (
    <>
      <PageHeader title="Partes" description={c.isManager ? 'Clientes, fornecedores e demais partes. O CPF/CNPJ é dado pessoal: só a gestão o enxerga; nos contratos aparece mascarado.' : 'Partes dos contratos a que você tem acesso. O CPF/CNPJ fica restrito à gestão.'} />
      <FilterForm clear="/partes"><FInput name="q" label="Buscar por nome" sp={sp} /></FilterForm>
      <TableShell caption="Partes" empty={rows.length === 0} emptyText="Nenhuma parte encontrada.">
        <thead><tr><th className={TH}>Nome</th><th className={TH}>Tipo</th>{c.isManager ? <th className={TH}>CPF/CNPJ</th> : null}<th className={TH}>Contato</th><th className={TH}>Cadastro</th>{c.isManager ? <th className={TH} /> : null}</tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className={TD}>{p.name}</td><td className={TD}>{p.person_type === 'company' ? 'Empresa' : 'Pessoa física'}</td>
              {c.isManager ? <td className={TD + ' tabular-nums'}>{fmtDoc(p.document_number) || '—'}</td> : null}
              <td className={TD}>{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</td>
              <td className={TD}>{p.active ? 'Ativo' : <Badge tone="warning">Inativo</Badge>}</td>
              {c.isManager ? (
                <td className={TD}>
                  <details className="max-w-md"><summary className="cursor-pointer text-sm underline underline-offset-2">Editar</summary>
                    <div className="mt-2"><CtForm action={saveCounterparty} submit="Salvar" reset={false} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={p.id} /><input type="hidden" name="version" value={p.version} />
                      <SelectF name="person_type" label="Tipo" def={p.person_type} opts={TYPES} />
                      <TextF name="name" label="Nome" def={p.name} required max={160} />
                      <TextF name="document_number" label="CPF/CNPJ" def={fmtDoc(p.document_number)} inputMode="numeric" max={30} />
                      <TextF name="email" label="E-mail" def={p.email} max={200} type="email" />
                      <TextF name="phone" label="Telefone" def={p.phone} max={40} />
                      <TextF name="address" label="Endereço" def={p.address} max={400} />
                    </CtForm></div>
                    <div className="mt-2"><ActionButton action={setCounterpartyActive} fields={{ id: p.id, active: p.active ? '0' : '1' }} label={p.active ? 'Inativar' : 'Reativar'} confirm={p.active ? 'Inativar? Ela continua nos contratos em que já está.' : undefined} /></div>
                  </details>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </TableShell>
      {c.isManager ? (
        <div className="mt-5"><Disclosure summary="Cadastrar parte" open={rows.length === 0}>
          <CtForm action={saveCounterparty} submit="Cadastrar" pending="Salvando…" reset className="grid gap-4 sm:grid-cols-4">
            <SelectF name="person_type" label="Tipo" def="company" opts={TYPES} required />
            <TextF name="name" label="Nome ou razão social" required max={160} span />
            <TextF name="document_number" label="CPF/CNPJ (opcional)" inputMode="numeric" max={30} hint="Os dígitos verificadores são conferidos." />
            <TextF name="email" label="E-mail (opcional)" type="email" max={200} />
            <TextF name="phone" label="Telefone (opcional)" max={40} />
            <TextF name="address" label="Endereço (opcional)" max={400} span />
          </CtForm>
        </Disclosure></div>
      ) : null}
    </>
  );
}
