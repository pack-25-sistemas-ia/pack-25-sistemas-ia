// Configuração do sistema de Gestão de Contratos e Vencimentos. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg (ou envie um logotipo em «Configurações»);  3. ajuste a navegação em `groups`.
// Perfis (ver docs/PERMISSIONS.md): owner = proprietário · manager = gestor · collaborator = colaborador (só contratos a que foi vinculado) · viewer = Leitor da empresa (só consulta).
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { OrgProfile } from '@/lib/ct/status';

export type NavItem = { href: string; label: string; profiles?: readonly OrgProfile[] };
export type NavGroup = { title: string; items: NavItem[] };

const ALL: readonly OrgProfile[] = ['owner', 'manager', 'collaborator', 'viewer'];

export const systemConfig: { name: string; logo: string; groups: NavGroup[] } = {
  name: 'Gestão de Contratos',
  logo: '/brand/logo.svg',
  groups: [
    {
      title: 'Contratos',
      items: [
        { href: '/dashboard', label: 'Painel', profiles: ALL },
        { href: '/contratos', label: 'Contratos', profiles: ALL },
        { href: '/partes', label: 'Partes', profiles: ALL },
        { href: '/prazos', label: 'Prazos e calendário', profiles: ALL },
        { href: '/obrigacoes', label: 'Obrigações', profiles: ALL },
        { href: '/reajustes', label: 'Reajustes', profiles: ALL },
        { href: '/notificacoes', label: 'Notificações', profiles: ALL },
        { href: '/relatorios', label: 'Relatórios', profiles: ALL },
        { href: '/arquivados', label: 'Arquivados', profiles: ALL },
      ],
    },
    {
      title: 'Empresa',
      items: [{ href: '/configuracoes', label: 'Configurações', profiles: ['owner', 'manager'] }],
    },
  ],
};
