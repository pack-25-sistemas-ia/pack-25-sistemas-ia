import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/ui/primitives';
import type { ProjectView } from '@/lib/pj/data';
import type { PageCtx } from '@/lib/pj/page';
import { projectKey } from '@/lib/pj/page';
import { PROJECT_ROLE_LABEL, isReadOnlyProject } from '@/lib/pj/status';
import { DateOnly, ProjectStatusPill, Tabs } from './bits';

export type ProjectTab = 'quadro' | 'lista' | 'visao-geral' | 'membros' | 'atividade' | 'configuracoes';

/** Cabeçalho contextual do projeto (nome, status, período, papel) e as abas: Quadro, Lista, Visão geral, Membros, Atividade, Configurações. */
export function ProjectShell({ c, view, current, children, actions }: { c: PageCtx; view: ProjectView; current: ProjectTab; children: ReactNode; actions?: ReactNode }) {
  const p = view.project;
  const base = `/projetos/${p.id}`;
  const readOnly = isReadOnlyProject({ status: p.status, archived: p.archived_at !== null });
  const reason = p.archived_at ? 'Projeto arquivado: somente para consulta.' : p.status === 'completed' ? 'Projeto concluído: somente para consulta. A liderança pode reabri-lo, com motivo.'
    : p.status === 'cancelled' ? 'Projeto cancelado: somente para consulta. A liderança pode reabri-lo, com motivo.' : p.status === 'paused' ? 'Projeto pausado: comentários e organização seguem liberados; movimentações de execução ficam bloqueadas até retomar.'
    : p.status === 'planned' ? 'Projeto planejado: prepare as tarefas; a execução começa quando o projeto for ativado.' : null;
  return (
    <>
      <nav aria-label="Navegação estrutural" className="mb-2 text-sm text-muted"><Link href="/projetos" className="underline underline-offset-2">Projetos</Link> / <span>{projectKey(c.settings.project_prefix, p.project_number)}</span></nav>
      <PageHeader title={p.name} description={p.description ?? undefined}>{actions}</PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <ProjectStatusPill status={p.status} archived={p.archived_at !== null} />
        <span className="text-muted">Período: <DateOnly value={p.start_date} /> a <DateOnly value={p.due_date} /></span>
        <span className="text-muted">Seu papel: <strong className="text-foreground">{view.role ? PROJECT_ROLE_LABEL[view.role] : 'Consulta'}</strong></span>
      </div>
      {reason ? <p className={`mb-4 rounded-md border px-3 py-2 text-sm ${readOnly ? 'border-warning text-warning' : 'border-border text-muted'}`} role="note">{reason}</p> : null}
      <Tabs current={current} items={[
        { key: 'quadro', label: 'Quadro', href: base }, { key: 'lista', label: 'Lista', href: `${base}/lista` }, { key: 'visao-geral', label: 'Visão geral', href: `${base}/visao-geral` },
        { key: 'membros', label: 'Membros', href: `${base}/membros` }, { key: 'atividade', label: 'Atividade', href: `${base}/atividade` }, { key: 'configuracoes', label: 'Configurações', href: `${base}/configuracoes` },
      ]} />
      {children}
    </>
  );
}
