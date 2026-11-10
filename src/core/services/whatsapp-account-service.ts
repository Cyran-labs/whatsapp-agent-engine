// Comptes WhatsApp d'organisation : raccordement (Meta en mode manuel, CM.com), vérification, inventaire,
// remplacement des identifiants, déconnexion (spec 2b §6, §7.1, §7.2, §7.4, §7.7, §9.1).
// Surface d'isolation : toute lecture passe par l'organisation active, un compte d'une autre organisation répond
// comme un compte inconnu, et rien de ce qui touche une autre organisation (numéro refusé, agent IA mis en pause
// par une reprise, app Meta déjà utilisée) ne sort d'ici autrement qu'en nombre ou en message neutre.

import {
  CreateWhatsAppAccountInput, ReplaceWhatsAppCredentialsInput, RenameWhatsAppAccountInput,
  type WhatsAppAccountAlertView, type WhatsAppAccountCreated, type WhatsAppAccountRefreshed, type WhatsAppAccountReplaced, type WhatsAppAccountVerified, type WhatsAppVerificationOutcome,
  type WhatsAppAccountView, type WhatsAppInventorySummary, type WhatsAppNumberView, type WhatsAppWebhookView,
} from '@wabagent/contracts';
import type { Database } from '../database/types.js';
import type {
  InventoryOptions, InventoryResult, ProviderAccountHolder, WhatsAppAccountRecord, WhatsAppNumberRecord,
} from '../database/whatsapp-types.js';
import { verifyMetaManual, listMetaNumbers, type MetaManualCredentials } from '../../whatsapp/meta-graph.js';
import { verifyCmAccount, listCmNumbers, type CmCredentials } from '../../whatsapp/cm-channels.js';
import type { ProviderListing, ProviderSkipped, ProviderVerification, VerificationCheck } from '../../whatsapp/provider-common.js';
import { generateVerifyToken, generateWebhookKey, hashWebhookKey } from '../../whatsapp/webhook-key.js';
import {
  decryptAccountSecrets, encryptAccountSecrets, invalidateAccountTransports, type AccountSecrets,
} from '../../transport/index.js';
import { recordSignatureSuccess } from '../../webhooks/signature-monitor.js';
import { CANNOT_CONNECT, SECRETS_UNREADABLE_SHORT, displayedAccountState, storedErrorFields } from './bot-number-summary.js';
import { loadNotResponding } from './bot-responding.js';
import { recordAudit } from '../audit.js';
import { config } from '../config.js';
import { AppError, conflict, notFound, validationError } from '../../api/errors.js';

/** Clients des fournisseurs, injectables pour les tests. */
/** Rappels passés à la vérification Meta (voir `MetaVerifyOptions.beforeWrite`). */
export interface MetaVerifyHooks {
  beforeWrite?: () => Promise<void>;
}

export interface WhatsAppProviders {
  verifyMeta: (c: MetaManualCredentials, hooks?: MetaVerifyHooks) => Promise<ProviderVerification>;
  listMeta: (c: MetaManualCredentials) => Promise<ProviderListing>;
  verifyCm: (c: CmCredentials) => Promise<ProviderVerification>;
  listCm: (c: CmCredentials) => Promise<ProviderListing>;
}

export interface WhatsAppAccountServiceDeps {
  db: Database;
  providers?: WhatsAppProviders;
}

const DEFAULT_PROVIDERS: WhatsAppProviders = {
  verifyMeta: (c, hooks) => verifyMetaManual(c, hooks?.beforeWrite ? { beforeWrite: hooks.beforeWrite } : undefined),
  listMeta: (c) => listMetaNumbers(c),
  verifyCm: (c) => verifyCmAccount(c),
  listCm: (c) => listCmNumbers(c),
};

const ACCOUNT_NOT_FOUND = 'Compte WhatsApp introuvable.';
const NUMBER_NOT_FOUND = 'Numéro WhatsApp introuvable.';
const MASKED_VALUE = "Saisissez la valeur complète : une valeur masquée n'est pas acceptée.";
const ALREADY_CONNECTED = 'Ce compte WhatsApp est déjà raccordé.';
const OTHER_PROVIDER_ACCOUNT = 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.';
const ACCOUNT_DISCONNECTED = 'Ce compte WhatsApp a été retiré de WABAGENT : raccordez un nouveau compte.';
// audit décisions A23 : la suite exacte, la même que la raison du menu « Remplacer les identifiants » désactivé.
const SECRETS_UNREADABLE = 'Les identifiants enregistrés de ce compte sont illisibles : retirez ce compte de WABAGENT puis raccordez-le de nouveau.';
// Se termine par deux-points : l'écran affiche ensuite les noms des agents IA (détails `bots.<id>`).
const NUMBERS_IN_USE = "Désactivez d'abord les agents IA qui utilisent ce compte :";
const APP_UNREADABLE = "Impossible de lire l'application du jeton auprès de Meta, réessayez.";
const PROVIDER_UNAVAILABLE = 'Le fournisseur ne répond pas, réessayez.';
const EMPTY_INVENTORY = "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré.";

/** Raccordement, remplacement des identifiants, « Rafraîchir les numéros » : actions d'admin, reprise permise. */
export const ADMIN_INVENTORY: InventoryOptions = { allowTakeover: true };

const MASK_PREFIX = '••••';
const TOKEN_EXPIRING_MS = 7 * 24 * 3600 * 1000;
const EMPTY_WEBHOOK: WhatsAppWebhookView = { path: '', url: null, verify_token: null };

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

function secretsFor(input: CredentialsInput, webhookKey: string, verifyToken: string): AccountSecrets {
  return input.mode === 'meta_manual'
    ? { mode: 'meta_manual', access_token: input.access_token, app_secret: input.app_secret, verify_token: verifyToken, webhook_key: webhookKey }
    : { mode: 'cm_com', product_token: input.product_token, webhook_key: webhookKey };
}

function target(clientId: string, id: number): string {
  return `whatsapp_account:${clientId}/${id}`;
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
   * Clé d'URL et jeton de vérification du compte : la seule lecture qui les sert (revue 2b-3 M-2). Compte d'une
   * autre organisation ou inconnu : même 404. Compte déconnecté : webhook vide.
   */
  async getWebhook(clientId: string, id: number): Promise<WhatsAppWebhookView> {
    const account = await this.requireAccount(clientId, id);
    return account.state === 'disconnected' ? EMPTY_WEBHOOK : this.webhookView(account);
  }

  async create(clientId: string, actorUserId: number | null, raw: CreateWhatsAppAccountInput): Promise<WhatsAppAccountCreated> {
    const input = CreateWhatsAppAccountInput.parse(raw);
    rejectMasked(input);
    const providerAccountId = providerAccountIdOf(input);
    // Revue 2b-2 I-1, M-5 : un compte du fournisseur tenu par un compte non `disconnected`, de n'importe quelle
    // organisation, n'est pas raccordé. Même organisation : refusé tout de suite (rien ne sort d'une autre
    // organisation). Autre organisation : contrôlé seulement après la preuve d'accès (sinon un jeton quelconque
    // dirait si la WABA est tenue sur la plateforme), mais avant toute écriture chez Meta (rappel avant le POST
    // subscribed_apps). La transaction de création refait le contrôle (CM.com, deux raccordements simultanés).
    const holder = await this.db.findProviderAccountHolder(clientId, input.mode, providerAccountId);
    if (holder === 'same_organization') rejectHeldProviderAccount(holder);
    const beforeWrite = async (): Promise<void> => {
      rejectHeldProviderAccount(await this.db.findProviderAccountHolder(clientId, input.mode, providerAccountId));
    };

    const verification = await this.verifyInput(input, { beforeWrite });
    if (!verification.ok) throw validationFailed(verification);
    rejectUnreadableApp(input.mode, verification);

    const webhookKey = generateWebhookKey();
    const encrypted = encryptAccountSecrets(secretsFor(input, webhookKey, generateVerifyToken()));
    // Choix 3 contrôlé dans la transaction de création (sous le verrou de topologie sur Postgres) : deux
    // organisations qui raccordent la même app au même instant ne peuvent pas réussir toutes les deux.
    const created = await this.db.createWhatsAppAccountWithInventory({
      client_id: clientId,
      name: input.name,
      mode: input.mode,
      provider_account_id: providerAccountId,
      // CM.com : `facebookId` lu à titre indicatif seulement (affichage).
      waba_id: input.mode === 'meta_manual' ? input.waba_id : verification.waba_id,
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
      webhook: this.webhookView(account),
      checks: verification.checks,
      inventory: summarize(inventory, verification.skipped),
    };
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

    const verification = await this.verifyInput(input);
    if (!verification.ok) throw validationFailed(verification);
    rejectUnreadableApp(input.mode, verification);

    // La clé d'URL et le jeton de vérification sont conservés : rien à reconfigurer chez le fournisseur.
    const verifyToken = current.mode === 'meta_manual' ? current.verify_token : generateVerifyToken();
    const encrypted = encryptAccountSecrets(secretsFor(input, current.webhook_key, verifyToken));
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
    const checks: VerificationCheck[] = inventory.ignored_empty
      ? [...verification.checks.filter((c) => c.key !== 'numbers'), { key: 'numbers', status: 'pending', detail: EMPTY_INVENTORY }]
      : verification.checks;
    if (inventory.ignored_empty) console.log(`[WhatsAppAccounts] Inventaire vide du compte ${id} non appliqué`);

    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.credentials', target: target(clientId, id), client_id: clientId,
      metadata: { added: inventory.added, removed: inventory.removed, refused: inventory.refused },
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
    if (verification.ok && verification.meta_app_id === account.meta_app_id) {
      const marked = await this.db.markWhatsAppAccountVerified(id, { token_expiry: verification.token_expiry, verified_at: new Date().toISOString() });
      if (marked.ok) {
        accepted = true;
        outcome = 'verified';
        recordSignatureSuccess(id);
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
    return { ...(await this.get(clientId, id)), checks: verification.checks, outcome };
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

  /** Choix 6 : refusée tant qu'un numéro sert un agent IA en accès limité ou actif. Sans effet sur un compte déjà déconnecté. */
  async disconnect(clientId: string, id: number, actorUserId: number | null): Promise<void> {
    const account = await this.requireAccount(clientId, id);
    if (account.state === 'disconnected') return;
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
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'whatsapp_account.disconnect', target: target(clientId, id), client_id: clientId,
      metadata: null,
    });
    console.log(`[WhatsAppAccounts] Compte ${id} déconnecté`);
  }

  // ---------------------------------------------------------------------------

  private async requireAccount(clientId: string, id: number): Promise<WhatsAppAccountRecord> {
    const account = await this.db.getWhatsAppAccount(clientId, id);
    if (!account) throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    return account;
  }

  private verifyInput(input: CredentialsInput, hooks?: MetaVerifyHooks): Promise<ProviderVerification> {
    return input.mode === 'meta_manual'
      ? this.providers.verifyMeta({ waba_id: input.waba_id, access_token: input.access_token, app_secret: input.app_secret }, hooks)
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
    };
  }

  private webhookView(account: WhatsAppAccountRecord): WhatsAppWebhookView {
    const secrets = decryptAccountSecrets(account);
    if (!secrets) {
      console.warn(`[WhatsAppAccounts] Identifiants illisibles pour le compte ${account.id}`);
      return EMPTY_WEBHOOK;
    }
    const path = secrets.mode === 'meta_manual' ? `/webhook/meta/${secrets.webhook_key}` : `/webhook/cm-com/${secrets.webhook_key}`;
    const base = config.webhook.publicBaseUrl;
    return {
      path,
      url: base === null ? null : `${base}${path}`,
      verify_token: secrets.mode === 'meta_manual' ? secrets.verify_token : null,
    };
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
