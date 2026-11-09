/**
 * Cause d'un compte en erreur « autre », lue dans le motif que le moteur enregistre (`WhatsAppAccountView.error_detail`).
 * Le moteur ne publie pas de code de cause : ces textes sont ceux de `whatsapp-account-service.ts` (app non conforme)
 * et de `meta-graph.ts` / `cm-channels.ts` (fournisseur injoignable). Un texte inconnu est un contrôle refusé.
 */
export type ErrorCause = 'cannot_connect' | 'provider_outage' | 'check_refused' | 'unknown';

/** Motif neutre d'une app Meta ou d'un compte tenu par une autre organisation : aucun nom, aucune reprise possible. */
export const CANNOT_CONNECT_DETAIL = 'Ce compte ne peut pas être raccordé. Contactez le support.';

/** Motifs d'une panne du fournisseur (contrôle non concluant) : la seule cause qui se résout d'elle-même. */
const PROVIDER_OUTAGE_DETAILS: ReadonlySet<string> = new Set([
  'Meta ne répond pas',
  'Meta est injoignable',
  'CM.com ne répond pas',
  'CM.com est injoignable',
  'Le fournisseur ne répond pas, réessayez.',
]);

export function errorCause(detail: string | null): ErrorCause {
  if (detail === null) return 'unknown';
  if (detail === CANNOT_CONNECT_DETAIL) return 'cannot_connect';
  if (PROVIDER_OUTAGE_DETAILS.has(detail)) return 'provider_outage';
  return 'check_refused';
}

/** Motif prêt à suivre « Motif : » : sans point ni deux-points final, puis un point. */
export function reasonSentence(detail: string): string {
  return `${detail.trim().replace(/[\s.:]+$/, '')}.`;
}
