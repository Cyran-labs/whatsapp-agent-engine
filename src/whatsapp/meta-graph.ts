// Client Meta Graph pour un compte WhatsApp Business en mode manuel (spec §7.1, §7.4).
// Module autonome : aucune base de données, `fetch` injectable. Le `appsecret_proof` est envoyé sur
// chaque appel (tâche 0 a) : c'est lui qui rend le contrôle du secret de l'app réel.

import { createHmac } from 'node:crypto';
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
const MESSAGE_TIMEOUT = 'Meta ne répond pas';
const MESSAGE_UNREACHABLE = 'Meta est injoignable';
const MESSAGE_SUBSCRIPTION_UNCONFIRMED = 'Abonnement aux webhooks non confirmé par Meta';

/** HMAC-SHA256 hexadécimal du jeton d'accès, clé = secret de l'app. */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

type GraphFailure =
  | { kind: 'token_invalid' | 'app_secret' | 'waba_not_found' | 'timeout' | 'unreachable' }
  | { kind: 'other'; message: string };

type GraphResult = { ok: true; body: Record<string, unknown> } | { ok: false; failure: GraphFailure };

interface GraphContext {
  c: MetaManualCredentials;
  fetchImpl: typeof fetch;
  proof: string;
  secrets: string[];
}

function makeContext(c: MetaManualCredentials, opts?: ProviderClientOptions): GraphContext {
  return {
    c,
    fetchImpl: opts?.fetchImpl ?? fetch,
    proof: appSecretProof(c.access_token, c.app_secret),
    secrets: [c.access_token, c.app_secret, appSecretProof(c.access_token, c.app_secret)],
  };
}

function classify(status: number, body: unknown, ctx: GraphContext): GraphFailure {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
  const code = error !== null && typeof error['code'] === 'number' ? error['code'] : null;
  const subcode = error !== null && typeof error['error_subcode'] === 'number' ? error['error_subcode'] : null;
  const rawMessage = error !== null && typeof error['message'] === 'string' ? error['message'] : '';
  if (status === 401 || code === 190) return { kind: 'token_invalid' };
  if (status === 400 && code === 100 && /appsecret_proof/i.test(rawMessage)) return { kind: 'app_secret' };
  if (code === 100 && subcode === 33) return { kind: 'waba_not_found' };
  const message = rawMessage.length > 0 ? sanitizeProviderText(rawMessage, ctx.secrets) : `HTTP ${status}`;
  return { kind: 'other', message };
}

async function graphCall(ctx: GraphContext, method: 'GET' | 'POST', target: URL): Promise<GraphResult> {
  target.searchParams.set('appsecret_proof', ctx.proof);
  const outcome = await httpJson(ctx.fetchImpl, target.href, {
    method,
    headers: { Authorization: `Bearer ${ctx.c.access_token}`, Accept: 'application/json' },
  });
  if (outcome.kind === 'timeout') return { ok: false, failure: { kind: 'timeout' } };
  if (outcome.kind === 'unreachable') return { ok: false, failure: { kind: 'unreachable' } };
  if (outcome.status < 200 || outcome.status >= 300) return { ok: false, failure: classify(outcome.status, outcome.body, ctx) };
  if (!isRecord(outcome.body)) return { ok: false, failure: { kind: 'other', message: 'Réponse de Meta illisible' } };
  return { ok: true, body: outcome.body };
}

function graphUrl(path: string, query: Record<string, string> = {}): URL {
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
}

/** Traduit un échec Graph en check et message. `step` est le check de l'étape en cours. */
function describeFailure(failure: GraphFailure, step: VerificationCheckKey): { key: VerificationCheckKey; reason: ProviderErrorReason; message: string } {
  switch (failure.kind) {
    case 'token_invalid': return { key: 'token', reason: 'token_invalid', message: MESSAGE_TOKEN_INVALID };
    case 'app_secret': return { key: 'app_secret', reason: 'other', message: MESSAGE_APP_SECRET };
    case 'waba_not_found': return { key: 'waba_access', reason: 'other', message: MESSAGE_WABA };
    case 'timeout': return { key: step, reason: 'other', message: MESSAGE_TIMEOUT };
    case 'unreachable': return { key: step, reason: 'other', message: MESSAGE_UNREACHABLE };
    case 'other': return {
      key: step,
      reason: 'other',
      message: failure.message === MESSAGE_SUBSCRIPTION_UNCONFIRMED ? failure.message : `Meta : ${failure.message}`.slice(0, MAX_TEXT_LENGTH),
    };
  }
}

function failureReport(checks: VerificationCheck[], failure: GraphFailure, step: VerificationCheckKey): FailureReport {
  const d = describeFailure(failure, step);
  return {
    checks: [...checks.filter((c) => c.key !== d.key), { key: d.key, status: 'failed', detail: d.message }],
    reason: d.reason,
    message: d.message,
  };
}

function refused(report: FailureReport): ProviderVerification {
  return { ok: false, checks: report.checks, error_reason: report.reason, message: report.message };
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
  return { numbers: [], skipped: { sandbox: 0, invalid_number: 0 }, error: { reason: d.reason, message: d.message } };
}

/**
 * Vérification d'un compte Meta en mode manuel (spec §7.1) : jeton et accès à la WABA, secret de l'app,
 * `debug_token`, abonnement de l'app (créé s'il manque), inventaire. L'écriture (POST subscribed_apps)
 * n'a lieu qu'après réussite de toutes les lectures qui la précèdent.
 */
export async function verifyMetaManual(c: MetaManualCredentials, opts?: ProviderClientOptions): Promise<ProviderVerification> {
  const ctx = makeContext(c, opts);
  const checks: VerificationCheck[] = [];

  const account = await graphCall(ctx, 'GET', graphUrl(wabaPath(c), { fields: 'id,name' }));
  if (!account.ok) return refused(failureReport(checks, account.failure, 'waba_access'));
  const accountName = (asString(account.body['name']) ?? c.waba_id).slice(0, MAX_TEXT_LENGTH);
  // Le proof a été accepté avec le jeton : le secret de l'app est bon.
  checks.push({ key: 'token', status: 'ok' }, { key: 'waba_access', status: 'ok' }, { key: 'app_secret', status: 'ok' });

  let metaAppId: string | null = null;
  let tokenExpiry: string | null = null;
  const debug = await graphCall(ctx, 'GET', graphUrl('/debug_token', { input_token: c.access_token }));
  if (debug.ok) {
    const read = readDebugToken(debug.body);
    if (!read.valid) return refused(failureReport(checks, { kind: 'token_invalid' }, 'token'));
    metaAppId = read.appId;
    tokenExpiry = read.expiry;
    checks.push({ key: 'token_expiry', status: read.expiry === null ? 'pending' : 'ok', ...(read.expiry === null ? { detail: 'Expiration non lue' } : {}) });
  } else if (debug.failure.kind === 'other') {
    checks.push({ key: 'token_expiry', status: 'pending', detail: 'Expiration non lue' });
  } else {
    return refused(failureReport(checks, debug.failure, 'token_expiry'));
  }

  const subscribed = await graphCall(ctx, 'GET', graphUrl(wabaPath(c, '/subscribed_apps')));
  if (!subscribed.ok) return refused(failureReport(checks, subscribed.failure, 'subscription'));

  // Toutes les lectures précèdent l'unique écriture : aucune écriture chez Meta si la vérification échoue.
  const inventory = await fetchNumbers(ctx);
  if (!inventory.ok) return refused(failureReport(checks, inventory.failure, 'numbers'));
  checks.push({ key: 'numbers', status: 'ok', detail: `${inventory.numbers.length} numéro(s)` });

  if (appIsSubscribed(subscribed.body, metaAppId)) {
    checks.push({ key: 'subscription', status: 'ok' });
  } else {
    // Jamais d'override_callback_uri : l'URL de rappel reste celle de l'app.
    const created = await graphCall(ctx, 'POST', graphUrl(wabaPath(c, '/subscribed_apps')));
    if (!created.ok) return refused(failureReport(checks, created.failure, 'subscription'));
    if (created.body['success'] !== true) {
      return refused(failureReport(checks, { kind: 'other', message: MESSAGE_SUBSCRIPTION_UNCONFIRMED }, 'subscription'));
    }
    checks.push({ key: 'subscription', status: 'created' });
  }

  return {
    ok: true,
    checks,
    account_name: accountName,
    waba_id: c.waba_id,
    meta_app_id: metaAppId,
    token_expiry: tokenExpiry,
    numbers: inventory.numbers,
    skipped: inventory.skipped,
  };
}
