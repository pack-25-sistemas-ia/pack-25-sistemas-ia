import type { Metadata } from 'next';
import Link from 'next/link';
import { Disclosure } from '@/components/ct/bits';
import { AreaF, CtForm, SelectF, TextF } from '@/components/ct/fields';
import { PageHeader } from '@/components/ui/primitives';
import { createContract } from '@/lib/ct/actions/contracts';
import { listCategories, listCounterparties, listMembers } from '@/lib/ct/data';
import { pageCtx } from '@/lib/ct/page';
import { BILLING_BASES, BILLING_LABEL } from '@/lib/ct/money';

export const metadata: Metadata = { title: 'Novo contrato' };

export default async function NewContractPage() {
  const c = await pageCtx(['owner', 'manager']);
  const [parties, cats, members] = await Promise.all([listCounterparties(c), listCategories(c), listMembers(c)]);
  const activeParties = parties.filter((p) => p.active);
  const mgmt = members.filter((m) => m.profile === 'owner' || m.profile === 'manager');
  return (
    <>
      <PageHeader title="Novo contrato" description="O contrato nasce como rascunho. Ativar é um registro administrativo: o sistema não atesta assinatura nem validade jurídica. Outras partes, documentos e acessos entram depois, na página do contrato." />
      {activeParties.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm">Cadastre ao menos uma parte antes de criar o contrato. <Link className="underline underline-offset-2" href="/partes">Ir para Partes</Link>.</p>
      ) : (
        <CtForm action={createContract} submit="Criar rascunho" pending="Criando…" reset={false} className="grid max-w-4xl gap-4 sm:grid-cols-4">
          <div className="sm:col-span-4"><TextF name="title" label="Título do contrato" required max={200} /></div>
          <SelectF name="party_id" label="Parte do contrato" required opts={activeParties.map((p) => ({ value: p.id, label: p.name }))} placeholder="Escolha…" span />
          <TextF name="party_role" label="Papel da parte" required max={120} placeholder="Ex.: Contratante" span />
          <SelectF name="category_id" label="Categoria (opcional)" opts={cats.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }))} placeholder="Sem categoria" span />
          <SelectF name="responsible_user_id" label="Responsável (opcional)" opts={mgmt.map((m) => ({ value: m.user_id, label: m.name }))} placeholder="Definir depois" span hint="Colaboradores podem ser responsáveis depois de receberem acesso de editor." />
          <TextF name="start_date" label="Início da vigência" type="date" required />
          <SelectF name="term" label="Prazo" def="fixed" required opts={[{ value: 'fixed', label: 'Determinado (com data final)' }, { value: 'indefinite', label: 'Indeterminado' }]} />
          <TextF name="end_date" label="Fim da vigência" type="date" hint="Obrigatório no prazo determinado." />
          <SelectF name="renewal_mode" label="Renovação" def="none" opts={[{ value: 'none', label: 'Sem renovação prevista' }, { value: 'manual', label: 'Manual (a gestão confirma)' }]} />
          <TextF name="notice_days" label="Aviso (dias antes)" inputMode="numeric" hint="Dias corridos antes do fim. Opcional." />
          <TextF name="notice_reference_date" label="Referência do aviso" type="date" hint="Só no prazo indeterminado." />
          <div className="sm:col-span-4">
            <Disclosure summary="Valor e reajuste (opcionais)">
              <div className="grid gap-4 sm:grid-cols-4">
                <TextF name="value" label="Valor (R$)" inputMode="decimal" placeholder="1.500,00" hint="Só registro: não gera cobrança." />
                <SelectF name="billing_basis" label="Periodicidade" opts={BILLING_BASES.map((b) => ({ value: b, label: BILLING_LABEL[b] }))} placeholder="Escolha…" />
                <TextF name="adj_frequency" label="Reajuste a cada (meses)" inputMode="numeric" />
                <TextF name="adj_next" label="Próximo reajuste" type="date" />
                <TextF name="adj_label" label="Referência do reajuste" max={80} placeholder="Ex.: IPCA" hint="Só um nome: nenhum índice é consultado." span />
              </div>
            </Disclosure>
          </div>
          <AreaF name="description" label="Descrição (opcional)" max={4000} />
        </CtForm>
      )}
    </>
  );
}
