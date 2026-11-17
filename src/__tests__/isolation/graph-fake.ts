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
 *
 * Lot R2a : profil WhatsApp d'un numéro (`/<PN>/whatsapp_business_profile`, lecture et écriture), envoi de la photo
 * (`/<APP_ID>/uploads` puis la session `upload:…`, en `Authorization: OAuth <jeton>` et sans `appsecret_proof`), demande
 * de nom (`POST /<PN>` avec `new_display_name`), réenregistrement (`POST /<PN>/register` avec le code), portefeuille de la
 * WABA (`owner_business_info`) et champs du nom dans la liste des numéros. Comme Meta : un appel sur un numéro n'est
 * accepté qu'avec le jeton d'une app à qui la WABA du numéro est partagée, et son `appsecret_proof` ; une session d'envoi
 * et une photo envoyée n'appartiennent qu'à l'app du jeton qui les a ouvertes.
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

/** Numéro d'une WABA chez le faux Meta ; les champs facultatifs absents ne sont pas déclarés dans la liste (lot R1). */
export interface GraphNumber {
  id: string;
  phone: string;
  /** `verified_name` : le numéro lui-même par défaut. */
  verifiedName?: string;
  nameStatus?: string;
  newNameStatus?: string;
  newDisplayName?: string;
  pinEnabled?: boolean;
  /** Code de vérification en deux étapes attendu au réenregistrement ; absent : tout code est accepté. */
  pin?: string;
  /** `new_name_status` donné à une nouvelle demande de nom ; PENDING_REVIEW par défaut. */
  nameDecision?: string;
}

/** Profil WhatsApp d'un numéro chez le faux Meta, tel que Meta le rend. */
export type GraphProfile = Record<string, unknown>;

interface GraphWaba {
  numbers: GraphNumber[];
  /** Apps abonnées à la WABA, avec leur override (null : adresse de l'app). */
  subscriptions: Map<string, string | null>;
  /** Portefeuille propriétaire (`owner_business_info`) ; null : Meta ne le donne pas. */
  owner: { id: string; name: string } | null;
}

interface UploadSession {
  appId: string;
  sig: string;
  length: number;
  type: string;
}

/** GET de vérification de Meta sur l'adresse inscrite : vrai si la réponse est 200 avec le challenge. */
export type GraphVerifier = (callbackUrl: string, verifyToken: string) => Promise<boolean>;

export interface FakeGraph {
  fetchImpl: typeof fetch;
  /** Tous les appels reçus, dans l'ordre. */
  readonly calls: GraphCall[];
  /** Appels en écriture (POST et DELETE) seulement. */
  posts(): GraphCall[];
  clearCalls(): void;
  addToken(token: string, grant: { appId: string; appSecret: string; wabas: string[] }): void;
  addWaba(wabaId: string, numbers: GraphNumber[], subscriptions?: Array<[string, string | null]>): void;
  /** Portefeuille propriétaire de la WABA, rendu par `owner_business_info` (lot R2a). */
  setOwnerBusiness(wabaId: string, owner: { id: string; name: string } | null): void;
  /** Numéro tel que le faux Meta le tient (objet vivant : le modifier change ce que Meta déclare). */
  numberOf(numberId: string): GraphNumber | undefined;
  /** Profil WhatsApp du numéro (objet vivant). */
  profileOf(numberId: string): GraphProfile;
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
const invalidParameter = (what: string): Response => reply(400, { error: { message: `(#100) Invalid parameter ${what}`, code: 100 } });
const hmacFailed = (): Response => reply(400, { error: { message: 'HMAC check failed', code: 1 } });
const pinMismatch = (): Response => reply(400, { error: { message: 'Two step verification PIN Mismatch', code: 133005 } });

/** Champs du profil qu'une écriture peut changer (`whatsapp_business_profile`). */
const PROFILE_WRITABLE = ['about', 'address', 'description', 'email', 'websites', 'vertical'] as const;
/** `new_name_status` d'un nom approuvé, à appliquer par réenregistrement (essai R2a §1). */
const NAME_APPROVED = new Set(['APPROVED', 'AVAILABLE_WITHOUT_REVIEW']);

function jsonBody(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function listedNumber(n: GraphNumber): Record<string, unknown> {
  return {
    id: n.id, display_phone_number: n.phone, verified_name: n.verifiedName ?? n.phone, status: 'CONNECTED', quality_rating: 'GREEN',
    ...(n.nameStatus !== undefined ? { name_status: n.nameStatus } : {}),
    ...(n.newNameStatus !== undefined ? { new_name_status: n.newNameStatus } : {}),
    ...(n.newDisplayName !== undefined ? { new_display_name: n.newDisplayName } : {}),
    ...(n.pinEnabled !== undefined ? { is_pin_enabled: n.pinEnabled } : {}),
  };
}

export function createFakeGraph(): FakeGraph {
  const calls: GraphCall[] = [];
  const tokens = new Map<string, TokenGrant>();
  const wabas = new Map<string, GraphWaba>();
  const apps = new Map<string, { appSecret: string; callbackUrl: string | null }>();
  const profiles = new Map<string, GraphProfile>();
  const sessions = new Map<string, UploadSession>();
  /** Photos envoyées : handle vers l'app du jeton qui a ouvert la session. */
  const handles = new Map<string, string>();
  let uploadCount = 0;

  const ownerOfNumber = (numberId: string): { wabaId: string; number: GraphNumber } | undefined => {
    for (const [wabaId, waba] of wabas) {
      const number = waba.numbers.find((n) => n.id === numberId);
      if (number) return { wabaId, number };
    }
    return undefined;
  };
  const profileOf = (numberId: string): GraphProfile => {
    let profile = profiles.get(numberId);
    if (profile === undefined) {
      profile = { about: 'Bonjour', vertical: 'OTHER' };
      profiles.set(numberId, profile);
    }
    return profile;
  };

  const graph: FakeGraph = {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST' || c.method === 'DELETE'),
    clearCalls: () => { calls.length = 0; },
    addToken: (token, grant) => { tokens.set(token, { appId: grant.appId, appSecret: grant.appSecret, wabas: new Set(grant.wabas) }); },
    addWaba: (wabaId, numbers, subscriptions = []) => {
      wabas.set(wabaId, { numbers: numbers.map((n) => ({ ...n })), subscriptions: new Map(subscriptions), owner: wabas.get(wabaId)?.owner ?? null });
    },
    setOwnerBusiness: (wabaId, owner) => {
      const waba = wabas.get(wabaId);
      if (!waba) throw new Error(`[FakeGraph] WABA inconnue : ${wabaId}`);
      waba.owner = owner;
    },
    numberOf: (numberId) => ownerOfNumber(numberId)?.number,
    profileOf,
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
      const rawBody = init?.body;
      const bytes = rawBody instanceof Uint8Array ? rawBody : null;
      const body = typeof rawBody === 'string' ? rawBody : bytes !== null ? `<${bytes.length} octets>` : '';
      calls.push({ method, url: href, path, query, headers, body });
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

      // Envoi du fichier dans une session (essai R2a §4, étape 2) : `Authorization: OAuth <jeton>`, sans appsecret_proof
      // (la session porte sa signature), jeton d'une app qui est celle de la session.
      if (id.startsWith('upload:') && edge === undefined) {
        const session = sessions.get(id);
        const oauth = headers['authorization']?.startsWith('OAuth ') === true ? headers['authorization'].slice('OAuth '.length) : '';
        const owner = tokens.get(oauth);
        if (!owner) return tokenRefused();
        if (query['appsecret_proof'] !== undefined) return hmacFailed();
        if (method !== 'POST' || !session || session.appId !== owner.appId || query['sig'] !== session.sig) return notShared();
        if (headers['file_offset'] !== '0' || headers['content-type'] !== session.type || bytes === null || bytes.length !== session.length) {
          return invalidParameter('file');
        }
        uploadCount += 1;
        const handle = `4::HANDLE-${owner.appId}-${uploadCount}`;
        handles.set(handle, owner.appId);
        return reply(200, { h: handle });
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
      // Ouverture d'une session d'envoi (essai R2a §4, étape 1) : seulement sur l'app du jeton.
      if (edge === 'uploads') {
        if (method !== 'POST' || id !== grant.appId) return notShared();
        const length = Number(query['file_length']);
        const type = query['file_type'] ?? '';
        if (!Number.isSafeInteger(length) || length <= 0 || !['image/jpeg', 'image/png'].includes(type)) return invalidParameter('file_type');
        uploadCount += 1;
        const sessionId = `upload:SESSION-${grant.appId}-${uploadCount}`;
        const sig = `SIG-${uploadCount}`;
        sessions.set(sessionId, { appId: grant.appId, sig, length, type });
        return reply(200, { id: `${sessionId}?sig=${sig}` });
      }
      // Appels sur un numéro : la WABA du numéro doit être partagée avec l'app du jeton.
      const numberOwner = wabas.has(id) ? undefined : ownerOfNumber(id);
      if (numberOwner !== undefined) {
        if (!grant.wabas.has(numberOwner.wabaId)) return notShared();
        const number = numberOwner.number;
        const json = method === 'POST' ? jsonBody(body) : null;
        if (edge === 'whatsapp_business_profile' && method === 'GET') return reply(200, { data: [{ ...profileOf(id), messaging_product: 'whatsapp' }] });
        if (edge === 'whatsapp_business_profile' && method === 'POST') {
          if (json === null || json['messaging_product'] !== 'whatsapp') return invalidParameter('messaging_product');
          const profile = profileOf(id);
          const handle = json['profile_picture_handle'];
          if (handle !== undefined) {
            if (typeof handle !== 'string' || handles.get(handle) !== grant.appId) return invalidParameter('profile_picture_handle');
            profile['profile_picture_url'] = `https://pps.whatsapp.net/v/${encodeURIComponent(handle)}`;
          }
          for (const key of PROFILE_WRITABLE) if (json[key] !== undefined) profile[key] = json[key];
          return reply(200, { success: true });
        }
        if (edge === undefined && method === 'POST') {
          const requested = json?.['new_display_name'];
          if (typeof requested !== 'string' || requested.length === 0) return invalidParameter('new_display_name');
          number.newDisplayName = requested;
          number.newNameStatus = number.nameDecision ?? 'PENDING_REVIEW';
          return reply(200, { success: true });
        }
        if (edge === 'register' && method === 'POST') {
          if (json === null || json['messaging_product'] !== 'whatsapp' || typeof json['pin'] !== 'string') return invalidParameter('pin');
          if (number.pin !== undefined && json['pin'] !== number.pin) return pinMismatch();
          if (number.newDisplayName !== undefined && NAME_APPROVED.has(number.newNameStatus ?? '')) {
            number.verifiedName = number.newDisplayName;
            delete number.newDisplayName;
            number.newNameStatus = 'NONE';
          }
          return reply(200, { success: true });
        }
        return reply(400, { error: { message: 'Unknown path', code: 100 } });
      }
      const waba = wabas.get(id);
      if (!waba || !grant.wabas.has(id)) return notShared();
      if (edge === undefined && method === 'GET') {
        const ownerAsked = (query['fields'] ?? '').split(',').includes('owner_business_info');
        return reply(200, { id, name: `Compte ${id}`, ...(ownerAsked && waba.owner !== null ? { owner_business_info: waba.owner } : {}) });
      }
      if (edge === 'phone_numbers' && method === 'GET') return reply(200, { data: waba.numbers.map(listedNumber) });
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
      // Désabonnement de l'app du jeton (audit des décisions R1, F-2) : seule l'entrée de cette app est retirée.
      if (edge === 'subscribed_apps' && method === 'DELETE') {
        waba.subscriptions.delete(grant.appId);
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
