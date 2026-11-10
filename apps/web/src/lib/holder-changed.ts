import { HOLDER_CHANGED_PATH } from '@wabagent/contracts';
import type { MutationFailure } from './api-fetch';

/**
 * Vrai pour le 409 du moteur « Ce numéro a changé depuis votre lecture » (revue 2b-3 M-1) : le numéro a un autre
 * détenteur que celui que l'écran affichait. L'écran relit alors sa liste au lieu de réessayer à l'aveugle.
 */
export function isHolderChanged(failure: MutationFailure): boolean {
  return failure.status === 409 && (failure.reason === 'assign.holder_changed' || failure.details.some((d) => d.path === HOLDER_CHANGED_PATH));
}
