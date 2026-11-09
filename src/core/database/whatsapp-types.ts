// Types du module « comptes WhatsApp » : comptes d'organisation, numéros inventoriés, liste d'accès limité.
// Interface WhatsAppStore implémentée par whatsapp-sqlite.ts et whatsapp-postgres.ts,
// puis étalée dans les drivers (Database extends AccountsStore, WhatsAppStore).

import type { TransitionRefusal } from '../bot-status.js';

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
  /** Meta : la WABA du compte ; CM.com : `facebookId` relu, à titre indicatif. */
  waba_id: string | null;
  meta_app_id: string | null;
  token_expiry: string | null;
  verified_at: string;
}

/** Résultat d'un inventaire. `paused_bots` peut nommer des agents IA d'une autre organisation : jamais exposé hors du service. */
export interface InventoryResult {
  added: number;
  updated: number;
  removed: number;
  refused: number;
  took_over: number;
  paused_bots: Array<{ client_id: string; bot_id: string }>;
}

export type AssignResult =
  | { ok: true; changed: boolean; previous_bot_id: string | null; previous_number_id: number | null }
  | { ok: false; reason: 'not_found' | 'number_removed' | TransitionRefusal };

export type TransitionResult =
  | { ok: true; from: BotStatus; to: BotStatus }
  | { ok: false; reason: 'not_found' | TransitionRefusal };

export type ActivateResult = TransitionResult & { assign?: AssignResult };

export type UnassignResult = { ok: true; number_id: number } | { ok: false };

/**
 * Remplacement de la liste d'accès limité. `not_found` : agent IA inconnu dans l'organisation (rien n'est écrit,
 * aucune liste orpheline) ; `empty_allowlist` : liste vide pour un agent IA `limited` (spec §8.1).
 */
export type AllowlistResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'empty_allowlist' };

/** Choix 3 : la création est refusée, dans sa transaction, si l'app Meta est détenue par une autre organisation. */
export type CreateAccountResult =
  | { ok: true; account: WhatsAppAccountRecord; inventory: InventoryResult }
  | { ok: false; reason: 'meta_app_taken' };

/**
 * Résultat d'une remise en `connected` (remplacement des secrets, vérification réussie). `not_found` : compte
 * inconnu, d'une autre organisation ou déconnecté ; `meta_app_taken` : app détenue par une autre organisation,
 * contrôlée dans la même transaction que l'écriture (choix 3).
 */
export type AccountWriteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'meta_app_taken' };

export type DisconnectResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'number_in_use'; bot_ids: string[] };

export interface TopologyOptions {
  /** Vrai : le compte compte comme non `connected` (signatures rejetées en série, choix 4). */
  isAccountBlocked?: (accountId: number) => boolean;
}

export interface WhatsAppStore {
  // Comptes. Toute lecture ou écriture porte l'organisation, sauf les méthodes d'entrée webhook et de
  // suivi d'état qui partent d'un identifiant de compte déjà résolu.
  insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord>;
  getWhatsAppAccount(clientId: string, id: number): Promise<WhatsAppAccountRecord | undefined>;
  listWhatsAppAccounts(clientId: string): Promise<WhatsAppAccountRecord[]>;
  /** Seule lecture sans organisation (entrée webhook). Ne renvoie jamais un compte déconnecté. */
  findWhatsAppAccountByWebhookKeyHash(hash: string): Promise<WhatsAppAccountRecord | undefined>;
  /**
   * Vrai si un compte non `disconnected` d'une autre organisation porte cette app Meta (choix 3, revue 2b-1 M-2) :
   * un compte en `error` la détient encore, il revient seul en `connected`. Ne renvoie qu'un booléen.
   */
  isMetaAppHeldElsewhere(clientId: string, metaAppId: string): Promise<boolean>;
  renameWhatsAppAccount(clientId: string, id: number, name: string): Promise<boolean>;
  /**
   * Remplace les secrets, repasse le compte `connected` et efface le motif d'erreur. Jamais sur un compte déconnecté ;
   * refusé si la nouvelle app Meta est détenue par une autre organisation (contrôle dans la transaction).
   */
  replaceWhatsAppAccountSecrets(clientId: string, id: number, s: WhatsAppAccountSecrets): Promise<AccountWriteResult>;
  /**
   * Repasse le compte `connected` et efface le motif d'erreur. Jamais sur un compte déconnecté ; refusé si l'app du
   * compte est détenue par une autre organisation (contrôle dans la transaction).
   */
  markWhatsAppAccountVerified(id: number, v: { token_expiry: string | null; verified_at: string }): Promise<AccountWriteResult>;
  /** Sans effet sur un compte déconnecté. */
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
  /**
   * Marquage manuel « numéro de test » (Meta ne le déclare pas, tâche 0 d). Faux si le numéro n'existe pas dans ce
   * compte de cette organisation. Un inventaire ultérieur ne l'écrase pas.
   */
  setWhatsAppNumberTestFlag(clientId: string, accountId: number, numberId: number, isTest: boolean): Promise<boolean>;

  // Liste d'accès limité (propre à l'agent IA)
  getAllowlist(clientId: string, botId: string): Promise<string[]>;
  /**
   * Relit l'agent IA dans sa transaction (sous le verrou de topologie sur Postgres, comme `deleteBotRecord`) :
   * refus sans écriture s'il n'existe pas, ou si la liste est vide alors qu'il est `limited`.
   */
  replaceAllowlist(clientId: string, botId: string, entries: string[]): Promise<AllowlistResult>;

  // Topologie des numéros (inventaire, branchement, statuts, déconnexion). Chaque méthode est une seule
  // transaction qui relit ses faits ; sur Postgres elles prennent toutes le verrou consultatif
  // `wab:whatsapp-topology` (choix 10). Une reprise, un retrait, un branchement ou une déconnexion
  // supprime les sessions du numéro concerné (choix 7).
  /**
   * Crée le compte et inventorie ses numéros dans la même transaction, après avoir vérifié dans cette transaction
   * (sous le verrou de topologie sur Postgres) que l'app Meta n'est détenue par aucune autre organisation.
   */
  createWhatsAppAccountWithInventory(a: NewWhatsAppAccount, found: ProviderNumber[]): Promise<CreateAccountResult>;
  /** Lève une erreur si le compte n'existe pas dans l'organisation ou s'il est déconnecté. */
  applyInventory(clientId: string, accountId: number, found: ProviderNumber[]): Promise<InventoryResult>;
  assignNumber(clientId: string, botId: string, numberId: number, opts?: TopologyOptions): Promise<AssignResult>;
  /**
   * Libère le numéro de l'agent IA et renvoie son identifiant, lu dans la même transaction (audit avant et après).
   * `ok: false` si l'agent IA n'existe pas dans l'organisation ou n'a pas de numéro.
   */
  unassignNumber(clientId: string, botId: string): Promise<UnassignResult>;
  transitionBotStatus(clientId: string, botId: string, to: BotStatus, opts?: TopologyOptions): Promise<TransitionResult>;
  /** Branchement, liste d'accès limité (si fournie) et transition ; un refus annule tout (spec §8.2). */
  activateWithNumber(
    clientId: string, botId: string, numberId: number, to: 'limited' | 'active', allowlist: string[] | null, opts?: TopologyOptions,
  ): Promise<ActivateResult>;
  disconnectWhatsAppAccount(clientId: string, id: number): Promise<DisconnectResult>;

  /** Supprime la session et les messages de cet agent IA pour ce contact. Jamais le lead. */
  resetContactConversation(waNumber: string, contactId: string, clientId: string, botId: string): Promise<void>;
}
