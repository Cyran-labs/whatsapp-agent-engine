'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Skeleton } from '@/components/ui/skeleton';

export interface RailItem {
  key: string;
  label: string;
  href: string | null;
  icon?: string;
  count?: number;
  /** Compteur en cours de chargement : pastille squelette à la place du nombre. */
  countLoading?: boolean;
  dot?: 'success' | 'warning' | 'neutral';
  soon?: boolean;
}

export interface RailGroup {
  label?: string;
  items: RailItem[];
  /** Ligne sous les éléments (par exemple le regroupement par entité indisponible). */
  notice?: React.ReactNode;
}

const DOT_CLASS: Record<NonNullable<RailItem['dot']>, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-muted-2',
};

const ITEM_BASE = 'mb-px flex items-center gap-2.5 rounded-md px-[11px] py-[9px] text-[13.5px]';

export function Rail({
  kicker,
  title,
  titleClassName = 'text-lg',
  header,
  groups,
  activeKey,
}: {
  kicker?: string;
  title: React.ReactNode;
  /** Taille et rupture du titre (par défaut `text-lg`) ; ex. une adresse e-mail longue. */
  titleClassName?: string;
  header?: React.ReactNode;
  groups: RailGroup[];
  activeKey: string;
}) {
  const t = useTranslations('common');

  const lead = (item: RailItem) => {
    if (item.dot) {
      return <span className={`mx-1 h-2 w-2 rounded-full ${DOT_CLASS[item.dot]}`} aria-hidden="true" />;
    }
    if (item.icon) {
      return (
        <span className="w-4 text-center opacity-80" aria-hidden="true">
          {item.icon}
        </span>
      );
    }
    return null;
  };

  return (
    <aside className="w-[236px] flex-shrink-0 overflow-auto border-r border-border bg-surface p-[18px_12px]">
      <div className="mb-3 border-b border-border px-2.5 pb-4 pt-1.5">
        {kicker && (
          <div className="text-[10.5px] font-bold uppercase tracking-[1.3px] text-muted-2">{kicker}</div>
        )}
        <div className={`font-serif leading-tight ${titleClassName} ${kicker ? 'mt-0.5' : ''}`}>{title}</div>
        {header && <div className="mt-1.5">{header}</div>}
      </div>
      {groups.map((group, index) => (
        <div key={group.label ?? index}>
          {group.label && (
            <div className="px-[11px] pb-1.5 pt-3.5 text-[10.5px] font-bold uppercase tracking-[1.3px] text-muted-2">
              {group.label}
            </div>
          )}
          {group.items.map((item) => {
            if (item.soon || item.href === null) {
              return (
                <div key={item.key} className={`${ITEM_BASE} cursor-default text-muted-2`}>
                  {lead(item)}
                  <span className="min-w-0">{item.label}</span>
                  {item.soon && (
                    <span className="ml-auto shrink-0 whitespace-nowrap rounded-pill border border-border px-[7px] py-px text-[9.5px] uppercase tracking-wide text-muted-2">
                      {t('comingSoon')}
                    </span>
                  )}
                </div>
              );
            }
            const isActive = item.key === activeKey;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`${ITEM_BASE} ${
                  isActive
                    ? 'bg-accent-soft font-semibold text-fg shadow-[inset_3px_0_0_var(--accent-ink)]'
                    : 'text-muted hover:bg-surface-subtle'
                }`}
              >
                {lead(item)}
                {item.label}
                {item.countLoading ? (
                  <Skeleton className="ml-auto h-3 w-5" />
                ) : (
                  item.count !== undefined && <span className="ml-auto text-[11px] font-normal text-muted-2">{item.count}</span>
                )}
              </Link>
            );
          })}
          {group.notice}
        </div>
      ))}
    </aside>
  );
}
