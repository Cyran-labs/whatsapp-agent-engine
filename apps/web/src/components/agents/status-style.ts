import type { BotStatus } from '@wabagent/contracts';

/** Classes d'une pastille de statut (`pill`) et de son point de couleur seul (`dot`). */
export interface StatusStyle {
  pill: string;
  dot: string;
}

/**
 * Couleurs des statuts (spec 6.2, choix P-5), source unique : pastille, points de la colonne du milieu,
 * Connexions et assistant. Draft et Offline sont deux gris distinguables : Draft en contour, Offline plein.
 */
export const STATUS_STYLE: Record<BotStatus, StatusStyle> = {
  draft: { pill: 'border border-border-strong bg-surface text-muted', dot: 'border border-muted-2 bg-transparent' },
  limited: { pill: 'bg-warning-soft text-warning-ink', dot: 'bg-warning' },
  active: { pill: 'bg-success-soft text-success-ink', dot: 'bg-success' },
  paused: { pill: 'bg-surface-subtle text-muted-2', dot: 'bg-muted-2' },
};

/** Mention « Ne répond pas » (spec 7) : rouge. */
export const MENTION_STYLE: StatusStyle = { pill: 'bg-danger-soft text-danger-ink', dot: 'bg-danger' };
