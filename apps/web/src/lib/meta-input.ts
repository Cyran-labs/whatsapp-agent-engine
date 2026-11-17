// Lecture des saisies Meta du guide de raccordement (lot R2a, spec R2a §5.1) : une seule source, `extractMetaIds` des
// contrats. Contrôle de forme seulement : rien n'est lu chez Meta à ce stade.
import { extractMetaIds } from '@wabagent/contracts';

const DIGITS_ONLY = /^[\d\s]+$/;

/** ID du portefeuille d'une saisie de l'étape 1 : l'identifiant seul ou le `business_id` d'une adresse Meta Business. */
export function businessIdFromInput(input: string): string | null {
  return extractMetaIds(input)?.business_id ?? null;
}

/**
 * WABA ID du champ WABA : l'identifiant seul, ou le `asset_id` d'une adresse de WhatsApp Manager (spec R2a §5.1, point 5).
 * `extractMetaIds` lit des chiffres seuls comme un portefeuille : ici, ce sont ceux de la WABA.
 */
export function wabaIdFromInput(input: string): string | null {
  const ids = extractMetaIds(input);
  if (ids === null) return null;
  return DIGITS_ONLY.test(input.trim()) ? ids.business_id : ids.asset_id;
}
