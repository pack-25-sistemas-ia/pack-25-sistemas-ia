// Configuração do sistema de Gestão de Projetos e Tarefas. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg (ou envie um logotipo em «Configurações»);  3. ajuste a navegação em `groups`.
// Perfis (ver docs/PERMISSIONS.md): owner = proprietário · manager = gestor · collaborator = colaborador (só projetos de que participa) · viewer = Leitor da empresa (só consulta).
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { OrgProfile } from '@/lib/pj/status';

export type NavItem = { href: string; label: string; profiles?: readonly OrgProfile[] };
export type NavGroup = { title: string; items: NavItem[] };

const ALL: readonly OrgProfile[] = ['owner', 'manager', 'collaborator', 'viewer'];
const MGMT: readonly OrgProfile[] = ['owner', 'manager'];
const WORKERS: readonly OrgProfile[] = ['owner', 'manager', 'collaborator'];

export const systemConfig: { name: string; logo: string; groups: NavGroup[] } = {
  name: 'Gestão de Projetos',
  logo: '/brand/logo.svg',
  groups: [
    {
      title: 'Trabalho',
      items: [
        { href: '/dashboard', label: 'Visão geral', profiles: ALL },
        { href: '/projetos', label: 'Meus projetos', profiles: ALL },
        { href: '/minhas-tarefas', label: 'Minhas tarefas', profiles: WORKERS },
        { href: '/tarefas', label: 'Todas as tarefas', profiles: ALL },
        { href: '/arquivados', label: 'Arquivados', profiles: ALL },
        { href: '/notificacoes', label: 'Notificações', profiles: ALL },
      ],
    },
    {
      title: 'Empresa',
      items: [{ href: '/configuracoes', label: 'Configurações', profiles: ['owner'] }],
    },
  ],
};
export const MANAGEMENT = MGMT;
