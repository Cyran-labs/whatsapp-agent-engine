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

/**
 * Pourquoi de nouveaux identifiants et une relecture des numéros ne répareraient pas le compte, d'après la cause décidée
 * par le moteur : identifiants enregistrés illisibles (`unreadable`, cause `reconnect`), ou compte qui ne peut pas être
 * raccordé (`support`, recette K-6) ; null sinon. Source du menu « Gérer » et des fenêtres de vérification.
 */
export type CredentialsLock = 'unreadable' | 'support';

export function credentialsLock(account: Pick<WhatsAppAccountView, 'state' | 'error_cause'>): CredentialsLock | null {
  if (hasUnreadableCredentials(account)) return 'unreadable';
  if (account.state === 'error' && account.error_cause === 'support') return 'support';
  return null;
}

export function reasonSentence(detail: string): string {
  return `${detail.trim().replace(/[\s.:]+$/, '')}.`;
}
