// Types du module « comptes WhatsApp » : comptes d'organisation, numéros inventoriés, liste d'accès limité.
// Interface WhatsAppStore implémentée par whatsapp-sqlite.ts et whatsapp-postgres.ts,
// puis étalée dans les drivers (Database extends AccountsStore, WhatsAppStore).

export type WhatsAppAccountMode = 'meta_manual' | 'cm_com';
export type WhatsAppAccountState = 'connected' | 'error' | 'disconnected';
export type WhatsAppAccountErrorReason = 'token_invalid' | 'signature_rejected' | 'other';
export type BotStatus = 'draft' | 'limited' | 'active' | 'paused';

export interface WhatsAppAccountAlert {
  kind: 'payment' | 'account_locked' | 'policy_block' | 'account_update';
  code: number | null;
  event: string | null;
  at: string;
}

export interface WhatsAppAccountRecord {
  id: number;
  client_id: string;
  name: string;
  mode: WhatsAppAccountMode;
  /** WABA ID (Meta) ou accountId (CM.com). */
  provider_account_id: string;
  waba_id: string | null;
  meta_app_id: string | null;
  secret_encrypted: string;
  key_version: number;
  webhook_key_hash: string | null;
  state: WhatsAppAccountState;
  error_reason: WhatsAppAccountErrorReason | null;
  error_detail: string | null;
  last_verified_at: string | null;
  /** ISO, `'never'` (jeton sans expiration) ou null (inconnue). */
  token_expiry: string | null;
  last_signature_ok_at: string | null;
  alerts: WhatsAppAccountAlert[];
  created_at: string;
  updated_at: string;
}

export interface WhatsAppNumberRecord {
  id: number;
  account_id: number;
  client_id: string;
  phone_e164: string;
  /** phone_number_id Meta, metaId CM.com ou `cm:<profil>`. */
  provider_number_id: string;
  cm_channel_id: string | null;
  display_name: string;
  meta_status: string | null;
  quality: string | null;
  is_test: boolean;
  bot_id: string | null;
  provider_state: 'present' | 'removed';
  removed_at: string | null;
  delivery_failures: number;
  last_delivery_error_code: number | null;
  last_delivery_error_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Numéro tel que le fournisseur le déclare (avant inscription à l'inventaire). */
export interface ProviderNumber {
  provider_number_id: string;
  phone_e164: string;
  display_name: string;
  meta_status: string | null;
  quality: string | null;
  is_test: boolean;
  cm_channel_id: string | null;
}

/** Champs saisis ou calculés d'un compte neuf. */
export interface NewWhatsAppAccount {
  client_id: string;
  name: string;
  mode: WhatsAppAccountMode;
  provider_account_id: string;
  waba_id: string | null;
  meta_app_id: string | null;
  secret_encrypted: string;
  key_version: number;
  webhook_key_hash: string | null;
  token_expiry: string | null;
  last_verified_at: string | null;
}

export interface WhatsAppAccountSecrets {
  secret_encrypted: string;
  key_version: number;
  meta_app_id: string | null;
  token_expiry: string | null;
  verified_at: string;
}

export interface WhatsAppStore {
  // Comptes. Toute lecture ou écriture porte l'organisation, sauf les méthodes d'entrée webhook et de
  // suivi d'état qui partent d'un identifiant de compte déjà résolu.
  insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord>;
  getWhatsAppAccount(clientId: string, id: number): Promise<WhatsAppAccountRecord | undefined>;
  listWhatsAppAccounts(clientId: string): Promise<WhatsAppAccountRecord[]>;
  /** Seule lecture sans organisation (entrée webhook). Ne renvoie jamais un compte déconnecté. */
  findWhatsAppAccountByWebhookKeyHash(hash: string): Promise<WhatsAppAccountRecord | undefined>;
  renameWhatsAppAccount(clientId: string, id: number, name: string): Promise<boolean>;
  /** Remplace les secrets, repasse le compte `connected` et efface le motif d'erreur. */
  replaceWhatsAppAccountSecrets(clientId: string, id: number, s: WhatsAppAccountSecrets): Promise<boolean>;
  /** Repasse le compte `connected` et efface le motif d'erreur. */
  markWhatsAppAccountVerified(id: number, v: { token_expiry: string | null; verified_at: string }): Promise<void>;
  setWhatsAppAccountError(id: number, reason: WhatsAppAccountErrorReason, detail: string): Promise<void>;
  touchSignatureOk(id: number, at: string): Promise<void>;
  /** Ajoute une alerte et ne garde que les 20 plus récentes. */
  addWhatsAppAccountAlert(id: number, alert: WhatsAppAccountAlert): Promise<void>;

  // Numéros inventoriés
  listWhatsAppNumbers(clientId: string, accountId?: number): Promise<WhatsAppNumberRecord[]>;
  getWhatsAppNumber(clientId: string, numberId: number): Promise<WhatsAppNumberRecord | undefined>;
  getWhatsAppNumberForBot(clientId: string, botId: string): Promise<WhatsAppNumberRecord | undefined>;
  findPresentNumber(accountId: number, key: { providerNumberId: string } | { phoneE164: string }): Promise<WhatsAppNumberRecord | undefined>;
  recordDeliveryFailure(numberId: number, code: number | null, at: string): Promise<void>;

  // Liste d'accès limité (propre à l'agent IA)
  getAllowlist(clientId: string, botId: string): Promise<string[]>;
  replaceAllowlist(clientId: string, botId: string, entries: string[]): Promise<void>;

  /** Supprime la session et les messages de cet agent IA pour ce contact. Jamais le lead. */
  resetContactConversation(waNumber: string, contactId: string, clientId: string, botId: string): Promise<void>;
}
