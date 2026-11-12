/**
 * Suite d'isolation « deux organisations », raccordement automatique du compte WhatsApp (lot R1, spec R1 §8). Tout passe
 * par le vrai chemin HTTP (API d'administration, route de webhook) et par le vrai client Graph (`meta-graph.ts`,
 * `meta-webhooks.ts`), injecté sur un Meta Graph simulé au niveau de `fetch` (graph-fake.ts) qui enregistre chaque appel
 * tel qu'il part : URL, paramètres, en-têtes. Le GET de vérification de Meta est fait sur la vraie route du moteur.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import request from 'supertest';
import { serve } from '../../test-support/http.js';
import { encryptJson } from '../../core/credentials/crypto.js';
import { hashWebhookKey } from '../../whatsapp/webhook-key.js';
import { appSecretProof } from '../../whatsapp/meta-graph.js';
import { keyOfMetaUrl } from '../../test-support/meta-webhooks-fake.js';
import { metaBody, signBody } from '../../test-support/whatsapp.js';
import {
  ACME_META_KEY, ACME_NUMBER, BETA_META_KEY, BETA_NUMBER, PNID_A, PNID_B, SECRET_A, SECRET_B, SHARED_CONTACT, TOKEN_A, TOKEN_B,
  WABA_A, WABA_B, isolationMetaUrl, setupTwoOrgs,
} from './harness.js';
import type { TwoOrgs } from './harness.js';
import { graphCallText, type GraphCall } from './graph-fake.js';

const CANNOT_CONNECT = 'Ce compte ne peut pas être raccordé. Contactez le support.';

/** Nouveau compte d'acme sur une app à elle (APP-A2), jamais vue par beta. */
const ACME_NEW = {
  wabaId: '1000000001', appId: 'APP-A2', phone: '+33100000011', pnid: 'PNID-A2',
  accessToken: 'EAAG-jeton-acme-nouveau-0123456789', appSecret: 'secret-app-acme-nouveau-0123456789',
};

/** Tout ce qui identifie beta chez Meta : présent dans un appel Graph fait pour acme, c'est une fuite. */
const BETA_MARKERS = [
  'beta', TOKEN_B, SECRET_B, WABA_B, 'APP-B', BETA_META_KEY, 'VERIF-B', PNID_B, BETA_NUMBER, appSecretProof(TOKEN_B, SECRET_B),
  isolationMetaUrl(BETA_META_KEY),
];

function expectNoMarker(what: string, call: GraphCall, markers: readonly string[]): void {
  const text = graphCallText(call);
  for (const marker of markers) expect([what, call.method, call.path, marker, text.includes(marker)]).toEqual([what, call.method, call.path, marker, false]);
}

/** Organisation propriétaire de la clé d'URL d'une adresse inscrite chez Meta. */
async function holderOfUrl(world: TwoOrgs, url: string): Promise<string | undefined> {
  return (await world.db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(keyOfMetaUrl(url))))?.client_id;
}

function seedAcmeNew(world: TwoOrgs): void {
  world.graph.addToken(ACME_NEW.accessToken, { appId: ACME_NEW.appId, appSecret: ACME_NEW.appSecret, wabas: [ACME_NEW.wabaId] });
  world.graph.addWaba(ACME_NEW.wabaId, [{ id: ACME_NEW.pnid, phone: ACME_NEW.phone }]);
  world.graph.addApp(ACME_NEW.appId, ACME_NEW.appSecret, null);
}

async function connectAcmeNew(world: TwoOrgs): Promise<request.Response> {
  return (await world.api('acme')).post('/whatsapp-accounts', {
    mode: 'meta_manual', name: 'Compte nouveau', waba_id: ACME_NEW.wabaId, access_token: ACME_NEW.accessToken, app_secret: ACME_NEW.appSecret,
  });
}

/** État de beta chez le Meta simulé : il ne bouge jamais pendant une opération d'acme. */
function betaAtMeta(world: TwoOrgs): unknown {
  return { waba: world.graph.subscriptionsOf(WABA_B), app: world.graph.appCallback('APP-B') };
}

describe('isolation entre deux organisations : raccordement automatique (vrai client Graph)', () => {
  let world: TwoOrgs;

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  // spec R1 §8 : « L'adresse inscrite chez Meta pour la WABA d'une organisation pointe vers le compte d'une autre » et
  // « Le webhook de l'app pointe vers un compte d'une autre organisation »
  it('raccordement de A : aucun appel Graph ne porte une URL ni un jeton de B', async () => {
    world = await setupTwoOrgs({ realGraph: true });
    seedAcmeNew(world);
    const betaBefore = betaAtMeta(world);

    const created = await connectAcmeNew(world);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ state: 'connected', webhooks: expect.objectContaining({ waba: 'ok', app: 'ok' }) });

    const calls = world.graph.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expectNoMarker('raccordement de A', call, BETA_MARKERS);
      // Seuls la WABA, l'app et le jeton du compte raccordé sont appelés.
      expect([call.path, [`/${ACME_NEW.wabaId}`, `/${ACME_NEW.wabaId}/phone_numbers`, `/${ACME_NEW.wabaId}/subscribed_apps`, '/debug_token', `/${ACME_NEW.appId}/subscriptions`].includes(call.path)])
        .toEqual([call.path, true]);
      if (call.path.endsWith('/subscriptions')) {
        // relecture finale R1 FR-I3 : jeton d'app en en-tête avec son appsecret_proof, jamais dans l'URL.
        expect([call.headers['authorization'], call.query['appsecret_proof'], call.query['access_token']])
          .toEqual([`Bearer ${ACME_NEW.appId}|${ACME_NEW.appSecret}`, appSecretProof(`${ACME_NEW.appId}|${ACME_NEW.appSecret}`, ACME_NEW.appSecret), undefined]);
        expect(call.url).not.toContain(ACME_NEW.appSecret);
      } else expect(call.headers['authorization']).toBe(`Bearer ${ACME_NEW.accessToken}`);
    }

    // Les deux écritures portent l'adresse du compte créé, dans l'organisation de la requête.
    const posts = world.graph.posts();
    expect(posts.map((c) => c.path)).toEqual([`/${ACME_NEW.wabaId}/subscribed_apps`, `/${ACME_NEW.appId}/subscriptions`]);
    const wabaUrl = posts[0]!.query['override_callback_uri']!;
    expect(posts[1]!.query['callback_url']).toBe(wabaUrl);
    const holder = await world.db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(keyOfMetaUrl(wabaUrl)));
    expect([holder?.client_id, holder?.id]).toEqual(['acme', created.body.id]);
    expect(world.graph.subscriptionsOf(ACME_NEW.wabaId)).toEqual([[ACME_NEW.appId, wabaUrl]]);
    expect(world.graph.appCallback(ACME_NEW.appId)).toBe(wabaUrl);
    // Rien n'a changé chez Meta pour beta.
    expect(betaAtMeta(world)).toEqual(betaBefore);
  });

  // spec R1 §8 : « GET de vérification servi pendant le raccordement avec le jeton d'un autre compte » et « Message traité
  // par un compte dont le raccordement n'est pas confirmé »
  it("vérification de B pendant un raccordement en attente de A : le GET de A refuse le jeton de B", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    seedAcmeNew(world);
    const server = await serve(world.app);
    const verify = async (key: string, token: string): Promise<number> => (await request(server).get(`/webhook/meta/${key}`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'defi' })).status;
    // Observé pendant l'inscription de l'adresse de la WABA, avant le GET de Meta : le compte n'existe pas encore en base.
    const seen: Array<Record<string, unknown>> = [];
    world.graph.duringInscription = async (callbackUrl, verifyToken) => {
      const key = keyOfMetaUrl(callbackUrl);
      const pending = (await world.db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(key))) === undefined;
      if (!pending) return;
      const payload = metaBody([{ wabaId: ACME_NEW.wabaId, displayPhone: ACME_NEW.phone, phoneNumberId: ACME_NEW.pnid, id: 'wamid.attente', from: SHARED_CONTACT }]);
      const raw = JSON.stringify(payload);
      const posted = await request(server).post(`/webhook/meta/${key}`).set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signBody(raw, ACME_NEW.appSecret)).send(raw);
      seen.push({
        pendingWithOwnToken: await verify(key, verifyToken),
        pendingWithBetaToken: await verify(key, 'VERIF-B'),
        pendingWithOtherAcmeToken: await verify(key, 'VERIF-A'),
        betaWithPendingToken: await verify(BETA_META_KEY, verifyToken),
        acmeWithPendingToken: await verify(ACME_META_KEY, verifyToken),
        signedPost: posted.status,
      });
    };

    const created = await connectAcmeNew(world);
    expect(created.status).toBe(201);
    // Contrôle positif : pendant la fenêtre, le GET avec le bon jeton en attente répond 200.
    expect(seen).toEqual([{
      pendingWithOwnToken: 200, pendingWithBetaToken: 403, pendingWithOtherAcmeToken: 403, betaWithPendingToken: 403, acmeWithPendingToken: 403, signedPost: 404,
    }]);
    // Le POST signé sur l'adresse en attente n'a eu aucun effet : ni LLM, ni envoi, ni session, ni réservation.
    await world.settle();
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NEW.phone, SHARED_CONTACT)).toBeUndefined();
    expect(await world.db.claimMessage(`${ACME_NEW.phone}:wamid.attente`, 0)).toBe(true);
    // Contrôle positif : chaque compte garde sa vérification avec son propre jeton.
    expect(await verify(BETA_META_KEY, 'VERIF-B')).toBe(200);
    expect(await verify(ACME_META_KEY, 'VERIF-A')).toBe(200);
  });

  // revue R1 ISO-I1 : le registre des vérifications attendues ne sert que le raccordement. Un compte retiré pendant une
  // réinscription (« Vérifier maintenant ») n'a plus de clé en base : le GET de Meta reçoit 403, Meta répond 2200 et
  // rien n'est inscrit, ni sur la WABA ni sur le webhook de l'app.
  it("compte retiré pendant « Vérifier maintenant » : GET de Meta refusé, aucune adresse inscrite chez Meta", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    seedAcmeNew(world);
    const acmeApi = await world.api('acme');
    const created = await connectAcmeNew(world);
    expect(created.status).toBe(201);
    const accountUrl = world.graph.subscriptionsOf(ACME_NEW.wabaId)[0]?.[1];
    expect(typeof accountUrl).toBe('string');
    // Adresse retirée chez Meta (WABA et app) : « Vérifier maintenant » va la réinscrire.
    world.graph.addWaba(ACME_NEW.wabaId, [{ id: ACME_NEW.pnid, phone: ACME_NEW.phone }], [[ACME_NEW.appId, null]]);
    world.graph.addApp(ACME_NEW.appId, ACME_NEW.appSecret, null);
    const verifyStatuses: number[] = [];
    let disconnected = false;
    world.graph.duringInscription = async (callbackUrl) => {
      if (!disconnected) {
        disconnected = true;
        expect(await world.db.disconnectWhatsAppAccount('acme', created.body.id)).toEqual({ ok: true });
      }
      verifyStatuses.push((await request(await serve(world.app)).get(callbackUrl.slice(callbackUrl.indexOf('/webhook/')))
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'jeton-quelconque', 'hub.challenge': 'x' })).status);
    };
    world.graph.clearCalls();

    const verified = await acmeApi.post(`/whatsapp-accounts/${created.body.id}/verify`);
    expect(verified.status).toBe(200);
    // Contrôle positif : la réinscription a bien été tentée pendant la déconnexion.
    expect(disconnected).toBe(true);
    const checks = (verified.body.checks as Array<{ key: string; status: string }>).filter((c) => c.key.startsWith('webhook_'));
    expect(checks.find((c) => c.key === 'webhook_waba')?.status).toBe('failed');
    expect(checks.some((c) => c.status === 'created')).toBe(false);
    // Rien d'inscrit chez Meta pour le compte retiré.
    expect(world.graph.subscriptionsOf(ACME_NEW.wabaId)).toEqual([[ACME_NEW.appId, null]]);
    expect(world.graph.appCallback(ACME_NEW.appId)).toBeNull();
    expect(world.graph.posts().filter((c) => c.path === `/${ACME_NEW.appId}/subscriptions`)).toEqual([]);
    expect(verifyStatuses.every((s) => s === 403)).toBe(true);
  });

  // spec R1 §8 : « Retrait à la déconnexion appliqué à la WABA d'une autre organisation » et « Le webhook de l'app pointe
  // vers un compte d'une autre organisation »
  it("déconnexion de A : aucun appel sur la WABA ni l'app de B", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    seedAcmeNew(world);
    // Second compte d'acme sur la même app (APP-A2) : le webhook de l'app doit passer sur lui, jamais sur beta.
    const second = { wabaId: '1000000002', accessToken: 'EAAG-jeton-acme-deux-0123456789' };
    world.graph.addToken(second.accessToken, { appId: ACME_NEW.appId, appSecret: ACME_NEW.appSecret, wabas: [second.wabaId] });
    world.graph.addWaba(second.wabaId, [{ id: 'PNID-A3', phone: '+33100000013' }]);
    const acmeApi = await world.api('acme');
    const first = await connectAcmeNew(world);
    expect(first.status).toBe(201);
    const firstUrl = world.graph.subscriptionsOf(ACME_NEW.wabaId)[0]?.[1];
    const created = await acmeApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: 'Compte deux', waba_id: second.wabaId, access_token: second.accessToken, app_secret: ACME_NEW.appSecret,
    });
    expect(created.status).toBe(201);
    const secondUrl = world.graph.subscriptionsOf(second.wabaId)[0]?.[1];
    expect(typeof firstUrl === 'string' && typeof secondUrl === 'string' && firstUrl !== secondUrl).toBe(true);
    expect(await holderOfUrl(world, secondUrl!)).toBe('acme');
    expect(world.graph.appCallback(ACME_NEW.appId)).toBe(firstUrl);

    const betaBefore = betaAtMeta(world);
    world.graph.clearCalls();
    const disconnected = await acmeApi.post(`/whatsapp-accounts/${first.body.id}/disconnect`);
    expect([disconnected.status, disconnected.body]).toEqual([200, { waba_cleanup: 'done', app_webhook: 'repointed', repointed_to: 'Compte deux' }]);

    const calls = world.graph.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expectNoMarker('déconnexion de A', call, BETA_MARKERS);
      expect([call.path, [`/${ACME_NEW.wabaId}/subscribed_apps`, `/${ACME_NEW.appId}/subscriptions`].includes(call.path)]).toEqual([call.path, true]);
    }
    // Un seul retrait, sur la WABA du compte déconnecté avec son jeton ; le webhook de l'app repointé sur l'autre compte d'acme.
    expect(world.graph.posts().map((c) => [c.path, c.headers['authorization'], c.query['override_callback_uri'] ?? c.query['callback_url'] ?? null]))
      .toEqual([
        [`/${ACME_NEW.wabaId}/subscribed_apps`, `Bearer ${ACME_NEW.accessToken}`, null],
        [`/${ACME_NEW.appId}/subscriptions`, `Bearer ${ACME_NEW.appId}|${ACME_NEW.appSecret}`, secondUrl],
      ]);
    expect(world.graph.subscriptionsOf(ACME_NEW.wabaId)).toEqual([[ACME_NEW.appId, null]]);
    expect(world.graph.subscriptionsOf(second.wabaId)).toEqual([[ACME_NEW.appId, secondUrl]]);
    expect(world.graph.appCallback(ACME_NEW.appId)).toBe(secondUrl);
    expect(betaAtMeta(world)).toEqual(betaBefore);
  });

  // spec R1 §8 : « Le webhook de l'app pointe vers un compte d'une autre organisation » (app partagée, choix 3)
  it("app partagée entre A et B : raccordement de B refusé avant toute écriture chez Meta", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    seedAcmeNew(world);
    expect((await connectAcmeNew(world)).status).toBe(201);
    // beta tient un jeton émis par l'app d'acme (APP-A2) et son secret, sur une WABA libre.
    const shared = { wabaId: '2000000001', accessToken: 'EAAG-jeton-beta-app-acme-0123456789' };
    world.graph.addToken(shared.accessToken, { appId: ACME_NEW.appId, appSecret: ACME_NEW.appSecret, wabas: [shared.wabaId] });
    world.graph.addWaba(shared.wabaId, [{ id: 'PNID-B2', phone: '+33100000012' }]);
    const betaApi = await world.api('beta');
    const betaAccountsBefore = (await betaApi.get('/whatsapp-accounts')).body;
    const acmeAppBefore = world.graph.appCallback(ACME_NEW.appId);
    const acmeWabaBefore = world.graph.subscriptionsOf(ACME_NEW.wabaId);
    world.graph.clearCalls();

    const refused = await betaApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: 'Compte partagé', waba_id: shared.wabaId, access_token: shared.accessToken, app_secret: ACME_NEW.appSecret,
    });
    expect([refused.status, refused.body.error?.message, refused.body.error?.reason]).toEqual([409, CANNOT_CONNECT, 'whatsapp_account.cannot_connect']);
    expect(JSON.stringify(refused.body)).not.toContain('acme');

    // Contrôle positif : la vérification (lecture seule) a bien eu lieu chez Meta, puis rien n'a été écrit.
    expect(world.graph.calls.some((c) => c.path === '/debug_token')).toBe(true);
    expect(world.graph.posts()).toEqual([]);
    expect(world.graph.subscriptionsOf(shared.wabaId)).toEqual([]);
    expect(world.graph.appCallback(ACME_NEW.appId)).toBe(acmeAppBefore);
    expect(world.graph.subscriptionsOf(ACME_NEW.wabaId)).toEqual(acmeWabaBefore);
    expect((await betaApi.get('/whatsapp-accounts')).body).toEqual(betaAccountsBefore);
  });

  // spec R1 §8 : « Écriture chez Meta avec les identifiants d'une autre organisation » : aucun repli `.env`, isolation
  // « agent sans identifiants » (audit 2.1) étendue aux nouveaux appels
  it('aucun appel Graph avec les identifiants .env', async () => {
    const ENV = {
      META_ACCESS_TOKEN: 'EAAG-ENV-PLATEFORME-0123456789', META_DEV_ACCESS_TOKEN: 'EAAG-ENV-DEV-0123456789',
      META_APP_SECRET: 'SECRET-ENV-PLATEFORME', META_APP_ID: 'APP-ENV-PLATEFORME', META_WABA_ID: '9999999999',
      META_PHONE_NUMBER_ID: 'PNID-ENV-PLATEFORME', META_VERIFY_TOKEN: 'VERIF-ENV-PLATEFORME', META_BUSINESS_ID: 'BUSINESS-ENV-PLATEFORME',
    };
    world = await setupTwoOrgs({ realGraph: true });
    // Posées après le montage : `close()` les retire (vi.unstubAllEnvs).
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const envMarkers = [...Object.values(ENV), appSecretProof(ENV.META_ACCESS_TOKEN, ENV.META_APP_SECRET), `${ENV.META_APP_ID}|${ENV.META_APP_SECRET}`];
    seedAcmeNew(world);
    const acmeApi = await world.api('acme');

    // Compte d'acme dont le contenu chiffré ne porte que la clé d'URL : rien ne doit partir chez Meta pour lui.
    const PARTIAL_WABA = '3000000001';
    const { secret, keyVersion } = encryptJson({ mode: 'meta_manual', webhook_key: 'cle-partielle-meta-r1' });
    const partial = await world.db.createWhatsAppAccountWithInventory({
      client_id: 'acme', name: 'Partiel', mode: 'meta_manual', provider_account_id: PARTIAL_WABA, waba_id: PARTIAL_WABA,
      meta_app_id: 'APP-A', secret_encrypted: secret, key_version: keyVersion, webhook_key_hash: hashWebhookKey('cle-partielle-meta-r1'),
      token_expiry: null, last_verified_at: null,
    }, []);
    if (!partial.ok) throw new Error('compte partiel refusé');

    const created = await connectAcmeNew(world);
    expect(created.status).toBe(201);
    const acmeId = world.accounts.acme.account.id;
    expect((await acmeApi.post(`/whatsapp-accounts/${acmeId}/verify`)).status).toBe(200);
    expect((await acmeApi.post(`/whatsapp-accounts/${acmeId}/refresh-numbers`)).status).toBe(200);
    const statuses: Array<[string, number, unknown]> = [];
    for (const action of ['verify', 'refresh-numbers', 'app-webhook', 'disconnect']) {
      const res = await acmeApi.post(`/whatsapp-accounts/${partial.account.id}/${action}`);
      statuses.push([action, res.status, res.body.error?.reason ?? null]);
    }
    // Secrets illisibles : la vérification répond la vue du compte, les autres actions un refus nommé, la déconnexion
    // se fait sans retrait chez Meta ; aucun appel Graph pour ce compte (contrôlé plus bas).
    expect(statuses).toEqual([
      ['verify', 200, null],
      ['refresh-numbers', 409, 'whatsapp_account.secrets_unreadable'],
      ['app-webhook', 422, 'whatsapp_account.app_webhook_failed'],
      ['disconnect', 200, null],
    ]);
    expect((await acmeApi.post(`/whatsapp-accounts/${created.body.id}/disconnect`)).status).toBe(200);
    // Un message servi : l'envoi part avec le jeton du compte d'acme.
    const payload = metaBody([{ wabaId: WABA_A, displayPhone: ACME_NUMBER, phoneNumberId: PNID_A, id: 'wamid.env-r1', from: SHARED_CONTACT, text: 'Bonjour' }]);
    expect((await world.postMeta('acme', payload, SECRET_A)).status).toBe(200);
    await world.settle();

    const calls = world.graph.calls;
    // Contrôle positif : raccordement, vérification, inventaire, inscription, retrait et envoi ont bien appelé Meta.
    expect(world.graph.posts().length).toBeGreaterThanOrEqual(3);
    expect(calls.some((c) => c.path === `/${WABA_A}/subscribed_apps`)).toBe(true);
    expect(world.sent.length).toBeGreaterThan(0);
    for (const call of calls) {
      expectNoMarker('appel Graph', call, envMarkers);
      expect(call.path.includes(PARTIAL_WABA)).toBe(false);
    }
    for (const sent of world.sent) {
      const text = JSON.stringify(sent);
      for (const marker of envMarkers) expect([sent.url, marker, text.includes(marker)]).toEqual([sent.url, marker, false]);
      expect(sent.headers['Authorization']).toBe(`Bearer ${TOKEN_A}`);
    }
  });

  // spec R1 §8 : « Message traité par un compte dont le raccordement n'est pas confirmé » (raccordement échoué)
  it("POST signé sur l'adresse d'un raccordement échoué : 404, aucun effet", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    seedAcmeNew(world);
    // Meta n'arrive pas à joindre l'adresse : 2200, le raccordement échoue.
    world.graph.verifier = async () => false;
    const failed = await connectAcmeNew(world);
    expect([failed.status, failed.body.error?.reason]).toEqual([422, 'whatsapp_account.webhook_unreachable']);
    const inscription = world.graph.posts().find((c) => c.path === `/${ACME_NEW.wabaId}/subscribed_apps` && c.query['override_callback_uri'] !== undefined);
    const key = keyOfMetaUrl(inscription!.query['override_callback_uri']!);
    const verifyToken = inscription!.query['verify_token']!;
    expect(await world.db.findWhatsAppAccountByWebhookKeyHash(hashWebhookKey(key))).toBeUndefined();
    expect(await world.db.listWhatsAppAccounts('acme')).toHaveLength(1);

    const payload = metaBody([{ wabaId: ACME_NEW.wabaId, displayPhone: ACME_NEW.phone, phoneNumberId: ACME_NEW.pnid, id: 'wamid.echec', from: SHARED_CONTACT }]);
    expect((await world.postMetaKey(key, payload, ACME_NEW.appSecret)).status).toBe(404);
    // Le registre des vérifications attendues a été libéré : le jeton de l'échec n'ouvre plus rien.
    const server = await serve(world.app);
    expect((await request(server).get(`/webhook/meta/${key}`).query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': 'x' })).status).toBe(403);
    await world.settle();
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NEW.phone, SHARED_CONTACT)).toBeUndefined();
    expect(await world.db.claimMessage(`${ACME_NEW.phone}:wamid.echec`, 0)).toBe(true);
  });

  // spec R1 §8 : « Événement de compte de la WABA d'une organisation traité par le compte d'une autre »
  it("événement de compte pour la WABA de B reçu sur l'adresse de A (signé avec le secret de A) : ignoré, rien chez B", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    const betaId = world.accounts.beta.account.id;
    const betaApi = await world.api('beta');
    const snapshot = async (): Promise<unknown> => ({
      record: await world.db.getWhatsAppAccount('beta', betaId),
      numbers: await world.db.listWhatsAppNumbers('beta', betaId),
      view: (await betaApi.get(`/whatsapp-accounts/${betaId}`)).body,
      audit: await world.db.listAuditLog('beta'),
    });
    const before = await snapshot();
    const event = (wabaId: string): Record<string, unknown> => ({
      object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ field: 'account_update', value: { event: 'ACCOUNT_UPDATE' } }] }],
    });
    world.graph.clearCalls();

    expect((await world.postMeta('acme', event(WABA_B), SECRET_A)).status).toBe(200);
    // revue R1 ISO-M4 : un message de la WABA de B, signé avec le secret de A, sur l'adresse de A : jamais routé.
    const betaMessage = metaBody([{ wabaId: WABA_B, displayPhone: BETA_NUMBER, phoneNumberId: PNID_B, id: 'wamid.beta-sur-acme', from: SHARED_CONTACT, text: 'Bonjour' }]);
    expect((await world.postMeta('acme', betaMessage, SECRET_A)).status).toBe(200);
    await world.settle();
    expect(await world.db.getSession(BETA_NUMBER, SHARED_CONTACT)).toBeUndefined();
    expect(await world.db.getSession(ACME_NUMBER, SHARED_CONTACT)).toBeUndefined();
    expect(world.sent).toEqual([]);
    for (const call of world.graph.calls) expectNoMarker('événement de B sur A', call, BETA_MARKERS);
    expect(world.graph.calls.filter((c) => c.path.includes(WABA_B))).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();

    // Contrôle positif : le même événement pour la WABA d'acme déclenche le rafraîchissement d'acme, avec ses identifiants.
    world.graph.clearCalls();
    expect((await world.postMeta('acme', event(WABA_A), SECRET_A)).status).toBe(200);
    await world.settle();
    const refresh = world.graph.calls.filter((c) => c.path === `/${WABA_A}/phone_numbers`);
    expect(refresh.map((c) => c.headers['authorization'])).toEqual([`Bearer ${TOKEN_A}`]);
    for (const call of world.graph.calls) expectNoMarker('événement de A sur A', call, BETA_MARKERS);
    expect(await snapshot()).toEqual(before);
  });
});
