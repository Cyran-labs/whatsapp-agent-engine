'use client';

import { useEffect, useRef } from 'react';

/**
 * Rend le focus au bouton « Gérer » du menu quand la fenêtre ouverte depuis ce menu se ferme (`panel` repasse à null).
 * Le menu ayant disparu pendant que la fenêtre était ouverte, `DialogFrame` ne sait pas où rendre le focus.
 */
export function useReturnFocus(panel: string | null, wrapperRef: React.RefObject<HTMLElement | null>): void {
  const previous = useRef(panel);
  useEffect(() => {
    if (previous.current !== null && panel === null) {
      wrapperRef.current?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')?.focus();
    }
    previous.current = panel;
  }, [panel, wrapperRef]);
}
