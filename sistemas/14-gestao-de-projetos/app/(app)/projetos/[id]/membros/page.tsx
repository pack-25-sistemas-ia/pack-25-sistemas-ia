import type { Metadata } from 'next';
import { PjForm, SelectF } from '@/components/pj/fields';
import { Disclosure, Section, TD, TH, TableShell, DateTimeLocal } from '@/components/pj/bits';
import { ProjectShell } from '@/components/pj/project-shell';
import { addMember, removeMember, setMemberRole } from '@/lib/pj/actions/projects';
import { loadProject } from '@/lib/pj/data';
import { pageCtx } from '@/lib/pj/page';
import { PROFILE_LABEL, PROJECT_ROLE_LABEL, allowedProjectRoles, canLeadRole, projectAllows, type OrgProfile, type ProjectRole } from '@/lib/pj/status';

export const metadata: Metadata = { title: 'Membros do projeto' };
type Person = { user_id: string; name: string; email: string; profile: OrgProfile | null };

const ROLE_OPTS = (roles: ProjectRole[]) => roles.map((r) => ({ value: r, label: PROJECT_ROLE_LABEL[r] }));

export default async function MembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await pageCtx();
  const view = await loadProject(c, id);
  const lead = canLeadRole(view.role);
  const state = { status: view.project.status, archived: view.project.archived_at !== null };
  const writable = lead && projectAllows(state, 'organize');
  const { data } = lead ? await c.ctx.supabase.rpc('pj_people', { p_org: c.org, p_project: id }) : { data: [] };
  const everyone = ((data ?? []) as Array<{ user_id: string; name: string; email: string; profile: OrgProfile | null }>) as Person[];
  const memberIds = new Set(view.members.map((m) => m.user_id));
  const candidates = everyone.filter((p) => !memberIds.has(p.user_id) && (p.profile === 'collaborator' || p.profile === 'viewer'));
  const management = view.people.filter((p) => p.project_role === 'lead' && !memberIds.has(p.user_id) && p.member);
  const nameById = new Map(everyone.map((p) => [p.user_id, p]));
  const assignable = view.people.filter((p) => p.assignable).map((p) => ({ value: p.user_id, label: p.name }));
  const treat = (
    <>
      <SelectF name="task_action" label="Se a pessoa tiver tarefas abertas" placeholder="Escolha o que fazer" opts={[{ value: 'unassign', label: 'Deixar sem responsável' }, { value: 'transfer', label: 'Transferir para outra pessoa' }]} />
      <SelectF name="transfer_to" label="Transferir para" placeholder="(só se transferir)" opts={assignable} />
    </>
  );
  return (
    <ProjectShell c={c} view={view} current="membros">
      <Section title="Participantes" description="Colaboradores só enxergam os projetos de que participam. Proprietário e gestor atuam como líder em todos os projetos e não precisam ser adicionados. Remover alguém revoga o acesso na hora.">
        <TableShell caption="Participantes do projeto" empty={view.members.length === 0 && management.length === 0} emptyText="Nenhum participante ainda.">
          <thead><tr className="border-b border-border"><th className={TH} scope="col">Pessoa</th><th className={TH} scope="col">Papel na empresa</th><th className={TH} scope="col">Papel no projeto</th><th className={TH} scope="col">Desde</th>{writable ? <th className={TH} scope="col">Ações</th> : null}</tr></thead>
          <tbody>
            {management.map((m) => (
              <tr key={m.user_id} className="border-b border-border"><td className={TD}>{m.name}</td><td className={TD}>Gestão</td><td className={TD}>Líder (todos os projetos)</td><td className={TD}>—</td>{writable ? <td className={TD} /> : null}</tr>
            ))}
            {view.members.map((m) => {
              const person = view.people.find((p) => p.user_id === m.user_id);
              const orgProfile = nameById.get(m.user_id)?.profile ?? null;
              return (
                <tr key={m.user_id} className="border-b border-border align-top last:border-0">
                  <td className={TD}>{person?.name ?? 'Pessoa'}</td>
                  <td className={TD}>{orgProfile ? PROFILE_LABEL[orgProfile] : '—'}</td>
                  <td className={TD}>{PROJECT_ROLE_LABEL[m.project_role]}</td>
                  <td className={TD}><DateTimeLocal value={m.created_at} tz={c.tz} /></td>
                  {writable ? (
                    <td className={TD}>
                      <Disclosure summary="Alterar papel">
                        <PjForm action={setMemberRole} submit="Salvar papel" pending="Salvando…" reset={false} className="grid gap-3">
                          <input type="hidden" name="project" value={id} /><input type="hidden" name="user" value={m.user_id} />
                          <SelectF name="role" label="Papel no projeto" def={m.project_role} opts={ROLE_OPTS(orgProfile ? allowedProjectRoles(orgProfile) : ['lead', 'editor', 'reader'])} />
                          {treat}
                        </PjForm>
                      </Disclosure>
                      <div className="mt-2"><Disclosure summary="Remover do projeto" tone="danger">
                        <PjForm action={removeMember} submit="Remover" variant="danger" pending="Removendo…" reset={false} className="grid gap-3">
                          <input type="hidden" name="project" value={id} /><input type="hidden" name="user" value={m.user_id} />
                          {treat}
                        </PjForm>
                      </Disclosure></div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      </Section>
      {writable ? (
        <Section title="Adicionar participante" description="Só membros ativos da empresa. O papel «Leitor» da empresa só pode ser leitor no projeto.">
          {candidates.length === 0 ? <p className="text-sm text-muted">Todas as pessoas elegíveis já participam deste projeto. Convide mais pessoas em «Pessoas e acessos».</p> : (
            <PjForm action={addMember} submit="Adicionar ao projeto" pending="Adicionando…" className="grid gap-4 sm:grid-cols-4">
              <input type="hidden" name="project" value={id} />
              <SelectF name="user" label="Pessoa" required placeholder="Escolha uma pessoa" opts={candidates.map((p) => ({ value: p.user_id, label: `${p.name} (${p.profile ? PROFILE_LABEL[p.profile] : ''})` }))} span />
              <SelectF name="role" label="Papel no projeto" def="editor" opts={ROLE_OPTS(['lead', 'editor', 'reader'])} hint="Líder gerencia etapas, membros e tarefas; Editor cria e atualiza; Leitor só consulta." />
            </PjForm>
          )}
        </Section>
      ) : null}
    </ProjectShell>
  );
}
