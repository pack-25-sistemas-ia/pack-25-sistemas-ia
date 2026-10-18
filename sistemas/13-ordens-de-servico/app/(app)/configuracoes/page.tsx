import type { Metadata } from 'next';
import { AreaF, ActionButton, FieldError, OsForm, SelectF, TextF } from '@/components/os/fields';
import { LogoForm } from '@/components/os/logo-form';
import { Section, TD, TH, TableShell } from '@/components/os/bits';
import { Badge, Card, PageHeader } from '@/components/ui/primitives';
import { cleanupOrphans } from '@/lib/os/actions/execution';
import { saveBrand, saveRules, setTechnicianActive } from '@/lib/os/actions/settings';
import { loadPeople } from '@/lib/os/data';
import { pageCtx } from '@/lib/os/page';
import { PROFILE_LABEL, type Profile } from '@/lib/os/status';

export const metadata: Metadata = { title: 'Configurações' };
const ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Cuiaba', 'America/Belem', 'America/Rio_Branco', 'America/Noronha', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'UTC'];

export default async function SettingsPage() {
  const c = await pageCtx(['owner']);
  const s = c.settings;
  const { data: org } = await c.ctx.supabase.from('organization_settings').select('display_name').eq('organization_id', c.org).maybeSingle();
  const people = await loadPeople(c);
  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];
  const mb = String(Math.round((s.attachment_max_size_bytes / 1024 / 1024) * 100) / 100).replace('.', ',');
  return (
    <>
      <PageHeader title="Configurações" description="Marca, regras do orçamento e do link, fuso horário, limite de arquivos e equipe técnica." />

      <Section title="Marca">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Nome e cor">
            <OsForm action={saveBrand} submit="Salvar marca" reset={false} className="grid gap-4">
              <>
                <TextF name="display_name" label="Nome exibido (também no link e nos PDFs do cliente)" def={s.public_display_name ?? (org as { display_name?: string } | null)?.display_name ?? c.ctx.membership.name} required max={80} />
                <label className="flex flex-col gap-1 text-sm font-medium">Cor principal
                  <input type="color" name="primary_color" defaultValue={s.primary_color} className="h-11 w-24 rounded-md border border-border bg-card p-1" />
                </label>
                <FieldError name="primary_color" />
              </>
            </OsForm>
          </Card>
          <Card title="Logotipo" description="PNG, JPG ou WebP de até 512 KB. SVG não é aceito (pode carregar scripts). No PDF o logotipo aparece em PNG/JPG.">
            <LogoForm hasLogo={!!s.logo_path} />
          </Card>
        </div>
      </Section>

      <Section title="Regras">
        <Card>
          <OsForm action={saveRules} submit="Salvar regras" reset={false}>
            <>
              <SelectF name="timezone" label="Fuso horário da empresa" def={s.timezone} opts={zones.map((z) => ({ value: z, label: z }))} span hint="Datas, janelas, painel e PDFs usam este fuso." />
              <TextF name="order_prefix" label="Prefixo do número" def={s.order_prefix} required max={6} hint="Ex.: OS → OS-00012." />
              <TextF name="quote_validity_days" label="Validade padrão do orçamento (dias)" def={String(s.quote_validity_days)} type="number" inputMode="numeric" required />
              <TextF name="link_ttl_days" label="Validade do link do cliente (dias)" def={String(s.link_ttl_days)} type="number" inputMode="numeric" required hint="Links já gerados mantêm a validade que tinham." />
              <TextF name="attachment_max_mb" label="Tamanho máximo por arquivo (MB)" def={mb} inputMode="decimal" required hint="Até 10 MB (limite de segurança)." />
              <AreaF name="default_quote_terms" label="Condições padrão do orçamento" def={s.default_quote_terms} max={2000} hint="Copiadas para cada novo orçamento; podem ser editadas por versão." />
              <AreaF name="retention_policy_text" label="Política de retenção e exclusão (texto exibido à equipe)" def={s.retention_policy_text} max={1000} hint="O sistema não exclui ordens pela interface (histórico auditável). Descreva por quanto tempo guarda os dados e como atende pedidos de exclusão/anonimização (veja docs/SECURITY.md)." />
            </>
          </OsForm>
        </Card>
      </Section>

      <Section title="Equipe técnica" description="Técnicos são membros com papel «Membro» no Core (veja «Pessoas e acessos»). Desativar um técnico devolve as ordens abertas dele à fila: agendadas voltam a «Abertas» e em execução ficam «Pausadas». O histórico dele é preservado.">
        <TableShell caption="Equipe" empty={people.length === 0}>
          <thead><tr><th className={TH}>Pessoa</th><th className={TH}>Perfil no sistema</th><th className={TH}>Situação</th><th className={TH}>Ação</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.user_id} className="border-t border-border">
                <td className={TD}>{p.name}<span className="block text-xs text-muted">{p.email}</span></td>
                <td className={TD}>{p.profile ? PROFILE_LABEL[p.profile as Profile] : p.role === 'viewer' ? 'Leitor (sem acesso às ordens)' : 'Desativado'}</td>
                <td className={TD}>{p.active ? <Badge tone="success">Ativo</Badge> : <Badge tone="warning">Desativado</Badge>}</td>
                <td className={TD}>{p.role === 'manager' || p.role === 'member' ? (p.user_id === c.userId ? <span className="text-xs text-muted">Você</span> : (
                  <ActionButton action={setTechnicianActive} fields={{ user: p.user_id, active: p.active ? 'false' : 'true' }} label={p.active ? 'Desativar' : 'Reativar'} confirm={p.active ? 'As ordens abertas dele voltam à fila. Continuar?' : undefined} variant={p.active ? 'danger' : 'primary'} />
                )) : <span className="text-xs text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Section>

      <Section title="Manutenção de arquivos">
        <Card description="Arquivos enviados mas nunca vinculados a uma ordem (ex.: envio interrompido) ficam órfãos. Esta ação remove os que têm mais de 2 horas.">
          <ActionButton action={cleanupOrphans} fields={{}} label="Limpar uploads órfãos" pending="Limpando…" />
        </Card>
      </Section>
    </>
  );
}
