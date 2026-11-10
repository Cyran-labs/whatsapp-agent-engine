export interface MenuPlacementInput {
  /** Rectangle du bouton dans la fenêtre (`getBoundingClientRect`). */
  trigger: { top: number; bottom: number; right: number };
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
}

export interface MenuPlacement {
  top: number;
  left: number;
  direction: 'down' | 'up';
}

const GAP = 4;
const MARGIN = 8;

/**
 * Position d'un menu d'actions affiché en `position: fixed` (hors de tout conteneur qui rogne) : aligné à droite du
 * bouton, ouvert vers le bas, sauf quand la place manque en dessous et qu'il y en a davantage au-dessus. Le menu ne
 * sort jamais de la fenêtre à gauche ni à droite.
 */
export function placeMenu({ trigger, menu, viewport }: MenuPlacementInput): MenuPlacement {
  const below = viewport.height - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  const direction = menu.height > below && above > below ? 'up' : 'down';
  const top = direction === 'down' ? trigger.bottom + GAP : Math.max(MARGIN, trigger.top - GAP - menu.height);
  const left = Math.max(MARGIN, Math.min(trigger.right - menu.width, viewport.width - menu.width - MARGIN));
  return { top, left, direction };
}
