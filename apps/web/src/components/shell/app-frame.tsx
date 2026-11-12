'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname } from '@/i18n/routing';
import { AppRail, type Space } from './app-rail';

/**
 * Cadre des pages connectées (spec 5) : rail, colonne du milieu, puis la zone de contenu, seule à défiler (recette 3.10) :
 * le rail et la colonne gardent la hauteur de la fenêtre, le document ne défile jamais. Le cadre et la zone sont
 * positionnés : un élément en position absolue d'une page (texte réservé aux lecteurs d'écran, bouton rond de l'en-tête)
 * reste dans la zone qui le porte, au lieu d'agrandir le document. La zone revient en haut à chaque changement de chemin
 * ou de requête (C-20) ; elle porte `data-page-scroll`.
 */
export function AppFrame({ space, column, children }: { space: Space | null; column: ReactNode; children: ReactNode }) {
  const path = usePathname();
  // Hors du routeur de Next (tests de composants), le contexte des paramètres est absent : `null` à l'exécution.
  const params: URLSearchParams | null = useSearchParams();
  const query = params?.toString() ?? '';
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [path, query]);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <AppRail active={space} />
      {column}
      <main ref={scrollRef} data-page-scroll="" className="relative flex min-w-0 flex-1 flex-col overflow-auto">
        {children}
      </main>
    </div>
  );
}
