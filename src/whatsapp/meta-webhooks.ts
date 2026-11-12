// Inscription des webhooks chez Meta et lecture de l'état du compte (lot R1, spec R1 §3).
// Trois surfaces : le webhook de la WABA (override de `subscribed_apps`, jeton du compte), le webhook de l'app Meta
// (`/<APP_ID>/subscriptions`, jeton d'app) et l'état du compte (`health_status`). Module autonome comme `meta-graph.ts` :
// aucune base de données, `fetch` injectable. Rien d'ici ne journalise : les textes renvoyés sont masqués et bornés, et ni
// l'adresse du webhook (elle contient la clé), ni le jeton de vérification, ni le jeton d'app ne sortent d'une erreur.

import type { MetaHealthView } from '@wabagent/contracts';
import {
  graphCall, graphUrl, makeAppContext, makeContext, META_HEALTH_FIELDS, readMetaHealthBody,
  type GraphContext, type GraphFailure, type MetaManualCredentials,
} from './meta-graph.js';
import { asString, isRecord } from './provider-common.js';
import type { ProviderClientOptions } from './provider-common.js';

export type { GraphFailure } from './meta-graph.js';

/**
 * Champs auxquels l'app Meta est abonnée pour le webhook de l'app : ceux que le moteur lit (spec R1 §5.4, audit des
 * décisions R1 N-2). `messages` (messages et statuts), `account_update` et `phone_number_*` (inventaire et état du compte,
 * `meta-events.ts`). L'écriture remplace l'abonnement de l'app pour cet objet.
 */
export const APP_WEBHOOK_FIELDS = [
  'messages', 'account_update', 'phone_number_name_update', 'phone_number_quality_update',
] as const;

/** `override_callback_uri` : 200 caractères au plus chez Meta. */
const MAX_CALLBACK_URL_LENGTH = 200;
const MESSAGE_CALLBACK_TOO_LONG = "L'adresse du webhook de WABAGENT dépasse la limite de 200 caractères de Meta";
const MESSAGE_REGISTRATION_UNCONFIRMED = 'Inscription du webhook non confirmée par Meta';
const WABA_OBJECT = 'whatsapp_business_account';

export type GraphOutcome = { ok: true } | { ok: false; failure: GraphFailure };

function wabaSubscribedApps(c: MetaManualCredentials): string {
  return `/${encodeURIComponent(c.waba_id)}/subscribed_apps`;
}

function appSubscriptions(appId: string): string {
  return `/${encodeURIComponent(appId)}/subscriptions`;
}

/**
 * Ce que Meta peut répéter dans un message d'erreur et qui ne doit jamais sortir : l'adresse inscrite (sa clé aussi, seule),
 * le jeton de vérification.
 */
function inscriptionSecrets(callbackUrl: string, verifyToken: string): string[] {
  let key: string | undefined;
  try { key = new URL(callbackUrl).pathname.split('/').filter((s) => s.length > 0).pop(); } catch { key = undefined; }
  return [callbackUrl, verifyToken, ...(key !== undefined && key.length >= 16 ? [key] : [])];
}

function withSecrets(ctx: GraphContext, extra: readonly string[]): GraphContext {
  return { ...ctx, secrets: [...ctx.secrets, ...extra] };
}

async function writeExpectingSuccess(ctx: GraphContext, method: 'POST' | 'DELETE', target: URL): Promise<GraphOutcome> {
  const result = await graphCall(ctx, method, target);
  if (!result.ok) return result;
  if (result.body['success'] !== true) {
    return { ok: false, failure: { kind: 'other', message: MESSAGE_REGISTRATION_UNCONFIRMED } };
  }
  return { ok: true };
}

/**
 * Relit l'abonnement de l'app du jeton sur la WABA et son éventuel `override_callback_uri`. Seule l'entrée de l'app du
 * jeton compte : une WABA peut être abonnée à d'autres apps (portefeuille partagé), dont l'override n'est pas le nôtre.
 */
export async function readWabaOverride(
  c: MetaManualCredentials, metaAppId: string, opts?: ProviderClientOptions,
): Promise<{ ok: true; subscribed: boolean; override: string | null } | { ok: false; failure: GraphFailure }> {
  const result = await graphCall(makeContext(c, opts), 'GET', graphUrl(wabaSubscribedApps(c)));
  if (!result.ok) return result;
  const data = Array.isArray(result.body['data']) ? result.body['data'] : [];
  for (const entry of data) {
    if (!isRecord(entry) || !isRecord(entry['whatsapp_business_api_data'])) continue;
    const id = entry['whatsapp_business_api_data']['id'];
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id) !== metaAppId) continue;
    return { ok: true, subscribed: true, override: asString(entry['override_callback_uri']) };
  }
  return { ok: true, subscribed: false, override: null };
}

/** Abonne l'app à la WABA avec notre adresse de rappel et notre jeton de vérification (override propre à la WABA). */
export async function setWabaOverride(
  c: MetaManualCredentials, target: { callbackUrl: string; verifyToken: string }, opts?: ProviderClientOptions,
): Promise<GraphOutcome> {
  if (target.callbackUrl.length > MAX_CALLBACK_URL_LENGTH) {
    return { ok: false, failure: { kind: 'other', message: MESSAGE_CALLBACK_TOO_LONG } };
  }
  const ctx = withSecrets(makeContext(c, opts), inscriptionSecrets(target.callbackUrl, target.verifyToken));
  return writeExpectingSuccess(ctx, 'POST', graphUrl(wabaSubscribedApps(c), {
    override_callback_uri: target.callbackUrl, verify_token: target.verifyToken,
  }));
}

/** Retire l'override de la WABA : l'abonnement est refait sans paramètre, l'adresse de rappel redevient celle de l'app. */
export async function clearWabaOverride(c: MetaManualCredentials, opts?: ProviderClientOptions): Promise<GraphOutcome> {
  return writeExpectingSuccess(makeContext(c, opts), 'POST', graphUrl(wabaSubscribedApps(c)));
}

/**
 * Désabonne l'app du jeton de la WABA (`DELETE /<WABA>/subscribed_apps`, jeton du compte) : plus aucun message de la
 * WABA ne passe par cette app, override compris. Audit des décisions R1, décision F-2 de François (12 nov. 2026) : au
 * retrait d'un compte, au remplacement vers une autre app (ancienne app) et au raccordement raté d'une app qui n'était pas
 * abonnée. Appel documenté par Meta, à rejouer en recette.
 */
export async function unsubscribeApp(c: MetaManualCredentials, opts?: ProviderClientOptions): Promise<GraphOutcome> {
  return writeExpectingSuccess(makeContext(c, opts), 'DELETE', graphUrl(wabaSubscribedApps(c)));
}

/** Adresse de rappel du webhook de l'app Meta pour `whatsapp_business_account`, null si aucune n'est inscrite. */
export async function readAppWebhook(
  app: { appId: string; appSecret: string }, opts?: ProviderClientOptions,
): Promise<{ ok: true; callbackUrl: string | null } | { ok: false; failure: GraphFailure }> {
  const result = await graphCall(makeAppContext(app, opts), 'GET', graphUrl(appSubscriptions(app.appId)));
  if (!result.ok) return result;
  const data = Array.isArray(result.body['data']) ? result.body['data'] : [];
  for (const entry of data) {
    if (isRecord(entry) && entry['object'] === WABA_OBJECT) return { ok: true, callbackUrl: asString(entry['callback_url']) };
  }
  return { ok: true, callbackUrl: null };
}

/** Inscrit le webhook de l'app Meta pour `whatsapp_business_account`, avec le jeton d'app. */
export async function setAppWebhook(
  app: { appId: string; appSecret: string },
  target: { callbackUrl: string; verifyToken: string; fields: readonly string[] },
  opts?: ProviderClientOptions,
): Promise<GraphOutcome> {
  const ctx = withSecrets(makeAppContext(app, opts), inscriptionSecrets(target.callbackUrl, target.verifyToken));
  return writeExpectingSuccess(ctx, 'POST', graphUrl(appSubscriptions(app.appId), {
    object: WABA_OBJECT, callback_url: target.callbackUrl, verify_token: target.verifyToken, fields: target.fields.join(','),
  }));
}

/** État du compte lu chez Meta (« Rafraîchir les numéros ») ; null sur tout échec ou si Meta ne renvoie pas les champs. */
export async function readMetaHealth(c: MetaManualCredentials, opts?: ProviderClientOptions): Promise<MetaHealthView | null> {
  const ctx = makeContext(c, opts);
  const result = await graphCall(ctx, 'GET', graphUrl(`/${encodeURIComponent(c.waba_id)}`, { fields: META_HEALTH_FIELDS }));
  return result.ok ? readMetaHealthBody(result.body, ctx.secrets) : null;
}

/**
 * Appels d'inscription des webhooks et lecture de l'état du compte, regroupés pour être injectés dans le service des comptes (tests : faux client
 * ou vrai client sur un `fetch` simulé). Mêmes signatures que les fonctions ci-dessus, sans les options.
 */
export interface MetaWebhookClient {
  readWabaOverride: (c: MetaManualCredentials, metaAppId: string) => ReturnType<typeof readWabaOverride>;
  setWabaOverride: (c: MetaManualCredentials, target: { callbackUrl: string; verifyToken: string }) => Promise<GraphOutcome>;
  clearWabaOverride: (c: MetaManualCredentials) => Promise<GraphOutcome>;
  unsubscribeApp: (c: MetaManualCredentials) => Promise<GraphOutcome>;
  readAppWebhook: (app: { appId: string; appSecret: string }) => ReturnType<typeof readAppWebhook>;
  setAppWebhook: (
    app: { appId: string; appSecret: string }, target: { callbackUrl: string; verifyToken: string; fields: readonly string[] },
  ) => Promise<GraphOutcome>;
  readMetaHealth: (c: MetaManualCredentials) => Promise<MetaHealthView | null>;
}

/** Client réel, sur le `fetch` donné (défaut : `fetch` global). */
export function createMetaWebhookClient(opts?: ProviderClientOptions): MetaWebhookClient {
  return {
    readWabaOverride: (c, metaAppId) => readWabaOverride(c, metaAppId, opts),
    setWabaOverride: (c, target) => setWabaOverride(c, target, opts),
    clearWabaOverride: (c) => clearWabaOverride(c, opts),
    unsubscribeApp: (c) => unsubscribeApp(c, opts),
    readAppWebhook: (app) => readAppWebhook(app, opts),
    setAppWebhook: (app, target) => setAppWebhook(app, target, opts),
    readMetaHealth: (c) => readMetaHealth(c, opts),
  };
}
