'use client';

import type { ReactNode } from 'react';
import type { BotStatus } from '@wabagent/contracts';
import { Link } from '@/i18n/routing';
import { Skeleton } from '@/components/ui/skeleton';
import { MENTION_STYLE, STATUS_STYLE } from '@/components/agents/status-style';
import { cn } from '@/lib/utils';
import { ComingSoon } from './coming-soon';
import { OrgBlock } from './org-block';

export interface ColumnItem {
  key: string;
  label: string;
  href: string | null;
  icon?: ReactNode;
  count?: number;
  /** Compteur en cours de chargement : pastille squelette à la place du nombre. */
  countLoading?: boolean;
  /** Point de couleur d'un statut (`STATUS_STYLE`) ou de la mention « Ne répond pas » (`danger`). */
  dot?: BotStatus | 'danger';
  /** Entrée à venir : grisée, pastille « Soon », cette bulle au survol et au focus (spec 5.2). */
  tooltip?: string;
  /** Texte rouge à droite, à la place du compteur (par exemple « 1 en erreur »). */
  alert?: string;
  /** Lien qui change d'espace : « ↗ » et le nom de l'espace de destination après le libellé (A-7). */
  external?: string;
}

export interface ColumnGroup {
  label?: string;
  /** Petite étiquette après le libellé du groupe (« Entité »). */
  tag?: string;
  items: ColumnItem[];
  /** Ligne sous les éléments (par exemple le regroupement par entité indisponible). */
  notice?: ReactNode;
}

const ITEM_BASE = 'mb-px flex items-center gap-2.5 rounded-md px-[11px] py-[9px] text-[13.5px]';
const GROUP_LABEL = 'text-[10.5px] font-bold uppercase tracking-[1.3px] text-muted-2';

function Lead({ item }: { item: ColumnItem }) {
  if (item.dot) {
    const dot = item.dot === 'danger' ? MENTION_STYLE.dot : STATUS_STYLE[item.dot].dot;
    return <span data-dot="" className={cn('mx-1 h-2 w-2 flex-shrink-0 rounded-full', dot)} aria-hidden="true" />;
  }
  if (item.icon) {
    return (
      <span className="w-4 text-center opacity-80" aria-hidden="true">
        {item.icon}
      </span>
    );
  }
  return null;
}

function Trailing({ item }: { item: ColumnItem }) {
  if (item.alert) return <span className="ml-auto shrink-0 text-[11px] font-semibold text-danger-ink">{item.alert}</span>;
  if (item.countLoading) return <Skeleton className="ml-auto h-3 w-5" />;
  if (item.count !== undefined) return <span className="ml-auto text-[11px] font-normal text-muted-2">{item.count}</span>;
  return null;
}

/**
 * Colonne blanche entre le rail et la page (spec 5.2) : bloc Organisation en tête (sauf pages du compte),
 * en-tête de l'espace, groupes d'entrées, pied éventuel (« Se déconnecter »).
 */
export function MiddleColumn({
  withOrg = true,
  kicker,
  title,
  titleClassName = 'text-lg',
  groups,
  activeKey,
  footer,
}: {
  withOrg?: boolean;
  kicker?: string;
  title?: ReactNode;
  /** Taille et rupture du titre (par défaut `text-lg`) ; ex. une adresse e-mail longue. */
  titleClassName?: string;
  groups: ColumnGroup[];
  activeKey: string;
  footer?: ReactNode;
}) {
  return (
    <aside className="flex w-[236px] flex-shrink-0 flex-col border-r border-border bg-surface">
      {withOrg && <OrgBlock />}
      <div className="flex-1 overflow-auto p-[14px_12px]">
        {(kicker || title) && (
          <div className="mb-1 px-2.5 pb-1 pt-1">
            {kicker && <div className={GROUP_LABEL}>{kicker}</div>}
            {title && <div className={cn('font-serif leading-tight', titleClassName, kicker && 'mt-0.5')}>{title}</div>}
          </div>
        )}
        {groups.map((group, index) => (
          <div key={group.label ?? index}>
            {group.label && (
              <div className={cn('flex items-center gap-1.5 px-[11px] pb-1.5 pt-3.5', GROUP_LABEL)}>
                {group.label}
                {group.tag && (
                  <span className="rounded-pill border border-border px-1.5 text-[10px] font-normal normal-case tracking-normal">
                    {group.tag}
                  </span>
                )}
              </div>
            )}
            {group.items.map((item) => {
              if (item.tooltip) {
                return (
                  <ComingSoon key={item.key} tooltip={item.tooltip} badge className={cn(ITEM_BASE, 'text-muted-2')}>
                    <Lead item={item} />
                    <span className="min-w-0">{item.label}</span>
                  </ComingSoon>
                );
              }
              if (item.href === null) {
                return (
                  <div key={item.key} className={cn(ITEM_BASE, 'cursor-default text-muted-2')}>
                    <Lead item={item} />
                    <span className="min-w-0">{item.label}</span>
                  </div>
                );
              }
              const isActive = item.key === activeKey;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    ITEM_BASE,
                    isActive
                      ? 'bg-surface-subtle font-semibold text-fg shadow-[inset_0_0_0_1px_var(--border)]'
                      : 'text-muted hover:bg-surface-subtle',
                  )}
                >
                  <Lead item={item} />
                  {item.label}
                  {item.external && (
                    <span className="whitespace-nowrap text-[11px] font-normal text-muted-2">↗ {item.external}</span>
                  )}
                  <Trailing item={item} />
                </Link>
              );
            })}
            {group.notice}
          </div>
        ))}
      </div>
      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </aside>
  );
}
