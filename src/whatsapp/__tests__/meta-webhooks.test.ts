// Client Graph des webhooks et de l'état du compte (lot R1, tâche 3) : lectures, inscriptions et retraits.
// Le faux Meta rejoue les formes observées en réel le 12 nov. 2026
// (docs/superpowers/research/2026-11-12-essai-raccordement-automatique.md).
import { describe, expect, it } from 'vitest';
import { appSecretProof } from '../meta-graph.js';
import type { MetaManualCredentials } from '../meta-graph.js';
import {
  APP_WEBHOOK_FIELDS, clearWabaOverride, readAppWebhook, readMetaHealth, readWabaOverride, setAppWebhook, setWabaOverride,
} from '../meta-webhooks.js';

const creds: MetaManualCredentials = {
  waba_id: '1122051030798254',
  access_token: 'EAAGsecretTOKENvalue1234567890',
  app_secret: 'appsecretvalueabcdef',
};
const APP_ID = 'APP-1';
const KEY = 'cleSecreteDeLUrlDeWebhook0123456789abcdefghi';
const CALLBACK = `https://wabagent.example.com/webhook/meta/${KEY}`;
const VERIFY = 'verify-token-propre-au-compte-0123456789';
const APP_TOKEN = `${APP_ID}|${creds.app_secret}`;

interface Call { method: string; url: URL; headers: Record<string, string> }

interface Options {
  /** Entrées de GET subscribed_apps ; par défaut : l'app du jeton, sans override. */
  entries?: Array<Record<string, unknown>>;
  postStatus?: number;
  postBody?: unknown;
  /** Réponse du POST subscribed_apps : échec de vérification du rappel chez Meta. */
  callbackFailure?: boolean;
  appSubscriptions?: Array<Record<string, unknown>>;
  appPostStatus?: number;
  appPostBody?: unknown;
  /** Meta répète l'URL, le jeton de vérification et le jeton d'app dans son message d'erreur. */
  echo?: boolean;
  health?: 'limited' | 'down';
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function graph(options: Options = {}): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers });
    const path = url.pathname;
    if (path.endsWith(`/${creds.waba_id}/subscribed_apps`)) {
      if (method === 'POST') {
        if (options.callbackFailure) {
          const echoed = options.echo ? ` url=${CALLBACK} token=${VERIFY} app=${APP_TOKEN} ${'q'.repeat(400)}` : '';
          return json(400, { error: { message: `(#2200) Callback verification failed with the following errors: HTTP Status Code = 404${echoed}`, type: 'OAuthException', code: 2200 } });
        }
        return json(options.postStatus ?? 200, options.postBody ?? { success: true });
      }
      return json(200, { data: options.entries ?? [{ whatsapp_business_api_data: { id: APP_ID, name: 'WABAGENT Dev' } }] });
    }
    if (path.endsWith(`/${APP_ID}/subscriptions`)) {
      if (method === 'POST') {
        if (options.echo) return json(400, { error: { message: `Bad request token=${APP_TOKEN} secret=${creds.app_secret} url=${CALLBACK} verify=${VERIFY}`, code: 100 } });
        return json(options.appPostStatus ?? 200, options.appPostBody ?? { success: true });
      }
      return json(200, { data: options.appSubscriptions ?? [] });
    }
    if (path.endsWith(`/${creds.waba_id}`)) {
      if (options.health === 'down') return json(500, { error: { message: 'boom', code: 2 } });
      return json(200, {
        id: creds.waba_id,
        health_status: { can_send_message: 'BLOCKED', entities: [{ entity_type: 'WABA', id: creds.waba_id, can_send_message: 'BLOCKED', errors: [{ error_code: 141000, error_description: 'Compte bloqué', possible_solution: 'x' }] }] },
        business_verification_status: 'verified',
      });
    }
    return json(404, { error: { message: 'inattendu', code: 100 } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('readWabaOverride', () => {
  // spec R1 §8 : relecture sur l'entrée de l'app du jeton seulement (portefeuille partagé)
  it("relecture : override lu sur l'entrée de l'app du jeton seulement", async () => {
    const g = graph({ entries: [
      { whatsapp_business_api_data: { id: 'AUTRE-APP', name: 'Autre' }, override_callback_uri: 'https://autre.example.com/hook' },
      { whatsapp_business_api_data: { id: APP_ID, name: 'WABAGENT Dev' }, override_callback_uri: CALLBACK },
    ] });
    expect(await readWabaOverride(creds, APP_ID, { fetchImpl: g.fetchImpl })).toEqual({ ok: true, subscribed: true, override: CALLBACK });
    const lecture = g.calls[0];
    expect(lecture.method).toBe('GET');
    expect(lecture.url.pathname).toBe(`/v26.0/${creds.waba_id}/subscribed_apps`);
  });

  it("l'override d'une autre app n'est jamais celui de l'app du jeton", async () => {
    const g = graph({ entries: [
      { whatsapp_business_api_data: { id: 'AUTRE-APP', name: 'Autre' }, override_callback_uri: 'https://autre.example.com/hook' },
      { whatsapp_business_api_data: { id: APP_ID } },
    ] });
    expect(await readWabaOverride(creds, APP_ID, { fetchImpl: g.fetchImpl })).toEqual({ ok: true, subscribed: true, override: null });
  });

  it("app du jeton absente : non abonnée, aucun override (même si une autre app en porte un)", async () => {
    const g = graph({ entries: [{ whatsapp_business_api_data: { id: 'AUTRE-APP' }, override_callback_uri: 'https://autre.example.com/hook' }] });
    expect(await readWabaOverride(creds, APP_ID, { fetchImpl: g.fetchImpl })).toEqual({ ok: true, subscribed: false, override: null });
  });

  it('lecture en échec : failure transitoire sur 5xx', async () => {
    const fetchImpl = (async () => json(503, { error: { message: 'indisponible', code: 2 } })) as typeof fetch;
    expect(await readWabaOverride(creds, APP_ID, { fetchImpl })).toMatchObject({ ok: false, failure: { kind: 'other', transient: true } });
  });
});

describe('setWabaOverride', () => {
  it('setWabaOverride envoie override_callback_uri et verify_token', async () => {
    const g = graph();
    expect(await setWabaOverride(creds, { callbackUrl: CALLBACK, verifyToken: VERIFY }, { fetchImpl: g.fetchImpl })).toEqual({ ok: true });
    const posts = g.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url.pathname).toBe(`/v26.0/${creds.waba_id}/subscribed_apps`);
    expect(posts[0].url.searchParams.get('override_callback_uri')).toBe(CALLBACK);
    expect(posts[0].url.searchParams.get('verify_token')).toBe(VERIFY);
    expect(posts[0].url.searchParams.get('appsecret_proof')).toBe(appSecretProof(creds.access_token, creds.app_secret));
    expect(posts[0].headers['authorization']).toBe(`Bearer ${creds.access_token}`);
  });

  it('2200 donne callback_failed, non transitoire', async () => {
    const g = graph({ callbackFailure: true });
    const r = await setWabaOverride(creds, { callbackUrl: CALLBACK, verifyToken: VERIFY }, { fetchImpl: g.fetchImpl });
    expect(r).toMatchObject({ ok: false, failure: { kind: 'callback_failed' } });
    expect(r.ok === false && r.failure.kind === 'callback_failed' && r.failure.provider_text).toContain('Callback verification failed');
    expect(r.ok === false && 'transient' in r.failure).toBe(false);
  });

  it("2200 : le texte de Meta qui répète l'adresse, le jeton de vérification et les identifiants est masqué et borné", async () => {
    const g = graph({ callbackFailure: true, echo: true });
    const r = await setWabaOverride(creds, { callbackUrl: CALLBACK, verifyToken: VERIFY }, { fetchImpl: g.fetchImpl });
    const serialized = JSON.stringify(r);
    for (const secret of [CALLBACK, KEY, VERIFY, APP_TOKEN, creds.app_secret, creds.access_token]) expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[masqué]');
    expect(r.ok === false && r.failure.kind === 'callback_failed' ? (r.failure.provider_text ?? '').length : 0).toBeLessThanOrEqual(200);
  });

  it("réponse 200 sans success: true : échec other, aucun texte de Meta", async () => {
    for (const postBody of [{}, { success: false }, { success: 'true' }]) {
      const r = await setWabaOverride(creds, { callbackUrl: CALLBACK, verifyToken: VERIFY }, { fetchImpl: graph({ postBody }).fetchImpl });
      expect(r).toMatchObject({ ok: false, failure: { kind: 'other', message: 'Inscription du webhook non confirmée par Meta' } });
      expect(r.ok === false && r.failure.kind === 'other' && r.failure.provider_text).toBeFalsy();
    }
  });

  it('adresse de plus de 200 caractères : refusée avant tout appel', async () => {
    const g = graph();
    const long = `https://wabagent.example.com/${'a'.repeat(190)}`;
    expect(long.length).toBeGreaterThan(200);
    expect(await setWabaOverride(creds, { callbackUrl: long, verifyToken: VERIFY }, { fetchImpl: g.fetchImpl })).toMatchObject({ ok: false, failure: { kind: 'other' } });
    expect(g.calls).toHaveLength(0);
    // 200 caractères exactement : accepté
    const exact = `https://wabagent.example.com/${'a'.repeat(200 - 'https://wabagent.example.com/'.length)}`;
    expect(exact).toHaveLength(200);
    expect(await setWabaOverride(creds, { callbackUrl: exact, verifyToken: VERIFY }, { fetchImpl: g.fetchImpl })).toEqual({ ok: true });
  });

  it('jeton refusé : token_invalid', async () => {
    const fetchImpl = (async () => json(401, { error: { message: 'Invalid OAuth access token', code: 190 } })) as typeof fetch;
    expect(await setWabaOverride(creds, { callbackUrl: CALLBACK, verifyToken: VERIFY }, { fetchImpl })).toMatchObject({ ok: false, failure: { kind: 'token_invalid' } });
  });
});

describe('clearWabaOverride', () => {
  it('clearWabaOverride : POST sans paramètre d\'override', async () => {
    const g = graph();
    expect(await clearWabaOverride(creds, { fetchImpl: g.fetchImpl })).toEqual({ ok: true });
    const posts = g.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url.pathname).toBe(`/v26.0/${creds.waba_id}/subscribed_apps`);
    expect([...posts[0].url.searchParams.keys()]).toEqual(['appsecret_proof']);
  });

  it('success absent : échec other', async () => {
    expect(await clearWabaOverride(creds, { fetchImpl: graph({ postBody: { success: false } }).fetchImpl })).toMatchObject({ ok: false, failure: { kind: 'other' } });
  });
});

describe('readAppWebhook', () => {
  const app = { appId: APP_ID, appSecret: creds.app_secret };

  it("lit l'entrée whatsapp_business_account, avec le jeton d'app et sans appsecret_proof", async () => {
    const g = graph({ appSubscriptions: [
      { object: 'page', callback_url: 'https://page.example.com/x', active: true, fields: [] },
      { object: 'whatsapp_business_account', callback_url: 'https://app.example.com/webhook', active: true, fields: [{ name: 'messages', version: 'v26.0' }] },
    ] });
    expect(await readAppWebhook(app, { fetchImpl: g.fetchImpl })).toEqual({ ok: true, callbackUrl: 'https://app.example.com/webhook' });
    expect(g.calls[0].method).toBe('GET');
    expect(g.calls[0].url.pathname).toBe(`/v26.0/${APP_ID}/subscriptions`);
    expect(g.calls[0].url.searchParams.get('access_token')).toBe(APP_TOKEN);
    expect(g.calls[0].url.searchParams.has('appsecret_proof')).toBe(false);
    expect(g.calls[0].headers['authorization']).toBeUndefined();
  });

  it('aucune entrée whatsapp_business_account : callbackUrl null', async () => {
    expect(await readAppWebhook(app, { fetchImpl: graph({ appSubscriptions: [] }).fetchImpl })).toEqual({ ok: true, callbackUrl: null });
  });
});

describe('setAppWebhook', () => {
  const app = { appId: APP_ID, appSecret: creds.app_secret };
  const target = { callbackUrl: CALLBACK, verifyToken: VERIFY, fields: APP_WEBHOOK_FIELDS };

  it("setAppWebhook utilise le jeton d'app et jamais le jeton du compte", async () => {
    const g = graph();
    expect(await setAppWebhook(app, target, { fetchImpl: g.fetchImpl })).toEqual({ ok: true });
    const call = g.calls[0];
    expect(call.method).toBe('POST');
    expect(call.url.pathname).toBe(`/v26.0/${APP_ID}/subscriptions`);
    expect(call.url.searchParams.get('access_token')).toBe(APP_TOKEN);
    expect(call.url.searchParams.get('object')).toBe('whatsapp_business_account');
    expect(call.url.searchParams.get('callback_url')).toBe(CALLBACK);
    expect(call.url.searchParams.get('verify_token')).toBe(VERIFY);
    expect(call.url.searchParams.get('fields')).toBe(APP_WEBHOOK_FIELDS.join(','));
    expect(call.url.searchParams.has('appsecret_proof')).toBe(false);
    expect(JSON.stringify([call.url.href, call.headers])).not.toContain(creds.access_token);
  });

  it("le jeton d'app n'apparaît pas dans provider_text", async () => {
    const g = graph({ echo: true });
    const r = await setAppWebhook(app, target, { fetchImpl: g.fetchImpl });
    expect(r.ok).toBe(false);
    const serialized = JSON.stringify(r);
    for (const secret of [APP_TOKEN, creds.app_secret, CALLBACK, KEY, VERIFY]) expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[masqué]');
  });

  it('success absent : échec other', async () => {
    expect(await setAppWebhook(app, target, { fetchImpl: graph({ appPostBody: {} }).fetchImpl })).toMatchObject({ ok: false, failure: { kind: 'other' } });
  });

  it('champs inscrits : les huit champs de la spec', () => {
    expect([...APP_WEBHOOK_FIELDS]).toEqual([
      'messages', 'account_alerts', 'account_update', 'account_review_update', 'phone_number_name_update',
      'phone_number_quality_update', 'message_template_status_update', 'security',
    ]);
  });
});

describe('readMetaHealth', () => {
  it("même lecture que la vérification : capacité bloquée, problème, vérification de l'entreprise", async () => {
    const g = graph();
    const health = await readMetaHealth(creds, { fetchImpl: g.fetchImpl });
    expect(g.calls[0].url.searchParams.get('fields')).toBe('health_status,business_verification_status');
    expect(health).toMatchObject({ can_send: 'blocked', business_verification: 'verified', issues: [{ code: 141000, text: 'Compte bloqué' }] });
    expect(health?.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('échec (5xx, délai, réseau) : null, jamais d\'erreur levée', async () => {
    expect(await readMetaHealth(creds, { fetchImpl: graph({ health: 'down' }).fetchImpl })).toBeNull();
    expect(await readMetaHealth(creds, { fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch })).toBeNull();
    expect(await readMetaHealth(creds, { fetchImpl: (async () => { throw new DOMException('t', 'TimeoutError'); }) as typeof fetch })).toBeNull();
  });
});
