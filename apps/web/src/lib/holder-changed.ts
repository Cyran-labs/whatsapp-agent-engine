import { HOLDER_CHANGED_PATH, type ErrorReason } from '@wabagent/contracts';
import type { MutationFailure } from './api-fetch';

/** Clé de refus du moteur pour ce 409 : typée par les contrats, une clé retirée ou renommée casse la compilation. */
const HOLDER_CHANGED_REASON: ErrorReason = 'assign.holder_changed';

/**
 * Vrai pour le 409 du moteur « Ce numéro a changé depuis votre lecture » (revue 2b-3 M-1) : le numéro a un autre
 * détenteur que celui que l'écran affichait. L'écran relit alors sa liste au lieu de réessayer à l'aveugle.
 */
export function isHolderChanged(failure: MutationFailure): boolean {
  return failure.status === 409 && (failure.reason === HOLDER_CHANGED_REASON || failure.details.some((d) => d.path === HOLDER_CHANGED_PATH));
}
