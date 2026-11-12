import { z } from 'zod';
import type { ErrorReason } from './errors.js';
import type { NotRespondingReason } from './bot-status.js';

// Comptes WhatsApp d'organisation (spec 2b §6, §7.1, §7.2, §9.1). Les vues de compte ne portent aucun secret.
// La clé d'URL du webhook et le jeton de vérification ne sortent que par `GET /whatsapp-accounts/:id/webhook`
// (lue par la seule boîte webhook) et par la réponse de création, seul moment où l'admin doit les copier (revue 2b-3 M-2).

// Chaque règle porte son message français : les écrans les affichent tels quels (audit R-7).
const accountName = z.string().trim().min(1, 'Le nom est requis.').max(80, 'Le nom fait 80 caractères au plus.');

const metaCredentials = {
  waba_id: z.string().trim().regex(/^\d{5,25}$/, 'WABA ID : 5 à 25 chiffres.'),
  access_token: z.string().trim()
    .min(20, "Le jeton d'accès semble incomplet : collez-le en entier.")
    .max(1000, "Le jeton d'accès est trop long."),
  app_secret: z.string().trim()
    .min(16, "Le secret de l'app semble incomplet : collez-le en entier.")
    .max(128, "Le secret de l'app est trop long."),
};

const cmCredentials = {
  account_id: z.string().trim().uuid('Identifiant de compte CM.com invalide.'),
  product_token: z.string().trim()
    .min(10, 'Le jeton produit semble incomplet : collez-le en entier.')
    .max(200, 'Le jeton produit est trop long.'),
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
// Trop d'entrées : refus de forme (Zod), mais métier pour l'écran : `params.reason` devient `error.reason` (voir le
// gestionnaire d'erreurs du moteur).
const TOO_MANY_ENTRIES: ErrorReason = 'allowlist.too_many';
const allowlistEntries = z
  .array(z.string().max(ALLOWLIST_ENTRY_MAX, `${ALLOWLIST_ENTRY_MAX} caractères au plus.`))
  .refine((entries) => entries.length <= ALLOWLIST_MAX, {
    message: `${ALLOWLIST_MAX} entrées au plus.`,
    params: { reason: TOO_MANY_ENTRIES },
  });

/**
 * Brancher un numéro inventorié de l'organisation sur un agent IA (spec 2b §7.5). `expected_bot_id` est le détenteur
 * que l'écran a vu (`null` : numéro libre). Il est obligatoire : un appelant qui ne sait pas qui tient le numéro ne
 * peut pas dire qu'il n'est pas en train de débrancher un agent IA en service. Différent du détenteur réel au moment
 * de l'écriture : 409, rien n'est écrit (revue 2b-3 M-1).
 */
export const AssignNumberInput = z.object({
  number_id: z.number().int().positive(),
  expected_bot_id: z.string().min(1).max(64).nullable(),
});
export type AssignNumberInput = z.infer<typeof AssignNumberInput>;

/**
 * Débrancher le numéro d'un agent IA (spec 2b §7.5). `expected_number_id` est le numéro que l'écran affichait comme
 * branché ; il est obligatoire, comme `expected_bot_id` du branchement. Différent du numéro réellement branché au
 * moment de l'écriture (l'agent IA en a pris un autre, ou n'en a plus) : 409, rien n'est écrit (revue finale 2b-3 I-2).
 */
export const UnassignNumberInput = z.object({
  expected_number_id: z.number().int().positive(),
});
export type UnassignNumberInput = z.infer<typeof UnassignNumberInput>;

export const SetAllowlistInput = z.object({ entries: allowlistEntries });
export type SetAllowlistInput = z.infer<typeof SetAllowlistInput>;

/**
 * Activation en une opération (spec 2b §8.2) : brancher le numéro, enregistrer la liste, passer en accès limité
 * (ou actif sur un numéro de test). Un refus n'enregistre rien.
 */
export const ActivateBotInput = z.object({
  number_id: z.number().int().positive(),
  /** Détenteur du numéro vu par l'écran (`null` : libre), contrôlé comme pour `AssignNumberInput`. */
  expected_bot_id: z.string().min(1).max(64).nullable(),
  status: z.enum(['limited', 'active']),
  allowlist: allowlistEntries.default([]),
});
export type ActivateBotInput = z.infer<typeof ActivateBotInput>;

export type WhatsAppAccountModeView = 'meta_manual' | 'cm_com';
export type WhatsAppAccountStateView = 'connected' | 'error' | 'disconnected';
export type WhatsAppAccountErrorReasonView = 'token_invalid' | 'signature_rejected' | 'other';
/**
 * Conseil propre à la cause d'une erreur stockée : `support` (compte ou app qui ne peut pas être raccordé, aucune
 * action possible sans le support), `credentials` (le fournisseur a refusé les identifiants : les remplacer),
 * `reconnect` (identifiants enregistrés illisibles, qui ne se remplacent pas : retirer le compte puis le raccorder
 * de nouveau).
 */
export type WhatsAppAccountErrorCauseView = 'support' | 'credentials' | 'reconnect';

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

/**
 * Contrôles d'une vérification de compte. Source unique : le moteur, les clients des fournisseurs et le web en dérivent
 * (revue finale 2b-3 m-12). `app` est contrôlé par le service des comptes, jamais produit par les clients.
 */
export const VERIFICATION_CHECK_KEYS = [
  'token', 'waba_access', 'app_secret', 'subscription', 'token_expiry', 'numbers', 'cm_account', 'cm_channels', 'app',
  // Webhooks inscrits chez Meta (lot R1) : contrôlés par le moteur, lus chez Meta
  'webhook_waba', 'webhook_app',
] as const;
export type VerificationCheckKey = (typeof VERIFICATION_CHECK_KEYS)[number];

export interface WhatsAppVerificationCheck {
  key: VerificationCheckKey;
  status: 'ok' | 'failed' | 'pending' | 'created';
  detail?: string;
  /** Message d'erreur du fournisseur tel qu'il l'a écrit (masqué et borné), jamais un texte du moteur. */
  provider_text?: string;
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
  /**
   * Agent IA branché, lu dans l'organisation du numéro. `status_reason` : motif brut d'une pause automatique (lu par
   * `toBotPauseReason`) ; `not_responding` : mention « Ne répond pas » calculée par le moteur (`decideResponding`).
   */
  bot: { bot_id: string; name: string; status: string; status_reason: string | null; not_responding: NotRespondingReason | null } | null;
}

/**
 * Webhook d'un compte CM.com, à configurer chez CM.com. Revue R1 ISO-M5 : jamais pour un compte Meta, dont le moteur
 * inscrit lui-même l'adresse chez Meta ; le jeton de vérification Meta ne sort jamais du moteur.
 */
export interface WhatsAppWebhookView {
  /** `/webhook/cm-com/<clé>` ; vide pour un compte déconnecté. */
  path: string;
  /** `path` préfixé par l'adresse publique du moteur, null si elle n'est pas configurée. */
  url: string | null;
}

/** Webhook de la WABA chez Meta, relu par le moteur : `missing` (non abonné ou adresse différente), `unknown` (non lu). */
export type WabaWebhookState = 'ok' | 'missing' | 'unknown';
/** Webhook de l'app Meta, relu par le moteur : `elsewhere` (pointe ailleurs), `failed` (inscription refusée), `unknown`. */
export type AppWebhookState = 'ok' | 'elsewhere' | 'failed' | 'unknown';

/** État des webhooks inscrits chez Meta pour un compte, calculé par le moteur (lot R1). */
export interface WhatsAppWebhooksView {
  waba: WabaWebhookState;
  app: AppWebhookState;
  /** Domaine seul (jamais le chemin), si `app` vaut `elsewhere` ; null sinon. */
  app_host: string | null;
  /** Date ISO de la dernière relecture chez Meta, null si jamais lue. */
  checked_at: string | null;
}

/** Capacité d'envoi du compte lue chez Meta par le moteur : `available`, `limited` ou `blocked`. */
export type MetaSendCapability = 'available' | 'limited' | 'blocked';

/** Problème signalé par Meta sur le compte (code et texte du fournisseur), lu par le moteur. */
export interface MetaHealthIssue {
  code: number | null;
  text: string | null;
}

/** État du compte lu chez Meta (capacité d'envoi, vérification de l'entreprise, problèmes), calculé par le moteur. */
export interface MetaHealthView {
  can_send: MetaSendCapability | null;
  business_verification: string | null;
  issues: MetaHealthIssue[];
  /** Date ISO de la lecture chez Meta. */
  read_at: string;
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
  /**
   * Texte enregistré du dernier passage en erreur, quand `state` est `error` par l'état stocké ; null sinon (compte
   * connecté, déconnecté, ou erreur affichée seulement à cause de signatures rejetées). Jamais le nom ou
   * l'identifiant d'une autre organisation : un compte ou une app tenus ailleurs donnent le texte neutre.
   */
  error_detail: string | null;
  /**
   * Cause de l'erreur stockée, qui décide du conseil affiché ; null hors erreur stockée (comme `error_detail`).
   * Calculée par le moteur. Une panne du fournisseur ne met jamais le compte en erreur (vérification « non concluante »).
   */
  error_cause: WhatsAppAccountErrorCauseView | null;
  /**
   * Message d'erreur du fournisseur tel qu'il l'a écrit (en anglais pour Meta), masqué et borné, quand le passage en
   * erreur vient d'un refus du fournisseur ; null sinon (texte écrit par le moteur, hors erreur stockée). À montrer
   * replié : `error_detail` reste le texte du moteur.
   */
  provider_text: string | null;
  last_verified_at: string | null;
  /** ISO, `'never'` (jeton sans expiration) ou null (inconnue). */
  token_expiry: string | null;
  /** Dernière signature de webhook valide. */
  secret_checked_at: string | null;
  /** Vrai si le compte a au moins un numéro présent et que tous sont de test. */
  is_test: boolean;
  alerts: WhatsAppAccountAlertView[];
  numbers: WhatsAppNumberView[];
  /** Webhooks inscrits chez Meta, calculés par le moteur ; null pour CM.com et pour un compte déconnecté. */
  webhooks: WhatsAppWebhooksView | null;
  /** État du compte lu chez Meta, calculé par le moteur ; null quand il n'a pas été lu (CM.com, déconnecté). */
  meta_health: MetaHealthView | null;
}

/** Bilan d'un inventaire. Un numéro refusé (tenu ailleurs) n'est compté que par `refused`, sans autre détail. */
export interface WhatsAppInventorySummary {
  added: number;
  removed: number;
  refused: number;
  skipped_sandbox: number;
  skipped_invalid: number;
}

/** Réponse d'un remplacement d'identifiants : la vue du compte, les contrôles et le bilan de l'inventaire. Sans webhook. */
export type WhatsAppAccountReplaced = WhatsAppAccountView & {
  checks: WhatsAppVerificationCheck[];
  inventory: WhatsAppInventorySummary;
};

/**
 * Réponse de création : porte aussi le webhook que l'admin doit copier sans autre lecture (CM.com), null pour Meta
 * (le moteur inscrit lui-même le webhook, lot R1).
 */
export type WhatsAppAccountCreated = WhatsAppAccountReplaced & { webhook: WhatsAppWebhookView | null };

/** Bilan d'un retrait de compte, calculé par le moteur : nettoyage chez Meta et webhook de l'app (lot R1). */
export interface WhatsAppAccountDisconnected {
  waba_cleanup: 'done' | 'failed' | 'not_applicable';
  app_webhook: 'repointed' | 'left' | 'not_applicable';
  /**
   * Relecture finale R1 FR-M7 : nom du compte de la même organisation vers lequel le webhook de l'app pointe maintenant,
   * présent seulement quand `app_webhook` vaut `repointed`.
   */
  repointed_to?: string;
}

/** Réponse de la réinscription du webhook de l'app : la vue du compte et les contrôles (lot R1). */
export type WhatsAppAppWebhookResult = WhatsAppAccountView & { checks: WhatsAppVerificationCheck[] };

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
  /** Messages sortants refusés par Meta pour ce numéro, et dernier code d'erreur de Meta (null s'il n'est pas connu). */
  delivery_failures: number;
  last_delivery_error_code: number | null;
  account: {
    id: number;
    name: string;
    mode: WhatsAppAccountModeView;
    state: WhatsAppAccountStateView;
    error_reason: WhatsAppAccountErrorReasonView | null;
    /** Mêmes règles que `WhatsAppAccountView` : renseignés seulement pour une erreur stockée, null sinon. */
    error_detail: string | null;
    error_cause: WhatsAppAccountErrorCauseView | null;
    /** Mêmes règles que `WhatsAppAccountView`, calculés par le moteur. */
    webhooks: WhatsAppWebhooksView | null;
    meta_health: MetaHealthView | null;
  };
}
