import type { BotStatus } from '@wabagent/contracts';

/** Classes d'une pastille de statut (`pill`) et de son point de couleur seul (`dot`). */
export interface StatusStyle {
  pill: string;
  dot: string;
}

/**
 * Couleurs des statuts (spec 6.2, choix P-5), source unique : pastille, points de la colonne du milieu,
 * Connexions et assistant. Draft et Offline sont deux gris distinguables : Draft en contour, Offline plein, sur les
 * jetons `offline` (gris neutre dans les deux thèmes, spec 3.11).
 */
export const STATUS_STYLE: Record<BotStatus, StatusStyle> = {
  draft: { pill: 'border border-border-strong bg-surface text-muted', dot: 'border border-muted-2 bg-transparent' },
  limited: { pill: 'bg-warning-soft text-warning-ink', dot: 'bg-warning' },
  active: { pill: 'bg-success-soft text-success-ink', dot: 'bg-success' },
  paused: { pill: 'bg-offline-soft text-offline-ink', dot: 'bg-offline-ink' },
};

/** Mention « Ne répond pas » (spec 7) : rouge (étiquette de Santé, encadré de l'encart Statut, point de la colonne). */
export const MENTION_STYLE: StatusStyle = { pill: 'bg-danger-soft text-danger-ink', dot: 'bg-danger' };

/** Point rouge de la mention sur la pastille de statut (recette 3.4, C-11) : 8 px, liseré de la surface. */
export const DANGER_MARK = 'h-2 w-2 rounded-full bg-danger ring-2 ring-surface';

/** Marque neutre de la Whitelist vide (recette 3.5, C-11) : contour gris, comme la pastille Draft, jamais de rouge. */
export const NEUTRAL_MARK = 'border border-border-strong bg-surface text-muted';
