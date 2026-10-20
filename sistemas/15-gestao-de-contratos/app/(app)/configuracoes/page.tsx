import type { Metadata } from 'next';
import { AreaF, CheckF, CtForm, FieldError, SelectF, TextF, ActionButton } from '@/components/ct/fields';
import { LogoForm } from '@/components/ct/logo-form';
import { TokenForm } from '@/components/ct/token-form';
import { DateTimeLocal, Section } from '@/components/ct/bits';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { runRemindersNow, saveReminderRule } from '@/lib/ct/actions/jobs';
import { saveBrand, saveRules } from '@/lib/ct/actions/settings';
import { saveCategory } from '@/lib/ct/actions/contracts';
import { listCategories, loadRunInfo } from '@/lib/ct/data';
import { pageCtx } from '@/lib/ct/page';

export const metadata: Metadata = { title: 'Configurações' };
const ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Cuiaba', 'America/Belem', 'America/Rio_Branco', 'America/Noronha', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Lisbon', 'Europe/London', 'UTC'];
const EVENT_LABEL: Record<string, string> = { contract_end: 'Fim de vigência', notice: 'Prazo de aviso', adjustment: 'Reajuste previsto', obligation: 'Obrigação' };

export default async function SettingsPage() {
  const c = await pageCtx(['owner', 'manager']);
  const s = c.settings;
  const [{ data: org }, rules, cats, run] = await Promise.all([
    c.ctx.supabase.from('organization_settings').select('display_name').eq('organization_id', c.org).maybeSingle(),
    c.ctx.supabase.from('reminder_rules').select('event_type, offsets_days, active').eq('organization_id', c.org).order('event_type'),
    listCategories(c), loadRunInfo(c)]);
  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];
  const mb = String(Math.round((s.attachment_max_size_bytes / 1024 / 1024) * 100) / 100).replace('.', ',');
  const ruleRows = (rules.data ?? []) as Array<{ event_type: string; offsets_days: number[]; active: boolean }>;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://seu-dominio';
  return (
    <>
      <PageHeader title="Configurações" description={c.isOwner ? 'Marca, fuso horário, prefixo dos números, limite de arquivos, lembretes e categorias. Pessoas e acessos ficam em «Pessoas e acessos».' : 'Lembretes e categorias de contrato. Marca e regras da empresa são do proprietário.'} />

      {c.isOwner ? (
        <Section title="Marca">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Nome e cor">
              <CtForm action={saveBrand} submit="Salvar marca" reset={false} className="grid gap-4">
                <>
                  <TextF name="display_name" label="Nome exibido no sistema" def={(org as { display_name?: string } | null)?.display_name ?? c.ctx.membership.name} required max={80} />
                  <label className="flex flex-col gap-1 text-sm font-medium">Cor principal
                    <input type="color" name="primary_color" defaultValue={s.primary_color} className="h-11 w-24 rounded-md border border-border bg-card p-1" />
                  </label>
                  <FieldError name="primary_color" />
                </>
              </CtForm>
            </Card>
            <Card title="Logotipo" description="PNG, JPG ou WebP de até 512 KB. SVG não é aceito (pode carregar scripts).">
              <LogoForm hasLogo={!!s.logo_path} />
            </Card>
          </div>
        </Section>
      ) : null}

      {c.isOwner ? (
        <Section title="Regras">
          <Card>
            <CtForm action={saveRules} submit="Salvar regras" reset={false}>
              <>
                <SelectF name="timezone" label="Fuso horário da empresa" def={s.timezone} opts={zones.map((z) => ({ value: z, label: z }))} span hint="Define «hoje», o que está vencido e quando cada lembrete é devido." />
                <TextF name="contract_prefix" label="Prefixo do número do contrato" def={s.contract_prefix} required max={6} hint="Ex.: CTR → CTR-0003." />
                <TextF name="attachment_max_mb" label="Tamanho máximo por documento (MB)" def={mb} inputMode="decimal" required hint="Até 20 MB (limite de segurança)." />
                <TextF name="near_end_days" label="«Próximo do fim» (dias)" def={String(s.near_end_days)} inputMode="numeric" required hint="Quantos dias antes do fim o contrato aparece como «Próximo do fim»." />
                <AreaF name="retention_policy_text" label="Política de retenção e exclusão (texto exibido à equipe)" def={s.retention_policy_text} max={1000} hint="A interface não apaga contratos nem documentos: arquiva. A exclusão/anonimização é administrativa (docs/SECURITY.md)." />
              </>
            </CtForm>
          </Card>
        </Section>
      ) : null}

      <Section title="Categorias de contrato">
        <Card>
          <ul className="mb-4 grid gap-2" aria-label="Categorias">
            {cats.length === 0 ? <li className="text-sm text-muted">Nenhuma categoria. Crie a primeira abaixo.</li> : null}
            {cats.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 text-sm">
                <CtForm action={saveCategory} submit="Salvar" reset={false} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={x.id} />
                  <TextF name="name" label="Nome" def={x.name} required max={80} />
                  <CheckF name="active" label="Ativa" def={x.active} />
                </CtForm>
                {!x.active ? <Badge tone="warning">Inativa</Badge> : null}
              </li>
            ))}
          </ul>
          <CtForm action={saveCategory} submit="Criar categoria" reset className="flex flex-wrap items-end gap-3"><TextF name="name" label="Nova categoria" required max={80} /></CtForm>
        </Card>
      </Section>

      <Section title="Lembretes" description="Notificações internas antes do fim de vigência, do prazo de aviso, do reajuste e das obrigações. Os prazos aparecem no painel e no calendário mesmo sem o agendador.">
        <Card title="Antecedências (em dias antes da data)">
          <div className="grid gap-4">
            {ruleRows.map((r) => (
              <CtForm key={r.event_type} action={saveReminderRule} submit="Salvar" reset={false} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="event" value={r.event_type} />
                <TextF name="offsets" label={EVENT_LABEL[r.event_type] ?? r.event_type} def={r.offsets_days.join(', ')} required hint="Ex.: 60, 30, 15, 7 (de 1 a 8 valores, de 0 a 365)." />
                <CheckF name="active" label="Ativo" def={r.active} />
              </CtForm>
            ))}
          </div>
        </Card>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Processamento" description="Execução idempotente: repetir não duplica notificações; execução atrasada consolida os avisos vencidos em um só.">
            <p className="mb-3 text-sm">{run.last ? <>Última execução: <DateTimeLocal value={run.last.started_at} tz={c.tz} /> — {run.last.reminders_sent} enviado(s), {run.last.reminders_consolidated} consolidado(s), {run.last.errors} erro(s) ({run.last.trigger === 'scheduler' ? 'agendador' : 'manual'}).</> : <span className="text-warning">Nenhuma execução registrada. Configure o agendador (abaixo) ou execute manualmente.</span>}</p>
            <ActionButton action={runRemindersNow} fields={{}} label="Processar lembretes agora" variant="primary" />
          </Card>
          {c.isOwner ? (
            <Card title="Agendador (cron)" description="Para os lembretes saírem sozinhos, agende uma chamada diária ao endereço abaixo. Veja docs/REMINDERS.md.">
              <p className="mb-2 break-all text-sm"><code>POST {appUrl}/api/jobs/lembretes</code> com o cabeçalho <code>Authorization: Bearer &lt;token&gt;</code></p>
              <TokenForm endpoint={`${appUrl}/api/jobs/lembretes`} />
            </Card>
          ) : null}
        </div>
      </Section>
    </>
  );
}
