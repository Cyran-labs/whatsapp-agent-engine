'use client';

import { Fragment, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { Skeleton } from '@/components/ui/skeleton';

export interface Crumb {
  /** Nul : libellé encore en lecture (nom d'un agent IA) ; un squelette tient sa place, ni lien ni segment vide. */
  label: string | null;
  href?: string;
}

const SEGMENT = 'min-w-0 max-w-[260px] truncate';

/**
 * Barre du haut d'une page (spec 5.3, choix P-4) : fil d'Ariane à gauche, qui commence par le nom de l'organisation
 * active (lien vers la liste des agents IA) ou par « Mon compte », et action principale à droite. Collante en haut
 * de la zone de contenu ; chaque page rend la sienne.
 */
export function PageBar({ trail, action, root = 'organisation' }: { trail: Crumb[]; action?: ReactNode; root?: 'organisation' | 'account' }) {
  const t = useTranslations('shell.pageBar');
  const { activeOrg } = useSession();

  const first: Crumb | null =
    root === 'account'
      ? { label: t('account'), href: '/account/organisations' }
      : activeOrg
        ? { label: activeOrg.name, href: '/' }
        : null;
  const crumbs = first ? [first, ...trail] : trail;
  const lastIndex = crumbs.length - 1;

  return (
    <div className="sticky top-0 z-20 flex h-14 flex-shrink-0 items-center gap-4 border-b border-border bg-bg px-8">
      <nav aria-label={t('label')} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-[13px] text-muted-2">
          {crumbs.map((crumb, index) => (
            <Fragment key={`${index}-${crumb.label ?? ''}`}>
              {index > 0 && (
                <li aria-hidden="true" className="shrink-0">
                  ›
                </li>
              )}
              <li className="flex min-w-0">
                {crumb.label === null ? (
                  <Skeleton className="h-3.5 w-24" />
                ) : index === lastIndex ? (
                  <span aria-current="page" title={crumb.label} className={`${SEGMENT} font-semibold text-fg`}>
                    {crumb.label}
                  </span>
                ) : crumb.href ? (
                  <Link
                    href={crumb.href}
                    title={crumb.label}
                    className={`${SEGMENT} ${index === 0 && root === 'organisation' ? 'font-semibold text-fg' : ''} hover:text-fg hover:underline`}
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span title={crumb.label} className={SEGMENT}>
                    {crumb.label}
                  </span>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
