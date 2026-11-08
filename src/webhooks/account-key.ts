import { getDatabase } from '../core/db.js';
import type { WhatsAppAccountMode, WhatsAppAccountRecord } from '../core/database/whatsapp-types.js';
import { hashWebhookKey } from '../whatsapp/webhook-key.js';

/**
 * Compte WhatsApp d'une clé d'URL de webhook, s'il existe, n'est pas déconnecté et est du mode attendu
 * (une clé Meta ne vaut pas sur la route CM.com, et inversement). Seule la recherche par empreinte SHA-256
 * est faite : aucun secret n'est déchiffré ici, la clé n'est jamais journalisée.
 */
export async function findAccountByKey(key: string, mode: WhatsAppAccountMode): Promise<WhatsAppAccountRecord | null> {
  const account = await getDatabase().findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(key));
  return account && account.mode === mode && account.state !== 'disconnected' ? account : null;
}
