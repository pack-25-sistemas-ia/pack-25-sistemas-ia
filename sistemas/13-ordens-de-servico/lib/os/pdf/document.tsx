import 'server-only';
import { Document, Page, StyleSheet, Text, View, Image, type DocumentProps } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { formatCents, formatQuantity, milliFromNumeric } from '../money';
import { PRIORITY_LABEL, STATUS_LABEL } from '../status';
import { formatInstant } from '../time';
import { readableOn, safePrimary } from '@/lib/utils';

// PDF para o CLIENTE: orçamento publicado, resumo da ordem e relatório de conclusão. Gerado no servidor a partir de dados já autorizados (função os_document / os_public_document),
// usando os SNAPSHOTS da época do documento — nunca o cadastro atual nem preços atuais do catálogo. Não contém notas internas, custos nem CPF/CNPJ.
export type DocKind = 'quote' | 'summary' | 'completion';
export type Doc = {
  kind: DocKind; generated_at: string;
  company: { name: string | null; primary_color: string; timezone: string; logo_path: string | null };
  order: { number_text: string; subject: string; problem_description: string; status: keyof typeof STATUS_LABEL; priority: keyof typeof PRIORITY_LABEL; created_at: string; scheduled_start_at: string | null; scheduled_end_at: string | null; started_at: string | null; completed_at: string | null; closed_at: string | null };
  customer: { name: string; phone: string | null; email: string | null; contact_name: string | null; contact_phone: string | null; address: Record<string, string> | null; equipment: Record<string, string> | null; snapshot_version: number };
  quote: null | {
    version_number: number; status: string; subtotal_cents: number; discount_cents: number; total_cents: number; valid_until: string | null; terms: string | null; notes: string | null; published_at: string | null;
    items: Array<{ kind: 'service' | 'part'; description: string; unit: string; quantity: string | number; unit_price_cents: number; line_total_cents: number }>;
    decision: null | { decision: 'approved' | 'rejected'; decided_at: string; declared_name: string; channel: string; accepted_text: string };
  };
  completion: null | {
    version: number; summary: string; completed_at: string; current: boolean; parts: Array<{ description: string; unit: string; quantity: string | number }>; checklist: Array<{ group: string; label: string; not_applicable: boolean; answer: unknown }>;
    acceptance: null | { decision: 'accepted' | 'contested'; decided_at: string; declared_name: string; channel: string; accepted_text: string; note: string | null };
  };
};

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontSize: 9.5, fontFamily: 'Helvetica', color: '#111827', lineHeight: 1.35 },
  band: { paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  company: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  sub: { color: '#4b5563', marginBottom: 10 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: '#d1d5db' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', paddingRight: 8, marginBottom: 4 },
  label: { fontSize: 8, color: '#6b7280' },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#374151' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb', paddingVertical: 3 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#9ca3af', paddingVertical: 3 },
  c1: { width: '10%' }, c2: { width: '42%' }, c3: { width: '16%', textAlign: 'right' }, c4: { width: '16%', textAlign: 'right' }, c5: { width: '16%', textAlign: 'right' },
  totals: { alignSelf: 'flex-end', width: '45%', marginTop: 6 },
  trow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
  box: { borderWidth: 1, borderColor: '#d1d5db', padding: 8, marginTop: 4 },
  small: { fontSize: 8, color: '#4b5563' },
  footer: { position: 'absolute', bottom: 22, left: 36, right: 36, fontSize: 7.5, color: '#6b7280', flexDirection: 'row', justifyContent: 'space-between' },
});

const addr = (a: Record<string, string> | null) => (a ? `${a.street ?? ''}${a.number ? `, ${a.number}` : ''}${a.complement ? ` — ${a.complement}` : ''} · ${a.district ? `${a.district}, ` : ''}${a.city ?? ''}/${a.state ?? ''}${a.postal_code ? ` · CEP ${a.postal_code.replace(/(\d{5})(\d{3})/, '$1-$2')}` : ''}` : '—');
const eq = (e: Record<string, string> | null) => (e ? [e.kind, e.brand, e.model].filter(Boolean).join(' · ') + (e.serial_number ? ` (série ${e.serial_number})` : '') : '—');
const q = (v: string | number) => formatQuantity(milliFromNumeric(v));
const answer = (a: unknown, na: boolean) => (na ? 'Não se aplica' : a === true ? 'Sim' : a === false ? 'Não' : a === null || a === undefined ? '—' : String(a));
const TITLES: Record<DocKind, string> = { quote: 'Orçamento', summary: 'Resumo da ordem de serviço', completion: 'Relatório de conclusão do serviço' };

function Field({ label, children }: { label: string; children: string | undefined | null }) {
  return <View style={s.cell}><Text style={s.label}>{label}</Text><Text>{children || '—'}</Text></View>;
}

export function OsPdf({ doc, logo }: { doc: Doc; logo?: { data: Buffer; format: 'png' | 'jpg' } | null }): ReactElement<DocumentProps> {
  const tz = doc.company.timezone;
  const primary = safePrimary(doc.company.primary_color);
  const on = readableOn(primary);
  const dt = (v: string | null) => (v ? formatInstant(Date.parse(v), tz) : '—');
  const o = doc.order;
  const title = doc.kind === 'quote' && doc.quote ? `${TITLES.quote} nº ${o.number_text} — versão ${doc.quote.version_number}` : doc.kind === 'completion' && doc.completion ? `${TITLES.completion} — ${o.number_text} (versão ${doc.completion.version})` : `${TITLES.summary} ${o.number_text}`;
  return (
    <Document title={title} author={doc.company.name ?? 'Ordens de Serviço'} subject="Documento gerado pelo sistema de ordens de serviço" creator="Ordens de Serviço" producer="Ordens de Serviço">
      <Page size="A4" style={s.page} wrap>
        <View style={[s.band, { backgroundColor: primary }]}>
          <Text style={[s.company, { color: on }]}>{doc.company.name ?? 'Ordens de Serviço'}</Text>
          {/* Image do @react-pdf/renderer (PDF), não é <img> do HTML: não tem alt */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image src={{ data: logo.data, format: logo.format }} style={{ height: 28, objectFit: 'contain' }} /> : null}
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>Gerado em {dt(doc.generated_at)} (fuso {tz}). Dados do cliente conforme registrados na versão {doc.customer.snapshot_version} do atendimento.</Text>

        <Text style={s.h2}>Cliente e atendimento</Text>
        <View style={s.grid}>
          <Field label="Cliente">{doc.customer.name}</Field>
          <Field label="Telefone">{doc.customer.phone}</Field>
          <Field label="E-mail">{doc.customer.email}</Field>
          <Field label="Contato no local">{doc.customer.contact_name ? `${doc.customer.contact_name}${doc.customer.contact_phone ? ` — ${doc.customer.contact_phone}` : ''}` : null}</Field>
          <View style={{ width: '100%', marginBottom: 4 }}><Text style={s.label}>Endereço do atendimento</Text><Text>{addr(doc.customer.address)}</Text></View>
          <View style={{ width: '100%', marginBottom: 4 }}><Text style={s.label}>Equipamento</Text><Text>{eq(doc.customer.equipment)}</Text></View>
        </View>

        <Text style={s.h2}>Ordem de serviço</Text>
        <View style={s.grid}>
          <Field label="Número">{o.number_text}</Field>
          <Field label="Situação">{STATUS_LABEL[o.status]}</Field>
          <Field label="Assunto">{o.subject}</Field>
          <Field label="Prioridade">{PRIORITY_LABEL[o.priority]}</Field>
          <Field label="Aberta em">{dt(o.created_at)}</Field>
          <Field label="Janela planejada">{o.scheduled_start_at ? `${dt(o.scheduled_start_at)} até ${dt(o.scheduled_end_at)}` : null}</Field>
          <Field label="Execução iniciada">{dt(o.started_at)}</Field>
          <Field label="Concluída em">{dt(o.completed_at)}</Field>
          <View style={{ width: '100%', marginBottom: 4 }}><Text style={s.label}>Solicitação</Text><Text>{o.problem_description}</Text></View>
        </View>

        {doc.quote ? (
          <View>
            <Text style={s.h2}>Orçamento — versão {doc.quote.version_number}{doc.kind === 'summary' ? ` (${doc.quote.status === 'approved' ? 'aprovada' : doc.quote.status === 'published' ? 'aguardando decisão' : doc.quote.status === 'rejected' ? 'recusada' : doc.quote.status})` : ''}</Text>
            <View style={s.head}><Text style={[s.th, s.c1]}>Tipo</Text><Text style={[s.th, s.c2]}>Descrição</Text><Text style={[s.th, s.c3]}>Qtd.</Text><Text style={[s.th, s.c4]}>Unitário</Text><Text style={[s.th, s.c5]}>Total</Text></View>
            {doc.quote.items.map((it, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={s.c1}>{it.kind === 'service' ? 'Serviço' : 'Peça'}</Text><Text style={s.c2}>{it.description}</Text>
                <Text style={s.c3}>{q(it.quantity)} {it.unit}</Text><Text style={s.c4}>{formatCents(it.unit_price_cents)}</Text><Text style={s.c5}>{formatCents(it.line_total_cents)}</Text>
              </View>
            ))}
            <View style={s.totals}>
              <View style={s.trow}><Text>Subtotal</Text><Text>{formatCents(doc.quote.subtotal_cents)}</Text></View>
              <View style={s.trow}><Text>Desconto</Text><Text>- {formatCents(doc.quote.discount_cents)}</Text></View>
              <View style={[s.trow, { borderTopWidth: 1, borderTopColor: '#9ca3af', marginTop: 2, paddingTop: 3 }]}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Total</Text><Text style={{ fontFamily: 'Helvetica-Bold' }}>{formatCents(doc.quote.total_cents)}</Text></View>
            </View>
            <Text style={[s.small, { marginTop: 6 }]}>Válido até {dt(doc.quote.valid_until)}. Valores em reais; total de cada linha arredondado a centavos. Este documento não é nota fiscal nem cobrança.</Text>
            {doc.quote.terms ? <View style={s.box}><Text style={s.label}>Condições</Text><Text>{doc.quote.terms}</Text></View> : null}
            {doc.quote.notes ? <View style={s.box}><Text style={s.label}>Observações</Text><Text>{doc.quote.notes}</Text></View> : null}
            {doc.quote.decision ? (
              <View style={s.box} wrap={false}>
                <Text style={s.label}>Decisão sobre a versão {doc.quote.version_number}</Text>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{doc.quote.decision.decision === 'approved' ? 'APROVADO' : 'RECUSADO'} por {doc.quote.decision.declared_name} em {dt(doc.quote.decision.decided_at)}</Text>
                <Text style={s.small}>{doc.quote.decision.channel === 'customer_link' ? 'Registrado pelo link do cliente (aceite simples, sem verificação certificada de identidade).' : 'Registro MANUAL feito pela equipe da empresa (não é ação autenticada do cliente).'}</Text>
                <Text style={s.small}>Texto aceito: {doc.quote.decision.accepted_text}</Text>
              </View>
            ) : doc.quote.status === 'published' ? <View style={s.box}><Text>Aguardando a decisão do cliente.</Text></View> : null}
          </View>
        ) : null}

        {doc.completion ? (
          <View>
            <Text style={s.h2}>Conclusão do serviço — versão {doc.completion.version}{doc.completion.current ? '' : ' (substituída)'}</Text>
            <Text>{doc.completion.summary}</Text>
            <Text style={[s.small, { marginTop: 4 }]}>Concluída em {dt(doc.completion.completed_at)}.</Text>
            {doc.completion.parts.length ? (
              <View>
                <Text style={[s.label, { marginTop: 8 }]}>Peças utilizadas</Text>
                {doc.completion.parts.map((p, i) => <Text key={i}>• {p.description} — {q(p.quantity)} {p.unit}</Text>)}
              </View>
            ) : null}
            {doc.completion.checklist.length ? (
              <View>
                <Text style={[s.label, { marginTop: 8 }]}>Verificações realizadas</Text>
                {doc.completion.checklist.map((c, i) => <View key={i} style={s.row} wrap={false}><Text style={{ width: '70%' }}>{c.label}</Text><Text style={{ width: '30%', textAlign: 'right' }}>{answer(c.answer, c.not_applicable)}</Text></View>)}
              </View>
            ) : null}
            {doc.completion.acceptance ? (
              <View style={s.box} wrap={false}>
                <Text style={s.label}>Resposta do cliente à versão {doc.completion.version}</Text>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>{doc.completion.acceptance.decision === 'accepted' ? 'CONCLUSÃO ACEITA' : 'CONCLUSÃO CONTESTADA'} por {doc.completion.acceptance.declared_name} em {dt(doc.completion.acceptance.decided_at)}</Text>
                <Text style={s.small}>{doc.completion.acceptance.channel === 'customer_link' ? 'Registrado pelo link do cliente (aceite simples, sem verificação certificada de identidade).' : 'Registro MANUAL feito pela equipe da empresa (não é ação autenticada do cliente).'}</Text>
                {doc.completion.acceptance.note ? <Text style={s.small}>Observação: {doc.completion.acceptance.note}</Text> : null}
                <Text style={s.small}>Texto aceito: {doc.completion.acceptance.accepted_text}</Text>
              </View>
            ) : <View style={s.box}><Text>Aguardando o aceite do cliente.</Text></View>}
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{doc.company.name ?? ''} · {o.number_text}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
