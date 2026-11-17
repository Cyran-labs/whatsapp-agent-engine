import type { DisplayNameRequestView } from '@wabagent/contracts';
import { parseEngineDate } from '@/lib/engine-date';

/**
 * Nom approuvé dont la date limite d'application est passée à la date du navigateur (ruling R-31, revue finale I-1).
 * Meta ne dit pas toujours qu'une demande a expiré (aucun code d'expiration connu, ruling R-13), et la date limite peut
 * n'être qu'approchée : l'écran dit « probablement dépassé » et propose une nouvelle demande, jamais le code. Sans date
 * limite lisible : faux.
 */
export function applyDeadlinePassed(request: DisplayNameRequestView | null, now: Date): boolean {
  if (request === null || request.status !== 'approved_pending') return false;
  const deadline = parseEngineDate(request.apply_before);
  return deadline !== null && now.getTime() > deadline.getTime();
}
