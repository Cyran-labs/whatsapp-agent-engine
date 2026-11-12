'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { AppRail, AppRailView } from './app-rail';
import { MiddleColumn } from './middle-column';
import { PageContent, PageHeader } from './page-header';

/**
 * Lecture de la session en échec, sur place (spec en-tête 7.3, C-8) : le titre est le message, suivi de « Réessayer »,
 * indisponible avec « Lecture en cours. » pendant la relecture (D-109). Aucune donnée de page n'est rendue.
 * - `session` : une session a déjà été lue par cet onglet ; rail et bloc Organisation de cette session, lus dans son
 *   contexte (le seul fourni par `SessionProvider`), colonne réduite à ce bloc.
 * - `neutral` : aucune session lue ; rail sans organisation ni compte (marque, Aide, Compte), colonne vide. Rien d'une
 *   session précédente (organisation, bandeau stocké) n'y paraît.
 */
export function SessionUnreadable({
  frame,
  onRetry,
  retrying,
}: {
  frame: 'session' | 'neutral';
  onRetry: () => void;
  retrying: boolean;
}) {
  const t = useTranslations('shell.sessionUnreadable');
  const tc = useTranslations('common');
  return (
    <div className="flex h-screen flex-col bg-bg">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {frame === 'session' ? (
          <AppRail active={null} />
        ) : (
          <AppRailView active={null} withOrg={false} isAdmin={false} account={null} />
        )}
        {frame === 'session' ? (
          <MiddleColumn groups={[]} activeKey="" />
        ) : (
          <aside className="flex w-[236px] flex-shrink-0 flex-col border-r border-border bg-surface" />
        )}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-auto">
          <PageContent>
            {/* Annoncé à l'arrivée de l'écran ; le titre reste le seul `h1` de la page. */}
            <div role="alert">
              {/* Une phrase : elle passe à la ligne à faible largeur, jamais tronquée (recette phase F). */}
              <PageHeader title={t('title')} wrapTitle />
            </div>
            {/* Le bouton reste en place pendant la relecture (focus gardé), seulement indisponible. */}
            <Button
              variant="outline"
              aria-disabled={retrying || undefined}
              onClick={() => {
                if (!retrying) onRetry();
              }}
            >
              {retrying ? tc('retrying') : tc('retry')}
            </Button>
          </PageContent>
        </main>
      </div>
    </div>
  );
}
