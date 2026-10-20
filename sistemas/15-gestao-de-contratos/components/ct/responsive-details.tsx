'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Painel recolhível no celular e sempre aberto no desktop. O conteúdo é renderizado UMA vez (sem duplicar formulários):
 * começa aberto (funciona sem JavaScript e no desktop) e é recolhido no celular logo após a hidratação; no desktop o título some.
 */
export function ResponsiveDetails({ summary, children }: { summary: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !window.matchMedia('(min-width: 1024px)').matches) el.open = false;
  }, []);
  return (
    <details ref={ref} open className="rounded-lg border-border lg:border-0 [&:not([open])]:border [&:not([open])]:bg-card max-lg:border max-lg:bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm font-medium lg:hidden">{summary}</summary>
      <div className="p-3 max-lg:border-t max-lg:border-border lg:p-0">{children}</div>
    </details>
  );
}
