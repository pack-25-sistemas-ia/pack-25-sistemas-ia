import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TemplateForm, type TemplateItem } from '@/components/os/template-form';
import { PageHeader } from '@/components/ui/primitives';
import { pageCtx } from '@/lib/os/page';
import { uuidOrNull } from '@/lib/os/query';

export const metadata: Metadata = { title: 'Modelo de checklist' };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const c = await pageCtx(['owner', 'manager']);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const s = c.ctx.supabase;
  const [{ data: t }, { data: items }] = await Promise.all([
    s.from('checklist_templates').select('id, name, description, active').eq('id', id).eq('organization_id', c.org).maybeSingle(),
    s.from('checklist_template_items').select('label, kind, options, required, allow_na, require_photo, note_rule').eq('template_id', id).order('position'),
  ]);
  if (!t) notFound();
  const tpl = t as { id: string; name: string; description: string | null; active: boolean };
  return (
    <>
      <PageHeader title={tpl.name} description="Alterações valem para as PRÓXIMAS ordens. Ordens que já aplicaram este modelo guardam a própria cópia dos itens."><Link href="/modelos-checklist" className="text-sm underline underline-offset-2">Voltar</Link></PageHeader>
      <TemplateForm id={tpl.id} name={tpl.name} description={tpl.description} active={tpl.active} items={(items ?? []) as TemplateItem[]} />
    </>
  );
}
