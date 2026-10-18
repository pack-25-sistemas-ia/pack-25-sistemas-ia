import type { Metadata } from 'next';
import Link from 'next/link';
import { TD, TH, TableShell } from '@/components/os/bits';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { pageCtx } from '@/lib/os/page';

export const metadata: Metadata = { title: 'Modelos de checklist' };
type Row = { id: string; name: string; description: string | null; active: boolean; checklist_template_items: Array<{ count: number }> };

export default async function TemplatesPage() {
  const c = await pageCtx(['owner', 'manager']);
  const { data } = await c.ctx.supabase.from('checklist_templates').select('id, name, description, active, checklist_template_items(count)').eq('organization_id', c.org).order('active', { ascending: false }).order('name');
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Modelos de checklist" description="Listas de verificação reutilizáveis. Ao aplicar um modelo a uma ordem, os itens são COPIADOS: alterar o modelo depois não muda ordens existentes.">
        <Link href="/modelos-checklist/novo" className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Novo modelo</Link>
      </PageHeader>
      <TableShell caption="Modelos de checklist" empty={rows.length === 0} emptyText="Nenhum modelo ainda. Crie o primeiro para padronizar o atendimento.">
        <thead><tr><th className={TH}>Modelo</th><th className={TH}>Itens</th><th className={TH}>Situação</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-border"><td className={TD}><Link className="font-medium underline underline-offset-2" href={`/modelos-checklist/${r.id}`}>{r.name}</Link>{r.description ? <span className="block text-xs text-muted">{r.description}</span> : null}</td><td className={TD}>{r.checklist_template_items[0]?.count ?? 0}</td><td className={TD}>{r.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}</td></tr>)}</tbody>
      </TableShell>
    </>
  );
}
