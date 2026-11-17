// Profil WhatsApp, photo du profil et nom d'affichage d'un numéro d'un compte Meta (lot R2a, spec R2a §5.2, §5.3,
// §6.2 à §6.4, §13).
// Surface d'isolation (spec R2a §9.1 à §9.4) :
// - chaque opération retrouve le compte dans l'organisation active, puis le numéro dans ce compte, avant tout appel
//   extérieur : un compte ou un numéro d'une autre organisation, ou d'un autre compte, répond 404 comme un inconnu ;
// - les appels partent avec le jeton et le secret d'app de ce compte seulement, sur le `provider_number_id` du numéro ;
// - le code de vérification en deux étapes n'est jamais écrit en base, journalisé, renvoyé ni tracé : il ne vit que
//   dans l'appel de `applyDisplayName` et dans le corps de la requête envoyée à Meta.
// Le profil n'est jamais gardé en base (approche A) ; le corps d'une écriture (`profilePatch`) n'est jamais journalisé.

import {
  ApplyDisplayNameInput, PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, RequestDisplayNameInput, TRANSIENT_DETAIL,
  UpdateWhatsAppBusinessProfileInput,
  type ApiErrorDetail, type ProfilePhotoType, type WhatsAppBusinessProfileView, type WhatsAppNumberView,
} from '@wabagent/contracts';
import type { Database } from '../database/types.js';
import type { WhatsAppAccountRecord, WhatsAppNumberRecord } from '../database/whatsapp-types.js';
import { describeFailure, makeContext, type GraphContext, type GraphFailure } from '../../whatsapp/meta-graph.js';
import {
  readBusinessProfile, registerNumber, requestDisplayName, setProfilePhoto, uploadProfilePhoto, writeBusinessProfile,
} from '../../whatsapp/meta-profile.js';
import type { ProviderClientOptions } from '../../whatsapp/provider-common.js';
import { decryptAccountSecrets } from '../../transport/index.js';
import { recordAudit } from '../audit.js';
import { AppError, conflict, notFound, validationError } from '../../api/errors.js';
import {
  ACCOUNT_DISCONNECTED, ACCOUNT_NOT_FOUND, APP_UNREADABLE, META_UNAVAILABLE, NUMBER_NOT_FOUND, SECRETS_UNREADABLE,
  type WhatsAppAccountService,
} from './whatsapp-account-service.js';

/** Appels Graph du profil et du nom (`meta-profile.ts`), remplaçables un par un dans les tests. */
export interface MetaProfileClient {
  readBusinessProfile: typeof readBusinessProfile;
  writeBusinessProfile: typeof writeBusinessProfile;
  uploadProfilePhoto: typeof uploadProfilePhoto;
  setProfilePhoto: typeof setProfilePhoto;
  requestDisplayName: typeof requestDisplayName;
  registerNumber: typeof registerNumber;
}

const DEFAULT_META: MetaProfileClient = {
  readBusinessProfile, writeBusinessProfile, uploadProfilePhoto, setProfilePhoto, requestDisplayName, registerNumber,
};

export interface WhatsAppNumberProfileServiceDeps {
  db: Database;
  /** Relecture des numéros et vue du numéro après une demande ou une application de nom. */
  accounts: WhatsAppAccountService;
  /** `fetch` des appels Graph (faux Meta des tests) ; défaut : `fetch` global. */
  graph?: ProviderClientOptions;
  meta?: Partial<MetaProfileClient>;
}

// Textes fixés par le PO pour le lot R2a ; les mêmes que le web pour les mêmes clés (messages/fr.json).
const PROFILE_UNSUPPORTED = 'Le profil WhatsApp ne se règle pas depuis WABAGENT pour ce compte.';
const NUMBER_REMOVED = 'Ce numéro a été retiré chez Meta.';
const PHOTO_INVALID = 'Photo refusée : JPEG ou PNG, 5 Mo au plus, 192 × 192 pixels au minimum.';
const PIN_REJECTED = 'Code de vérification en deux étapes refusé par Meta. Vérifiez-le ou changez-le dans WhatsApp Manager.';
const NAME_APPLY_EXPIRED = 'Le délai pour appliquer ce nom est dépassé. Demandez de nouveau ce nom.';
const NAME_APPLY_IN_PROGRESS = "Le nouveau nom est déjà en cours d'application.";
const NO_DISPLAY_NAME_REQUEST = "Aucun nouveau nom n'est à appliquer pour ce numéro.";
// Ruling R-17 : écriture confirmée par Meta, relecture du profil en échec. Jamais présenté comme un échec de l'écriture.
const PROFILE_SAVED_UNREAD = 'Profil enregistré chez Meta, mais sa relecture a échoué. Rouvrez la fenêtre dans un moment pour le vérifier.';
/** Texte du moteur d'un refus de Meta sans texte de Meta lisible (même texte que le client Graph). */
const PROVIDER_ERROR = 'Meta a renvoyé une erreur';

/** Raison tracée d'un refus de Meta sans clé propre (restitué de façon générique avec le texte de Meta, ruling R-14). */
const PROVIDER_REFUSED = 'provider_refused';

/** Signatures des formats acceptés : le contenu fait foi, pas l'en-tête seul. */
const PHOTO_SIGNATURES: Record<ProfilePhotoType, readonly number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47],
};

/** Photo refusée par WABAGENT (type, taille, contenu) : 400, avant tout appel. */
export function photoInvalid(): AppError {
  return validationError([{ path: 'photo', message: PHOTO_INVALID }], PHOTO_INVALID, 'whatsapp_account.photo_invalid');
}

function numberRemoved(): AppError {
  return conflict(NUMBER_REMOVED, 'whatsapp_account.number_removed');
}

/** Type de la photo si le type déclaré est accepté, la taille dans la limite et le contenu de ce type ; null sinon. */
function acceptedPhotoType(file: { bytes: Uint8Array; type: string }): ProfilePhotoType | null {
  const type = PROFILE_PHOTO_TYPES.find((t) => t === file.type);
  if (type === undefined || file.bytes.length === 0 || file.bytes.length > PROFILE_PHOTO_MAX_BYTES) return null;
  return PHOTO_SIGNATURES[type].every((byte, i) => file.bytes[i] === byte) ? type : null;
}

function withProviderText(detail: ApiErrorDetail, providerText: string | undefined): ApiErrorDetail {
  return providerText === undefined ? detail : { ...detail, provider_text: providerText };
}

/**
 * Applications de nom en cours dans ce processus, par numéro : un réenregistrement à la fois. Le registre ne porte que la
 * clé du numéro, jamais le code. Limite : propre au processus, comme le registre des raccordements (multi-instance
 * différé au chantier Infra).
 */
const appliesInFlight = new Set<string>();

function claimApply(clientId: string, accountId: number, numberId: number): () => void {
  const key = `${clientId}:${accountId}:${numberId}`;
  if (appliesInFlight.has(key)) throw conflict(NAME_APPLY_IN_PROGRESS, 'whatsapp_account.name_apply_in_progress');
  appliesInFlight.add(key);
  return () => { appliesInFlight.delete(key); };
}

/** Compte et numéro retrouvés dans l'organisation active, et le contexte Graph des identifiants de ce compte. */
interface NumberTarget {
  clientId: string;
  account: WhatsAppAccountRecord;
  number: WhatsAppNumberRecord;
  ctx: GraphContext;
}

type ProfileAction = 'whatsapp_number.profile_updated' | 'whatsapp_number.photo_updated' | 'whatsapp_number.name_requested' | 'whatsapp_number.name_applied';

export class WhatsAppNumberProfileService {
  private readonly db: Database;
  private readonly accounts: WhatsAppAccountService;
  private readonly graph: ProviderClientOptions | undefined;
  private readonly meta: MetaProfileClient;

  constructor(deps: WhatsAppNumberProfileServiceDeps) {
    this.db = deps.db;
    this.accounts = deps.accounts;
    this.graph = deps.graph;
    this.meta = { ...DEFAULT_META, ...deps.meta };
  }

  /** Profil WhatsApp du numéro, lu chez Meta (spec R2a §5.2). */
  async getProfile(clientId: string, accountId: number, numberId: number): Promise<WhatsAppBusinessProfileView> {
    return this.readProfile(await this.target(clientId, accountId, numberId));
  }

  /**
   * Écrit les champs présents de `profilePatch` chez Meta, puis relit le profil : la réponse est la version relue
   * (spec R2a §5.2, point 5). Un champ refusé par Meta est nommé par le chemin du détail.
   */
  async updateProfile(
    clientId: string, accountId: number, numberId: number, actorUserId: number | null, patch: UpdateWhatsAppBusinessProfileInput,
  ): Promise<WhatsAppBusinessProfileView> {
    const t = await this.target(clientId, accountId, numberId);
    const profilePatch = UpdateWhatsAppBusinessProfileInput.parse(patch);
    if (Object.keys(profilePatch).length > 0) {
      await this.audited(t, actorUserId, 'whatsapp_number.profile_updated', async () => {
        const written = await this.meta.writeBusinessProfile(t.ctx, t.number.provider_number_id, profilePatch);
        if (!written.ok) throw await this.metaRefused(t, written.failure, written.field ?? 'profile');
      });
      return this.readProfileAfterWrite(t);
    }
    return this.readProfile(t);
  }

  /**
   * Photo du profil (spec R2a §6.2, §13.5) : contrôlée (JPEG ou PNG, 5 Mo au plus, contenu du type annoncé), envoyée
   * à Meta, posée sur le profil, puis le profil est relu. Le fichier n'est tenu qu'en mémoire.
   */
  async updatePhoto(
    clientId: string, accountId: number, numberId: number, actorUserId: number | null, file: { bytes: Uint8Array; type: string },
  ): Promise<WhatsAppBusinessProfileView> {
    const t = await this.target(clientId, accountId, numberId);
    await this.audited(t, actorUserId, 'whatsapp_number.photo_updated', async () => {
      const type = acceptedPhotoType(file);
      if (type === null) throw photoInvalid();
      const appId = t.account.meta_app_id;
      if (appId === null) throw conflict(APP_UNREADABLE, 'whatsapp_account.app_unreadable');
      const uploaded = await this.meta.uploadProfilePhoto(t.ctx, appId, { bytes: file.bytes, type });
      // Étapes d'envoi (`/<app>/uploads`, session) : hors du chemin du numéro, un objet inexistant n'est pas un numéro retiré.
      if (!uploaded.ok) throw uploaded.photoRejected ? this.photoRejected() : await this.metaRefused(t, uploaded.failure, 'photo', { numberPath: false });
      const set = await this.meta.setProfilePhoto(t.ctx, t.number.provider_number_id, uploaded.handle);
      if (!set.ok) throw set.photoRejected ? this.photoRejected() : await this.metaRefused(t, set.failure, 'photo');
    });
    return this.readProfileAfterWrite(t);
  }

  /**
   * Demande d'un nouveau nom d'affichage (spec R2a §5.3, §6.3) : envoyée à Meta, la demande est gardée en revue, puis
   * les numéros du compte sont relus. Un refus de Meta est restitué avec son texte (ruling R-14).
   */
  async requestDisplayName(
    clientId: string, accountId: number, numberId: number, actorUserId: number | null, name: string,
  ): Promise<WhatsAppNumberView> {
    const t = await this.target(clientId, accountId, numberId);
    const { new_display_name: requested } = RequestDisplayNameInput.parse({ new_display_name: name });
    await this.audited(t, actorUserId, 'whatsapp_number.name_requested', async () => {
      const sent = await this.meta.requestDisplayName(t.ctx, t.number.provider_number_id, requested);
      if (!sent.ok) throw await this.metaRefused(t, sent.failure, 'new_display_name');
      await this.db.setWhatsAppNumberNameRequest(clientId, accountId, numberId, {
        requested_name: requested, status: 'in_review', rejection_reason: null, requested_at: new Date().toISOString(),
        approved_at: null, apply_before: null, apply_before_approx: false,
      });
    });
    await this.relist(clientId, accountId, actorUserId);
    return this.numberView(clientId, accountId, numberId);
  }

  /**
   * Applique le nom approuvé en réenregistrant le numéro avec le code de vérification en deux étapes (spec R2a §5.3,
   * point 4, §6.3). Refusé sans appel si aucun nom approuvé n'attend d'être appliqué, ou si une application du même
   * numéro est en cours (409). Réussi : le nom affiché devient le nom demandé, la demande est effacée, les numéros sont
   * relus. `pin` n'est passé qu'à `registerNumber`, qui le masque dans tout texte de Meta.
   */
  async applyDisplayName(
    clientId: string, accountId: number, numberId: number, actorUserId: number | null, pin: string,
  ): Promise<WhatsAppNumberView> {
    const t = await this.target(clientId, accountId, numberId);
    // Refus de forme : le message ne recopie jamais la valeur.
    ApplyDisplayNameInput.parse({ pin });
    if (t.number.name_request?.status !== 'approved_pending') throw this.noRequestToApply();
    const release = claimApply(clientId, accountId, numberId);
    try {
      await this.audited(t, actorUserId, 'whatsapp_number.name_applied', async () => {
        // Relue sous le verrou : une application qui vient de finir a effacé la demande.
        const request = (await this.db.getWhatsAppNumber(clientId, numberId))?.name_request ?? null;
        if (request === null || request.status !== 'approved_pending') throw this.noRequestToApply();
        const registered = await this.meta.registerNumber(t.ctx, t.number.provider_number_id, pin);
        if (!registered.ok) {
          if (registered.pinRejected) {
            throw new AppError('WA_VALIDATION_FAILED', PIN_REJECTED, [{ path: 'pin', message: PIN_REJECTED }], 'whatsapp_account.pin_rejected');
          }
          if (registered.expired) {
            await this.db.setWhatsAppNumberNameRequest(clientId, accountId, numberId, null);
            throw conflict(NAME_APPLY_EXPIRED, 'whatsapp_account.name_apply_expired');
          }
          throw await this.metaRefused(t, registered.failure, 'display_name');
        }
        await this.db.setWhatsAppNumberDisplayName(clientId, accountId, numberId, request.requested_name);
        await this.db.setWhatsAppNumberNameRequest(clientId, accountId, numberId, null);
      });
    } finally {
      release();
    }
    await this.relist(clientId, accountId, actorUserId);
    return this.numberView(clientId, accountId, numberId);
  }

  // ---------------------------------------------------------------------------

  /**
   * Compte dans l'organisation active, puis numéro dans ce compte (404 sinon, même texte qu'un inconnu), avant tout appel
   * extérieur. Compte CM.com : `profile_unsupported` ; numéro retiré chez Meta : `number_removed`.
   */
  private async target(clientId: string, accountId: number, numberId: number): Promise<NumberTarget> {
    const account = await this.db.getWhatsAppAccount(clientId, accountId);
    if (!account || account.client_id !== clientId) throw notFound(ACCOUNT_NOT_FOUND, 'whatsapp_account.not_found');
    const number = await this.db.getWhatsAppNumber(clientId, numberId);
    if (!number || number.client_id !== clientId || number.account_id !== account.id) {
      throw notFound(NUMBER_NOT_FOUND, 'whatsapp_account.number_not_found');
    }
    if (account.state === 'disconnected') throw conflict(ACCOUNT_DISCONNECTED, 'whatsapp_account.disconnected');
    if (account.mode !== 'meta_manual') throw conflict(PROFILE_UNSUPPORTED, 'whatsapp_account.profile_unsupported');
    if (number.provider_state === 'removed') throw numberRemoved();
    const secrets = decryptAccountSecrets(account);
    if (secrets === null || secrets.mode !== 'meta_manual') throw conflict(SECRETS_UNREADABLE, 'whatsapp_account.secrets_unreadable');
    const ctx = makeContext({ waba_id: account.provider_account_id, access_token: secrets.access_token, app_secret: secrets.app_secret }, this.graph);
    return { clientId, account, number, ctx };
  }

  private async readProfile(t: NumberTarget): Promise<WhatsAppBusinessProfileView> {
    const read = await this.meta.readBusinessProfile(t.ctx, t.number.provider_number_id);
    if (!read.ok) throw await this.metaRefused(t, read.failure, 'profile');
    return read.profile;
  }

  /**
   * Relecture après une écriture confirmée par Meta (ruling R-17) : en échec, `profile_saved_unread` (422, comme le refus
   * passager `meta_unavailable`), jamais le refus de la relecture, qui ferait croire que rien n'a été enregistré. La trace
   * d'audit de l'écriture reste `ok: true`.
   */
  private async readProfileAfterWrite(t: NumberTarget): Promise<WhatsAppBusinessProfileView> {
    try {
      return await this.readProfile(t);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      throw new AppError(
        'WA_VALIDATION_FAILED', PROFILE_SAVED_UNREAD, [{ path: 'profile', message: PROFILE_SAVED_UNREAD }], 'whatsapp_account.profile_saved_unread',
      );
    }
  }

  /**
   * Refus de Meta restitué :
   * - objet inexistant (code 100, sous-code 33, classé `waba_not_found` par le client Graph) : `number_removed` sur le
   *   chemin du numéro seulement, jamais « WABA introuvable » ; hors de ce chemin (envoi de la photo, ruling R-17), refus
   *   générique : le client Graph ne garde pas le texte de Meta pour ce code, seul le texte du moteur est rendu ;
   * - jeton refusé : le compte passe en erreur (même effet qu'à la relecture des numéros), `listing_token_invalid` ;
   * - panne passagère : `meta_unavailable` ;
   * - sinon : texte du moteur et texte de Meta (`provider_text`) sur `path`, sans clé (ruling R-14).
   */
  private async metaRefused(
    t: NumberTarget, failure: GraphFailure, path: string, opts: { numberPath: boolean } = { numberPath: true },
  ): Promise<AppError> {
    if (failure.kind === 'waba_not_found') {
      return opts.numberPath ? numberRemoved() : new AppError('WA_VALIDATION_FAILED', PROVIDER_ERROR, [{ path, message: PROVIDER_ERROR }]);
    }
    const d = describeFailure(failure, 'numbers');
    if (failure.kind === 'token_invalid') {
      await this.db.setWhatsAppAccountError(t.account.id, 'token_invalid', d.message, t.account.secret_encrypted, null);
      return new AppError('WA_VALIDATION_FAILED', d.message, [{ path: 'token', message: d.message }], 'whatsapp_account.listing_token_invalid');
    }
    if (d.transient) {
      return new AppError('WA_VALIDATION_FAILED', META_UNAVAILABLE, [{ path: TRANSIENT_DETAIL, message: META_UNAVAILABLE }], 'whatsapp_account.meta_unavailable');
    }
    return new AppError('WA_VALIDATION_FAILED', d.message, [withProviderText({ path, message: d.message }, d.provider_text)]);
  }

  private photoRejected(): AppError {
    return new AppError('WA_VALIDATION_FAILED', PHOTO_INVALID, [{ path: 'photo', message: PHOTO_INVALID }], 'whatsapp_account.photo_invalid');
  }

  private noRequestToApply(): AppError {
    return conflict(NO_DISPLAY_NAME_REQUEST, 'whatsapp_account.no_display_name_request');
  }

  /**
   * Trace d'audit de l'action (spec R2a §6.3, dernier point) : qui, quel numéro, réussite ou raison, jamais le contenu
   * (ni profil, ni fichier, ni nom, ni code).
   */
  private async audited(t: NumberTarget, actorUserId: number | null, action: ProfileAction, run: () => Promise<void>): Promise<void> {
    const entry = (metadata: Record<string, unknown>) => ({
      actor_user_id: actorUserId, action, target: `whatsapp_account:${t.clientId}/${t.account.id}`, client_id: t.clientId,
      metadata: { number_id: t.number.id, ...metadata },
    });
    try {
      await run();
    } catch (err) {
      const reason = err instanceof AppError ? (err.reason ?? PROVIDER_REFUSED) : 'unexpected';
      await recordAudit(this.db, entry({ ok: false, reason }));
      throw err;
    }
    await recordAudit(this.db, entry({ ok: true }));
  }

  /**
   * Relecture des numéros du compte après une écriture du nom réussie chez Meta (sans reprise de numéro). Un échec de la
   * relecture ne fait pas échouer l'écriture, déjà faite : la vue rendue est celle en base.
   */
  private async relist(clientId: string, accountId: number, actorUserId: number | null): Promise<void> {
    try {
      await this.accounts.refreshNumbers(clientId, accountId, actorUserId);
    } catch (err) {
      const cause = err instanceof AppError ? (err.reason ?? err.code) : 'panne inattendue';
      console.log(`[WhatsAppNumberProfile] Relecture des numéros du compte ${accountId} en échec : ${cause}`);
    }
  }

  private async numberView(clientId: string, accountId: number, numberId: number): Promise<WhatsAppNumberView> {
    const view = (await this.accounts.get(clientId, accountId)).numbers.find((n) => n.id === numberId);
    if (!view) throw notFound(NUMBER_NOT_FOUND, 'whatsapp_account.number_not_found');
    return view;
  }
}
