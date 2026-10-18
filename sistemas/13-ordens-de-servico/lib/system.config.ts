// Configuração do sistema de Ordens de Serviço. Para personalizar para uma empresa:
//  1. troque `name`;  2. substitua public/brand/logo.svg (ou envie um logotipo em «Configurações»);  3. ajuste a navegação em `groups`.
// Perfis (ver docs/PERMISSIONS.md): owner = proprietário · manager = gestor/atendimento · technician = técnico (member do Core).
// Este arquivo é do sistema (listado em .core-overrides): o sync-core nunca o sobrescreve.
import type { Profile } from '@/lib/os/status';

export type NavItem = { href: string; label: string; profiles?: readonly Profile[] };
export type NavGroup = { title: string; items: NavItem[] };

const ALL: readonly Profile[] = ['owner', 'manager', 'technician'];
const MGMT: readonly Profile[] = ['owner', 'manager'];

export const systemConfig: { name: string; logo: string; groups: NavGroup[] } = {
  name: 'Ordens de Serviço',
  logo: '/brand/logo.svg',
  groups: [
    {
      title: 'Operação',
      items: [
        { href: '/dashboard', label: 'Visão geral', profiles: ALL },
        { href: '/ordens', label: 'Ordens de serviço', profiles: MGMT },
        { href: '/minhas-ordens', label: 'Minhas ordens', profiles: ALL },
        { href: '/agenda', label: 'Agenda de atendimentos', profiles: ALL },
      ],
    },
    {
      title: 'Cadastros',
      items: [
        { href: '/clientes', label: 'Clientes', profiles: MGMT },
        { href: '/equipamentos', label: 'Equipamentos', profiles: MGMT },
        { href: '/servicos', label: 'Serviços', profiles: MGMT },
        { href: '/pecas', label: 'Peças', profiles: MGMT },
        { href: '/modelos-checklist', label: 'Modelos de checklist', profiles: MGMT },
      ],
    },
    {
      title: 'Análise e empresa',
      items: [
        { href: '/relatorios', label: 'Relatórios', profiles: MGMT },
        { href: '/configuracoes', label: 'Configurações', profiles: ['owner'] },
      ],
    },
  ],
};
