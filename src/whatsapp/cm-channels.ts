// Client CM.com Channels pour un compte WhatsApp (spec §7.2, §7.4).
// Module autonome : aucune base de données, `fetch` injectable. Chemins et champs relevés le 8 nov. 2026
// (résultats de la tâche 0) : canaux à `available.whatsApp.profiles[].channelRequestId`, profils et
// `businessaccount` par canal.

import { normalizeWhatsAppNumber } from '../core/phone.js';
import type { ProviderNumber } from '../core/database/whatsapp-types.js';
import { fromCmNumber } from '../transport/cm-com.js';
import { asString, httpJson, isRecord, MAX_TEXT_LENGTH, sanitizeProviderText } from './provider-common.js';
import type {
  ProviderClientOptions, ProviderErrorReason, ProviderListing, ProviderSkipped, ProviderVerification,
  VerificationCheck, VerificationCheckKey,
} from './provider-common.js';

export interface CmCredentials {
  account_id: string;
  product_token: string;
}

const CM_API_BASE = 'https://api.cm.com';
const MESSAGE_TOKEN_INVALID = 'Jeton CM.com refusé';
const MESSAGE_TIMEOUT = 'CM.com ne répond pas';
const MESSAGE_UNREACHABLE = 'CM.com est injoignable';

type CmFailure =
  | { kind: 'token_invalid' | 'timeout' | 'unreachable' }
  | { kind: 'other'; message: string };

type CmResult = { ok: true; body: unknown } | { ok: false; failure: CmFailure };

interface CmContext {
  c: CmCredentials;
  fetchImpl: typeof fetch;
}

function accountPath(c: CmCredentials, suffix: string): string {
  return `${CM_API_BASE}/channels/v1/accounts/${encodeURIComponent(c.account_id)}${suffix}`;
}

function channelPath(c: CmCredentials, channelRequestId: string, suffix: string): string {
  return accountPath(c, `/whatsapp/${encodeURIComponent(channelRequestId)}${suffix}`);
}

async function cmGet(ctx: CmContext, url: string): Promise<CmResult> {
  const outcome = await httpJson(ctx.fetchImpl, url, {
    method: 'GET',
    headers: { 'X-CM-PRODUCTTOKEN': ctx.c.product_token, Accept: 'application/json' },
  });
  if (outcome.kind === 'timeout') return { ok: false, failure: { kind: 'timeout' } };
  if (outcome.kind === 'unreachable') return { ok: false, failure: { kind: 'unreachable' } };
  if (outcome.status === 401) return { ok: false, failure: { kind: 'token_invalid' } };
  if (outcome.status < 200 || outcome.status >= 300) {
    const raw = isRecord(outcome.body) ? asString(outcome.body['Message']) ?? asString(outcome.body['message']) : null;
    const text = raw === null ? `HTTP ${outcome.status}` : sanitizeProviderText(raw, [ctx.c.product_token]);
    return { ok: false, failure: { kind: 'other', message: text } };
  }
  return { ok: true, body: outcome.body };
}

function describeFailure(failure: CmFailure): { reason: ProviderErrorReason; message: string } {
  switch (failure.kind) {
    case 'token_invalid': return { reason: 'token_invalid', message: MESSAGE_TOKEN_INVALID };
    case 'timeout': return { reason: 'other', message: MESSAGE_TIMEOUT };
    case 'unreachable': return { reason: 'other', message: MESSAGE_UNREACHABLE };
    case 'other': return { reason: 'other', message: `CM.com : ${failure.message}`.slice(0, MAX_TEXT_LENGTH) };
  }
}

function refused(checks: VerificationCheck[], step: VerificationCheckKey, failure: CmFailure): ProviderVerification {
  const d = describeFailure(failure);
  return {
    ok: false,
    checks: [...checks.filter((c) => c.key !== step), { key: step, status: 'failed', detail: d.message }],
    error_reason: d.reason,
    message: d.message,
  };
}

/** Identifiants `channelRequestId` des canaux WhatsApp du compte ; absent ou null : liste vide. */
function readChannelIds(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body['available']) || !isRecord(body['available']['whatsApp'])) return [];
  const profiles = body['available']['whatsApp']['profiles'];
  if (!Array.isArray(profiles)) return [];
  const ids: string[] = [];
  for (const profile of profiles) {
    const id = isRecord(profile) ? asString(profile['channelRequestId']) : null;
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Profil CM.com converti en numéro, ou la raison pour laquelle il est écarté. */
function readProfile(profile: Record<string, unknown>, channelRequestId: string): ProviderNumber | 'inactive' | 'sandbox' | 'invalid' {
  if (profile['entityStatus'] !== 'ACTIVE') return 'inactive';
  if (profile['isSandbox'] === true) return 'sandbox';
  const phone = asString(profile['phoneNumber']);
  const e164 = phone === null ? null : normalizeWhatsAppNumber(fromCmNumber(phone));
  const profileId = typeof profile['id'] === 'string' || typeof profile['id'] === 'number' ? String(profile['id']) : null;
  const metaId = typeof profile['metaId'] === 'string' || typeof profile['metaId'] === 'number' ? String(profile['metaId']) : null;
  const providerNumberId = metaId !== null && metaId.length > 0 ? metaId : profileId === null ? null : `cm:${profileId}`;
  if (e164 === null || providerNumberId === null) return 'invalid';
  const quality = isRecord(profile['metaQualityRating']) ? asString(profile['metaQualityRating']['rating']) : null;
  return {
    provider_number_id: providerNumberId,
    phone_e164: e164,
    display_name: asString(profile['name']) ?? e164,
    meta_status: null,
    quality,
    is_test: false,
    cm_channel_id: channelRequestId,
  };
}

type InventoryResult =
  | { ok: true; channelIds: string[]; numbers: ProviderNumber[]; skipped: ProviderSkipped }
  | { ok: false; step: VerificationCheckKey; failure: CmFailure };

async function collectInventory(ctx: CmContext): Promise<InventoryResult> {
  const channels = await cmGet(ctx, accountPath(ctx.c, '/channels'));
  if (!channels.ok) return { ok: false, step: 'cm_account', failure: channels.failure };
  const channelIds = readChannelIds(channels.body);

  const numbers: ProviderNumber[] = [];
  const skipped: ProviderSkipped = { sandbox: 0, invalid_number: 0 };
  const seen = new Set<string>();
  for (const channelRequestId of channelIds) {
    // Un seul appel par liste : les paramètres `skip` et `take` ne sont pas documentés (sens inconnu).
    // Un canal qui porterait plus de profils que la réponse par défaut n'est donc pas inventorié en entier.
    const profiles = await cmGet(ctx, channelPath(ctx.c, channelRequestId, '/profiles?includeMetaQualityRating=true'));
    if (!profiles.ok) return { ok: false, step: 'cm_channels', failure: profiles.failure };
    if (!Array.isArray(profiles.body)) {
      return { ok: false, step: 'cm_channels', failure: { kind: 'other', message: 'Liste de profils illisible' } };
    }
    for (const entry of profiles.body) {
      if (!isRecord(entry)) { skipped.invalid_number += 1; continue; }
      const read = readProfile(entry, channelRequestId);
      if (read === 'inactive') continue;
      if (read === 'sandbox') { skipped.sandbox += 1; continue; }
      if (read === 'invalid') { skipped.invalid_number += 1; continue; }
      if (seen.has(read.provider_number_id)) continue;
      seen.add(read.provider_number_id);
      numbers.push(read);
    }
  }
  return { ok: true, channelIds, numbers, skipped };
}

/** Inventaire des numéros du compte chez CM.com (spec §7.4). */
export async function listCmNumbers(c: CmCredentials, opts?: ProviderClientOptions): Promise<ProviderListing> {
  const inventory = await collectInventory({ c, fetchImpl: opts?.fetchImpl ?? fetch });
  if (inventory.ok) return { numbers: inventory.numbers, skipped: inventory.skipped };
  const d = describeFailure(inventory.failure);
  return { numbers: [], skipped: { sandbox: 0, invalid_number: 0 }, error: { reason: d.reason, message: d.message } };
}

/**
 * Vérification d'un compte CM.com (spec §7.2) : canaux, profils de chaque canal WhatsApp, puis `businessaccount`
 * par canal. `facebookId` est conservé à titre indicatif seulement (affichage), jamais pour filtrer ou autoriser :
 * on ignore s'il désigne la WABA ou le portefeuille. Un échec de `businessaccount` ne rend pas la vérification
 * en échec.
 */
export async function verifyCmAccount(c: CmCredentials, opts?: ProviderClientOptions): Promise<ProviderVerification> {
  const ctx: CmContext = { c, fetchImpl: opts?.fetchImpl ?? fetch };
  const inventory = await collectInventory(ctx);
  if (!inventory.ok) {
    const checks: VerificationCheck[] = inventory.step === 'cm_channels' ? [{ key: 'cm_account', status: 'ok' }] : [];
    return refused(checks, inventory.step, inventory.failure);
  }

  let wabaId: string | null = null;
  let metaName: string | null = null;
  for (const channelRequestId of inventory.channelIds) {
    const business = await cmGet(ctx, channelPath(c, channelRequestId, '/businessaccount'));
    if (!business.ok || !isRecord(business.body)) continue;
    const facebookId = business.body['facebookId'];
    wabaId = typeof facebookId === 'string' || typeof facebookId === 'number' ? String(facebookId) : null;
    metaName = asString(business.body['metaName']);
    break;
  }

  return {
    ok: true,
    checks: [
      { key: 'cm_account', status: 'ok' },
      { key: 'cm_channels', status: 'ok', detail: `${inventory.channelIds.length} canal(aux), ${inventory.numbers.length} numéro(s)` },
    ],
    account_name: metaName ?? c.account_id,
    waba_id: wabaId,
    meta_app_id: null,
    token_expiry: null,
    numbers: inventory.numbers,
    skipped: inventory.skipped,
  };
}
