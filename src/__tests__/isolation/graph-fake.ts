/**
 * Faux Meta Graph de la suite d'isolation (lot R1) : il répond au vrai client Graph (`meta-graph.ts`, `meta-webhooks.ts`)
 * injecté par son `fetchImpl`, et enregistre chaque appel tel qu'il est parti (méthode, URL complète, en-têtes, corps).
 * Les assertions portent donc sur le code réel du client : un identifiant d'une autre organisation ou de l'environnement
 * glissé dans une URL, un paramètre ou un en-tête est vu.
 *
 * Comme Meta : un jeton de compte n'est accepté qu'avec l'`appsecret_proof` de son app et sur une WABA qui lui est
 * partagée ; un appel d'app n'est accepté qu'avec le jeton d'app `<app_id>|<secret>` en en-tête et son `appsecret_proof` ;
 * une inscription d'adresse
 * (`subscribed_apps` avec `override_callback_uri`, ou `subscriptions` de l'app) n'est acceptée qu'après un GET de
 * vérification réussi sur cette adresse (`verifier`), sinon erreur 2200.
 */
import { appSecretProof } from '../../whatsapp/meta-graph.js';

export interface GraphCall {
  method: string;
  /** URL complète, telle qu'envoyée (paramètres encodés). */
  url: string;
  /** Chemin sans la version (`/<id>` ou `/<id>/<arête>`). */
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

interface TokenGrant {
  appId: string;
  appSecret: string;
  wabas: Set<string>;
}

interface GraphWaba {
  numbers: Array<{ id: string; phone: string }>;
  /** Apps abonnées à la WABA, avec leur override (null : adresse de l'app). */
  subscriptions: Map<string, string | null>;
}

/** GET de vérification de Meta sur l'adresse inscrite : vrai si la réponse est 200 avec le challenge. */
export type GraphVerifier = (callbackUrl: string, verifyToken: string) => Promise<boolean>;

export interface FakeGraph {
  fetchImpl: typeof fetch;
  /** Tous les appels reçus, dans l'ordre. */
  readonly calls: GraphCall[];
  /** Appels en écriture (POST) seulement. */
  posts(): GraphCall[];
  clearCalls(): void;
  addToken(token: string, grant: { appId: string; appSecret: string; wabas: string[] }): void;
  addWaba(wabaId: string, numbers: Array<{ id: string; phone: string }>, subscriptions?: Array<[string, string | null]>): void;
  addApp(appId: string, appSecret: string, callbackUrl: string | null): void;
  /** Abonnements de la WABA (app vers override), copie. */
  subscriptionsOf(wabaId: string): Array<[string, string | null]>;
  /** Adresse du webhook de l'app (null : aucune). */
  appCallback(appId: string): string | null;
  /** GET de vérification de Meta ; posé par le harnais une fois l'app montée. */
  verifier: GraphVerifier;
  /** Appelé pendant une inscription, avant le GET de vérification de Meta (raccordement en attente). */
  duringInscription: ((callbackUrl: string, verifyToken: string) => Promise<void>) | null;
}

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenRefused = (): Response => reply(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
const proofRefused = (): Response => reply(400, { error: { message: 'Invalid appsecret_proof provided in the API argument', code: 100 } });
const notShared = (): Response => reply(400, { error: { message: 'Unsupported get request', code: 100, error_subcode: 33 } });
const callbackFailed = (): Response => reply(400, { error: { message: 'Callback verification failed', code: 2200 } });

export function createFakeGraph(): FakeGraph {
  const calls: GraphCall[] = [];
  const tokens = new Map<string, TokenGrant>();
  const wabas = new Map<string, GraphWaba>();
  const apps = new Map<string, { appSecret: string; callbackUrl: string | null }>();

  const graph: FakeGraph = {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    clearCalls: () => { calls.length = 0; },
    addToken: (token, grant) => { tokens.set(token, { appId: grant.appId, appSecret: grant.appSecret, wabas: new Set(grant.wabas) }); },
    addWaba: (wabaId, numbers, subscriptions = []) => { wabas.set(wabaId, { numbers, subscriptions: new Map(subscriptions) }); },
    addApp: (appId, appSecret, callbackUrl) => { apps.set(appId, { appSecret, callbackUrl }); },
    subscriptionsOf: (wabaId) => [...(wabas.get(wabaId)?.subscriptions.entries() ?? [])],
    appCallback: (appId) => apps.get(appId)?.callbackUrl ?? null,
    verifier: async () => false,
    duringInscription: null,
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href);
      const method = init?.method ?? 'GET';
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
      const query: Record<string, string> = {};
      url.searchParams.forEach((value, key) => { query[key] = value; });
      const segments = url.pathname.split('/').filter((s) => s.length > 0).slice(1).map(decodeURIComponent);
      const path = `/${segments.join('/')}`;
      calls.push({ method, url: href, path, query, headers, body: typeof init?.body === 'string' ? init.body : '' });
      const [id = '', edge] = segments;

      const inscribe = async (callbackUrl: string, verifyToken: string): Promise<boolean> => {
        if (graph.duringInscription) await graph.duringInscription(callbackUrl, verifyToken);
        return graph.verifier(callbackUrl, verifyToken);
      };

      // Appels de l'app : jeton d'app dans l'en-tête avec son appsecret_proof (« Clé requise »), jamais dans l'URL ni un
      // jeton de compte (relecture finale R1 FR-I3).
      if (edge === 'subscriptions') {
        const app = apps.get(id);
        const appToken = `${id}|${app?.appSecret ?? ''}`;
        if (!app || headers['authorization'] !== `Bearer ${appToken}` || query['access_token'] !== undefined) return tokenRefused();
        if (query['appsecret_proof'] !== appSecretProof(appToken, app.appSecret)) return proofRefused();
        if (method === 'GET') {
          return reply(200, { data: app.callbackUrl === null ? [] : [{ object: 'whatsapp_business_account', callback_url: app.callbackUrl, active: true }] });
        }
        const callbackUrl = query['callback_url'] ?? '';
        if (query['object'] !== 'whatsapp_business_account' || !(await inscribe(callbackUrl, query['verify_token'] ?? ''))) return callbackFailed();
        app.callbackUrl = callbackUrl;
        return reply(200, { success: true });
      }

      // Appels du compte : jeton du compte et appsecret_proof de son app.
      const bearer = headers['authorization']?.replace(/^Bearer /, '') ?? '';
      const grant = tokens.get(bearer);
      if (!grant) return tokenRefused();
      if (query['appsecret_proof'] !== appSecretProof(bearer, grant.appSecret)) return proofRefused();
      if (id === 'debug_token') {
        if (query['input_token'] !== bearer) return tokenRefused();
        return reply(200, { data: { app_id: grant.appId, is_valid: true, expires_at: 0 } });
      }
      const waba = wabas.get(id);
      if (!waba || !grant.wabas.has(id)) return notShared();
      if (edge === undefined && method === 'GET') return reply(200, { id, name: `Compte ${id}` });
      if (edge === 'phone_numbers' && method === 'GET') {
        return reply(200, { data: waba.numbers.map((n) => ({ id: n.id, display_phone_number: n.phone, verified_name: n.phone, status: 'CONNECTED', quality_rating: 'GREEN' })) });
      }
      if (edge === 'subscribed_apps' && method === 'GET') {
        return reply(200, {
          data: [...waba.subscriptions.entries()].map(([appId, override]) => ({
            whatsapp_business_api_data: { id: appId }, ...(override === null ? {} : { override_callback_uri: override }),
          })),
        });
      }
      if (edge === 'subscribed_apps' && method === 'POST') {
        const override = query['override_callback_uri'];
        if (override !== undefined && !(await inscribe(override, query['verify_token'] ?? ''))) return callbackFailed();
        waba.subscriptions.set(grant.appId, override ?? null);
        return reply(200, { success: true });
      }
      return reply(400, { error: { message: 'Unknown path', code: 100 } });
    }) as typeof fetch,
  };
  return graph;
}

/** Texte d'un appel où chercher une fuite : URL telle qu'envoyée et décodée, paramètres, en-têtes et corps. */
export function graphCallText(call: GraphCall): string {
  let decoded = call.url;
  try { decoded = decodeURIComponent(call.url); } catch { decoded = call.url; }
  return JSON.stringify({ url: call.url, decoded, query: call.query, headers: call.headers, body: call.body });
}
