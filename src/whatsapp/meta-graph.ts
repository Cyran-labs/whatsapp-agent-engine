// Client Meta Graph pour un compte WhatsApp Business en mode manuel (spec §7.1, §7.4).
// Module autonome : aucune base de données, `fetch` injectable. Le `appsecret_proof` est envoyé sur
// chaque appel (tâche 0 a) : c'est lui qui rend le contrôle du secret de l'app réel.

import { createHmac } from 'node:crypto';
import type { MetaHealthIssue, MetaHealthView, MetaSendCapability } from '@wabagent/contracts';
import { config } from '../core/config.js';
import { normalizeWhatsAppNumber } from '../core/phone.js';
import type { ProviderNumber } from '../core/database/whatsapp-types.js';
import { META_API_BASE } from '../transport/meta-cloud.js';
import { asString, httpJson, isRecord, MAX_TEXT_LENGTH, sanitizeProviderText } from './provider-common.js';
import type {
  ProviderClientOptions, ProviderErrorReason, ProviderListing, ProviderSkipped, ProviderVerification,
  VerificationCheck, VerificationCheckKey,
} from './provider-common.js';

export type { ProviderVerification, VerificationCheck, ProviderListing } from './provider-common.js';

export interface MetaManualCredentials {
  waba_id: string;
  access_token: string;
  app_secret: string;
}

const PAGE_SIZE = 100;
/** Garde-fou : 100 pages de 100 numéros, bien au-delà de ce qu'un compte porte. */
const MAX_PAGES = 100;

const MESSAGE_TOKEN_INVALID = 'Jeton refusé par Meta';
const MESSAGE_APP_SECRET = "Secret de l'app refusé";
const MESSAGE_WABA = 'Identifiant de compte introuvable ou non partagé avec le jeton';
/** Recette 3.14 : l'identifiant saisi est celui d'un numéro (ou d'un autre objet), Meta n'y connaît pas `subscribed_apps`. */
const MESSAGE_NOT_A_WABA = "Cet identifiant n'est pas celui d'un compte WhatsApp Business (WABA). Reprenez l'identifiant du compte WhatsApp Business dans le Gestionnaire WhatsApp, pas celui d'un numéro ni de l'app.";
const MESSAGE_TIMEOUT = 'Meta ne répond pas';
const MESSAGE_UNREACHABLE = 'Meta est injoignable';
/** Texte du moteur quand Meta répond par une erreur : le message de Meta, lui, va dans `provider_text`. */
const MESSAGE_PROVIDER_ERROR = 'Meta a renvoyé une erreur';
const MESSAGE_APP_UNREAD = "Impossible de lire l'application du jeton auprès de Meta, réessayez.";
const MESSAGE_CALLBACK_FAILED = "Meta n'a pas pu joindre l'adresse du webhook de WABAGENT";
const DETAIL_SUBSCRIPTION_AT_CONNECT = 'Abonnement fait au raccordement';
/** Code d'erreur Meta : la vérification de l'adresse de rappel (GET hub.challenge) a échoué. */
const CALLBACK_VERIFICATION_FAILED_CODE = 2200;
/** Garde-fou : Meta liste un problème par entité, bien moins que cela en pratique. */
const MAX_HEALTH_ISSUES = 20;
/** Codes d'erreur Meta de limite de débit (application, utilisateur, compte, numéro, WhatsApp Business). */
const RATE_LIMIT_CODES: ReadonlySet<number> = new Set([4, 17, 32, 613, 80007, 130429]);

/** HMAC-SHA256 hexadécimal du jeton d'accès, clé = secret de l'app. */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

export type GraphFailure =
  | { kind: 'token_invalid' | 'app_secret' | 'waba_not_found' | 'timeout' | 'unreachable' }
  /**
   * Meta n'a pas pu joindre l'adresse de rappel inscrite (code 2200) : non transitoire, rien n'est enregistré chez Meta.
   * `provider_text` : le message de Meta (masqué, borné).
   */
  | { kind: 'callback_failed'; provider_text?: string }
  /** Identifiant qui n'est pas une WABA (recette 3.14) : texte du moteur, message de Meta gardé dans `provider_text`. */
  | { kind: 'not_a_waba'; provider_text?: string }
  /**
   * `message` est toujours un texte du moteur, en français ; `provider_text` le message d'erreur de Meta (masqué,
   * borné), présent seulement quand Meta en a écrit un. `transient` : réponse 5xx ou limite de débit (revue 2b-2 M-1).
   */
  | { kind: 'other'; message: string; provider_text?: string; transient?: true };

type GraphResult = { ok: true; body: Record<string, unknown> } | { ok: false; failure: GraphFailure };

export interface GraphContext {
  c: MetaManualCredentials;
  fetchImpl: typeof fetch;
  proof: string;
  secrets: string[];
}

export function makeContext(c: MetaManualCredentials, opts?: ProviderClientOptions): GraphContext {
  return {
    c,
    fetchImpl: opts?.fetchImpl ?? fetch,
    proof: appSecretProof(c.access_token, c.app_secret),
    secrets: [c.access_token, c.app_secret, appSecretProof(c.access_token, c.app_secret)],
  };
}

/**
 * Contexte des appels de l'app Meta, authentifiés par le jeton d'app `<app_id>|<app_secret>` et jamais par un jeton de
 * compte. Relecture finale R1 FR-I3 : comme un jeton de compte, il part dans l'en-tête `Authorization` (jamais dans
 * l'URL) avec son `appsecret_proof` (HMAC-SHA256 du jeton d'app, clé = secret de l'app), exigé quand « Clé requise » est
 * activée dans les paramètres avancés de l'app.
 */
export function makeAppContext(app: { appId: string; appSecret: string }, opts?: ProviderClientOptions): GraphContext {
  const appToken = `${app.appId}|${app.appSecret}`;
  const proof = appSecretProof(appToken, app.appSecret);
  return {
    c: { waba_id: '', access_token: appToken, app_secret: app.appSecret },
    fetchImpl: opts?.fetchImpl ?? fetch,
    proof,
    secrets: [appToken, app.appSecret, proof],
  };
}

function classify(status: number, body: unknown, ctx: GraphContext): GraphFailure {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
  const code = error !== null && typeof error['code'] === 'number' ? error['code'] : null;
  const subcode = error !== null && typeof error['error_subcode'] === 'number' ? error['error_subcode'] : null;
  const rawMessage = error !== null && typeof error['message'] === 'string' ? error['message'] : '';
  if (status === 401 || code === 190) return { kind: 'token_invalid' };
  if (code === CALLBACK_VERIFICATION_FAILED_CODE) {
    const text = rawMessage.length > 0 ? sanitizeProviderText(rawMessage, ctx.secrets) : null;
    return text === null ? { kind: 'callback_failed' } : { kind: 'callback_failed', provider_text: text };
  }
  // Revue 2b-2 M-1 : une limite de débit (HTTP 429 ou code Meta dédié) ne dit rien des identifiants.
  const rateLimited = status === 429 || (code !== null && RATE_LIMIT_CODES.has(code));
  if (status === 400 && code === 100 && /appsecret_proof/i.test(rawMessage)) return { kind: 'app_secret' };
  if (code === 100 && subcode === 33) return { kind: 'waba_not_found' };
  const providerText = rawMessage.length > 0 ? sanitizeProviderText(rawMessage, ctx.secrets) : null;
  // Recette 3.14 : Meta répond « nonexisting field (subscribed_apps) » quand l'identifiant saisi n'est pas une WABA
  // (par exemple celui d'un numéro). Texte seulement : le contrôle et la raison restent ceux d'un refus clair.
  if (code === 100 && /nonexisting field/i.test(rawMessage) && /subscribed_apps/i.test(rawMessage)) {
    return providerText === null ? { kind: 'not_a_waba' } : { kind: 'not_a_waba', provider_text: providerText };
  }
  const message = providerText === null ? `Meta a répondu avec le code HTTP ${status}` : MESSAGE_PROVIDER_ERROR;
  const failure = providerText === null ? { kind: 'other' as const, message } : { kind: 'other' as const, message, provider_text: providerText };
  return status >= 500 || rateLimited ? { ...failure, transient: true } : failure;
}

export async function graphCall(ctx: GraphContext, method: 'GET' | 'POST', target: URL): Promise<GraphResult> {
  target.searchParams.set('appsecret_proof', ctx.proof);
  const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${ctx.c.access_token}` };
  const outcome = await httpJson(ctx.fetchImpl, target.href, { method, headers });
  if (outcome.kind === 'timeout') return { ok: false, failure: { kind: 'timeout' } };
  if (outcome.kind === 'unreachable') return { ok: false, failure: { kind: 'unreachable' } };
  if (outcome.status < 200 || outcome.status >= 300) return { ok: false, failure: classify(outcome.status, outcome.body, ctx) };
  if (!isRecord(outcome.body)) return { ok: false, failure: { kind: 'other', message: 'Réponse de Meta illisible' } };
  return { ok: true, body: outcome.body };
}

export function graphUrl(path: string, query: Record<string, string> = {}): URL {
  const url = new URL(`${META_API_BASE}/${config.meta.graphVersion}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

function wabaPath(c: MetaManualCredentials, suffix = ''): string {
  return `/${encodeURIComponent(c.waba_id)}${suffix}`;
}

interface FailureReport {
  checks: VerificationCheck[];
  reason: ProviderErrorReason;
  message: string;
  provider_text?: string;
  transient: boolean;
}

interface FailureDescription {
  key: VerificationCheckKey;
  reason: ProviderErrorReason;
  message: string;
  provider_text?: string;
  /** Délai dépassé, Meta injoignable ou réponse 5xx : non concluant (revue 2b-2 M-1). */
  transient: boolean;
  /**
   * Le texte du moteur dit lui-même quoi corriger (recette 3.14) : le contrôle ne porte pas `provider_text`, que le web
   * afficherait à sa place ; le message de Meta reste dans la réponse (et dans l'erreur enregistrée du compte).
   */
  engineExplains?: true;
  /** Meta n'a pas pu joindre l'adresse du webhook de WABAGENT (code 2200) : l'appelant dit quoi vérifier. */
  callbackFailed?: true;
}

/** Traduit un échec Graph en check et message. `step` est le check de l'étape en cours. */
export function describeFailure(failure: GraphFailure, step: VerificationCheckKey): FailureDescription {
  switch (failure.kind) {
    case 'token_invalid': return { key: 'token', reason: 'token_invalid', message: MESSAGE_TOKEN_INVALID, transient: false };
    case 'app_secret': return { key: 'app_secret', reason: 'other', message: MESSAGE_APP_SECRET, transient: false };
    case 'waba_not_found': return { key: 'waba_access', reason: 'other', message: MESSAGE_WABA, transient: false };
    case 'not_a_waba': return {
      key: 'waba_access',
      reason: 'other',
      message: MESSAGE_NOT_A_WABA,
      ...(failure.provider_text !== undefined ? { provider_text: failure.provider_text } : {}),
      transient: false,
      engineExplains: true,
    };
    case 'callback_failed': return {
      key: step,
      reason: 'other',
      message: MESSAGE_CALLBACK_FAILED,
      ...(failure.provider_text !== undefined ? { provider_text: failure.provider_text } : {}),
      transient: false,
      callbackFailed: true,
    };
    case 'timeout': return { key: step, reason: 'other', message: MESSAGE_TIMEOUT, transient: true };
    case 'unreachable': return { key: step, reason: 'other', message: MESSAGE_UNREACHABLE, transient: true };
    case 'other': return {
      key: step,
      reason: 'other',
      message: failure.message,
      ...(failure.provider_text !== undefined ? { provider_text: failure.provider_text } : {}),
      transient: failure.transient === true,
    };
  }
}

function failureReport(checks: VerificationCheck[], failure: GraphFailure, step: VerificationCheckKey): FailureReport {
  const d = describeFailure(failure, step);
  return {
    checks: [
      ...checks.filter((c) => c.key !== d.key),
      { key: d.key, status: 'failed', detail: d.message, ...(d.provider_text !== undefined && d.engineExplains !== true ? { provider_text: d.provider_text } : {}) },
    ],
    reason: d.reason,
    message: d.message,
    ...(d.provider_text !== undefined ? { provider_text: d.provider_text } : {}),
    transient: d.transient,
  };
}

function refused(report: FailureReport): ProviderVerification {
  return {
    ok: false, checks: report.checks, error_reason: report.reason, message: report.message,
    ...(report.provider_text !== undefined ? { provider_text: report.provider_text } : {}),
    ...(report.transient ? { transient: true as const } : {}),
  };
}

interface DebugTokenData {
  appId: string | null;
  expiry: string | null;
  valid: boolean;
}

function readDebugToken(body: Record<string, unknown>): DebugTokenData {
  const data = isRecord(body['data']) ? body['data'] : {};
  const expiresAt = data['expires_at'];
  let expiry: string | null = null;
  if (expiresAt === 0) expiry = 'never';
  else if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0) {
    const date = new Date(expiresAt * 1000);
    expiry = Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const appId = typeof data['app_id'] === 'string' || typeof data['app_id'] === 'number' ? String(data['app_id']) : null;
  return { appId, expiry, valid: data['is_valid'] !== false };
}

function appIsSubscribed(body: Record<string, unknown>, metaAppId: string | null): boolean {
  if (metaAppId === null) return false;
  const data = Array.isArray(body['data']) ? body['data'] : [];
  return data.some((entry) => {
    if (!isRecord(entry) || !isRecord(entry['whatsapp_business_api_data'])) return false;
    const id = entry['whatsapp_business_api_data']['id'];
    return (typeof id === 'string' || typeof id === 'number') && String(id) === metaAppId;
  });
}

const SEND_CAPABILITIES: Readonly<Record<string, MetaSendCapability>> = {
  AVAILABLE: 'available', LIMITED: 'limited', BLOCKED: 'blocked',
};

/** Champs lus sur la WABA pour l'état du compte (vérification et « Rafraîchir les numéros »). */
export const META_HEALTH_FIELDS = 'health_status,business_verification_status';

/**
 * État du compte lu dans la réponse de la WABA (lot R1) : capacité d'envoi, vérification de l'entreprise, problèmes de
 * toutes les entités (texte de Meta masqué et borné, dédoublonnés par code). Null si Meta n'a renvoyé aucun des deux champs.
 */
export function readMetaHealthBody(body: Record<string, unknown>, secrets: readonly string[], now: Date = new Date()): MetaHealthView | null {
  const health = isRecord(body['health_status']) ? body['health_status'] : null;
  const verification = asString(body['business_verification_status']);
  if (health === null && verification === null) return null;
  const capability = health === null ? null : asString(health['can_send_message']);
  const issues: MetaHealthIssue[] = [];
  const seen = new Set<string>();
  const entities = health !== null && Array.isArray(health['entities']) ? health['entities'] : [];
  for (const entity of entities) {
    const errors = isRecord(entity) && Array.isArray(entity['errors']) ? entity['errors'] : [];
    for (const error of errors) {
      if (!isRecord(error) || issues.length >= MAX_HEALTH_ISSUES) continue;
      const rawCode = error['error_code'];
      const code = typeof rawCode === 'number' && Number.isFinite(rawCode) ? rawCode : null;
      const description = asString(error['error_description']);
      const text = description === null ? null : sanitizeProviderText(description, secrets);
      const identity = code !== null ? `code:${code}` : `text:${text ?? ''}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      issues.push({ code, text });
    }
  }
  return {
    can_send: capability === null ? null : SEND_CAPABILITIES[capability] ?? null,
    business_verification: verification,
    issues,
    read_at: now.toISOString(),
  };
}

type NumbersResult =
  | { ok: true; numbers: ProviderNumber[]; skipped: ProviderSkipped }
  | { ok: false; failure: GraphFailure };

function toProviderNumber(entry: Record<string, unknown>): ProviderNumber | null {
  const id = typeof entry['id'] === 'string' || typeof entry['id'] === 'number' ? String(entry['id']) : null;
  const display = asString(entry['display_phone_number']);
  const e164 = display === null ? null : normalizeWhatsAppNumber(display);
  if (id === null || e164 === null) return null;
  return {
    provider_number_id: id,
    phone_e164: e164,
    display_name: (asString(entry['verified_name']) ?? e164).slice(0, MAX_TEXT_LENGTH),
    meta_status: asString(entry['status']),
    quality: asString(entry['quality_rating']),
    // Tâche 0 d : `account_mode` vaut LIVE pour le numéro de test, il ne le distingue pas.
    // Le marquage « numéro de test » d'un numéro Meta est manuel (tâche 5).
    is_test: false,
    cm_channel_id: null,
  };
}

async function fetchNumbers(ctx: GraphContext): Promise<NumbersResult> {
  const numbers: ProviderNumber[] = [];
  const skipped: ProviderSkipped = { sandbox: 0, invalid_number: 0 };
  const graphOrigin = new URL(META_API_BASE).origin;
  let target: URL = graphUrl(wabaPath(ctx.c, '/phone_numbers'), {
    fields: 'id,display_phone_number,verified_name,status,quality_rating',
    limit: String(PAGE_SIZE),
  });
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await graphCall(ctx, 'GET', target);
    if (!result.ok) return result;
    const data = result.body['data'];
    if (!Array.isArray(data)) return { ok: false, failure: { kind: 'other', message: 'Liste de numéros illisible' } };
    for (const entry of data) {
      const mapped = isRecord(entry) ? toProviderNumber(entry) : null;
      if (mapped === null) skipped.invalid_number += 1;
      else numbers.push(mapped);
    }
    const paging = result.body['paging'];
    const next = isRecord(paging) ? asString(paging['next']) : null;
    if (next === null) return { ok: true, numbers, skipped };
    let nextUrl: URL;
    try { nextUrl = new URL(next); } catch { return { ok: false, failure: { kind: 'other', message: 'Pagination de Meta illisible' } }; }
    // Le jeton n'est envoyé qu'à Meta : une pagination vers un autre hôte est refusée.
    if (nextUrl.origin !== graphOrigin) return { ok: false, failure: { kind: 'other', message: 'Pagination de Meta refusée' } };
    target = nextUrl;
  }
  return { ok: false, failure: { kind: 'other', message: 'Trop de pages de numéros' } };
}

/** Inventaire des numéros du compte chez Meta (spec §7.4). */
export async function listMetaNumbers(c: MetaManualCredentials, opts?: ProviderClientOptions): Promise<ProviderListing> {
  const ctx = makeContext(c, opts);
  const result = await fetchNumbers(ctx);
  if (result.ok) return { numbers: result.numbers, skipped: result.skipped };
  const d = describeFailure(result.failure, 'numbers');
  // audit décisions B7 : une panne passagère (délai, Meta injoignable, 5xx) est dite telle, comme chez CM.com.
  return {
    numbers: [],
    skipped: { sandbox: 0, invalid_number: 0 },
    error: { reason: d.reason, message: d.message, ...(d.provider_text !== undefined ? { provider_text: d.provider_text } : {}), ...(d.transient ? { transient: true as const } : {}) },
  };
}

/**
 * Vérification d'un compte Meta en mode manuel (spec §7.1) : jeton et accès à la WABA, secret de l'app,
 * `debug_token`, abonnement de l'app, inventaire, état du compte. Lecture seule (lot R1) : aucune écriture chez Meta,
 * l'abonnement se fait au raccordement (`subscription` vaut `pending` tant que l'app n'est pas abonnée).
 */
export async function verifyMetaManual(c: MetaManualCredentials, opts?: ProviderClientOptions): Promise<ProviderVerification> {
  const ctx = makeContext(c, opts);
  const checks: VerificationCheck[] = [];

  const account = await graphCall(ctx, 'GET', graphUrl(wabaPath(c), { fields: `id,name,${META_HEALTH_FIELDS}` }));
  if (!account.ok) return refused(failureReport(checks, account.failure, 'waba_access'));
  const accountName = (asString(account.body['name']) ?? c.waba_id).slice(0, MAX_TEXT_LENGTH);
  // Le proof a été accepté avec le jeton : le secret de l'app est bon.
  checks.push({ key: 'token', status: 'ok' }, { key: 'waba_access', status: 'ok' }, { key: 'app_secret', status: 'ok' });
  const metaHealth = readMetaHealthBody(account.body, ctx.secrets);

  let metaAppId: string | null = null;
  let tokenExpiry: string | null = null;
  const debug = await graphCall(ctx, 'GET', graphUrl('/debug_token', { input_token: c.access_token }));
  if (debug.ok) {
    const read = readDebugToken(debug.body);
    if (!read.valid) return refused(failureReport(checks, { kind: 'token_invalid' }, 'token'));
    metaAppId = read.appId;
    tokenExpiry = read.expiry;
    checks.push({ key: 'token_expiry', status: read.expiry === null ? 'pending' : 'ok', ...(read.expiry === null ? { detail: 'Expiration non lue' } : {}) });
  } else if (debug.failure.kind !== 'other') {
    return refused(failureReport(checks, debug.failure, 'token_expiry'));
  }

  // Sans l'application du jeton, l'abonnement ne peut pas être jugé et le service refuse le raccordement :
  // aucune écriture chez Meta (revue finale 2b-2). Une app illisible n'est jamais un refus clair d'identifiants
  // (5xx, autre 400, 200 sans app_id) : toujours non concluant, « Vérifier maintenant » ne met jamais le compte en erreur.
  if (metaAppId === null) {
    return refused({
      checks: [...checks, { key: 'app', status: 'failed', detail: MESSAGE_APP_UNREAD }],
      reason: 'other',
      message: MESSAGE_APP_UNREAD,
      transient: true,
    });
  }

  const subscribed = await graphCall(ctx, 'GET', graphUrl(wabaPath(c, '/subscribed_apps')));
  if (!subscribed.ok) return refused(failureReport(checks, subscribed.failure, 'subscription'));

  const inventory = await fetchNumbers(ctx);
  if (!inventory.ok) return refused(failureReport(checks, inventory.failure, 'numbers'));
  checks.push({ key: 'numbers', status: 'ok', detail: `${inventory.numbers.length} numéro(s)` });

  checks.push(appIsSubscribed(subscribed.body, metaAppId)
    ? { key: 'subscription', status: 'ok' }
    : { key: 'subscription', status: 'pending', detail: DETAIL_SUBSCRIPTION_AT_CONNECT });

  return {
    ok: true,
    checks,
    account_name: accountName,
    waba_id: c.waba_id,
    meta_app_id: metaAppId,
    token_expiry: tokenExpiry,
    numbers: inventory.numbers,
    skipped: inventory.skipped,
    meta_health: metaHealth,
  };
}
