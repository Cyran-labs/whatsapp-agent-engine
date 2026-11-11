import type { ReactNode } from 'react';
import { AppRail, type Space } from './app-rail';

/**
 * Cadre des pages connectées (spec 5) : rail, colonne du milieu, puis zone de contenu défilante sans marge haute,
 * où la page pose sa `PageBar` (collante) et son contenu.
 */
export function AppFrame({ space, column, children }: { space: Space | null; column: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <AppRail active={space} />
      {column}
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">{children}</main>
    </div>
  );
}
