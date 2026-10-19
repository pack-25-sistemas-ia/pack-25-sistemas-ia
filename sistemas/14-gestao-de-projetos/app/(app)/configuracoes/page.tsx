import type { Metadata } from 'next';
import { AreaF, FieldError, PjForm, SelectF, TextF } from '@/components/pj/fields';
import { LogoForm } from '@/components/pj/logo-form';
import { Section } from '@/components/pj/bits';
import { Card, PageHeader } from '@/components/ui/primitives';
import { saveBrand, saveRules } from '@/lib/pj/actions/settings';
import { pageCtx } from '@/lib/pj/page';

export const metadata: Metadata = { title: 'Configurações' };
const ZONES = ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Cuiaba', 'America/Belem', 'America/Rio_Branco', 'America/Noronha', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'UTC'];

export default async function SettingsPage() {
  const c = await pageCtx(['owner']);
  const s = c.settings;
  const { data: org } = await c.ctx.supabase.from('organization_settings').select('display_name').eq('organization_id', c.org).maybeSingle();
  const zones = ZONES.includes(s.timezone) ? ZONES : [s.timezone, ...ZONES];
  const mb = String(Math.round((s.attachment_max_size_bytes / 1024 / 1024) * 100) / 100).replace('.', ',');
  return (
    <>
      <PageHeader title="Configurações" description="Marca, fuso horário, prefixo dos números, limite de anexos e política de retenção. Pessoas e acessos ficam em «Pessoas e acessos»." />

      <Section title="Marca">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Nome e cor">
            <PjForm action={saveBrand} submit="Salvar marca" reset={false} className="grid gap-4">
              <>
                <TextF name="display_name" label="Nome exibido no sistema" def={(org as { display_name?: string } | null)?.display_name ?? c.ctx.membership.name} required max={80} />
                <label className="flex flex-col gap-1 text-sm font-medium">Cor principal
                  <input type="color" name="primary_color" defaultValue={s.primary_color} className="h-11 w-24 rounded-md border border-border bg-card p-1" />
                </label>
                <FieldError name="primary_color" />
              </>
            </PjForm>
          </Card>
          <Card title="Logotipo" description="PNG, JPG ou WebP de até 512 KB. SVG não é aceito (pode carregar scripts).">
            <LogoForm hasLogo={!!s.logo_path} />
          </Card>
        </div>
      </Section>

      <Section title="Regras">
        <Card>
          <PjForm action={saveRules} submit="Salvar regras" reset={false}>
            <>
              <SelectF name="timezone" label="Fuso horário da empresa" def={s.timezone} opts={zones.map((z) => ({ value: z, label: z }))} span hint="Define «hoje», atrasos e os períodos do painel." />
              <TextF name="project_prefix" label="Prefixo do número do projeto" def={s.project_prefix} required max={6} hint="Ex.: PRJ → PRJ-0003 (tarefas: PRJ-0003-12)." />
              <TextF name="attachment_max_mb" label="Tamanho máximo por anexo (MB)" def={mb} inputMode="decimal" required hint="Até 10 MB (limite de segurança)." />
              <AreaF name="retention_policy_text" label="Política de retenção e exclusão (texto exibido à equipe)" def={s.retention_policy_text} max={1000} hint="A interface não apaga projetos nem tarefas (histórico preservado). Descreva por quanto tempo guarda os dados e como atende pedidos de exclusão/anonimização (veja docs/SECURITY.md)." />
            </>
          </PjForm>
        </Card>
      </Section>
    </>
  );
}
