// Comptes WhatsApp d'organisation : raccordement (Meta en mode manuel, CM.com), vérification, inventaire,
// remplacement des identifiants, déconnexion (spec 2b §6, §7.1, §7.2, §7.4, §7.7, §9.1).
// Surface d'isolation : toute lecture passe par l'organisation active, un compte d'une autre organisation répond
// comme un compte inconnu, et rien de ce qui touche une autre organisation (numéro refusé, agent IA mis en pause
// par une reprise, app Meta déjà utilisée) ne sort d'ici autrement qu'en nombre ou en message neutre.

import {
  CreateWhatsAppAccountInput, ReplaceWhatsAppCredentialsInput, RenameWhatsAppAccountInput,
  type WhatsAppAccountAlertView, type WhatsAppAccountCreated, type WhatsAppAccountRefreshed, type WhatsAppAccountReplaced, type WhatsAppAccountVerified, type WhatsAppVerificationOutcome,
  type WhatsAppAccountView, type WhatsAppInventorySummary, type WhatsAppNumberView, type WhatsAppWebhookView,
  type AppWebhookState, type ApiErrorDetail, type WabaWebhookState, type MetaHealthView,
  type WhatsAppAppWebhookResult, type WhatsAppAccountDisconnected,
} from '@wabagent/contracts';
import type { Database } from '../database/types.js';
import type {
  InventoryOptions, InventoryResult, ProviderAccountHolder, WhatsAppAccountRecord, WhatsAppNumberRecord,
} from '../database/whatsapp-types.js';
import { describeFailure, verifyMetaManual, listMetaNumbers, type GraphFailure, type MetaManualCredentials } from '../../whatsapp/meta-graph.js';
import { APP_WEBHOOK_FIELDS, createMetaWebhookClient, type MetaWebhookClient } from '../../whatsapp/meta-webhooks.js';
import { registerPendingVerification } from '../../webhooks/pending-verification.js';
import { classifyAppWebhook, hostOf, metaWebhookUrl } from './meta-webhook-plan.js';
import { verifyCmAccount, listCmNumbers, type CmCredentials } from '../../whatsapp/cm-channels.js';
import type { ProviderListing, ProviderSkipped, ProviderVerification, VerificationCheck } from '../../whatsapp/provider-common.js';
import { generateVerifyToken, generateWebhookKey, hashWebhookKey } from '../../whatsapp/webhook-key.js';
import {
  decryptAccountSecrets, encryptAccountSecrets, invalidateAccountTransports, type AccountSecrets,
} from '../../transport/index.js';
import { recordSignatureSuccess } from '../../webhooks/signature-monitor.js';
import {
  CANNOT_CONNECT, SECRETS_UNREADABLE_SHORT, displayedAccountState, presentMetaHealth, presentWebhooks, storedErrorFields,
} from './bot-number-summary.js';
import { loadNotResponding } from './bot-responding.js';
import { recordAudit } from '../audit.js';
import { config } from '../config.js';
import { AppError, conflict, notFound, validationError } from '../../api/errors.js';

/** Clients des fournisseurs, injectables pour les tests. */
export interface WhatsAppProviders {
  verifyMeta: (c: MetaManualCredentials) => Promise<ProviderVerification>;
  listMeta: (c: MetaManualCredentials) => Promise<ProviderListing>;
  verifyCm: (c: CmCredentials) => Promise<ProviderVerification>;
  listCm: (c: CmCredentials) => Promise<ProviderListing>;
  /** Inscription des webhooks chez Meta (lot R1) : webhook de la WABA et webhook de l'app. */
  metaWebhooks: MetaWebhookClient;
}

export interface WhatsAppAccountServiceDeps {
  db: Database;
  providers?: WhatsAppProviders;
}

const DEFAULT_PROVIDERS: WhatsAppProviders = {
  verifyMeta: (c) => verifyMetaManual(c),
  listMeta: (c) => listMetaNumbers(c),
  verifyCm: (c) => verifyCmAccount(c),
  listCm: (c) => listCmNumbers(c),
  metaWebhooks: createMetaWebhookClient(),
};

const ACCOUNT_NOT_FOUND = 'Compte WhatsApp introuvable.';
const NUMBER_NOT_FOUND = 'Numéro WhatsApp introuvable.';
const MASKED_VALUE = "Saisissez la valeur complète : une valeur masquée n'est pas acceptée.";
const ALREADY_CONNECTED = 'Ce compte WhatsApp est déjà raccordé.';
const OTHER_PROVIDER_ACCOUNT = 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.';
const ACCOUNT_DISCONNECTED = 'Ce compte WhatsApp a été retiré : raccordez un nouveau compte.';
// audit décisions A23 : la suite exacte, la même que la raison du menu « Remplacer les identifiants » désactivé.
const SECRETS_UNREADABLE = 'Les identifiants enregistrés de ce compte sont illisibles : retirez le compte puis raccordez-le de nouveau.';
// Se termine par deux-points : l'écran affiche ensuite les noms des agents IA (détails `bots.<id>`).
const NUMBERS_IN_USE = "Mettez d'abord Offline les agents IA qui utilisent ce compte :";
const APP_UNREADABLE = "Impossible de lire l'application du jeton auprès de Meta, réessayez.";
const PROVIDER_UNAVAILABLE = 'Le fournisseur ne répond pas, réessayez.';
const EMPTY_INVENTORY = "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré.";
// Lot R1 : mêmes textes que ceux du web pour les mêmes clés (messages/fr.json, errors.reason.whatsapp_account).
const PUBLIC_URL_MISSING = "La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support.";
const WEBHOOK_URL_TOO_LONG = "L'adresse du webhook de WABAGENT dépasse la limite de Meta. Contactez le support.";
const WEBHOOK_UNREACHABLE = "Meta n'a pas pu joindre WABAGENT pour vérifier l'adresse du webhook. Réessayez dans quelques minutes ; si cela continue, contactez le support.";
const WEBHOOK_UNCONFIRMED = "Meta n'a pas confirmé l'adresse du webhook de WABAGENT. Réessayez ; si cela continue, contactez le support.";
const WEBHOOK_CLEANUP_DONE = "L'adresse inscrite chez Meta a été retirée.";
const WEBHOOK_CLEANUP_FAILED = "WABAGENT n'a pas pu retirer l'adresse inscrite chez Meta ; elle ne reçoit rien. Réessayez le raccordement ou contactez le support.";
// Revue de la tâche 3 : un refus du jeton d'app (190) n'est pas un refus du jeton du compte, le texte le dit.
const APP_WEBHOOK_FAILED = "WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.";
const APP_WEBHOOK_ELSEWHERE = "Le webhook de votre app Meta pointe vers une autre adresse : les alertes de compte de Meta n'arrivent pas.";
// Lot R1 : WABA réservée par une autre opération (raccordement, vérification, remplacement) du même processus.
const CONNECTION_BUSY = 'Une autre opération est en cours sur ce compte WhatsApp, réessayez.';
// Revue 2b-2 M-2 : identifiants remplacés pendant « Vérifier maintenant ».
const CREDENTIALS_CHANGED = 'Les identifiants de ce compte WhatsApp ont changé pendant la vérification, relancez-la.';
// Revue 2b-2 M-2, « Faire pointer vers WABAGENT » : identifiants ou état du compte changés pendant l'opération.
const ACCOUNT_CHANGED = 'Ce compte WhatsApp a changé pendant l\'opération, réessayez.';
// « Faire pointer vers WABAGENT » : seul un compte connecté reçoit le webhook de l'app (spec R1 §5.4).
const APP_WEBHOOK_NOT_CONNECTED = "Ce compte WhatsApp n'est pas connecté : lancez d'abord Vérifier maintenant.";
/** `override_callback_uri` : 200 caractères au plus chez Meta. */
const MAX_CALLBACK_URL_LENGTH = 200;

/** Raccordement, remplacement des identifiants, « Rafraîchir les numéros » : actions d'admin, reprise permise. */
export const ADMIN_INVENTORY: InventoryOptions = { allowTakeover: true };

const MASK_PREFIX = '••••';
const TOKEN_EXPIRING_MS = 7 * 24 * 3600 * 1000;
const EMPTY_WEBHOOK: WhatsAppWebhookView = { path: '', url: null };
/** Déconnexion sans rien à faire chez Meta (CM.com, compte déjà retiré). */
const NOTHING_AT_META: WhatsAppAccountDisconnected = { waba_cleanup: 'not_applicable', app_webhook: 'not_applicable' };

type CredentialsInput = CreateWhatsAppAccountInput | ReplaceWhatsAppCredentialsInput;

const APP_UNREADABLE_CHECK: VerificationCheck = { key: 'app', status: 'failed', detail: APP_UNREADABLE };

/**
 * Choix 3 (revue 2b-1 M-2) : en mode manuel, l'app du jeton doit être lue pour être contrôlée. Une vérification
 * réussie sans app lue (debug_token en échec ou sans app_id) est refusée avant toute écriture.
 */
function rejectUnreadableApp(mode: CredentialsInput['mode'], v: Extract<ProviderVerification, { ok: true }>): void {
  if (mode === 'meta_manual' && v.meta_app_id === null) {
    throw new AppError('WA_VALIDATION_FAILED', APP_UNREADABLE, [{ path: 'app', message: APP_UNREADABLE }], 'whatsapp_account.app_unreadable');
  }
}

/** Audit 6.4 : une valeur masquée renvoyée par un formulaire n'est jamais enregistrée comme secret. */
function rejectMasked(input: CredentialsInput): void {
  const secrets: Array<[string, string]> = input.mode === 'meta_manual'
    ? [['access_token', input.access_token], ['app_secret', input.app_secret]]
    : [['product_token', input.product_token]];
  const details = secrets
    .filter(([, value]) => value.startsWith(MASK_PREFIX))
    .map(([path]) => ({ path, message: MASKED_VALUE }));
  if (details.length > 0) throw validationError(details, MASKED_VALUE, 'whatsapp_account.masked_value');
}

function providerAccountIdOf(input: CredentialsInput): string {
  return input.mode === 'meta_manual' ? input.waba_id : input.account_id;
}

/** Les UUID CM.com ne dépendent pas de la casse ; un WABA ID n'a que des chiffres. */
function sameProviderAccount(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Revue 2b-2 I-1 : compte du fournisseur déjà tenu. Même organisation : « déjà raccordé » ; autre organisation :
 * message neutre du choix 3, qui ne révèle rien de l'autre organisation.
 */
function rejectHeldProviderAccount(holder: ProviderAccountHolder): void {
  if (holder === 'same_organization') throw conflict(ALREADY_CONNECTED, 'whatsapp_account.already_connected');
  if (holder === 'other_organization') {
    console.log('[WhatsAppAccounts] Raccordement refusé : compte du fournisseur déjà raccordé ailleurs');
    throw conflict(CANNOT_CONNECT, 'whatsapp_account.cannot_connect');
  }
}

function validationFailed(v: Extract<ProviderVerification, { ok: false }>): AppError {
  const details = v.checks
    .filter((c) => c.status === 'failed')
    .map((c) => ({ path: c.key, message: c.detail ?? v.message, ...(c.provider_text !== undefined ? { provider_text: c.provider_text } : {}) }));
  return new AppError('WA_VALIDATION_FAILED', v.message, details, 'whatsapp_account.verification_failed');
}

function summarize(inv: InventoryResult, skipped: ProviderSkipped): WhatsAppInventorySummary {
  // `paused_bots` (qui peut nommer des agents IA d'une autre organisation) est volontairement laissé de côté.
  return {
    added: inv.added, removed: inv.removed, refused: inv.refused,
    skipped_sandbox: skipped.sandbox, skipped_invalid: skipped.invalid_number,
  };
}

/** Jeton qui expire dans moins de 7 jours (ou déjà expiré). `'never'` et une date inconnue ne déclenchent rien. */
function tokenExpiring(expiry: string | null, now: number): boolean {
  if (expiry === null || expiry === 'never') return false;
  const at = Date.parse(expiry);
  return Number.isFinite(at) && at - now < TOKEN_EXPIRING_MS;
}

/**
 * Contrôles d'une vérification suivis de ceux des webhooks (lot R1). L'abonnement de l'app à la WABA, en attente à la
 * lecture, est créé par une inscription confirmée.
 */
function withWebhookChecks(checks: VerificationCheck[], waba: VerificationCheck, app: VerificationCheck | null): VerificationCheck[] {
  const base = checks
    .filter((c) => c.key !== 'webhook_waba' && c.key !== 'webhook_app')
    .map((c): VerificationCheck => (waba.status === 'created' && c.key === 'subscription' && c.status === 'pending' ? { key: 'subscription', status: 'created' } : c));
  return [...base, waba, ...(app === null ? [] : [app])];
}

function secretsFor(input: CredentialsInput, webhookKey: string, verifyToken: string): AccountSecrets {
  return input.mode === 'meta_manual'
    ? { mode: 'meta_manual', access_token: input.access_token, app_secret: input.app_secret, verify_token: verifyToken, webhook_key: webhookKey }
    : { mode: 'cm_com', product_token: input.product_token, webhook_key: webhookKey };
}

function target(clientId: string, id: number): string {
  return `whatsapp_account:${clientId}/${id}`;
}

type MetaSecrets = Extract<AccountSecrets, { mode: 'meta_manual' }>;

/** Inscription de l'adresse propre d'un compte sur sa WABA, confirmée par relecture (spec R1 §5.1, étapes 4 et 5). */
type OverrideInscription = { ok: true } | { ok: false; stage: 'write'; failure: GraphFailure } | { ok: false; stage: 'readback' };

/**
 * Webhook de la WABA d'un compte existant (« Vérifier maintenant », remplacement des identifiants). `state` : état à
 * enregistrer, null si rien de sûr n'a été lu (il reste alors celui en base). `tokenRefused` : Meta a refusé le jeton du
 * compte (texte du moteur), seul échec qui relève des règles du 2b.
 */
interface WabaWebhookOutcome {
  state: WabaWebhookState | null;
  check: VerificationCheck;
  tokenRefused: string | null;
  /**
   * Revue 2b-2 M-2 : identifiants, app ou état du compte changés depuis la lecture de l'appelant (remplacement
   * concurrent) : rien n'a été écrit chez Meta, l'appelant n'écrit rien non plus.
   */
  stale: boolean;
}

/** Résultat de la règle du webhook de l'app (spec R1 §5.4). */
interface AppWebhookOutcome {
  state: AppWebhookState;
  app_host: string | null;
  check: VerificationCheck;
}

/**
 * Lot R1, spec R1 §5.1 : adresse du webhook Meta du compte en cours de raccordement, sous l'adresse publique du moteur.
 * Refus avant tout appel à Meta si l'adresse publique manque ou si l'adresse dépasse la limite de Meta.
 */
function requireCallbackUrl(webhookKey: string): string {
  const url = callbackUrlFor(webhookKey);
  if (!url.ok) {
    throw new AppError('WA_VALIDATION_FAILED', url.message, [{ path: 'webhook_waba', message: url.message }], url.reason);
  }
  return url.url;
}

/** Adresse du webhook Meta d'un compte, ou le texte et la raison qui l'empêchent (adresse publique absente, trop longue). */
function callbackUrlFor(webhookKey: string):
  | { ok: true; url: string }
  | { ok: false; message: string; reason: 'whatsapp_account.public_url_missing' | 'whatsapp_account.webhook_url_too_long' } {
  const base = config.webhook.publicBaseUrl;
  if (base === null) return { ok: false, message: PUBLIC_URL_MISSING, reason: 'whatsapp_account.public_url_missing' };
  const url = metaWebhookUrl(base, webhookKey);
  if (url.length > MAX_CALLBACK_URL_LENGTH) return { ok: false, message: WEBHOOK_URL_TOO_LONG, reason: 'whatsapp_account.webhook_url_too_long' };
  return { ok: true, url };
}

function withProviderText(detail: ApiErrorDetail, providerText: string | undefined): ApiErrorDetail {
  return providerText === undefined ? detail : { ...detail, provider_text: providerText };
}

/**
 * Raccordements Meta en cours dans ce processus, par compte du fournisseur (organisation qui raccorde). Deux
 * raccordements simultanés de la même WABA écriraient chacun leur adresse chez Meta, et le perdant retirerait celle
 * du gagnant : le second est refusé avant toute écriture. Limite : propre au processus, comme le registre des
 * vérifications attendues (multi-instance différé au chantier Infra, spec R1 §5.2) ; la transaction de création
 * reste le contrôle final.
 */
const connectionsInFlight = new Map<string, string>();

/**
 * Réservation d'un compte déjà raccordé (vérification, remplacement) autour d'une écriture chez Meta : null si la WABA est
 * déjà réservée, l'appelant n'écrit alors rien. Même registre que les raccordements, qui ne peuvent donc pas s'intercaler.
 */
function tryClaimConnection(clientId: string, providerAccountId: string): (() => void) | null {
  const key = providerAccountId.toLowerCase();
  if (connectionsInFlight.has(key)) return null;
  connectionsInFlight.set(key, clientId);
  return () => { connectionsInFlight.delete(key); };
}

function claimConnection(clientId: string, providerAccountId: string): () => void {
  const key = providerAccountId.toLowerCase();
  const holder = connectionsInFlight.get(key);
  if (holder !== undefined) rejectHeldProviderAccount(holder === clientId ? 'same_organization' : 'other_organization');
  connectionsInFlight.set(key, clientId);
  return () => { connectionsInFlight.delete(key); };
}

export class WhatsAppAccountService {
  private readonly db: Database;
  private readonly providers: WhatsAppProviders;

  constructor(deps: WhatsAppAccountServiceDeps) {
    this.db = deps.db;
    this.providers = deps.providers ?? DEFAULT_PROVIDERS;
  }

  async list(clientId: string): Promise<WhatsAppAccountView[]> {
    const accounts = await this.db.listWhatsAppAccounts(clientId);
    return Promise.all(accounts.map((a) => this.view(clientId, a)));
  }

  async get(clientId: string, id: number): Promise<WhatsAppAccountView> {
    return this.view(clientId, await this.requireAccount(clientId, id));
  }

  /**
   * Clé d'URL du compte CM.com : la seule lecture qui la sert (revue 2b-3 M-2). Compte d'une autre organisation ou
   * inconnu : même 404. Compte déconnecté : webhook vide. Lot R1 (spec R1 §6.2, §7) : un compte Meta répond le même 404,
   * le moteur inscrit lui-même son adresse chez Meta et son jeton de vérification ne sort jamais.
   */
  async getWebhook(clientId: string, id: number): Promise<WhatsAppWebhookView> {
    const account = await this.requireAccount(clientId, id);
    if (account.mode === 'meta_manual') throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    return account.state === 'disconnected' ? EMPTY_WEBHOOK : this.cmWebhookView(account);
  }

  async create(clientId: string, actorUserId: number | null, raw: CreateWhatsAppAccountInput): Promise<WhatsAppAccountCreated> {
    const input = CreateWhatsAppAccountInput.parse(raw);
    rejectMasked(input);
    const providerAccountId = providerAccountIdOf(input);
    const webhookKey = generateWebhookKey();
    // Lot R1, spec R1 §5.1 : prérequis de plateforme, avant tout appel au fournisseur.
    const callbackUrl = input.mode === 'meta_manual' ? requireCallbackUrl(webhookKey) : null;
    // Revue 2b-2 I-1, M-5 : un compte du fournisseur tenu par un compte non `disconnected`, de n'importe quelle
    // organisation, n'est pas raccordé. Même organisation : refusé tout de suite (rien ne sort d'une autre
    // organisation). Autre organisation : contrôlé seulement après la preuve d'accès (sinon un jeton quelconque
    // dirait si la WABA est tenue sur la plateforme), mais avant toute écriture chez Meta : la vérification est en
    // lecture seule (lot R1, ruling R-2), le contrôle suit donc directement sa réussite. La transaction de création
    // refait le contrôle (CM.com, deux raccordements simultanés).
    const holder = await this.db.findProviderAccountHolder(clientId, input.mode, providerAccountId);
    if (holder === 'same_organization') rejectHeldProviderAccount(holder);

    const verification = await this.verifyInput(input);
    if (!verification.ok) throw validationFailed(verification);
    // Meta : contrôles d'unicité faits sous la réservation du raccordement (revue PO R-9), dans createMeta.
    if (input.mode === 'meta_manual') {
      // requireCallbackUrl a levé sans adresse : garde de typage.
      if (callbackUrl === null) throw new AppError('WA_VALIDATION_FAILED', PUBLIC_URL_MISSING, [{ path: 'webhook_waba', message: PUBLIC_URL_MISSING }], 'whatsapp_account.public_url_missing');
      return this.createMeta(clientId, actorUserId, input, verification, { webhookKey, verifyToken: generateVerifyToken(), callbackUrl });
    }
    // Revue R1 ISO-M5 : la suite ne sert plus que CM.com (aucun jeton de vérification, webhook à configurer chez CM.com).
    rejectHeldProviderAccount(await this.db.findProviderAccountHolder(clientId, input.mode, providerAccountId));

    const encrypted = encryptAccountSecrets({ mode: 'cm_com', product_token: input.product_token, webhook_key: webhookKey });
    // Choix 3 contrôlé dans la transaction de création (sous le verrou de topologie sur Postgres) : deux
    // organisations qui raccordent la même app au même instant ne peuvent pas réussir toutes les deux.
    const created = await this.db.createWhatsAppAccountWithInventory({
      client_id: clientId,
      name: input.name,
      mode: input.mode,
      provider_account_id: providerAccountId,
      // CM.com : `facebookId` lu à titre indicatif seulement (affichage).
      waba_id: verification.waba_id,
      meta_app_id: verification.meta_app_id,
      secret_encrypted: encrypted.secret_encrypted,
      key_version: encrypted.key_version,
      webhook_key_hash: hashWebhookKey(webhookKey),
      token_expiry: verification.token_expiry,
      last_verified_at: new Date().toISOString(),
    }, verification.numbers, ADMIN_INVENTORY);
    if (!created.ok && created.reason === 'provider_account_taken') {
      rejectHeldProviderAccount(created.same_organization ? 'same_organization' : 'other_organization');
    }
    if (!created.ok) {
      console.log('[WhatsAppAccounts] Raccordement refusé : app Meta déjà utilisée ailleurs');
      throw conflict(CANNOT_CONNECT, 'whatsapp_account.cannot_connect');
    }
    const { account, inventory } = created;
    // Vérification réussie : l'appsecret_proof a prouvé le secret de l'app.
    recordSignatureSuccess(account.id);

    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.create', target: target(clientId, account.id), client_id: clientId,
      metadata: { mode: input.mode, numbers: inventory.added, refused: inventory.refused },
    });
    console.log(`[WhatsAppAccounts] Compte ${account.id} raccordé (${input.mode}, ${inventory.added} numéro(s) ajouté(s), ${inventory.refused} refusé(s))`);
    return {
      ...(await this.view(clientId, account)),
      webhook: this.cmWebhookView(account),
      checks: verification.checks,
      inventory: summarize(inventory, verification.skipped),
    };
  }

  /**
   * Raccordement d'un compte Meta (lot R1, spec R1 §5.1 et §5.2). La vérification (lecture seule) est faite ; ici, la
   * WABA est d'abord réservée dans le processus, puis, sous la réservation et avant toute écriture chez Meta, les
   * contrôles d'unicité de la WABA et de l'app (choix 3), puis l'inscription de l'adresse propre du compte sur la
   * WABA, confirmée par relecture, puis l'enregistrement. Un échec après l'écriture retire l'adresse chez Meta et le
   * dit. Le webhook de l'app n'est écrit qu'après l'enregistrement : son échec ne refuse pas le raccordement, et
   * aucune panne après l'enregistrement ne fait répondre une erreur pour un compte créé et connecté.
   */
  private async createMeta(
    clientId: string,
    actorUserId: number | null,
    input: Extract<CreateWhatsAppAccountInput, { mode: 'meta_manual' }>,
    verification: Extract<ProviderVerification, { ok: true }>,
    hook: { webhookKey: string; verifyToken: string; callbackUrl: string },
  ): Promise<WhatsAppAccountCreated> {
    const meta: MetaManualCredentials = { waba_id: input.waba_id, access_token: input.access_token, app_secret: input.app_secret };
    const secrets: MetaSecrets = {
      mode: 'meta_manual', access_token: input.access_token, app_secret: input.app_secret,
      verify_token: hook.verifyToken, webhook_key: hook.webhookKey,
    };
    // Revue PO R-9 : chiffré avant toute écriture chez Meta, un échec du chiffrement ne laisse rien chez Meta.
    const encrypted = encryptAccountSecrets(secrets);

    // Revue PO R-9 : la réservation précède les contrôles d'unicité. Un raccordement concurrent de la même WABA qui a
    // lu la base avant l'enregistrement du premier ne peut donc pas écrire après sa libération.
    const releaseClaim = claimConnection(clientId, input.waba_id);
    let created: Awaited<ReturnType<Database['createWhatsAppAccountWithInventory']>>;
    try {
      rejectHeldProviderAccount(await this.db.findProviderAccountHolder(clientId, 'meta_manual', input.waba_id));
      rejectUnreadableApp('meta_manual', verification);
      const metaAppId = verification.meta_app_id;
      // rejectUnreadableApp a refusé une app illisible ; garde de typage.
      if (metaAppId === null) throw new AppError('WA_VALIDATION_FAILED', APP_UNREADABLE, [{ path: 'app', message: APP_UNREADABLE }], 'whatsapp_account.app_unreadable');
      if (await this.db.isMetaAppHeldElsewhere(clientId, metaAppId)) {
        console.log('[WhatsAppAccounts] Raccordement refusé : app Meta déjà utilisée ailleurs');
        throw conflict(CANNOT_CONNECT, 'whatsapp_account.cannot_connect');
      }

      // Meta vérifie l'adresse pendant l'appel (GET hub.challenge), avant que le compte existe : le registre y répond.
      const releasePending = registerPendingVerification(hook.webhookKey, hook.verifyToken);
      try {
        const inscription = await this.writeAndConfirmOverride(meta, metaAppId, hook);
        if (!inscription.ok && inscription.stage === 'write') throw await this.overrideRefused(meta, inscription.failure);
        if (!inscription.ok) {
          console.log('[WhatsAppAccounts] Raccordement refusé : adresse du webhook absente à la relecture chez Meta');
          throw new AppError('WA_VALIDATION_FAILED', WEBHOOK_UNCONFIRMED, [
            { path: 'webhook_waba', message: WEBHOOK_UNCONFIRMED }, await this.withdrawOverride(meta),
          ], 'whatsapp_account.webhook_unconfirmed');
        }

        try {
          // Choix 3 contrôlé dans la transaction de création (sous le verrou de topologie sur Postgres) : deux
          // organisations qui raccordent la même app au même instant ne peuvent pas réussir toutes les deux.
          created = await this.db.createWhatsAppAccountWithInventory({
            client_id: clientId,
            name: input.name,
            mode: 'meta_manual',
            provider_account_id: input.waba_id,
            waba_id: input.waba_id,
            meta_app_id: metaAppId,
            secret_encrypted: encrypted.secret_encrypted,
            key_version: encrypted.key_version,
            webhook_key_hash: hashWebhookKey(hook.webhookKey),
            token_expiry: verification.token_expiry,
            last_verified_at: new Date().toISOString(),
          }, verification.numbers, ADMIN_INVENTORY);
        } catch {
          console.log('[WhatsAppAccounts] Enregistrement du compte en échec après l\'inscription du webhook chez Meta');
          throw new AppError('WA_VALIDATION_FAILED', WEBHOOK_UNCONFIRMED, [
            { path: 'webhook_waba', message: WEBHOOK_UNCONFIRMED }, await this.withdrawOverride(meta),
          ], 'whatsapp_account.webhook_unconfirmed');
        }
        if (!created.ok) {
          // Raccordement concurrent (autre instance) : l'adresse est retirée, le refus reste celui d'aujourd'hui.
          const cleanup = await this.withdrawOverride(meta);
          if (created.reason === 'provider_account_taken' && created.same_organization) {
            throw new AppError('CONFLICT', ALREADY_CONNECTED, [cleanup], 'whatsapp_account.already_connected');
          }
          console.log('[WhatsAppAccounts] Raccordement refusé : compte du fournisseur ou app Meta déjà utilisés ailleurs');
          throw new AppError('CONFLICT', CANNOT_CONNECT, [cleanup], 'whatsapp_account.cannot_connect');
        }
      } finally {
        releasePending();
      }
    } finally {
      releaseClaim();
    }

    const { account, inventory } = created;
    // Vérification réussie : l'appsecret_proof a prouvé le secret de l'app.
    recordSignatureSuccess(account.id);

    // Revue PO R-9 : le compte est créé et connecté, aucune panne d'ici ne fait répondre une erreur.
    const app = await this.applyAppWebhookRuleSafely(account, secrets);
    try {
      await this.db.setWhatsAppAccountWebhookState(clientId, account.id, {
        waba: 'ok', app: app.state, app_host: app.app_host, checked_at: new Date().toISOString(),
      });
    } catch {
      console.log(`[WhatsAppAccounts] État des webhooks du compte ${account.id} non enregistré`);
    }
    await this.saveMetaHealth(account, verification.meta_health);

    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.create', target: target(clientId, account.id), client_id: clientId,
      metadata: { mode: 'meta_manual', numbers: inventory.added, refused: inventory.refused, webhook_waba: 'ok', webhook_app: app.state },
    });
    console.log(`[WhatsAppAccounts] Compte ${account.id} raccordé (meta_manual, ${inventory.added} numéro(s) ajouté(s), ${inventory.refused} refusé(s), webhook de l'app : ${app.state})`);
    // L'app est abonnée à la WABA par l'inscription, confirmée à la relecture.
    const checks = withWebhookChecks(verification.checks, { key: 'webhook_waba', status: 'created' }, app.check);
    let stored = account;
    try {
      stored = (await this.db.getWhatsAppAccount(clientId, account.id)) ?? account;
    } catch {
      console.log(`[WhatsAppAccounts] Relecture du compte ${account.id} en échec après le raccordement`);
    }
    return {
      ...(await this.view(clientId, stored)),
      // Le moteur a inscrit lui-même l'adresse chez Meta : rien à recopier (lot R1).
      webhook: null,
      checks,
      inventory: summarize(inventory, verification.skipped),
    };
  }

  /**
   * Inscription de l'adresse propre du compte sur sa WABA puis relecture : l'entrée de l'app du jeton doit porter cette
   * adresse. Séquence commune au raccordement, à « Vérifier maintenant » et au remplacement des identifiants ; l'appelant
   * tient la réservation de la WABA. Meta vérifie l'adresse pendant l'appel : au raccordement, le registre des
   * vérifications attendues y répond (le compte n'existe pas encore) ; pour un compte existant, la base (revue R1 ISO-I1).
   */
  private async writeAndConfirmOverride(
    meta: MetaManualCredentials, metaAppId: string, hook: { callbackUrl: string; verifyToken: string },
  ): Promise<OverrideInscription> {
    const written = await this.providers.metaWebhooks.setWabaOverride(meta, { callbackUrl: hook.callbackUrl, verifyToken: hook.verifyToken });
    if (!written.ok) return { ok: false, stage: 'write', failure: written.failure };
    const readBack = await this.providers.metaWebhooks.readWabaOverride(meta, metaAppId);
    return readBack.ok && readBack.subscribed && readBack.override === hook.callbackUrl ? { ok: true } : { ok: false, stage: 'readback' };
  }

  /**
   * Webhook de la WABA d'un compte existant (spec R1 §5.3). `readFirst` (« Vérifier maintenant ») : l'abonnement est relu
   * et rien n'est écrit si l'adresse est déjà celle du compte ; sinon (remplacement des identifiants, parcours du §5.1)
   * l'adresse est inscrite d'emblée. L'adresse et le jeton de vérification sont ceux du compte, jamais de nouveaux. Une
   * erreur 2200, une panne passagère ou une relecture sans notre adresse donnent `missing` sans toucher à l'état du
   * compte ; l'adresse n'est jamais retirée (le compte existe). Aucune exception ne sort d'ici.
   */
  private async reconcileWabaOverride(
    account: WhatsAppAccountRecord, secrets: MetaSecrets, opts: { readFirst: boolean },
  ): Promise<WabaWebhookOutcome> {
    const failed = (detail: string, state: WabaWebhookState | null, providerText?: string): WabaWebhookOutcome => ({
      state, tokenRefused: null, stale: false,
      check: { key: 'webhook_waba', status: 'failed', detail, ...(providerText !== undefined ? { provider_text: providerText } : {}) },
    });
    const url = callbackUrlFor(secrets.webhook_key);
    if (!url.ok) return failed(url.message, null);
    if (account.meta_app_id === null) return failed(APP_UNREADABLE, null);
    const metaAppId = account.meta_app_id;
    const meta: MetaManualCredentials = { waba_id: account.provider_account_id, access_token: secrets.access_token, app_secret: secrets.app_secret };
    const hook = { callbackUrl: url.url, verifyToken: secrets.verify_token };

    // Réservation de la WABA autour de la lecture et de l'écriture : ni un raccordement ni une autre vérification ne
    // peuvent écrire chez Meta en même temps.
    const releaseClaim = tryClaimConnection(account.client_id, account.provider_account_id);
    if (releaseClaim === null) {
      console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} non relu : autre opération en cours`);
      // Remplacement des identifiants : l'adresse n'a pas été inscrite avec les nouveaux identifiants, `missing`.
      return failed(CONNECTION_BUSY, opts.readFirst ? null : 'missing');
    }
    try {
      // Revue 2b-2 M-2 : sous la réservation, le compte doit être encore celui que l'appelant a lu.
      if (!(await this.stillCurrent(account))) {
        console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} non relu : identifiants changés entre-temps`);
        return { ...failed(CREDENTIALS_CHANGED, null), stale: true };
      }
      if (opts.readFirst) {
        const current = await this.providers.metaWebhooks.readWabaOverride(meta, metaAppId);
        if (!current.ok) {
          const d = describeFailure(current.failure, 'webhook_waba');
          console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} non relu chez Meta`);
          const outcome = failed(d.transient ? PROVIDER_UNAVAILABLE : d.message, null, d.provider_text);
          return d.reason === 'token_invalid' ? { ...outcome, tokenRefused: d.message } : outcome;
        }
        if (current.subscribed && current.override === hook.callbackUrl) {
          return { state: 'ok', tokenRefused: null, stale: false, check: { key: 'webhook_waba', status: 'ok' } };
        }
      }

      // Revue R1 ISO-I1 : jamais de registre des vérifications attendues pour un compte existant, la base sert le GET de
      // Meta. Un compte retiré entre-temps n'a plus de clé en base : 403, Meta répond 2200, rien n'est écrit chez Meta.
      const inscription = await this.writeAndConfirmOverride(meta, metaAppId, hook);
      if (inscription.ok) {
        console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} inscrit chez Meta`);
        return { state: 'ok', tokenRefused: null, stale: false, check: { key: 'webhook_waba', status: 'created' } };
      }
      if (inscription.stage === 'readback') {
        console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} absent à la relecture chez Meta`);
        return failed(WEBHOOK_UNCONFIRMED, 'missing');
      }
      const d = describeFailure(inscription.failure, 'webhook_waba');
      console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} non inscrit chez Meta`);
      if (d.reason === 'token_invalid') return { ...failed(d.message, 'missing'), tokenRefused: d.message };
      // Spec R1 §5.3 : 2200 ou panne passagère, non concluant ; refus net : texte du moteur et message de Meta.
      return failed(d.callbackFailed === true || d.transient ? WEBHOOK_UNREACHABLE : d.message, 'missing', d.provider_text);
    } catch {
      console.log(`[WhatsAppAccounts] Webhook de la WABA du compte ${account.id} non vérifié (panne inattendue)`);
      return failed(PROVIDER_UNAVAILABLE, null);
    } finally {
      releaseClaim();
    }
  }

  /**
   * Revue 2b-2 M-2 : vrai si le compte en base a encore les identifiants, l'app et l'état `connected` de `account`.
   * Une lecture en échec compte comme un changement : rien n'est écrit. `requireConnected: false` : compte que
   * l'appelant vient de mettre en erreur (jeton refusé), seuls les identifiants et l'app sont comparés.
   */
  private async stillCurrent(account: WhatsAppAccountRecord, opts: { requireConnected: boolean } = { requireConnected: true }): Promise<boolean> {
    try {
      const now = await this.db.getWhatsAppAccount(account.client_id, account.id);
      if (now === undefined || now === null || now.state === 'disconnected') return false;
      return (!opts.requireConnected || now.state === 'connected')
        && now.secret_encrypted === account.secret_encrypted && now.meta_app_id === account.meta_app_id;
    } catch {
      return false;
    }
  }

  /**
   * État des webhooks après une relecture chez Meta : écriture partielle (revue R1 ISO-M1), ce qui n'a pas été lu garde
   * sa valeur en base, jamais celle d'une lecture ancienne (un `missing` posé entre-temps par le webhook reste). Écriture
   * gardée : son échec est journalisé sans identifiant et ne change pas la réponse.
   */
  private async saveWebhookState(account: WhatsAppAccountRecord, waba: WabaWebhookState | null, app: AppWebhookOutcome | null): Promise<void> {
    if (waba === null && app === null) return;
    try {
      await this.db.setWhatsAppAccountWebhookState(account.client_id, account.id, {
        ...(waba === null ? {} : { waba }),
        ...(app === null ? {} : { app: app.state, app_host: app.app_host }),
        checked_at: new Date().toISOString(),
      });
    } catch {
      console.log(`[WhatsAppAccounts] État des webhooks du compte ${account.id} non enregistré`);
    }
  }

  /** État du compte lu chez Meta (spec R1 §5.6) : écriture gardée, rien si rien n'a été lu. */
  private async saveMetaHealth(account: Pick<WhatsAppAccountRecord, 'client_id' | 'id'>, health: MetaHealthView | null): Promise<void> {
    if (health === null) return;
    try {
      await this.db.setWhatsAppAccountMetaHealth(account.client_id, account.id, health);
    } catch {
      console.log(`[WhatsAppAccounts] État Meta du compte ${account.id} non enregistré`);
    }
  }

  /**
   * Échec de l'inscription de l'adresse sur la WABA. 2200 : Meta n'a pas pu joindre notre adresse, rien n'est écrit
   * chez Meta. Panne passagère : l'écriture a pu aboutir sans réponse, l'adresse est retirée. Refus net : texte de Meta.
   */
  private async overrideRefused(meta: MetaManualCredentials, failure: GraphFailure): Promise<AppError> {
    const d = describeFailure(failure, 'webhook_waba');
    if (d.callbackFailed === true) {
      console.log('[WhatsAppAccounts] Raccordement refusé : Meta n\'a pas pu joindre l\'adresse du webhook (2200)');
      return new AppError('WA_VALIDATION_FAILED', WEBHOOK_UNREACHABLE, [
        withProviderText({ path: 'webhook_waba', message: WEBHOOK_UNREACHABLE }, d.provider_text),
      ], 'whatsapp_account.webhook_unreachable');
    }
    if (d.transient) {
      console.log('[WhatsAppAccounts] Raccordement refusé : Meta indisponible pendant l\'inscription du webhook');
      return new AppError('WA_VALIDATION_FAILED', WEBHOOK_UNREACHABLE, [
        withProviderText({ path: 'webhook_waba', message: d.message }, d.provider_text),
        { path: 'transient', message: PROVIDER_UNAVAILABLE },
        await this.withdrawOverride(meta),
      ], 'whatsapp_account.webhook_unreachable');
    }
    console.log('[WhatsAppAccounts] Raccordement refusé : inscription du webhook refusée par Meta');
    return new AppError('WA_VALIDATION_FAILED', d.message, [
      withProviderText({ path: 'webhook_waba', message: d.message }, d.provider_text),
    ], 'whatsapp_account.verification_failed');
  }

  /** Retire l'adresse inscrite sur la WABA (spec R1 §5.2) et rend le détail qui dit si le retrait a réussi. */
  private async withdrawOverride(meta: MetaManualCredentials): Promise<ApiErrorDetail> {
    let ok = false;
    try {
      ok = (await this.providers.metaWebhooks.clearWabaOverride(meta)).ok;
    } catch {
      ok = false;
    }
    if (!ok) console.log('[WhatsAppAccounts] Raccordement refusé : retrait de l\'adresse du webhook chez Meta en échec');
    return { path: 'webhook_cleanup', message: ok ? WEBHOOK_CLEANUP_DONE : WEBHOOK_CLEANUP_FAILED };
  }

  /** Règle du webhook de l'app : toute exception devient l'état `failed` (revue PO R-9). Défaut : jamais de remplacement. */
  private async applyAppWebhookRuleSafely(
    account: WhatsAppAccountRecord, secrets: MetaSecrets, opts: { allowReplaceElsewhere: boolean } = { allowReplaceElsewhere: false },
  ): Promise<AppWebhookOutcome> {
    try {
      return await this.applyAppWebhookRule(account, secrets, opts);
    } catch {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} non inscrit (panne inattendue)`);
      return { state: 'failed', app_host: null, check: { key: 'webhook_app', status: 'failed', detail: APP_WEBHOOK_FAILED } };
    }
  }

  /**
   * Webhook de l'app Meta (spec R1 §5.4, ruling R-3) : lu avec le jeton d'app. Déjà sur un compte `connected` de la même
   * organisation et de la même app : rien n'est écrit. Vide ou sur une autre adresse de WABAGENT : l'adresse du compte
   * est inscrite. Ailleurs : inscrite seulement si `allowReplaceElsewhere`, sinon état `elsewhere` avec le domaine seul.
   * Un échec de lecture ou d'écriture donne `failed` et ne change jamais l'état du compte.
   */
  private async applyAppWebhookRule(
    account: WhatsAppAccountRecord, secrets: MetaSecrets, opts: { allowReplaceElsewhere: boolean },
  ): Promise<AppWebhookOutcome> {
    const base = config.webhook.publicBaseUrl;
    if (account.meta_app_id === null || base === null) {
      return { state: 'failed', app_host: null, check: { key: 'webhook_app', status: 'failed', detail: base === null ? PUBLIC_URL_MISSING : APP_WEBHOOK_FAILED } };
    }
    const app = { appId: account.meta_app_id, appSecret: secrets.app_secret };
    const failed = (failure: GraphFailure): AppWebhookOutcome => {
      const d = describeFailure(failure, 'webhook_app');
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} non inscrit`);
      return {
        state: 'failed', app_host: null,
        check: { key: 'webhook_app', status: 'failed', detail: APP_WEBHOOK_FAILED, ...(d.provider_text !== undefined ? { provider_text: d.provider_text } : {}) },
      };
    };

    const current = await this.providers.metaWebhooks.readAppWebhook(app);
    if (!current.ok) return failed(current.failure);
    // Adresses des comptes `connected` de la même organisation et de la même app, jamais d'une autre organisation.
    const ownUrls = (await this.db.listConnectedMetaAccountsForApp(account.client_id, account.meta_app_id))
      .map((a) => decryptAccountSecrets(a))
      .filter((s): s is MetaSecrets => s !== null && s.mode === 'meta_manual')
      .map((s) => metaWebhookUrl(base, s.webhook_key));
    const kind = classifyAppWebhook(current.callbackUrl, base, ownUrls);
    if (kind === 'ours') return { state: 'ok', app_host: null, check: { key: 'webhook_app', status: 'ok' } };
    if (kind === 'elsewhere' && !opts.allowReplaceElsewhere) {
      return {
        state: 'elsewhere',
        app_host: current.callbackUrl === null ? null : hostOf(current.callbackUrl),
        check: { key: 'webhook_app', status: 'pending', detail: APP_WEBHOOK_ELSEWHERE },
      };
    }

    // Revue R1 ISO-I1 : le compte est relu juste avant l'écriture (pas de verrou par app) : retiré, remplacé ou sorti de
    // `connected` entre-temps, rien n'est écrit. Aucun registre des vérifications attendues : le compte existe en base, qui
    // sert le GET de Meta (un compte retiré répond 403, Meta n'écrit rien).
    if (!(await this.stillCurrent(account))) {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} non inscrit : compte changé entre-temps`);
      return { state: 'failed', app_host: null, check: { key: 'webhook_app', status: 'failed', detail: ACCOUNT_CHANGED } };
    }
    const written = await this.providers.metaWebhooks.setAppWebhook(app, {
      callbackUrl: metaWebhookUrl(base, secrets.webhook_key), verifyToken: secrets.verify_token, fields: APP_WEBHOOK_FIELDS,
    });
    if (!written.ok) return failed(written.failure);
    return { state: 'ok', app_host: null, check: { key: 'webhook_app', status: 'created' } };
  }

  /**
   * « Faire pointer vers WABAGENT » (spec R1 §5.4, §10 question 1) : l'admin confirme que le webhook de l'app, qui pointe
   * hors de WABAGENT, peut être remplacé par l'adresse de ce compte. Compte `connected` en `meta_manual` seulement : un
   * compte inconnu, d'une autre organisation ou CM.com répond 404, un compte retiré 409. Même sûreté que « Vérifier
   * maintenant » : réservation de la WABA (aucune vérification ni remplacement du même compte en même temps ; pas de verrou
   * par app, choix du rédacteur du §5.4), compte relu sous la réservation puis juste avant
   * l'écriture (dans la règle, revue R1 ISO-I1). Un échec du jeton d'app ne change jamais l'état du compte : refus `app_webhook_failed`.
   * Audit `{ result }`, jamais l'adresse.
   */
  async pointAppWebhook(clientId: string, id: number, actorUserId: number | null): Promise<WhatsAppAppWebhookResult> {
    const account = await this.requireAccount(clientId, id);
    if (account.mode !== 'meta_manual') throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    if (account.state === 'disconnected') throw conflict(ACCOUNT_DISCONNECTED, 'whatsapp_account.disconnected');
    const refused = (message: string, providerText?: string): AppError => new AppError('WA_VALIDATION_FAILED', APP_WEBHOOK_FAILED, [
      withProviderText({ path: 'webhook_app', message }, providerText),
    ], 'whatsapp_account.app_webhook_failed');
    if (account.state !== 'connected') throw refused(APP_WEBHOOK_NOT_CONNECTED);
    const secrets = decryptAccountSecrets(account);
    if (secrets === null || secrets.mode !== 'meta_manual') throw conflict(SECRETS_UNREADABLE, 'whatsapp_account.secrets_unreadable');
    // Comme au raccordement : adresse publique absente ou trop longue, refus avant tout appel à Meta.
    const url = callbackUrlFor(secrets.webhook_key);
    if (!url.ok) throw new AppError('WA_VALIDATION_FAILED', url.message, [{ path: 'webhook_app', message: url.message }], url.reason);

    const releaseClaim = tryClaimConnection(account.client_id, account.provider_account_id);
    if (releaseClaim === null) {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${id} non inscrit : autre opération en cours`);
      throw refused(CONNECTION_BUSY);
    }
    let app: AppWebhookOutcome;
    try {
      // Revue 2b-2 M-2 : sous la réservation, le compte doit être encore celui qui vient d'être lu.
      if (!(await this.stillCurrent(account))) throw refused(ACCOUNT_CHANGED);
      app = await this.applyAppWebhookRuleSafely(account, secrets, { allowReplaceElsewhere: true });
      // Un remplacement des identifiants terminé pendant l'appel garde ses propres états.
      if (!(await this.stillCurrent(account))) {
        console.log(`[WhatsAppAccounts] État du webhook de l'app Meta du compte ${id} non enregistré : compte changé entre-temps`);
        // Revue de la tâche 7, mineur 2 : Meta a pu être écrit, l'opération est auditée sans enregistrement d'état.
        await recordAudit(this.db, {
          actor_user_id: actorUserId, action: 'whatsapp_account.app_webhook', target: target(clientId, id), client_id: clientId,
          metadata: { result: app.state, saved: false },
        });
        throw refused(ACCOUNT_CHANGED);
      }
      // Ruling R-15 : un échec ne change pas l'état enregistré (`elsewhere` et son domaine restent, le bouton aussi).
      if (app.state !== 'failed') await this.saveWebhookState(account, null, app);
    } finally {
      releaseClaim();
    }
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.app_webhook', target: target(clientId, id), client_id: clientId,
      metadata: { result: app.state },
    });
    if (app.state === 'failed') throw refused(app.check.detail ?? APP_WEBHOOK_FAILED, app.check.provider_text);
    console.log(`[WhatsAppAccounts] Webhook de l'app Meta pointé sur le compte ${id}`);
    return { ...(await this.get(clientId, id)), checks: [app.check] };
  }

  async rename(clientId: string, id: number, actorUserId: number | null, rawName: string): Promise<WhatsAppAccountView> {
    const { name } = RenameWhatsAppAccountInput.parse({ name: rawName });
    await this.requireAccount(clientId, id);
    if (!(await this.db.renameWhatsAppAccount(clientId, id, name))) throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.rename', target: target(clientId, id), client_id: clientId,
      metadata: { name },
    });
    return this.get(clientId, id);
  }

  async replaceCredentials(
    clientId: string, id: number, actorUserId: number | null, raw: ReplaceWhatsAppCredentialsInput,
  ): Promise<WhatsAppAccountReplaced> {
    const input = ReplaceWhatsAppCredentialsInput.parse(raw);
    rejectMasked(input);
    const account = await this.requireAccount(clientId, id);
    if (account.state === 'disconnected') throw conflict(ACCOUNT_DISCONNECTED, 'whatsapp_account.disconnected');
    if (input.mode !== account.mode || !sameProviderAccount(providerAccountIdOf(input), account.provider_account_id)) {
      throw conflict(OTHER_PROVIDER_ACCOUNT, 'whatsapp_account.other_provider_account');
    }
    const current = decryptAccountSecrets(account);
    if (!current) throw conflict(SECRETS_UNREADABLE, 'whatsapp_account.secrets_unreadable');
    // Lot R1, spec R1 §5.1 et §5.3 : prérequis de plateforme, avant tout appel au fournisseur.
    if (current.mode === 'meta_manual') requireCallbackUrl(current.webhook_key);

    const verification = await this.verifyInput(input);
    if (!verification.ok) throw validationFailed(verification);
    rejectUnreadableApp(input.mode, verification);

    // La clé d'URL et le jeton de vérification sont conservés (spec R1 §5.3) : l'adresse réinscrite chez Meta est la même.
    const verifyToken = current.mode === 'meta_manual' ? current.verify_token : generateVerifyToken();
    const newSecrets = secretsFor(input, current.webhook_key, verifyToken);
    const encrypted = encryptAccountSecrets(newSecrets);
    // Choix 3 contrôlé dans la transaction de l'écriture (sous le verrou de topologie sur Postgres).
    const replaced = await this.db.replaceWhatsAppAccountSecrets(clientId, id, {
      secret_encrypted: encrypted.secret_encrypted,
      key_version: encrypted.key_version,
      // CM.com : `facebookId` relu à titre indicatif ; Meta : la WABA du compte, inchangée.
      waba_id: input.mode === 'meta_manual' ? input.waba_id : verification.waba_id,
      meta_app_id: verification.meta_app_id,
      token_expiry: verification.token_expiry,
      verified_at: new Date().toISOString(),
    });
    if (!replaced.ok && replaced.reason === 'meta_app_taken') {
      console.log('[WhatsAppAccounts] Remplacement refusé : app Meta déjà utilisée ailleurs');
      throw conflict(CANNOT_CONNECT, 'whatsapp_account.cannot_connect');
    }
    if (!replaced.ok) throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    invalidateAccountTransports(id);
    // Vérification réussie : l'appsecret_proof a prouvé le secret de l'app, les rejets passés ne comptent plus.
    recordSignatureSuccess(id);
    const inventory = await this.db.applyInventory(clientId, id, verification.numbers, ADMIN_INVENTORY);
    // Revue 2b-2 M-3 : les identifiants sont remplacés, l'inventaire vide n'est pas appliqué et le contrôle le dit.
    const inventoryChecks: VerificationCheck[] = inventory.ignored_empty
      ? [...verification.checks.filter((c) => c.key !== 'numbers'), { key: 'numbers', status: 'pending', detail: EMPTY_INVENTORY }]
      : verification.checks;
    if (inventory.ignored_empty) console.log(`[WhatsAppAccounts] Inventaire vide du compte ${id} non appliqué`);

    // Lot R1, spec R1 §5.3 : parcours du §5.1 avec les nouveaux identifiants, après leur écriture. Un échec de
    // l'inscription garde les identifiants (ils ont été vérifiés) : webhook de la WABA `missing`, contrôle en échec.
    let checks = inventoryChecks;
    let webhookMetadata: { webhook_waba: WabaWebhookState; webhook_app: AppWebhookState } | null = null;
    if (newSecrets.mode === 'meta_manual') {
      // Le compte tel que ce remplacement l'a écrit : un remplacement concurrent est reconnu sous la réservation.
      const updated: WhatsAppAccountRecord = {
        ...account, state: 'connected', meta_app_id: verification.meta_app_id,
        secret_encrypted: encrypted.secret_encrypted, key_version: encrypted.key_version,
      };
      const waba = await this.reconcileWabaOverride(updated, newSecrets, { readFirst: false });
      if (waba.stale) {
        checks = withWebhookChecks(inventoryChecks, waba.check, null);
      } else {
        const app = await this.applyAppWebhookRuleSafely(updated, newSecrets);
        await this.saveWebhookState(updated, waba.state, app);
        await this.saveMetaHealth(updated, verification.meta_health);
        checks = withWebhookChecks(inventoryChecks, waba.check, app.check);
        webhookMetadata = { webhook_waba: waba.state ?? 'unknown', webhook_app: app.state };
      }
    }

    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.credentials', target: target(clientId, id), client_id: clientId,
      metadata: { added: inventory.added, removed: inventory.removed, refused: inventory.refused, ...(webhookMetadata ?? {}) },
    });
    console.log(`[WhatsAppAccounts] Identifiants du compte ${id} remplacés`);
    return { ...(await this.get(clientId, id)), checks, inventory: summarize(inventory, verification.skipped) };
  }

  /**
   * « Vérifier maintenant » (§7.7) : un refus clair du fournisseur met le compte en `error` avec son motif, sans lever
   * d'erreur ; un échec non concluant (fournisseur indisponible, app illisible) ne change rien.
   */
  async verify(clientId: string, id: number, actorUserId: number | null): Promise<WhatsAppAccountVerified> {
    const account = await this.requireAccount(clientId, id);
    if (account.state === 'disconnected') throw conflict(ACCOUNT_DISCONNECTED, 'whatsapp_account.disconnected');
    // Lot R1, spec R1 §5.3 : sans adresse publique, la vérification d'un compte Meta est refusée avant tout appel à Meta,
    // non concluante : état du compte et dates inchangés.
    if (account.mode === 'meta_manual' && config.webhook.publicBaseUrl === null) {
      console.log(`[WhatsAppAccounts] Vérification du compte ${id} non concluante : adresse publique absente`);
      await recordAudit(this.db, {
        actor_user_id: actorUserId, action: 'whatsapp_account.verify', target: target(clientId, id), client_id: clientId,
        metadata: { ok: false },
      });
      return { ...(await this.get(clientId, id)), checks: [{ key: 'webhook_waba', status: 'failed', detail: PUBLIC_URL_MISSING }], outcome: 'inconclusive' };
    }
    const secrets = decryptAccountSecrets(account);
    const verification: ProviderVerification = secrets
      ? await this.verifyStored(account, secrets)
      : { ok: false, checks: [], error_reason: 'other', message: SECRETS_UNREADABLE_SHORT };

    // Revue 2b-2 M-1 : délai dépassé, fournisseur injoignable ou réponse 5xx, vérification non concluante. L'état du
    // compte, `last_verified_at` et `token_expiry` ne changent pas ; seul un refus clair met le compte en `error`.
    if (!verification.ok && verification.transient === true) {
      console.log(`[WhatsAppAccounts] Vérification du compte ${id} non concluante : fournisseur indisponible`);
      await recordAudit(this.db, {
        actor_user_id: actorUserId, action: 'whatsapp_account.verify', target: target(clientId, id), client_id: clientId,
        metadata: { ok: false },
      });
      const checks = verification.checks.map((c) => (c.status === 'failed' ? { ...c, detail: PROVIDER_UNAVAILABLE } : c));
      return { ...(await this.get(clientId, id)), checks, outcome: 'inconclusive' };
    }

    // Garde de défense : le client Meta réel ne renvoie plus de réussite sans app lue (il répond « non concluant »,
    // branche précédente). Si un fournisseur le faisait quand même, le compte ne passerait jamais en erreur ni en
    // `connected` : état et `last_verified_at` ne changent pas.
    if (verification.ok && account.mode === 'meta_manual' && verification.meta_app_id === null) {
      console.log(`[WhatsAppAccounts] Vérification du compte ${id} non concluante : app Meta illisible`);
      await recordAudit(this.db, {
        actor_user_id: actorUserId, action: 'whatsapp_account.verify', target: target(clientId, id), client_id: clientId,
        metadata: { ok: false },
      });
      return { ...(await this.get(clientId, id)), checks: [...verification.checks, APP_UNREADABLE_CHECK], outcome: 'inconclusive' };
    }

    // Choix 3 : le jeton doit rester celui de l'app du compte, et cette app ne doit être détenue par aucune autre
    // organisation (contrôlé par le pilote dans la transaction de la remise en `connected`) ; sinon le compte passe
    // en `error` avec un message neutre et ne revient jamais en `connected`.
    let accepted = false;
    // Issue pour l'écran : `refused` pour tout passage en erreur (y compris app non conforme, contrôles tous `ok`).
    // Compte déconnecté entre-temps : rien n'est enregistré, l'issue n'est pas `verified`.
    let outcome: WhatsAppVerificationOutcome = 'refused';
    let checks: VerificationCheck[] = verification.checks;
    if (verification.ok && verification.meta_app_id === account.meta_app_id) {
      const marked = await this.db.markWhatsAppAccountVerified(id, { token_expiry: verification.token_expiry, verified_at: new Date().toISOString() });
      if (marked.ok) {
        accepted = true;
        outcome = 'verified';
        recordSignatureSuccess(id);
        if (secrets?.mode === 'meta_manual') {
          const hooks = await this.verifyWebhooks(account, secrets, verification);
          checks = hooks.checks;
          // Ruling R-11 : compte marqué vérifié et jeton accepté, l'issue reste `verified` même si la réinscription
          // échoue ; l'échec se lit dans le contrôle `webhook_waba` et dans `webhooks.waba`.
          if (hooks.tokenRefused !== null) {
            accepted = false;
            outcome = 'refused';
          }
        }
      } else if (marked.reason === 'meta_app_taken') {
        await this.db.setWhatsAppAccountError(id, 'other', CANNOT_CONNECT, account.secret_encrypted);
        console.log(`[WhatsAppAccounts] Vérification du compte ${id} refusée : app Meta non conforme`);
      } else {
        // not_found : compte déconnecté entre-temps, rien à écrire.
        outcome = 'inconclusive';
      }
    } else if (verification.ok) {
      await this.db.setWhatsAppAccountError(id, 'other', CANNOT_CONNECT, account.secret_encrypted);
      console.log(`[WhatsAppAccounts] Vérification du compte ${id} refusée : app Meta non conforme`);
    } else {
      // Revue 2b-2 M-2 : rien n'est écrit si les identifiants ont été remplacés pendant la vérification.
      await this.db.setWhatsAppAccountError(id, verification.error_reason, verification.message, account.secret_encrypted, verification.provider_text ?? null);
      console.log(`[WhatsAppAccounts] Vérification du compte ${id} en échec (${verification.error_reason})`);
    }
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.verify', target: target(clientId, id), client_id: clientId,
      metadata: { ok: accepted },
    });
    return { ...(await this.get(clientId, id)), checks, outcome };
  }

  /**
   * « Vérifier maintenant » d'un compte Meta accepté (spec R1 §5.3, §5.6) : webhook de la WABA relu et réinscrit au
   * besoin, puis règle du webhook de l'app (sans jamais remplacer une adresse hors de WABAGENT), état Meta réécrit. Un
   * échec de la WABA autre qu'un jeton refusé ne change pas l'état du compte ; un échec du webhook de l'app ne change
   * rien d'autre que son état. Jeton refusé par Meta : compte en erreur (règles du 2b). Identifiants remplacés entre-temps
   * (revue 2b-2 M-2) : rien n'est écrit, ni chez Meta ni en base.
   */
  private async verifyWebhooks(
    account: WhatsAppAccountRecord, secrets: MetaSecrets, verification: Extract<ProviderVerification, { ok: true }>,
  ): Promise<{ checks: VerificationCheck[]; tokenRefused: string | null }> {
    const waba = await this.reconcileWabaOverride(account, secrets, { readFirst: true });
    if (waba.stale) return { checks: withWebhookChecks(verification.checks, waba.check, null), tokenRefused: null };
    if (waba.tokenRefused !== null) {
      // Revue 2b-2 M-2 : rien n'est écrit si les identifiants ont été remplacés pendant la vérification.
      await this.db.setWhatsAppAccountError(account.id, 'token_invalid', waba.tokenRefused, account.secret_encrypted, waba.check.provider_text ?? null);
      console.log(`[WhatsAppAccounts] Vérification du compte ${account.id} en échec (token_invalid)`);
      if (await this.stillCurrent(account, { requireConnected: false })) await this.saveWebhookState(account, waba.state, null);
      return { checks: withWebhookChecks(verification.checks, waba.check, null), tokenRefused: waba.tokenRefused };
    }
    const app = await this.applyAppWebhookRuleSafely(account, secrets);
    // Revue 2b-2 M-2 : un remplacement terminé pendant la règle de l'app garde ses propres états.
    if (!(await this.stillCurrent(account))) {
      // Revue R1 ISO-I1 : compte retiré ou remplacé pendant la règle, le contrôle ne dit jamais « inscrit ».
      const changed: VerificationCheck = { key: 'webhook_app', status: 'failed', detail: CREDENTIALS_CHANGED };
      return { checks: withWebhookChecks(verification.checks, waba.check, changed), tokenRefused: null };
    }
    await this.saveWebhookState(account, waba.state, app);
    await this.saveMetaHealth(account, verification.meta_health);
    return { checks: withWebhookChecks(verification.checks, waba.check, app.check), tokenRefused: null };
  }

  /**
   * Rafraîchissement déclenché par un événement du fournisseur (aucun acteur) : jamais de reprise d'un numéro tenu
   * par un autre compte, il est compté dans `refused` (revue 2b-2 I-1).
   */
  async refreshOnProviderEvent(clientId: string, id: number): Promise<WhatsAppAccountRefreshed> {
    return this.refreshNumbers(clientId, id, null, { allowTakeover: false });
  }

  /**
   * « Rafraîchir les numéros » (§7.4). La reprise d'un numéro tenu par un compte en erreur ou déconnecté n'a lieu que
   * si `opts.allowTakeover` (action d'un admin) ; défaut : aucune reprise.
   */
  async refreshNumbers(
    clientId: string, id: number, actorUserId: number | null, opts: InventoryOptions = { allowTakeover: false },
  ): Promise<WhatsAppAccountRefreshed> {
    // applyInventory lève pour un compte inconnu, d'une autre organisation ou déconnecté : contrôlé avant.
    const account = await this.requireAccount(clientId, id);
    if (account.state === 'disconnected') throw conflict(ACCOUNT_DISCONNECTED, 'whatsapp_account.disconnected');
    const secrets = decryptAccountSecrets(account);
    if (!secrets) throw conflict(SECRETS_UNREADABLE, 'whatsapp_account.secrets_unreadable');

    const listing = secrets.mode === 'meta_manual'
      ? await this.providers.listMeta({ waba_id: account.provider_account_id, access_token: secrets.access_token, app_secret: secrets.app_secret })
      : await this.providers.listCm({ account_id: account.provider_account_id, product_token: secrets.product_token });
    if (listing.error) {
      // Jeton refusé à la lecture : même effet qu'à la vérification (§7.7). Inventaire inchangé.
      // Revue 2b-2 M-2 : seulement si les identifiants lus sont encore ceux du compte.
      if (listing.error.reason === 'token_invalid') {
        await this.db.setWhatsAppAccountError(id, 'token_invalid', listing.error.message, account.secret_encrypted, listing.error.provider_text ?? null);
      }
      // audit décisions B7 : la clé dit la cause (jeton refusé, panne passagère du fournisseur, autre) pour que l'écran
      // ne conseille « Réessayez » que lorsque réessayer peut réussir.
      const reason = listing.error.reason === 'token_invalid'
        ? 'whatsapp_account.listing_token_invalid'
        : listing.error.transient === true ? 'whatsapp_account.listing_unavailable' : 'whatsapp_account.listing_failed';
      throw new AppError(
        'WA_VALIDATION_FAILED', listing.error.message,
        [{ path: 'numbers', message: listing.error.message, ...(listing.error.provider_text !== undefined ? { provider_text: listing.error.provider_text } : {}) }],
        reason,
      );
    }

    const inventory = await this.db.applyInventory(clientId, id, listing.numbers, opts);
    if (inventory.ignored_empty) {
      // Revue 2b-2 M-3 : rien n'a été écrit (ni retrait, ni pause, ni audit).
      console.log(`[WhatsAppAccounts] Inventaire vide du compte ${id} non appliqué`);
      throw new AppError('WA_VALIDATION_FAILED', EMPTY_INVENTORY, [{ path: 'numbers', message: EMPTY_INVENTORY }], 'whatsapp_account.empty_inventory');
    }
    if (secrets.mode === 'meta_manual') {
      // Spec R1 §5.6 : état du compte relu chez Meta ; un échec de lecture le laisse tel quel et ne fait pas échouer.
      let health: MetaHealthView | null = null;
      try {
        health = await this.providers.metaWebhooks.readMetaHealth({
          waba_id: account.provider_account_id, access_token: secrets.access_token, app_secret: secrets.app_secret,
        });
      } catch {
        console.log(`[WhatsAppAccounts] État Meta du compte ${id} non relu`);
      }
      await this.saveMetaHealth(account, health);
    }
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.refresh', target: target(clientId, id), client_id: clientId,
      metadata: { added: inventory.added, removed: inventory.removed, refused: inventory.refused },
    });
    return { ...(await this.get(clientId, id)), inventory: summarize(inventory, listing.skipped) };
  }

  /** Marquage manuel « numéro de test » (Meta ne le déclare pas, tâche 0 d). */
  async setNumberTestFlag(
    clientId: string, accountId: number, numberId: number, actorUserId: number | null, isTest: boolean,
  ): Promise<WhatsAppAccountView> {
    await this.requireAccount(clientId, accountId);
    if (!(await this.db.setWhatsAppNumberTestFlag(clientId, accountId, numberId, isTest))) throw notFound(NUMBER_NOT_FOUND, 'whatsapp_account.number_not_found');
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_number.test_flag', target: target(clientId, accountId), client_id: clientId,
      metadata: { number_id: numberId, is_test: isTest },
    });
    return this.get(clientId, accountId);
  }

  /**
   * Choix 6 : refusée tant qu'un numéro sert un agent IA en accès limité ou actif, sans aucun appel à Meta. Sans effet sur
   * un compte déjà déconnecté. Meta (spec R1 §5.5) : les secrets sont lus avant la déconnexion en base, qui les efface ;
   * une fois la déconnexion faite, l'adresse propre de la WABA est retirée et le webhook de l'app est repointé ou laissé.
   * Ces nettoyages ne bloquent ni n'annulent jamais la déconnexion : leur issue est dans le résultat et dans l'audit.
   */
  async disconnect(clientId: string, id: number, actorUserId: number | null): Promise<WhatsAppAccountDisconnected> {
    const account = await this.requireAccount(clientId, id);
    if (account.state === 'disconnected') return NOTHING_AT_META;
    const isMeta = account.mode === 'meta_manual';
    const decrypted = isMeta ? decryptAccountSecrets(account) : null;
    const secrets = decrypted !== null && decrypted.mode === 'meta_manual' ? decrypted : null;
    // Réservation de la WABA prise avant la déconnexion et gardée jusqu'au retrait : un raccordement ou une vérification
    // de la même WABA ne peut pas écrire son adresse chez Meta entre les deux (le retrait l'effacerait). Null : WABA déjà
    // réservée par une autre opération, le retrait n'est pas fait.
    const releaseClaim = isMeta ? tryClaimConnection(clientId, account.provider_account_id) : null;
    let cleanup: WhatsAppAccountDisconnected = NOTHING_AT_META;
    try {
      const result = await this.db.disconnectWhatsAppAccount(clientId, id);
      if (!result.ok && result.reason === 'not_found') throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
      if (!result.ok && result.reason === 'number_in_use') {
        // Les agents IA nommés sont ceux de l'organisation active (le pilote filtre par organisation).
        const details = await Promise.all(result.bot_ids.map(async (botId) => ({
          path: `bots.${botId}`,
          message: (await this.db.getBotRecord(clientId, botId))?.name ?? botId,
        })));
        throw new AppError('CONFLICT', NUMBERS_IN_USE, details, 'whatsapp_account.in_use');
      }
      invalidateAccountTransports(id);
      if (isMeta) cleanup = { waba_cleanup: await this.withdrawOnDisconnect(account, secrets, releaseClaim !== null), app_webhook: 'left' };
    } finally {
      releaseClaim?.();
    }
    if (isMeta) cleanup = { ...cleanup, app_webhook: secrets === null ? 'left' : await this.handOverAppWebhookSafely(account, secrets) };
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.disconnect', target: target(clientId, id), client_id: clientId,
      metadata: isMeta ? { waba_cleanup: cleanup.waba_cleanup, app_webhook: cleanup.app_webhook } : null,
    });
    console.log(`[WhatsAppAccounts] Compte ${id} déconnecté${isMeta ? ` (retrait chez Meta : ${cleanup.waba_cleanup}, webhook de l'app : ${cleanup.app_webhook})` : ''}`);
    return cleanup;
  }

  /**
   * Spec R1 §5.5 : retrait de l'adresse propre de la WABA du compte déconnecté, avec ses propres identifiants (spec R1 §8 :
   * jamais une autre WABA). L'appelant tient la réservation de la WABA (`claimed`). Aucune exception ne sort d'ici.
   */
  private async withdrawOnDisconnect(account: WhatsAppAccountRecord, secrets: MetaSecrets | null, claimed: boolean): Promise<'done' | 'failed'> {
    if (secrets === null) {
      console.log(`[WhatsAppAccounts] Retrait chez Meta du compte ${account.id} impossible : identifiants illisibles`);
      return 'failed';
    }
    if (!claimed) {
      console.log(`[WhatsAppAccounts] Retrait chez Meta du compte ${account.id} non fait : autre opération en cours`);
      return 'failed';
    }
    let ok = false;
    try {
      ok = (await this.providers.metaWebhooks.clearWabaOverride({
        waba_id: account.provider_account_id, access_token: secrets.access_token, app_secret: secrets.app_secret,
      })).ok;
    } catch {
      ok = false;
    }
    if (!ok) console.log(`[WhatsAppAccounts] Retrait chez Meta de l'adresse du compte ${account.id} en échec`);
    return ok ? 'done' : 'failed';
  }

  /** Webhook de l'app à la déconnexion : toute exception le laisse tel quel (`left`). */
  private async handOverAppWebhookSafely(account: WhatsAppAccountRecord, secrets: MetaSecrets): Promise<WhatsAppAccountDisconnected['app_webhook']> {
    try {
      return await this.handOverAppWebhook(account, secrets);
    } catch {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} laissé (panne inattendue)`);
      return 'left';
    }
  }

  /**
   * Spec R1 §5.4 et §5.5, à la déconnexion (le compte est déjà `disconnected`) : le webhook de l'app est lu avec le secret
   * du compte retiré. S'il ne pointe pas vers ce compte : `not_applicable`, rien n'est écrit. S'il pointe vers ce compte,
   * il est repointé vers le premier autre compte `connected` de la même organisation et de la même app, par la règle du
   * §5.4 appliquée à ce compte (son adresse, son jeton de vérification, son secret d'app, sa vérification attendue) :
   * `repointed`. Aucun autre compte, lecture ou écriture en échec : laissé tel quel, `left`.
   */
  private async handOverAppWebhook(account: WhatsAppAccountRecord, secrets: MetaSecrets): Promise<WhatsAppAccountDisconnected['app_webhook']> {
    const base = config.webhook.publicBaseUrl;
    const metaAppId = account.meta_app_id;
    if (metaAppId === null || base === null) {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} laissé : app ou adresse publique inconnue`);
      return 'left';
    }
    const current = await this.providers.metaWebhooks.readAppWebhook({ appId: metaAppId, appSecret: secrets.app_secret });
    if (!current.ok) {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} laissé : lecture chez Meta en échec`);
      return 'left';
    }
    if (current.callbackUrl !== metaWebhookUrl(base, secrets.webhook_key)) return 'not_applicable';

    // Spec R1 §8 : un compte de la même organisation et de la même app seulement (filtre du pilote, refait ici).
    const candidates = (await this.db.listConnectedMetaAccountsForApp(account.client_id, metaAppId))
      .filter((a) => a.id !== account.id && a.client_id === account.client_id && a.meta_app_id === metaAppId && a.mode === 'meta_manual');
    let next: { record: WhatsAppAccountRecord; secrets: MetaSecrets } | null = null;
    for (const record of candidates) {
      const s = decryptAccountSecrets(record);
      if (s !== null && s.mode === 'meta_manual') {
        next = { record, secrets: s };
        break;
      }
    }
    if (next === null) {
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} laissé : aucun autre compte connecté de la même app`);
      return 'left';
    }
    const app = await this.applyAppWebhookRuleSafely(next.record, next.secrets);
    if (app.state === 'ok') {
      await this.saveWebhookState(next.record, null, app);
      console.log(`[WhatsAppAccounts] Webhook de l'app Meta repointé du compte ${account.id} vers le compte ${next.record.id}`);
      return 'repointed';
    }
    // Remplacé hors de WABAGENT entre les deux lectures : il ne pointe plus vers ce compte, la règle n'y touche pas.
    if (app.state === 'elsewhere') return 'not_applicable';
    console.log(`[WhatsAppAccounts] Webhook de l'app Meta du compte ${account.id} laissé : repointage en échec`);
    return 'left';
  }

  // ---------------------------------------------------------------------------

  private async requireAccount(clientId: string, id: number): Promise<WhatsAppAccountRecord> {
    const account = await this.db.getWhatsAppAccount(clientId, id);
    if (!account) throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    return account;
  }

  private verifyInput(input: CredentialsInput): Promise<ProviderVerification> {
    return input.mode === 'meta_manual'
      ? this.providers.verifyMeta({ waba_id: input.waba_id, access_token: input.access_token, app_secret: input.app_secret })
      : this.providers.verifyCm({ account_id: input.account_id, product_token: input.product_token });
  }

  private verifyStored(account: WhatsAppAccountRecord, secrets: AccountSecrets): Promise<ProviderVerification> {
    return secrets.mode === 'meta_manual'
      ? this.providers.verifyMeta({ waba_id: account.provider_account_id, access_token: secrets.access_token, app_secret: secrets.app_secret })
      : this.providers.verifyCm({ account_id: account.provider_account_id, product_token: secrets.product_token });
  }

  private async view(clientId: string, account: WhatsAppAccountRecord): Promise<WhatsAppAccountView> {
    const disconnected = account.state === 'disconnected';
    const numbers = disconnected ? [] : await this.db.listWhatsAppNumbers(clientId, account.id);
    const present = numbers.filter((n) => n.provider_state === 'present');
    // Choix 4 : signatures rejetées en série, état affiché seulement (l'état stocké n'est pas touché).
    const displayed = displayedAccountState(account);

    const alerts: WhatsAppAccountAlertView[] = [...account.alerts];
    if (tokenExpiring(account.token_expiry, Date.now())) alerts.push({ kind: 'token_expiring', at: account.token_expiry! });
    for (const n of present) if (n.quality === 'RED') alerts.push({ kind: 'quality_degraded', number_id: n.id });

    return {
      id: account.id,
      name: account.name,
      mode: account.mode,
      provider_account_id: account.provider_account_id,
      waba_id: account.waba_id,
      meta_app_id: account.mode === 'meta_manual' ? account.meta_app_id : null,
      state: displayed.state,
      error_reason: displayed.error_reason,
      // Motif et cause de l'erreur stockée seulement (jamais déconnecté, jamais l'état affiché seul) : règle partagée
      // avec le résumé de numéro d'un agent IA. Le web n'en déduit rien du texte.
      ...storedErrorFields(account),
      // Message du fournisseur tel qu'il l'a écrit, même règle d'exposition que `error_detail`.
      provider_text: account.state === 'error' ? account.error_provider_text : null,
      last_verified_at: account.last_verified_at,
      token_expiry: account.token_expiry,
      secret_checked_at: account.last_signature_ok_at,
      is_test: present.length > 0 && present.every((n) => n.is_test),
      alerts,
      numbers: await Promise.all(numbers.map((n) => this.numberView(clientId, n))),
      // Règles partagées avec le résumé de numéro d'un agent IA : null pour CM.com et pour un compte déconnecté.
      webhooks: presentWebhooks(account),
      meta_health: presentMetaHealth(account),
    };
  }

  /**
   * Webhook d'un compte CM.com, à configurer chez CM.com. Revue R1 ISO-M5 : aucune branche Meta, un compte Meta (ou des
   * secrets qui ne sont pas ceux de CM.com) rend le webhook vide ; le jeton de vérification Meta ne sort jamais d'ici.
   */
  private cmWebhookView(account: WhatsAppAccountRecord): WhatsAppWebhookView {
    const secrets = account.mode === 'cm_com' ? decryptAccountSecrets(account) : null;
    if (secrets === null || secrets.mode !== 'cm_com') {
      console.warn(`[WhatsAppAccounts] Webhook CM.com illisible pour le compte ${account.id}`);
      return EMPTY_WEBHOOK;
    }
    const path = `/webhook/cm-com/${secrets.webhook_key}`;
    const base = config.webhook.publicBaseUrl;
    return { path, url: base === null ? null : `${base.replace(/\/+$/, '')}${path}` };
  }

  private async numberView(clientId: string, n: WhatsAppNumberRecord): Promise<WhatsAppNumberView> {
    const bot = n.bot_id === null ? undefined : await this.db.getBotRecord(clientId, n.bot_id);
    return {
      id: n.id,
      phone_e164: n.phone_e164,
      display_name: n.display_name,
      meta_status: n.meta_status,
      quality: n.quality,
      is_test: n.is_test,
      provider_state: n.provider_state,
      removed_at: n.removed_at,
      delivery_failures: n.delivery_failures,
      last_delivery_error_code: n.last_delivery_error_code,
      bot: bot
        ? {
          bot_id: bot.bot_id, name: bot.name, status: bot.status, status_reason: bot.status_reason,
          not_responding: await loadNotResponding(this.db, clientId, bot),
        }
        : null,
    };
  }
}
