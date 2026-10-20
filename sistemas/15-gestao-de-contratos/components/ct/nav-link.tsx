'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Link do menu com destaque da seção atual (inclui as páginas filhas, ex.: /ordens/123 mantém «Ordens de serviço» ativo). */
export function CtNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn('flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition', active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-black/5 dark:hover:bg-white/5')}
    >
      {children}
    </Link>
  );
}
