import { z } from 'zod';

// Comptes WhatsApp d'organisation (spec 2b §6, §7.1, §7.2, §9.1). Les vues ne portent aucun secret :
// seule la clé d'URL du webhook figure dans `webhook.path`, destinée à l'admin qui la colle chez le fournisseur.

const accountName = z.string().trim().min(1).max(80);

const metaCredentials = {
  waba_id: z.string().trim().regex(/^\d{5,25}$/, 'WABA ID : 5 à 25 chiffres.'),
  access_token: z.string().trim().min(20).max(1000),
  app_secret: z.string().trim().min(16).max(128),
};

const cmCredentials = {
  account_id: z.string().trim().uuid(),
  product_token: z.string().trim().min(10).max(200),
};

export const CreateWhatsAppAccountInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('meta_manual'), name: accountName, ...metaCredentials }),
  z.object({ mode: z.literal('cm_com'), name: accountName, ...cmCredentials }),
]);
export type CreateWhatsAppAccountInput = z.infer<typeof CreateWhatsAppAccountInput>;

export const ReplaceWhatsAppCredentialsInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('meta_manual'), ...metaCredentials }),
  z.object({ mode: z.literal('cm_com'), ...cmCredentials }),
]);
export type ReplaceWhatsAppCredentialsInput = z.infer<typeof ReplaceWhatsAppCredentialsInput>;

export const RenameWhatsAppAccountInput = z.object({ name: accountName });
export type RenameWhatsAppAccountInput = z.infer<typeof RenameWhatsAppAccountInput>;

/** Marquage manuel « numéro de test » (Meta ne le déclare pas). */
export const SetWhatsAppNumberTestFlagInput = z.object({ is_test: z.boolean() });
export type SetWhatsAppNumberTestFlagInput = z.infer<typeof SetWhatsAppNumberTestFlagInput>;

/** Liste d'accès limité : propre à l'agent IA, numéros E.164 ou BSUID, 20 au plus (spec 2b §8.3). */
export const ALLOWLIST_MAX = 20;
/** Longueur maximale d'une entrée saisie (numéro ou BSUID, avant normalisation). */
export const ALLOWLIST_ENTRY_MAX = 64;
const allowlistEntries = z
  .array(z.string().max(ALLOWLIST_ENTRY_MAX, `${ALLOWLIST_ENTRY_MAX} caractères au plus.`))
  .max(ALLOWLIST_MAX, `${ALLOWLIST_MAX} entrées au plus.`);

/** Brancher un numéro inventorié de l'organisation sur un agent IA (spec 2b §7.5). */
export const AssignNumberInput = z.object({ number_id: z.number().int().positive() });
export type AssignNumberInput = z.infer<typeof AssignNumberInput>;

export const SetAllowlistInput = z.object({ entries: allowlistEntries });
export type SetAllowlistInput = z.infer<typeof SetAllowlistInput>;

/**
 * Activation en une opération (spec 2b §8.2) : brancher le numéro, enregistrer la liste, passer en accès limité
 * (ou actif sur un numéro de test). Un refus n'enregistre rien.
 */
export const ActivateBotInput = z.object({
  number_id: z.number().int().positive(),
  status: z.enum(['limited', 'active']),
  allowlist: allowlistEntries.default([]),
});
export type ActivateBotInput = z.infer<typeof ActivateBotInput>;

export type WhatsAppAccountModeView = 'meta_manual' | 'cm_com';
export type WhatsAppAccountStateView = 'connected' | 'error' | 'disconnected';
export type WhatsAppAccountErrorReasonView = 'token_invalid' | 'signature_rejected' | 'other';

/** Alerte signalée par le fournisseur (paiement, compte verrouillé, politique, mise à jour du compte). */
export interface WhatsAppProviderAlert {
  kind: 'payment' | 'account_locked' | 'policy_block' | 'account_update';
  code: number | null;
  event: string | null;
  at: string;
}

export type WhatsAppAccountAlertView =
  | WhatsAppProviderAlert
  | { kind: 'token_expiring'; at: string }
  | { kind: 'quality_degraded'; number_id: number };

export interface WhatsAppVerificationCheck {
  key: 'token' | 'waba_access' | 'app_secret' | 'subscription' | 'token_expiry' | 'numbers' | 'cm_account' | 'cm_channels' | 'app';
  status: 'ok' | 'failed' | 'pending' | 'created';
  detail?: string;
}

export interface WhatsAppNumberView {
  id: number;
  phone_e164: string;
  display_name: string;
  meta_status: string | null;
  quality: string | null;
  is_test: boolean;
  provider_state: 'present' | 'removed';
  removed_at: string | null;
  delivery_failures: number;
  last_delivery_error_code: number | null;
  bot: { bot_id: string; name: string; status: string } | null;
}

export interface WhatsAppWebhookView {
  /** `/webhook/meta/<clé>` ou `/webhook/cm-com/<clé>` ; vide pour un compte déconnecté. */
  path: string;
  /** `path` préfixé par l'adresse publique du moteur, null si elle n'est pas configurée. */
  url: string | null;
  /** Jeton du GET de vérification Meta ; null pour CM.com et pour un compte déconnecté. */
  verify_token: string | null;
}

export interface WhatsAppAccountView {
  id: number;
  name: string;
  mode: WhatsAppAccountModeView;
  provider_account_id: string;
  waba_id: string | null;
  /** Identifiant public de l'app Meta du compte (non secret) ; null pour CM.com. */
  meta_app_id: string | null;
  state: WhatsAppAccountStateView;
  error_reason: WhatsAppAccountErrorReasonView | null;
  last_verified_at: string | null;
  /** ISO, `'never'` (jeton sans expiration) ou null (inconnue). */
  token_expiry: string | null;
  /** Dernière signature de webhook valide. */
  secret_checked_at: string | null;
  /** Vrai si le compte a au moins un numéro présent et que tous sont de test. */
  is_test: boolean;
  alerts: WhatsAppAccountAlertView[];
  webhook: WhatsAppWebhookView;
  numbers: WhatsAppNumberView[];
}

/** Bilan d'un inventaire. Un numéro refusé (tenu ailleurs) n'est compté que par `refused`, sans autre détail. */
export interface WhatsAppInventorySummary {
  added: number;
  removed: number;
  refused: number;
  skipped_sandbox: number;
  skipped_invalid: number;
}

export type WhatsAppAccountCreated = WhatsAppAccountView & {
  checks: WhatsAppVerificationCheck[];
  inventory: WhatsAppInventorySummary;
};

/**
 * Issue d'un « Vérifier maintenant » : `verified` (compte connecté, vérification enregistrée), `refused` (le fournisseur
 * ou la conformité de l'app a refusé : le compte est passé en erreur, les contrôles peuvent tous être `ok`),
 * `inconclusive` (fournisseur indisponible ou app illisible : rien n'a changé, réessayer).
 */
export type WhatsAppVerificationOutcome = 'verified' | 'refused' | 'inconclusive';

export type WhatsAppAccountVerified = WhatsAppAccountView & {
  checks: WhatsAppVerificationCheck[];
  outcome: WhatsAppVerificationOutcome;
};

export type WhatsAppAccountRefreshed = WhatsAppAccountView & { inventory: WhatsAppInventorySummary };

/** Numéro branché sur un agent IA, avec l'état affiché de son compte (signatures rejetées comprises). */
export interface BotNumberSummary {
  id: number;
  phone_e164: string;
  display_name: string;
  is_test: boolean;
  provider_state: 'present' | 'removed';
  quality: string | null;
  account: {
    id: number;
    name: string;
    mode: WhatsAppAccountModeView;
    state: WhatsAppAccountStateView;
    error_reason: WhatsAppAccountErrorReasonView | null;
  };
}
