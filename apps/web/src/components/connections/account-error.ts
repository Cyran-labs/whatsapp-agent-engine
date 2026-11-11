/**
 * Motif prêt à suivre « Motif : » : sans point ni deux-points final, puis un point. La cause de l'erreur (conseil à
 * donner) vient du moteur (`WhatsAppAccountView.error_cause`) ; le web ne la déduit jamais du texte du motif.
 */
import type { WhatsAppAccountView } from '@wabagent/contracts';

/**
 * Identifiants enregistrés illisibles (cause `reconnect`, décidée par le moteur) : le moteur refuse de les remplacer
 * et de lire les numéros (409 `whatsapp_account.secrets_unreadable`). Source unique du menu du compte et des bandeaux
 * (audit décisions A23, relecture tâche 10 I-2).
 */
export function hasUnreadableCredentials(account: Pick<WhatsAppAccountView, 'state' | 'error_cause'>): boolean {
  return account.state === 'error' && account.error_cause === 'reconnect';
}

export function reasonSentence(detail: string): string {
  return `${detail.trim().replace(/[\s.:]+$/, '')}.`;
}
