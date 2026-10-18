import type { Metadata } from 'next';
import Link from 'next/link';
import { TemplateForm } from '@/components/os/template-form';
import { PageHeader } from '@/components/ui/primitives';
import { pageCtx } from '@/lib/os/page';

export const metadata: Metadata = { title: 'Novo modelo de checklist' };

export default async function NewTemplatePage() {
  await pageCtx(['owner', 'manager']);
  return (
    <>
      <PageHeader title="Novo modelo de checklist" description="Defina os itens que o técnico deve verificar. Marque como obrigatório o que impede a conclusão se ficar sem resposta."><Link href="/modelos-checklist" className="text-sm underline underline-offset-2">Voltar</Link></PageHeader>
      <TemplateForm items={[]} extra={8} />
    </>
  );
}
