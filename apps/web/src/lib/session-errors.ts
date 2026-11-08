/** Message du BFF quand la session n'est plus renouvelable (distinct d'un refus métier du moteur). */
export const SESSION_EXPIRED_MESSAGE = 'Session expirée.';

/** En-tête posé par apiFetch : organisation affichée par l'onglet, comparée au cookie wab_org par le BFF. */
export const DISPLAYED_ORG_HEADER = 'X-Wab-Org';

/** 409 du BFF quand l'onglet affiche une autre organisation que celle du cookie (bascule dans un autre onglet). */
export const ORG_CHANGED_CODE = 'ORG_CHANGED';
export const ORG_CHANGED_MESSAGE = 'Organisation changée dans un autre onglet.';
