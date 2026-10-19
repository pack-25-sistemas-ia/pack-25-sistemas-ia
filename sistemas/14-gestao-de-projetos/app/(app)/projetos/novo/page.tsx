import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/primitives';
import { AreaF, PjForm, SelectF, TextF } from '@/components/pj/fields';
import { createProject } from '@/lib/pj/actions/projects';
import { pageCtx } from '@/lib/pj/page';

export const metadata: Metadata = { title: 'Novo projeto' };

export default async function NewProjectPage() {
  await pageCtx(['owner', 'manager']);
  return (
    <>
      <PageHeader title="Novo projeto" description="O quadro nasce com as etapas A fazer, Em andamento, Em revisão e Concluído (você pode renomear e criar outras). Os participantes são adicionados depois, na aba Membros." />
      <PjForm action={createProject} submit="Criar projeto" pending="Criando…" reset={false} className="grid max-w-3xl gap-4 sm:grid-cols-4">
        <div className="sm:col-span-4"><TextF name="name" label="Nome do projeto" required max={120} /></div>
        <AreaF name="description" label="Descrição (opcional)" max={4000} />
        <TextF name="start_date" label="Início (opcional)" type="date" />
        <TextF name="due_date" label="Entrega (opcional)" type="date" />
        <SelectF name="status" label="Como começa" def="planned" opts={[{ value: 'planned', label: 'Planejado (prepara tarefas)' }, { value: 'active', label: 'Ativo (executa já)' }]} span />
      </PjForm>
    </>
  );
}
