'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { Bot, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { href: '/', key: 'agents', icon: Bot },
  { href: '/usage', key: 'usage', icon: BarChart3 },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <aside className="flex w-56 flex-col gap-1 border-r border-border bg-surface p-4">
      <span className="mb-4 px-2 font-serif text-lg text-brand">WABAGENT</span>
      {items.map(({ href, key, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-fg hover:bg-bg',
            pathname === href && 'bg-accent-soft font-medium',
          )}
        >
          <Icon className="h-4 w-4" />
          {t(key)}
        </Link>
      ))}
    </aside>
  );
}
