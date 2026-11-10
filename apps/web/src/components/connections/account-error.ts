/**
 * Motif prêt à suivre « Motif : » : sans point ni deux-points final, puis un point. La cause de l'erreur (conseil à
 * donner) vient du moteur (`WhatsAppAccountView.error_cause`) ; le web ne la déduit jamais du texte du motif.
 */
export function reasonSentence(detail: string): string {
  return `${detail.trim().replace(/[\s.:]+$/, '')}.`;
}
