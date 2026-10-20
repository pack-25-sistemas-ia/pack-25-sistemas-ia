import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui/primitives';
import { ActionButton, AreaF, CheckF, CtForm, FileF, SelectF, TextF } from './fields';
import { DateOnly, DateTimeLocal, DeadlinePill, DefinitionList, Disclosure, LifecyclePill, SituationPill, TD, TH, TableShell } from './bits';
import {
  activateContract, addParty, archiveContract, closeContract, completeObligation, cancelObligation, deleteDraft, removeParty, reopenContract, saveObligation, setAccess, setNotice, setResponsible, terminateContract, updateContract,
} from '@/lib/ct/actions/contracts';
import { uploadDocument, uploadDocumentVersion, setCurrentVersion } from '@/lib/ct/actions/documents';
import { applyAdjustment, cancelAdjustment, registerChange, renewContract, saveAdjustmentRule, setInitialValue, simulateAdjustment } from '@/lib/ct/actions/money';
import { currentValue, type ContractDetail, type CounterpartyRow } from '@/lib/ct/data';
import { relativeLabel } from '@/lib/ct/dates';
import { BILLING_BASES, BILLING_LABEL, formatBRL, formatPercent, isBillingBasis } from '@/lib/ct/money';
import type { PageCtx } from '@/lib/ct/page';
import { ADJUSTMENT_STATUS_LABEL, CHANGE_LABEL, DOC_TYPE_LABEL, OBLIGATION_STATUS_LABEL, describeEvent } from '@/lib/ct/present';
import { CONTRACT_ROLE_LABEL, DEADLINE_LABEL, availableActions, canEditRole, isOpenForEdit, situationOf, type ContractAction, type DeadlineKind } from '@/lib/ct/status';
import { formatBytes } from '@/lib/ct/format';

type Member = { user_id: string; name: string; profile: string };
export type ViewProps = { d: ContractDetail; c: PageCtx; members: Member[]; parties: Array<CounterpartyRow>; acts: ContractAction[]; who: (id: string | null | undefined) => string };
const has = (acts: ContractAction[], a: ContractAction) => acts.includes(a);
const money = (v: number | null | undefined) => (v === null || v === undefined ? 'Sem dados' : formatBRL(v));
const basisLabel = (b: string) => (isBillingBasis(b) ? BILLING_LABEL[b] : b);

export function ContractHeader({ d, c }: Pick<ViewProps, 'd' | 'c'>) {
  const k = d.contract;
  const open = k.lifecycle_status === 'draft' || k.lifecycle_status === 'active';
  const v = currentValue(d.values, c.today);
  return (
    <div className="mb-5">
      <p className="text-sm text-muted">{c.settings.contract_prefix}-{String(k.contract_number).padStart(4, '0')}{d.category ? ` · ${d.category}` : ''}</p>
      <h1 className="text-2xl font-semibold">{k.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2"><LifecyclePill status={k.lifecycle_status} archived={!!k.archived_at} />
        {open ? <SituationPill situation={situationOf({ start: k.start_date, end: k.end_date, indefinite: k.indefinite_term }, c.today, c.settings.near_end_days)} /> : null}
        <span className="text-sm text-muted">Seu papel: {d.role ? CONTRACT_ROLE_LABEL[d.role] : '—'}</span></p>
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
        <p><span className="block text-xs text-muted">Vigência</span><DateOnly value={k.start_date} /> a {k.indefinite_term ? 'prazo indeterminado' : <DateOnly value={k.end_date} />}</p>
        <p><span className="block text-xs text-muted">Fim da vigência</span>{k.end_date ? <>{<DateOnly value={k.end_date} />} <span className="text-muted">({relativeLabel(k.end_date, c.today)})</span></> : '—'}</p>
        <p><span className="block text-xs text-muted">Prazo de aviso{k.notice_adjusted ? ' (ajustado)' : ''}</span>{k.notice_deadline_date ? <>{<DateOnly value={k.notice_deadline_date} />} <span className="text-muted">({relativeLabel(k.notice_deadline_date, c.today)})</span></> : '—'}</p>
        <p><span className="block text-xs text-muted">Valor vigente</span>{money(v?.amount_cents)} {v ? <span className="text-muted">{basisLabel(v.billing_basis)}</span> : null}</p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- resumo
export function SummaryTab({ d, c, members, acts, who }: ViewProps) {
  const k = d.contract;
  const idField = <input type="hidden" name="contract" value={k.id} />;
  const verField = <input type="hidden" name="version" value={k.version} />;
  const mgmtPeople = d.people.filter((p) => p.assignable);
  const nonMgmt = members.filter((m) => m.profile === 'collaborator' || m.profile === 'viewer');
  return (
    <>
      <Card title="Dados do contrato">
        <DefinitionList items={[
          ['Status', <LifecyclePill key="s" status={k.lifecycle_status} archived={!!k.archived_at} />],
          ['Categoria', d.category ?? 'Sem categoria'], ['Renovação', k.renewal_mode === 'manual' ? 'Manual (a gestão confirma; nunca automática)' : 'Sem renovação prevista'],
          ['Responsável', k.responsible_user_id ? who(k.responsible_user_id) : 'Sem responsável'],
          ['Prazo de aviso', k.notice_days === null ? 'Não configurado' : `${k.notice_days} dias antes de ${k.notice_reference_date ? k.notice_reference_date.split('-').reverse().join('/') : '—'}${k.notice_adjusted ? ` — ajustado manualmente: ${k.notice_adjust_reason}` : ''}`],
          ...(k.ended_on ? [['Encerrado em', <><DateOnly key="e" value={k.ended_on} /> — {k.end_reason}</>] as [string, ReactNode]] : []),
          ['Descrição', k.description ?? '—'],
        ]} />
        <p className="mt-3 text-xs text-muted">Ferramenta administrativa: o registro não substitui o contrato assinado nem constitui parecer jurídico.</p>
      </Card>

      {has(acts, 'edit') ? (
        <div className="mt-4"><Disclosure summary="Editar dados">
          <CtForm action={updateContract} submit="Salvar" reset={false} className="grid gap-4 sm:grid-cols-4">
            {idField}{verField}
            <div className="sm:col-span-4"><TextF name="title" label="Título" def={k.title} required max={200} /></div>
            <AreaF name="description" label="Descrição" def={k.description} max={4000} />
            {d.role === 'manager' ? <SelectF name="renewal_mode" label="Renovação" def={k.renewal_mode} opts={[{ value: 'none', label: 'Sem renovação prevista' }, { value: 'manual', label: 'Manual (a gestão confirma)' }]} /> : null}
            {k.lifecycle_status === 'draft' && d.role === 'manager' ? (
              <>
                <TextF name="start_date" label="Início da vigência" type="date" def={k.start_date} required />
                <SelectF name="term" label="Prazo" def={k.indefinite_term ? 'indefinite' : 'fixed'} opts={[{ value: 'fixed', label: 'Determinado' }, { value: 'indefinite', label: 'Indeterminado' }]} />
                <TextF name="end_date" label="Fim da vigência" type="date" def={k.end_date} />
              </>
            ) : null}
          </CtForm>
        </Disclosure></div>
      ) : null}

      {d.role === 'manager' ? (
        <Card title="Ciclo de vida" description="Decisões da gestão. Rescindir, encerrar e reabrir ficam registrados com data e motivo; nada é apagado.">
          <div className="flex flex-wrap items-start gap-3">
            {has(acts, 'activate') ? <ActionButton action={activateContract} fields={{ contract: k.id, version: String(k.version) }} label="Ativar contrato" variant="primary" confirm="Ativar é um registro administrativo (não é assinatura nem validação jurídica). Confirma?" /> : null}
            {has(acts, 'archive') ? <ActionButton action={archiveContract} fields={{ contract: k.id, version: String(k.version), archive: '1' }} label="Arquivar" confirm="Sai das listas padrão; documentos e histórico continuam." /> : null}
            {has(acts, 'unarchive') ? <ActionButton action={archiveContract} fields={{ contract: k.id, version: String(k.version), archive: '0' }} label="Desarquivar" /> : null}
            {has(acts, 'delete') ? <ActionButton action={deleteDraft} fields={{ contract: k.id, version: String(k.version) }} label="Excluir rascunho" variant="danger" confirm="Exclui o rascunho de vez (só rascunho sem documentos, aditivos ou obrigações)." /> : null}
          </div>
          {has(acts, 'terminate') ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Disclosure summary="Rescindir contrato" tone="danger">
                <CtForm action={terminateContract} submit="Rescindir" variant="danger" reset={false} className="grid gap-4 sm:grid-cols-2">
                  {idField}{verField}
                  <TextF name="ended_on" label="Data da rescisão" type="date" def={c.today} required hint="Entre o início da vigência e hoje." />
                  <TextF name="reason" label="Motivo" required max={500} />
                </CtForm>
              </Disclosure>
              <Disclosure summary="Encerrar administrativamente">
                <CtForm action={closeContract} submit="Encerrar" reset={false} className="grid gap-4 sm:grid-cols-2">
                  {idField}{verField}
                  <div className="sm:col-span-2"><TextF name="reason" label="Motivo" required max={500} hint="Ex.: objeto cumprido, contrato substituído." /></div>
                </CtForm>
              </Disclosure>
            </div>
          ) : null}
          {has(acts, 'reopen') ? (
            <div className="mt-3"><Disclosure summary="Reabrir contrato">
              <CtForm action={reopenContract} submit="Reabrir" reset={false} className="grid gap-4 sm:grid-cols-2">
                {idField}{verField}
                <div className="sm:col-span-2"><TextF name="reason" label="Justificativa (fica no histórico)" required max={500} /></div>
              </CtForm>
            </Disclosure></div>
          ) : null}
        </Card>
      ) : null}

      <Card title="Responsável e acessos" description="Gestão e proprietário veem todos os contratos. Colaboradores veem só os contratos aos quais forem vinculados; o acesso removido vale na hora.">
        <DefinitionList items={[['Responsável', k.responsible_user_id ? who(k.responsible_user_id) : 'Sem responsável']]} />
        {d.access.length ? (
          <TableShell caption="Pessoas vinculadas">
            <thead><tr><th className={TH}>Pessoa</th><th className={TH}>Papel no contrato</th></tr></thead>
            <tbody className="divide-y divide-border">{d.access.map((a) => <tr key={a.user_id}><td className={TD}>{who(a.user_id)}</td><td className={TD}>{CONTRACT_ROLE_LABEL[a.contract_role]}</td></tr>)}</tbody>
          </TableShell>
        ) : <p className="mt-2 text-sm text-muted">Nenhum colaborador vinculado.</p>}
        {has(acts, 'responsible') ? (
          <div className="mt-3"><Disclosure summary="Trocar o responsável">
            <CtForm action={setResponsible} submit="Salvar responsável" reset={false} className="grid gap-4 sm:grid-cols-2">
              {idField}{verField}
              <SelectF name="user" label="Responsável" def={k.responsible_user_id} opts={mgmtPeople.map((p) => ({ value: p.user_id, label: p.name }))} placeholder="Sem responsável" hint="Só quem tem acesso de editor (ou é da gestão)." />
            </CtForm>
          </Disclosure></div>
        ) : null}
        {has(acts, 'access') ? (
          <div className="mt-3"><Disclosure summary="Vincular, mudar o papel ou remover acesso">
            <CtForm action={setAccess} submit="Salvar acesso" reset={false} className="grid gap-4 sm:grid-cols-4">
              <input type="hidden" name="contract" value={k.id} />
              <SelectF name="user" label="Pessoa" required opts={nonMgmt.map((m) => ({ value: m.user_id, label: `${m.name} (${m.profile === 'viewer' ? 'Leitor' : 'Colaborador'})` }))} placeholder="Escolha…" span />
              <SelectF name="role" label="Papel no contrato" opts={[{ value: 'editor', label: 'Editor' }, { value: 'reader', label: 'Leitor' }]} placeholder="Remover acesso" hint="O «Leitor» da empresa só pode ser leitor." />
              <SelectF name="action" label="Se tiver obrigações pendentes" opts={[{ value: 'unassign', label: 'Desatribuir' }, { value: 'transfer', label: 'Transferir' }]} placeholder="—" />
              <SelectF name="transfer_to" label="Transferir para" opts={mgmtPeople.map((p) => ({ value: p.user_id, label: p.name }))} placeholder="—" />
            </CtForm>
          </Disclosure></div>
        ) : null}
      </Card>
    </>
  );
}

// ----------------------------------------------------------------------------- partes
export function PartiesTab({ d, parties, acts }: ViewProps) {
  const k = d.contract;
  const used = new Set(d.parties.map((p) => p.counterparty_id));
  return (
    <>
      <TableShell caption="Partes do contrato" empty={d.parties.length === 0} emptyText="Nenhuma parte vinculada.">
        <thead><tr><th className={TH}>Parte</th><th className={TH}>Papel</th><th className={TH}>Documento (parcial)</th><th className={TH}>Situação do cadastro</th><th className={TH} /></tr></thead>
        <tbody className="divide-y divide-border">
          {d.parties.map((p) => (
            <tr key={p.counterparty_id}>
              <td className={TD}>{p.snapshot.name ?? '—'} <span className="text-xs text-muted">{p.snapshot.person_type === 'company' ? 'Empresa' : 'Pessoa física'}</span></td>
              <td className={TD}>{p.role_description}</td><td className={TD}>{p.snapshot.document_masked ?? '—'}</td>
              <td className={TD}>{p.active === false ? <Badge tone="warning">Cadastro inativo</Badge> : 'Ativo'}</td>
              <td className={TD}>{has(acts, 'party') ? <ActionButton action={removeParty} fields={{ contract: k.id, counterparty: p.counterparty_id }} label="Remover" confirm="Remover a parte deste contrato?" /> : null}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      <p className="mt-2 text-xs text-muted">A identidade mostrada é a registrada no momento do vínculo; o CPF/CNPJ completo fica só no cadastro de Partes, visível à gestão.</p>
      {has(acts, 'party') ? (
        <div className="mt-4"><Disclosure summary="Adicionar parte">
          <CtForm action={addParty} submit="Adicionar" reset className="grid gap-4 sm:grid-cols-4">
            <input type="hidden" name="contract" value={k.id} />
            <SelectF name="counterparty" label="Parte" required opts={parties.filter((p) => p.active && !used.has(p.id)).map((p) => ({ value: p.id, label: p.name }))} placeholder="Escolha…" span />
            <TextF name="role_description" label="Papel no contrato" required max={120} placeholder="Ex.: Contratada" span />
          </CtForm>
        </Disclosure></div>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------------------- documentos
export function DocumentsTab({ d, c, acts, who }: ViewProps) {
  const k = d.contract;
  const canUpload = has(acts, 'document');
  return (
    <>
      {d.documents.length === 0 ? <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">Nenhum documento. Documentos ficam em área privada, com versões preservadas.</p> : null}
      <div className="grid gap-4">
        {d.documents.map((doc) => (
          <Card key={doc.id} title={doc.title} description={DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type}>
            <TableShell caption={`Versões de ${doc.title}`}>
              <thead><tr><th className={TH}>Versão</th><th className={TH}>Arquivo</th><th className={TH}>Enviado</th><th className={TH}>Integridade (SHA-256)</th><th className={TH} /></tr></thead>
              <tbody className="divide-y divide-border">
                {doc.versions.map((v) => (
                  <tr key={v.id}>
                    <td className={TD}>v{v.version_number} {doc.current_version_id === v.id ? <Badge tone="success">Atual</Badge> : null}</td>
                    <td className={TD}><a className="underline underline-offset-2" href={`/api/arquivos/${v.id}${v.mime_type.startsWith('image/') ? '' : '?download=1'}`}>{v.original_filename}</a> <span className="text-xs text-muted">{formatBytes(v.size_bytes)}</span></td>
                    <td className={TD}><DateTimeLocal value={v.created_at} tz={c.tz} /> · {who(v.uploaded_by)}</td>
                    <td className={TD}><code className="break-all text-xs">{v.sha256 ? v.sha256.slice(0, 16) + '…' : '—'}</code></td>
                    <td className={TD}>{canUpload && doc.current_version_id !== v.id ? <ActionButton action={setCurrentVersion} fields={{ document: doc.id, version_id: v.id }} label="Tornar atual" /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <p className="mt-2 text-xs text-muted">O hash confere se o arquivo mudou; não é assinatura digital nem certificação.</p>
            {canUpload ? (
              <div className="mt-3"><Disclosure summary="Enviar nova versão">
                <CtForm action={uploadDocumentVersion} submit="Enviar versão" pending="Enviando…" reset className="grid gap-4 sm:grid-cols-4">
                  <input type="hidden" name="contract" value={k.id} /><input type="hidden" name="document" value={doc.id} />
                  <FileF name="file" label="Arquivo" hint="PDF, DOCX, JPEG, PNG ou WebP. A versão anterior continua preservada." accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" />
                </CtForm>
              </Disclosure></div>
            ) : null}
          </Card>
        ))}
      </div>
      {canUpload ? (
        <div className="mt-4"><Disclosure summary="Adicionar documento" open={d.documents.length === 0}>
          <CtForm action={uploadDocument} submit="Adicionar documento" pending="Enviando…" reset className="grid gap-4 sm:grid-cols-4">
            <input type="hidden" name="contract" value={k.id} />
            <TextF name="title" label="Título do documento" required max={160} span />
            <SelectF name="type" label="Tipo" def="main" opts={Object.entries(DOC_TYPE_LABEL).map(([value, label]) => ({ value, label }))} span />
            <FileF name="file" label="Arquivo" hint="PDF, DOCX, JPEG, PNG ou WebP, até o limite da empresa. O tipo é conferido pelo conteúdo." accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" />
          </CtForm>
        </Disclosure></div>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------------------- aditivos e renovações
export function ChangesTab({ d, c, acts, who }: ViewProps) {
  const k = d.contract;
  const versions = d.documents.flatMap((doc) => doc.versions.map((v) => ({ value: v.id, label: `${doc.title} — v${v.version_number}` })));
  const snap = (o: Record<string, unknown>) => [o.end_date ? `fim ${String(o.end_date).split('-').reverse().join('/')}` : o.indefinite_term ? 'prazo indeterminado' : null, typeof o.amount_cents === 'number' ? formatBRL(o.amount_cents) : null].filter(Boolean).join(' · ') || '—';
  return (
    <>
      <TableShell caption="Aditivos, renovações, correções e rescisão" empty={d.changes.length === 0} emptyText="Nenhum aditivo, renovação ou correção registrado.">
        <thead><tr><th className={TH}>Tipo</th><th className={TH}>Efeito</th><th className={TH}>Descrição</th><th className={TH}>Antes → depois</th><th className={TH}>Registrado</th></tr></thead>
        <tbody className="divide-y divide-border">
          {d.changes.map((ch) => (
            <tr key={ch.id}>
              <td className={TD}><Badge tone={ch.change_type === 'termination' ? 'danger' : 'neutral'}>{CHANGE_LABEL[ch.change_type] ?? ch.change_type}</Badge></td>
              <td className={TD}><DateOnly value={ch.effective_date} /></td><td className={TD}>{ch.description}</td>
              <td className={TD}>{snap(ch.before_snapshot)} → {snap(ch.after_snapshot)}</td>
              <td className={TD}><DateTimeLocal value={ch.created_at} tz={c.tz} /> · {who(ch.created_by)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
      {has(acts, 'renew') ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Disclosure summary="Registrar renovação (manual)">
            <p className="mb-3 text-sm text-muted">A renovação é sempre uma decisão da gestão, com justificativa. O período anterior fica no histórico e os prazos e lembretes são recalculados.</p>
            <CtForm action={renewContract} submit="Registrar renovação" reset={false} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="contract" value={k.id} /><input type="hidden" name="version" value={k.version} />
              <SelectF name="mode" label="Como renovar" def="date" opts={[{ value: 'date', label: 'Nova data de fim' }, ...(k.indefinite_term ? [] : [{ value: 'indefinite', label: 'Passar a prazo indeterminado' }])]} />
              <TextF name="new_end" label="Nova data de fim" type="date" hint={k.end_date ? `Posterior a ${k.end_date.split('-').reverse().join('/')}.` : undefined} />
              <TextF name="effective" label="Data da renovação" type="date" def={c.today} />
              <SelectF name="document_version_id" label="Documento (opcional)" opts={versions} placeholder="Nenhum" />
              <div className="sm:col-span-2"><TextF name="reason" label="Justificativa" required max={500} /></div>
            </CtForm>
          </Disclosure>
          <Disclosure summary="Registrar aditivo ou correção">
            <p className="mb-3 text-sm text-muted">O valor anterior nunca é editado: uma alteração de valor cria nova versão no histórico, em ordem cronológica.</p>
            <CtForm action={registerChange} submit="Registrar" reset={false} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="contract" value={k.id} /><input type="hidden" name="version" value={k.version} />
              <SelectF name="change_type" label="Tipo" def="amendment" opts={[{ value: 'amendment', label: 'Aditivo' }, { value: 'correction', label: 'Correção' }]} />
              <TextF name="effective_date" label="Data de efeito" type="date" def={c.today} required hint="Até hoje." />
              <div className="sm:col-span-2"><TextF name="description" label="Descrição" required max={2000} /></div>
              <TextF name="amount" label="Novo valor (opcional)" inputMode="decimal" placeholder="1.500,00" />
              <SelectF name="basis" label="Periodicidade" opts={BILLING_BASES.map((b) => ({ value: b, label: BILLING_LABEL[b] }))} placeholder="—" />
              <SelectF name="document_version_id" label="Documento (opcional)" opts={versions} placeholder="Nenhum" span />
            </CtForm>
          </Disclosure>
        </div>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------------------- valores e reajustes
export function ValuesTab({ d, c, acts }: ViewProps) {
  const k = d.contract;
  const cur = currentValue(d.values, c.today);
  const proposal = d.adjustments.find((a) => a.status === 'proposed');
  const base = proposal ? d.values.find((v) => v.id === proposal.base_value_version_id) : null;
  const origin = (v: ContractDetail['values'][number]) => (v.source_adjustment_id ? 'Reajuste' : v.source_change_id ? 'Aditivo/correção' : 'Valor inicial');
  return (
    <>
      <Card title="Valor vigente" description="Registro do contrato: não gera cobrança, recebível nem lançamento contábil.">
        <p className="text-2xl font-semibold tabular-nums">{money(cur?.amount_cents)} {cur ? <span className="text-base font-normal text-muted">{basisLabel(cur.billing_basis)} · desde <DateOnly value={cur.effective_from} /></span> : null}</p>
        {!cur && has(acts, 'adjust') ? (
          <div className="mt-3"><Disclosure summary="Cadastrar valor inicial" open>
            <CtForm action={setInitialValue} submit="Cadastrar valor" reset={false} className="grid gap-4 sm:grid-cols-4">
              <input type="hidden" name="contract" value={k.id} /><input type="hidden" name="version" value={k.version} />
              <TextF name="amount" label="Valor (R$)" inputMode="decimal" required placeholder="1.500,00" />
              <SelectF name="basis" label="Periodicidade" required opts={BILLING_BASES.map((b) => ({ value: b, label: BILLING_LABEL[b] }))} placeholder="Escolha…" />
            </CtForm>
          </Disclosure></div>
        ) : null}
      </Card>

      <Card title="Histórico de valores" description="Versões nunca são editadas nem apagadas.">
        <TableShell caption="Histórico de valores" empty={d.values.length === 0} emptyText="Sem dados.">
          <thead><tr><th className={TH}>Desde</th><th className={TH}>Valor</th><th className={TH}>Periodicidade</th><th className={TH}>Origem</th></tr></thead>
          <tbody className="divide-y divide-border">{d.values.map((v) => <tr key={v.id}><td className={TD}><DateOnly value={v.effective_from} /> {cur?.id === v.id ? <Badge tone="success">Vigente</Badge> : null}</td><td className={TD + ' tabular-nums'}>{formatBRL(v.amount_cents)}</td><td className={TD}>{basisLabel(v.billing_basis)}</td><td className={TD}>{origin(v)}</td></tr>)}</tbody>
        </TableShell>
      </Card>

      <Card title="Reajuste" description="O percentual é informado por você; o nome de um índice não significa que seu valor foi consultado. Simular não altera o contrato; aplicar é uma confirmação explícita.">
        {d.rule ? <DefinitionList items={[['Regra', `a cada ${d.rule.frequency_months} meses${d.rule.reference_label ? ` (${d.rule.reference_label})` : ''}`], ['Próxima data prevista', <DateOnly key="n" value={d.rule.next_adjustment_date} />], ['Situação', d.rule.active ? 'Ativa' : 'Pausada']]} /> : <p className="text-sm text-muted">Nenhuma regra de reajuste configurada.</p>}
        {has(acts, 'adjust') ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Disclosure summary={d.rule ? 'Alterar regra de reajuste' : 'Configurar regra de reajuste'}>
              <CtForm action={saveAdjustmentRule} submit="Salvar regra" reset={false} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="contract" value={k.id} />
                <TextF name="frequency" label="Frequência (meses)" inputMode="numeric" def={d.rule ? String(d.rule.frequency_months) : '12'} required />
                <TextF name="next" label="Próxima data" type="date" def={d.rule?.next_adjustment_date} required />
                <TextF name="label" label="Referência (só um nome)" def={d.rule?.reference_label} max={80} placeholder="Ex.: IPCA" />
                <CheckF name="active" label="Regra ativa" def={d.rule?.active ?? true} />
              </CtForm>
            </Disclosure>
            {cur ? (
              <Disclosure summary="Simular reajuste" open={!proposal}>
                <CtForm action={simulateAdjustment} submit="Simular" reset={false} className="grid gap-4 sm:grid-cols-2">
                  <input type="hidden" name="contract" value={k.id} />
                  <TextF name="effective" label="Data de efeito" type="date" def={d.rule?.next_adjustment_date && d.rule.next_adjustment_date <= c.today ? d.rule.next_adjustment_date : c.today} required />
                  <TextF name="percentage" label="Percentual (%)" inputMode="decimal" required placeholder="5,5" hint="Negativo exige justificativa." />
                  <TextF name="label" label="Referência" max={80} placeholder="Ex.: IPCA" />
                  <TextF name="period" label="Período de referência" max={60} placeholder="Ex.: 12 meses até 09/2026" />
                  <div className="sm:col-span-2"><TextF name="note" label="Fonte ou observação" max={500} /></div>
                  <div className="sm:col-span-2"><TextF name="justification" label="Justificativa (obrigatória se negativo)" max={500} /></div>
                </CtForm>
              </Disclosure>
            ) : null}
          </div>
        ) : null}

        {proposal && base ? (
          <div className="mt-4 rounded-lg border border-warning/40 bg-card p-4">
            <h3 className="font-semibold">Simulação em aberto — o contrato ainda NÃO foi alterado</h3>
            <DefinitionList items={[
              ['Base', `${formatBRL(base.amount_cents)} (${basisLabel(base.billing_basis)}, vigente em ${base.effective_from.split('-').reverse().join('/')})`],
              ['Percentual', formatPercent(BigInt(Math.round(Number(proposal.percentage_decimal) * 10_000)))],
              ['Resultado', <strong key="r">{formatBRL(proposal.new_amount_cents)}</strong>],
              ['Data de efeito', <DateOnly key="d" value={proposal.effective_date} />],
              ['Referência', [proposal.reference_label, proposal.reference_period, proposal.source_note].filter(Boolean).join(' · ') || '—'],
            ]} />
            {has(acts, 'adjust') ? (
              <div className="mt-3 flex flex-wrap items-start gap-4">
                <CtForm action={applyAdjustment} submit="Aplicar reajuste" reset={false} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="adjustment" value={proposal.id} />
                  <CheckF name="confirm" label="Confirmo aplicar este reajuste (nova versão de valor; o histórico anterior continua)" />
                </CtForm>
                <ActionButton action={cancelAdjustment} fields={{ adjustment: proposal.id }} label="Cancelar simulação" />
              </div>
            ) : null}
          </div>
        ) : null}

        <TableShell caption="Reajustes" empty={d.adjustments.length === 0} emptyText="Nenhum reajuste simulado ou aplicado.">
          <thead><tr><th className={TH}>Efeito</th><th className={TH}>%</th><th className={TH}>Novo valor</th><th className={TH}>Situação</th><th className={TH}>Referência</th></tr></thead>
          <tbody className="divide-y divide-border">{d.adjustments.map((a) => <tr key={a.id}><td className={TD}><DateOnly value={a.effective_date} /></td><td className={TD}>{formatPercent(BigInt(Math.round(Number(a.percentage_decimal) * 10_000)))}</td><td className={TD + ' tabular-nums'}>{formatBRL(a.new_amount_cents)}</td><td className={TD}>{ADJUSTMENT_STATUS_LABEL[a.status] ?? a.status}</td><td className={TD}>{[a.reference_label, a.reference_period].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody>
        </TableShell>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------------------- prazos e obrigações
export function DeadlinesTab({ d, c, acts, who }: ViewProps) {
  const k = d.contract;
  const current = d.deadlines.filter((x) => !x.superseded_at);
  const past = d.deadlines.filter((x) => x.superseded_at);
  const assignable = d.people.filter((p) => p.assignable);
  return (
    <>
      <Card title="Prazos do contrato" description="Fim da vigência, prazo de aviso e reajuste previsto. Cada mudança de data cria uma nova revisão; os lembretes antigos deixam de valer.">
        <TableShell caption="Prazos correntes" empty={current.length === 0} emptyText="Sem prazos correntes.">
          <thead><tr><th className={TH}>Tipo</th><th className={TH}>Data</th><th className={TH}>Quando</th><th className={TH}>Origem</th><th className={TH}>Revisão</th></tr></thead>
          <tbody className="divide-y divide-border">{current.map((x) => <tr key={x.id}><td className={TD}><DeadlinePill kind={x.deadline_type as DeadlineKind} /></td><td className={TD}><DateOnly value={x.due_date} /></td><td className={TD}>{relativeLabel(x.due_date, c.today)}</td><td className={TD}>{x.source_reference ?? '—'}</td><td className={TD}>{x.revision}</td></tr>)}</tbody>
        </TableShell>
        {past.length ? (
          <div className="mt-3"><Disclosure summary={`Revisões anteriores (${past.length})`}>
            <TableShell caption="Revisões anteriores dos prazos"><thead><tr><th className={TH}>Tipo</th><th className={TH}>Data</th><th className={TH}>Revisão</th><th className={TH}>Substituída em</th></tr></thead>
              <tbody className="divide-y divide-border">{past.map((x) => <tr key={x.id}><td className={TD}>{DEADLINE_LABEL[x.deadline_type as DeadlineKind]}</td><td className={TD}><DateOnly value={x.due_date} /></td><td className={TD}>{x.revision}</td><td className={TD}><DateTimeLocal value={x.superseded_at} tz={c.tz} /></td></tr>)}</tbody></TableShell>
          </Disclosure></div>
        ) : null}
        {has(acts, 'notice') ? (
          <div className="mt-3"><Disclosure summary="Prazo de aviso">
            <p className="mb-3 text-sm text-muted">Prazo de aviso = data de referência − dias corridos (sem feriados e sem interpretar cláusulas). Perder o prazo não renova nem rescinde: o sistema só sinaliza. Deixe os dias em branco para remover.</p>
            <CtForm action={setNotice} submit="Salvar aviso" reset={false} className="grid gap-4 sm:grid-cols-4">
              <input type="hidden" name="contract" value={k.id} /><input type="hidden" name="version" value={k.version} />
              <TextF name="notice_days" label="Dias de aviso" inputMode="numeric" def={k.notice_days === null ? '' : String(k.notice_days)} />
              <TextF name="notice_reference_date" label="Data de referência" type="date" def={k.notice_reference_date} hint={k.indefinite_term ? 'Obrigatória no prazo indeterminado.' : 'Padrão: fim da vigência.'} />
              <TextF name="manual_deadline" label="Ajuste manual do prazo" type="date" hint="Só se a cláusula exigir outro cálculo." />
              <TextF name="justification" label="Justificativa do ajuste" max={500} />
            </CtForm>
          </Disclosure></div>
        ) : null}
      </Card>

      <Card title="Obrigações" description="Tarefas administrativas simples, com responsável e data. Sem recorrência automática.">
        <TableShell caption="Obrigações" empty={d.obligations.length === 0} emptyText="Nenhuma obrigação cadastrada.">
          <thead><tr><th className={TH}>Obrigação</th><th className={TH}>Data</th><th className={TH}>Responsável</th><th className={TH}>Situação</th><th className={TH} /></tr></thead>
          <tbody className="divide-y divide-border">
            {d.obligations.map((o) => (
              <tr key={o.id}>
                <td className={TD}>{o.title}{o.completion_note ? <span className="block text-xs text-muted">{o.completion_note}</span> : null}</td>
                <td className={TD}><DateOnly value={o.due_date} /> {o.status === 'pending' && o.due_date < c.today ? <Badge tone="danger">Atrasada</Badge> : null}</td>
                <td className={TD}>{o.responsible_user_id ? who(o.responsible_user_id) : '—'}</td><td className={TD}>{OBLIGATION_STATUS_LABEL[o.status] ?? o.status}</td>
                <td className={TD}>{o.status === 'pending' && has(acts, 'obligation') ? (
                  <span className="flex flex-wrap gap-2">
                    <ActionButton action={completeObligation} fields={{ id: o.id, version: String(o.version) }} label="Concluir" variant="primary" />
                    <ActionButton action={cancelObligation} fields={{ id: o.id, version: String(o.version), reason: 'Cancelada pela equipe' }} label="Cancelar" confirm="Cancelar esta obrigação?" />
                  </span>) : null}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
        {has(acts, 'obligation') ? (
          <div className="mt-3"><Disclosure summary="Nova obrigação">
            <CtForm action={saveObligation} submit="Criar obrigação" reset className="grid gap-4 sm:grid-cols-4">
              <input type="hidden" name="contract" value={k.id} />
              <TextF name="title" label="Título" required max={200} span />
              <TextF name="due_date" label="Data" type="date" required />
              <SelectF name="responsible_user_id" label="Responsável" opts={assignable.map((p) => ({ value: p.user_id, label: p.name }))} placeholder="Sem responsável" />
              <AreaF name="description" label="Descrição (opcional)" max={2000} />
            </CtForm>
          </Disclosure></div>
        ) : null}
      </Card>
    </>
  );
}

// ----------------------------------------------------------------------------- histórico
export function HistoryTab({ d, c, who }: ViewProps) {
  return (
    <ol className="grid gap-2" aria-label="Histórico do contrato">
      {d.events.length === 0 ? <li className="text-sm text-muted">Sem eventos.</li> : null}
      {d.events.map((e) => (
        <li key={e.id} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
          <span className="text-xs text-muted"><DateTimeLocal value={e.created_at} tz={c.tz} /> · {e.actor_kind === 'system' ? 'Sistema' : who(e.actor_user_id)}</span>
          <p>{describeEvent(e.event_type, e.data, who)}</p>
        </li>
      ))}
    </ol>
  );
}

export { availableActions, canEditRole, isOpenForEdit, Link };
