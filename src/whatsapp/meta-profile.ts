// Appels Graph du lot R2a : portefeuille de la WABA, profil WhatsApp d'un numéro, photo du profil, demande de nom
// d'affichage et réenregistrement du numéro. Formes relevées à l'essai du 17 nov. 2026
// (docs/superpowers/research/2026-11-17-essai-r2a-profil-nom.md, §1, §3, §4 et §5).
// Module autonome comme `meta-graph.ts` : aucune base de données, `fetch` injectable par le contexte, identifiants du
// compte seulement (jamais de repli de plateforme ni d'environnement). Rien d'ici ne journalise : ni le contenu du profil
// (adresse, e-mail), ni le fichier, ni le code de vérification en deux étapes ne sortent d'un échec.

import type { UpdateWhatsAppBusinessProfileInput, WhatsAppBusinessProfileView } from '@wabagent/contracts';
import { config } from '../core/config.js';
import { META_API_BASE } from '../transport/meta-cloud.js';
import {
  classifyGraphError, graphRequest, graphUrl, readMetaErrorCode,
  type GraphContext, type GraphFailure, type GraphResponse, type MetaErrorCode,
} from './meta-graph.js';
import { asString, httpJson, isRecord, MAX_TEXT_LENGTH } from './provider-common.js';

export type { GraphFailure } from './meta-graph.js';

const MESSAGING_PRODUCT = 'whatsapp';
const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

const MESSAGE_BUSINESS_UNREAD = 'Portefeuille du compte illisible dans la réponse de Meta';
const MESSAGE_PROFILE_UNREAD = 'Profil WhatsApp illisible dans la réponse de Meta';
const MESSAGE_WRITE_UNCONFIRMED = "Écriture non confirmée par Meta";
const MESSAGE_UPLOAD_SESSION_UNREAD = "Session d'envoi de la photo illisible dans la réponse de Meta";
const MESSAGE_UPLOAD_HANDLE_UNREAD = "Photo envoyée sans référence lisible dans la réponse de Meta";

/**
 * Mauvais code de vérification en deux étapes au réenregistrement : code Meta `133005` (documentation de Meta, non
 * observé à l'essai, spec R2a §13.3).
 */
const PIN_MISMATCH_CODE = 133005;
/** Photo refusée pour sa résolution, sous 192 x 192 pixels : code 1, sous-code 3441013 (essai R2a §4). */
const PHOTO_TOO_SMALL = { code: 1, subcode: 3441013 } as const;
/** Champ du profil refusé : code 100 (« Param <champ> must be at most… ») ou 105 (nombre de sites), essai R2a §5. */
const FIELD_ERROR_CODES: ReadonlySet<number> = new Set([100, 105]);

/** Champs du profil qu'un refus de Meta peut désigner (clés de `UpdateWhatsAppBusinessProfileInput`). */
const PROFILE_KEYS = ['about', 'description', 'address', 'email', 'websites', 'vertical'] as const;
export type BusinessProfileField = (typeof PROFILE_KEYS)[number];
const FIELD_IN_MESSAGE = new RegExp(`\\b(?:param|parameter)\\s+(${PROFILE_KEYS.join('|')})\\b`, 'i');

/**
 * Identifiant d'une session d'envoi de Meta : `upload:<identifiant>` (base64, qui peut contenir `/`) et sa signature
 * `?sig=…`. Jamais de `..` : l'adresse construite doit rester sous `/<version>/upload:` chez Graph.
 */
const UPLOAD_SESSION = /^upload:[A-Za-z0-9_=+%:./-]+(?:\?sig=[A-Za-z0-9_=+%:./-]+)?$/;

function uploadSessionUrl(sessionId: string): URL | null {
  if (!UPLOAD_SESSION.test(sessionId) || sessionId.includes('..')) return null;
  const base = new URL(META_API_BASE);
  const target = new URL(`${META_API_BASE}/${config.meta.graphVersion}/${sessionId}`);
  const prefix = `${base.pathname.replace(/\/$/, '')}/${config.meta.graphVersion}/upload:`;
  return target.origin === base.origin && target.pathname.startsWith(prefix) ? target : null;
}

type Failed = { ok: false; failure: GraphFailure };

function numberPath(providerNumberId: string, suffix = ''): string {
  return `/${encodeURIComponent(providerNumberId)}${suffix}`;
}

function withSecrets(ctx: GraphContext, extra: readonly string[]): GraphContext {
  return { ...ctx, secrets: [...ctx.secrets, ...extra.filter((s) => s.length > 0)] };
}

function isMetaError(error: MetaErrorCode, expected: { code: number; subcode?: number }): boolean {
  return error.code === expected.code && (expected.subcode === undefined || error.subcode === expected.subcode);
}

/** Une écriture que Meta confirme par `{"success": true}` ; toute autre réponse 2xx n'est pas une réussite. */
async function writeExpectingSuccess(
  ctx: GraphContext, target: URL, json: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; failure: GraphFailure; meta_error: MetaErrorCode | null }> {
  const result = await graphRequest(ctx, 'POST', target, json);
  if (!result.ok) return result;
  if (result.body['success'] !== true) return { ok: false, failure: { kind: 'other', message: MESSAGE_WRITE_UNCONFIRMED }, meta_error: null };
  return { ok: true };
}

/** Échec sans le code d'erreur de Meta, qui ne sert qu'à reconnaître un refus précis ici. */
function failed(result: { failure: GraphFailure }): Failed {
  return { ok: false, failure: result.failure };
}

function idOf(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/**
 * Portefeuille propriétaire de la WABA (`owner_business_info`), lu avec le jeton du compte (spec R2a §4, §5.1). Un
 * portefeuille n'est rendu que si Meta en donne l'identifiant (chiffres) et le nom : jamais un portefeuille deviné.
 */
export async function readOwnerBusiness(
  ctx: GraphContext, wabaId: string,
): Promise<{ ok: true; business: { id: string; name: string } } | Failed> {
  const result = await graphRequest(ctx, 'GET', graphUrl(`/${encodeURIComponent(wabaId)}`, { fields: 'owner_business_info' }));
  if (!result.ok) return failed(result);
  const owner = isRecord(result.body['owner_business_info']) ? result.body['owner_business_info'] : null;
  const id = owner === null ? null : idOf(owner['id']);
  const name = owner === null ? null : asString(owner['name']);
  if (id === null || !/^\d+$/.test(id) || name === null) return { ok: false, failure: { kind: 'other', message: MESSAGE_BUSINESS_UNREAD } };
  return { ok: true, business: { id, name: name.slice(0, MAX_TEXT_LENGTH) } };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Adresse de la photo servie par Meta : seulement une adresse https, que l'écran peut afficher sans risque. */
function photoUrl(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  try { return new URL(raw).protocol === 'https:' ? raw : null; } catch { return null; }
}

/** Profil WhatsApp du numéro, lu chez Meta avec les identifiants de son compte (spec R2a §6.1, jamais gardé en base). */
export async function readBusinessProfile(
  ctx: GraphContext, providerNumberId: string, now: Date = new Date(),
): Promise<{ ok: true; profile: WhatsAppBusinessProfileView } | Failed> {
  const result = await graphRequest(ctx, 'GET', graphUrl(numberPath(providerNumberId, '/whatsapp_business_profile'), { fields: PROFILE_FIELDS }));
  if (!result.ok) return failed(result);
  const data = Array.isArray(result.body['data']) ? result.body['data'] : [];
  const entry: unknown = data[0];
  if (!isRecord(entry)) return { ok: false, failure: { kind: 'other', message: MESSAGE_PROFILE_UNREAD } };
  const websites = Array.isArray(entry['websites'])
    ? entry['websites'].filter((w): w is string => typeof w === 'string' && w.length > 0)
    : [];
  return {
    ok: true,
    profile: {
      about: text(entry['about']),
      description: text(entry['description']),
      address: text(entry['address']),
      email: text(entry['email']),
      websites,
      vertical: text(entry['vertical']),
      photo_url: photoUrl(entry['profile_picture_url']),
      read_at: now.toISOString(),
    },
  };
}

/** Champ du profil nommé par un refus de Meta (essai R2a §5), lu dans son texte masqué ; null sinon. */
function refusedField(failure: GraphFailure, error: MetaErrorCode | null): BusinessProfileField | null {
  if (error === null || error.code === null || !FIELD_ERROR_CODES.has(error.code)) return null;
  if (failure.kind !== 'other' || failure.provider_text === undefined) return null;
  const match = FIELD_IN_MESSAGE.exec(failure.provider_text);
  const named = match?.[1]?.toLowerCase();
  return PROFILE_KEYS.find((k) => k === named) ?? null;
}

/**
 * Écrit le profil du numéro (spec R2a §6.2) : seuls les champs présents dans `patch` partent, toujours avec
 * `messaging_product`, et un champ vide part vide (Review Focus 2). Le corps va dans la requête, jamais dans l'adresse.
 * `field` : le champ que Meta désigne dans son refus, null s'il n'en nomme aucun.
 */
export async function writeBusinessProfile(
  ctx: GraphContext, providerNumberId: string, patch: UpdateWhatsAppBusinessProfileInput,
): Promise<{ ok: true } | { ok: false; failure: GraphFailure; field: BusinessProfileField | null }> {
  const body: Record<string, unknown> = { messaging_product: MESSAGING_PRODUCT };
  for (const key of PROFILE_KEYS) {
    const value = patch[key];
    if (value !== undefined) body[key] = value;
  }
  const result = await writeExpectingSuccess(ctx, graphUrl(numberPath(providerNumberId, '/whatsapp_business_profile')), body);
  if (result.ok) return result;
  return { ok: false, failure: result.failure, field: refusedField(result.failure, result.meta_error) };
}

type PhotoResult<T> = ({ ok: true } & T) | { ok: false; failure: GraphFailure; photoRejected: boolean };

function photoFailure(result: { failure: GraphFailure; meta_error: MetaErrorCode | null }): { ok: false; failure: GraphFailure; photoRejected: boolean } {
  return { ok: false, failure: result.failure, photoRejected: result.meta_error !== null && isMetaError(result.meta_error, PHOTO_TOO_SMALL) };
}

/**
 * Envoi du fichier dans la session de Meta (essai R2a §4, étape 2) : `Authorization: OAuth <jeton>`, `file_offset: 0`,
 * le fichier en corps. Sans `appsecret_proof` : l'adresse de session porte déjà sa signature `?sig=…`, et lui ajouter
 * le proof fait échouer Meta (« HMAC check failed »). C'est le seul appel Graph sans proof, d'où cette fonction à part.
 */
async function sendUploadBytes(
  ctx: GraphContext, target: URL, file: { bytes: Uint8Array; type: string },
): Promise<GraphResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `OAuth ${ctx.c.access_token}`,
    file_offset: '0',
    'Content-Type': file.type,
  };
  // Copie typée sur un ArrayBuffer, la forme qu'accepte `fetch` (le fichier tient en mémoire, 5 Mo au plus).
  const outcome = await httpJson(ctx.fetchImpl, target.href, { method: 'POST', headers, body: new Uint8Array(file.bytes) });
  const none: MetaErrorCode = { code: null, subcode: null };
  if (outcome.kind === 'timeout') return { ok: false, failure: { kind: 'timeout' }, meta_error: none };
  if (outcome.kind === 'unreachable') return { ok: false, failure: { kind: 'unreachable' }, meta_error: none };
  if (outcome.status < 200 || outcome.status >= 300) {
    return { ok: false, failure: classifyGraphError(outcome.status, outcome.body, ctx), meta_error: readMetaErrorCode(outcome.body) };
  }
  if (!isRecord(outcome.body)) return { ok: false, failure: { kind: 'other', message: MESSAGE_UPLOAD_HANDLE_UNREAD }, meta_error: none };
  return { ok: true, body: outcome.body };
}

/**
 * Envoie la photo du profil par l'API d'envoi de fichiers de Meta (essai R2a §4, étapes 1 et 2) et rend son handle, à
 * poser ensuite par `setProfilePhoto`. Le type et la taille sont contrôlés par l'appelant (spec R2a §6.2).
 * `photoRejected` : Meta refuse l'image pour sa résolution (code 1, sous-code 3441013), à restituer en `photo_invalid`.
 */
export async function uploadProfilePhoto(
  ctx: GraphContext, appId: string, file: { bytes: Uint8Array; type: 'image/jpeg' | 'image/png' },
): Promise<PhotoResult<{ handle: string }>> {
  const open = await graphRequest(ctx, 'POST', graphUrl(`/${encodeURIComponent(appId)}/uploads`, {
    file_length: String(file.bytes.length), file_type: file.type,
  }));
  if (!open.ok) return photoFailure(open);
  const sessionId = asString(open.body['id']);
  // L'identifiant de session est recopié dans l'adresse : une forme inattendue est refusée, pour que le jeton ne
  // parte jamais vers un autre chemin ni un autre hôte que Graph.
  const target = sessionId === null ? null : uploadSessionUrl(sessionId);
  if (sessionId === null || target === null) {
    return { ok: false, failure: { kind: 'other', message: MESSAGE_UPLOAD_SESSION_UNREAD }, photoRejected: false };
  }
  const sent = await sendUploadBytes(withSecrets(ctx, [sessionId, ...sessionId.split('?sig=')]), target, file);
  if (!sent.ok) return photoFailure(sent);
  const handle = asString(sent.body['h']);
  if (handle === null) return { ok: false, failure: { kind: 'other', message: MESSAGE_UPLOAD_HANDLE_UNREAD }, photoRejected: false };
  return { ok: true, handle };
}

/** Pose le handle d'une photo envoyée sur le profil du numéro (essai R2a §4, étape 3). */
export async function setProfilePhoto(
  ctx: GraphContext, providerNumberId: string, handle: string,
): Promise<PhotoResult<Record<never, never>>> {
  const result = await writeExpectingSuccess(ctx, graphUrl(numberPath(providerNumberId, '/whatsapp_business_profile')), {
    messaging_product: MESSAGING_PRODUCT, profile_picture_handle: handle,
  });
  if (result.ok) return result;
  return photoFailure(result);
}

/**
 * Demande un nouveau nom d'affichage pour le numéro (`new_display_name`, essai R2a §1). La limite des 10 changements
 * par 30 jours n'a pas été atteinte à l'essai : son code n'est pas connu, le refus reste générique.
 */
export async function requestDisplayName(ctx: GraphContext, providerNumberId: string, name: string): Promise<{ ok: true } | Failed> {
  const result = await writeExpectingSuccess(ctx, graphUrl(numberPath(providerNumberId)), { new_display_name: name });
  return result.ok ? result : failed(result);
}

/**
 * Réenregistre le numéro avec le code de vérification en deux étapes, ce qui applique le nom approuvé (essai R2a §3).
 * Le code part dans le corps de la requête seulement : jamais dans l'adresse, et il est ajouté aux secrets masqués du
 * contexte, pour qu'un texte de Meta qui le répète ne le fasse jamais sortir d'un échec (spec R2a §9.4).
 * - `pinRejected` : code Meta 133005 (documentation de Meta, non observé, ruling R-13) ;
 * - `expired` : vrai seulement sur un code d'erreur de Meta identifié, et aucun n'est connu (ruling R-13) : il reste
 *   false, et l'expiration d'une demande est lue par la relecture des numéros (demande `EXPIRED` ou disparue).
 */
export async function registerNumber(
  ctx: GraphContext, providerNumberId: string, pin: string,
): Promise<{ ok: true } | { ok: false; failure: GraphFailure; pinRejected: boolean; expired: boolean }> {
  const result = await writeExpectingSuccess(withSecrets(ctx, [pin]), graphUrl(numberPath(providerNumberId, '/register')), {
    messaging_product: MESSAGING_PRODUCT, pin,
  });
  if (result.ok) return result;
  return {
    ok: false,
    failure: result.failure,
    pinRejected: result.meta_error !== null && isMetaError(result.meta_error, { code: PIN_MISMATCH_CODE }),
    expired: false,
  };
}
