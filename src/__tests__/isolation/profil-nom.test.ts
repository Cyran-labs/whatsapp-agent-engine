/**
 * Suite d'isolation « deux organisations », profil WhatsApp, photo, nom d'affichage et portefeuille (lot R2a, spec R2a
 * §9). Tout passe par le vrai chemin HTTP (API d'administration, route de webhook), les vrais services et le vrai client
 * Graph (`meta-graph.ts`, `meta-profile.ts`), injecté sur le Meta Graph simulé (graph-fake.ts) qui applique les règles de
 * Meta (jeton accepté seulement avec le proof de son app et sur un numéro d'une WABA qui lui est partagée) et enregistre
 * chaque appel tel qu'il part.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import type request from 'supertest';
import type { DisplayNameRequestView } from '@wabagent/contracts';
import { appSecretProof } from '../../whatsapp/meta-graph.js';
import {
  ACME_META_KEY, ACME_NUMBER, BETA_CM_NUMBER, BETA_META_KEY, BETA_NUMBER, PNID_A, PNID_B, SECRET_A, SECRET_B, TOKEN_A, TOKEN_B,
  WABA_A, WABA_B, isolationMetaUrl, setupTwoOrgs,
} from './harness.js';
import type { AdminApi, TwoOrgs } from './harness.js';
import { graphCallText, type GraphCall } from './graph-fake.js';

/** PNG de quelques octets : la signature suffit au contrôle de WABAGENT, la résolution est jugée par Meta. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 7)]);

type Org = 'acme' | 'beta';

/** Ce qui identifie une organisation chez Meta : présent dans un appel fait pour l'autre, c'est une fuite. */
const MARKERS: Record<Org, readonly string[]> = {
  acme: [
    'acme', TOKEN_A, SECRET_A, WABA_A, 'APP-A', ACME_META_KEY, 'VERIF-A', PNID_A, ACME_NUMBER, appSecretProof(TOKEN_A, SECRET_A),
    isolationMetaUrl(ACME_META_KEY),
  ],
  beta: [
    'beta', TOKEN_B, SECRET_B, WABA_B, 'APP-B', BETA_META_KEY, 'VERIF-B', PNID_B, BETA_NUMBER, appSecretProof(TOKEN_B, SECRET_B),
    isolationMetaUrl(BETA_META_KEY),
  ],
};

const OTHER: Record<Org, Org> = { acme: 'beta', beta: 'acme' };

/** Identifiants de l'organisation chez Meta et dans la suite. */
const META_OF: Record<Org, { token: string; secret: string; waba: string; app: string; pnid: string; phone: string }> = {
  acme: { token: TOKEN_A, secret: SECRET_A, waba: WABA_A, app: 'APP-A', pnid: PNID_A, phone: ACME_NUMBER },
  beta: { token: TOKEN_B, secret: SECRET_B, waba: WABA_B, app: 'APP-B', pnid: PNID_B, phone: BETA_NUMBER },
};

function expectNoMarker(what: string, call: GraphCall, markers: readonly string[]): void {
  const text = graphCallText(call);
  for (const marker of markers) expect([what, call.method, call.path, marker, text.includes(marker)]).toEqual([what, call.method, call.path, marker, false]);
}

function numberBase(accountId: number, numberId: number): string {
  return `/whatsapp-accounts/${accountId}/numbers/${numberId}`;
}

function ids(world: TwoOrgs, org: Org): { accountId: number; numberId: number } {
  const fixture = world.accounts[org];
  const phone = META_OF[org].phone;
  return { accountId: fixture.account.id, numberId: fixture.numbers[phone]!.id };
}

/** Les cinq routes du profil et du nom d'un numéro, avec des corps valides : un refus ne vient jamais de la forme. */
async function fiveRoutes(api: AdminApi, accountId: number, numberId: number): Promise<Array<[string, request.Response]>> {
  const base = numberBase(accountId, numberId);
  return [
    ['GET profile', await api.get(`${base}/profile`)],
    ['PUT profile', await api.put(`${base}/profile`, { about: 'Infos écrites par une autre organisation' })],
    ['POST profile/photo', await api.postBytes(`${base}/profile/photo`, 'image/png', PNG)],
    ['POST display-name', await api.post(`${base}/display-name`, { new_display_name: 'Nom pris par une autre organisation' })],
    ['POST display-name/apply', await api.post(`${base}/display-name/apply`, { pin: '246810' })],
  ];
}

const APPROVED_REQUEST: DisplayNameRequestView = {
  requested_name: 'Nom Beta Demandé', status: 'approved_pending', rejection_reason: null, requested_at: '2026-11-10T09:00:00.000Z',
  approved_at: '2026-11-11T09:00:00.000Z', apply_before: '2026-11-25T09:00:00.000Z', apply_before_approx: false,
};

/** Numéro de beta avec un nom affiché, un nom approuvé qui attend d'être appliqué et un code actif. */
async function seedBetaNameState(world: TwoOrgs): Promise<void> {
  const { accountId, numberId } = ids(world, 'beta');
  expect(await world.db.setWhatsAppNumberDisplayName('beta', accountId, numberId, 'Nom Beta Actuel')).toBe(true);
  expect(await world.db.setWhatsAppNumberNameRequest('beta', accountId, numberId, APPROVED_REQUEST)).toBe(true);
  expect(await world.db.setWhatsAppNumberPinEnabled('beta', accountId, numberId, true)).toBe(true);
}

/** État de beta en base, dans sa vue et chez le Meta simulé : il ne bouge jamais pendant une opération d'acme. */
async function betaState(world: TwoOrgs): Promise<unknown> {
  const { accountId, numberId } = ids(world, 'beta');
  const betaApi = await world.api('beta');
  return {
    account: await world.db.getWhatsAppAccount('beta', accountId),
    number: await world.db.getWhatsAppNumber('beta', numberId),
    numbers: await world.db.listWhatsAppNumbers('beta', accountId),
    view: (await betaApi.get(`/whatsapp-accounts/${accountId}`)).body,
    audit: await world.db.listAuditLog('beta'),
    meta: { number: { ...world.graph.numberOf(PNID_B) }, profile: { ...world.graph.profileOf(PNID_B) } },
  };
}

function nameUpdateEvent(wabaId: string, value: Record<string, unknown>): Record<string, unknown> {
  return { object: 'whatsapp_business_account', entry: [{ id: wabaId, time: 1763380800, changes: [{ field: 'phone_number_name_update', value }] }] };
}

describe('isolation entre deux organisations : profil, nom d\'affichage et portefeuille (vrai client Graph)', () => {
  let world: TwoOrgs;

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  // spec R2a §9.1 et §9.2
  it('les cinq routes avec un compte ou un numéro de B depuis A : 404, aucun appel au faux Meta', async () => {
    world = await setupTwoOrgs({ realGraph: true });
    // Nom approuvé en attente chez beta : une application qui passerait la recherche appellerait Meta.
    await seedBetaNameState(world);
    const acme = ids(world, 'acme');
    const beta = ids(world, 'beta');
    const betaCmNumber = world.accounts.betaCm.numbers[BETA_CM_NUMBER]!.id;
    const acmeApi = await world.api('acme');
    const betaApi = await world.api('beta');
    const betaBefore = await betaState(world);
    const acmeAuditBefore = await world.db.listAuditLog('acme');
    world.graph.clearCalls();

    const cases: Array<[string, AdminApi, number, number, string]> = [
      ['A : compte et numéro de B', acmeApi, beta.accountId, beta.numberId, 'whatsapp_account.not_found'],
      ['A : compte de A, numéro de B', acmeApi, acme.accountId, beta.numberId, 'whatsapp_account.number_not_found'],
      ['A : compte de B, numéro de A', acmeApi, beta.accountId, acme.numberId, 'whatsapp_account.not_found'],
      // spec R2a §9.2 : numéro d'un autre compte de la même organisation.
      ['B : compte Meta de B, numéro du compte CM.com de B', betaApi, beta.accountId, betaCmNumber, 'whatsapp_account.number_not_found'],
      ['B : compte CM.com de B, numéro du compte Meta de B', betaApi, world.accounts.betaCm.account.id, beta.numberId, 'whatsapp_account.number_not_found'],
    ];
    for (const [who, api, accountId, numberId, reason] of cases) {
      for (const [route, res] of await fiveRoutes(api, accountId, numberId)) {
        expect([who, route, res.status, res.body.error?.reason]).toEqual([who, route, 404, reason]);
        const text = JSON.stringify(res.body);
        for (const leak of ['Nom Beta', 'Bonjour', PNID_B, BETA_NUMBER, WABA_B]) expect([who, route, leak, text.includes(leak)]).toEqual([who, route, leak, false]);
      }
    }

    // Aucun appel à Meta, ni par le client Graph, ni par le `fetch` global ; rien d'écrit ni de tracé.
    expect(world.graph.calls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await betaState(world)).toEqual(betaBefore);
    expect(await world.db.listAuditLog('acme')).toEqual(acmeAuditBefore);

    // Contrôle positif : la même lecture par beta sur son numéro appelle Meta, avec ses identifiants.
    const own = await betaApi.get(`${numberBase(beta.accountId, beta.numberId)}/profile`);
    expect([own.status, own.body.about]).toEqual([200, 'Bonjour']);
    expect(world.graph.calls.map((c) => [c.method, c.path, c.headers['authorization']]))
      .toEqual([['GET', `/${PNID_B}/whatsapp_business_profile`, `Bearer ${TOKEN_B}`]]);
  });

  // spec R2a §9.3 (et §9.4 pour le code de vérification en deux étapes)
  it('appels du faux Meta : chaque requête porte le jeton du compte visé', async () => {
    const ENV = {
      META_ACCESS_TOKEN: 'EAAG-ENV-PLATEFORME-0123456789', META_DEV_ACCESS_TOKEN: 'EAAG-ENV-DEV-0123456789',
      META_APP_SECRET: 'SECRET-ENV-PLATEFORME', META_APP_ID: 'APP-ENV-PLATEFORME', META_WABA_ID: '9999999999',
      META_PHONE_NUMBER_ID: 'PNID-ENV-PLATEFORME', META_VERIFY_TOKEN: 'VERIF-ENV-PLATEFORME', META_BUSINESS_ID: 'BUSINESS-ENV-PLATEFORME',
    };
    world = await setupTwoOrgs({ realGraph: true });
    // Posées après le montage : `close()` les retire (vi.unstubAllEnvs).
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const envMarkers = [...Object.values(ENV), appSecretProof(ENV.META_ACCESS_TOKEN, ENV.META_APP_SECRET), `${ENV.META_APP_ID}|${ENV.META_APP_SECRET}`];
    // Codes reconnaissables, propres à chaque numéro chez Meta.
    const PIN: Record<Org, string> = { acme: '135790', beta: '864209' };
    world.graph.numberOf(PNID_A)!.pin = PIN.acme;
    world.graph.numberOf(PNID_B)!.pin = PIN.beta;

    for (const org of ['acme', 'beta'] as const) {
      const meta = META_OF[org];
      const other = META_OF[OTHER[org]];
      const { accountId, numberId } = ids(world, org);
      const api = await world.api(org);
      const base = numberBase(accountId, numberId);
      const otherMetaBefore = { number: { ...world.graph.numberOf(other.pnid) }, profile: { ...world.graph.profileOf(other.pnid) } };
      world.graph.clearCalls();
      const responses: Array<[string, request.Response]> = [];
      const step = async (label: string, res: Promise<request.Response>): Promise<request.Response> => {
        const done = await res;
        responses.push([label, done]);
        return done;
      };

      const read = await step('lecture du profil', api.get(`${base}/profile`));
      expect([org, read.status, read.body.about]).toEqual([org, 200, 'Bonjour']);
      const written = await step('écriture du profil', api.put(`${base}/profile`, { about: `Infos ${org}`, websites: [`https://${org}.example`] }));
      expect([org, written.status, written.body.about, written.body.websites]).toEqual([org, 200, `Infos ${org}`, [`https://${org}.example`]]);
      const photo = await step('photo', api.postBytes(`${base}/profile/photo`, 'image/png', PNG));
      expect([org, photo.status, String(photo.body.photo_url).includes(`HANDLE-${meta.app}-`)]).toEqual([org, 200, true]);
      const requested = await step('demande de nom', api.post(`${base}/display-name`, { new_display_name: `Nom ${org}` }));
      expect([org, requested.status, requested.body.display_name_request?.status]).toEqual([org, 200, 'in_review']);
      // Meta approuve le nom ; la relecture des numéros le reporte comme « à appliquer ».
      world.graph.numberOf(meta.pnid)!.newNameStatus = 'APPROVED';
      const refreshed = await step('relecture des numéros', api.post(`/whatsapp-accounts/${accountId}/refresh-numbers`));
      expect([org, refreshed.status, refreshed.body.numbers?.[0]?.display_name_request?.status]).toEqual([org, 200, 'approved_pending']);
      const applied = await step('application du nom', api.post(`${base}/display-name/apply`, { pin: PIN[org] }));
      expect([org, applied.status, applied.body.display_name, applied.body.display_name_request]).toEqual([org, 200, `Nom ${org}`, null]);

      const calls = world.graph.calls;
      // Contrôle positif : chaque étape a bien appelé Meta.
      for (const expected of [
        ['GET', `/${meta.pnid}/whatsapp_business_profile`], ['POST', `/${meta.pnid}/whatsapp_business_profile`], ['POST', `/${meta.app}/uploads`],
        ['POST', `/${meta.pnid}`], ['GET', `/${meta.waba}/phone_numbers`], ['POST', `/${meta.pnid}/register`],
      ]) expect([org, expected, calls.some((c) => c.method === expected[0] && c.path === expected[1])]).toEqual([org, expected, true]);
      expect([org, calls.filter((c) => c.path.startsWith('/upload:')).length]).toEqual([org, 1]);

      const allowed = [
        `/${meta.pnid}/whatsapp_business_profile`, `/${meta.app}/uploads`, `/${meta.pnid}`, `/${meta.pnid}/register`,
        `/${meta.waba}`, `/${meta.waba}/phone_numbers`,
      ];
      for (const call of calls) {
        expectNoMarker(`appel pour ${org}`, call, [...MARKERS[OTHER[org]], ...envMarkers]);
        if (call.path.startsWith('/upload:')) {
          // Envoi dans la session (essai R2a §4) : jeton du compte en `OAuth`, session de l'app du compte, sans proof.
          expect([org, call.path.startsWith(`/upload:SESSION-${meta.app}-`), call.headers['authorization'], call.query['appsecret_proof']])
            .toEqual([org, true, `OAuth ${meta.token}`, undefined]);
        } else {
          expect([org, call.path, allowed.includes(call.path), call.headers['authorization'], call.query['appsecret_proof'], call.query['access_token']])
            .toEqual([org, call.path, true, `Bearer ${meta.token}`, appSecretProof(meta.token, meta.secret), undefined]);
        }
      }

      // spec R2a §9.4 : le code ne part que dans le corps du réenregistrement, et ne revient ni dans une réponse, ni en
      // base, ni dans la trace d'audit.
      const withPin = calls.filter((c) => graphCallText(c).includes(PIN[org]));
      expect(withPin.map((c) => [c.method, c.path])).toEqual([['POST', `/${meta.pnid}/register`]]);
      expect(withPin[0]!.url.includes(PIN[org])).toBe(false);
      for (const [label, res] of responses) expect([org, label, JSON.stringify(res.body).includes(PIN[org])]).toEqual([org, label, false]);
      expect(JSON.stringify(await world.db.listWhatsAppNumbers(org, accountId)).includes(PIN[org])).toBe(false);
      expect(JSON.stringify(await world.db.listAuditLog(org)).includes(PIN[org])).toBe(false);

      // Le numéro de l'autre organisation n'a pas bougé chez Meta ; celui-ci a son nom appliqué et son profil écrit.
      expect({ number: { ...world.graph.numberOf(other.pnid) }, profile: { ...world.graph.profileOf(other.pnid) } }).toEqual(otherMetaBefore);
      expect([org, world.graph.numberOf(meta.pnid)!.verifiedName, world.graph.profileOf(meta.pnid)['about']]).toEqual([org, `Nom ${org}`, `Infos ${org}`]);
    }
  });

  // spec R2a §9.5
  it('vue de compte de B jamais lisible depuis A, portefeuille compris', async () => {
    world = await setupTwoOrgs({ realGraph: true });
    const BETA_NEW = {
      wabaId: '2000000101', appId: 'APP-B2', phone: '+33100000021', pnid: 'PNID-B21',
      accessToken: 'EAAG-jeton-beta-nouveau-0123456789', appSecret: 'secret-app-beta-nouveau-0123456789',
      business: { id: '200000000000001', name: 'Portefeuille Beta' },
    };
    const ACME_NEW = {
      wabaId: '1000000101', appId: 'APP-A2', phone: '+33100000011', pnid: 'PNID-A21',
      accessToken: 'EAAG-jeton-acme-nouveau-0123456789', appSecret: 'secret-app-acme-nouveau-0123456789',
      business: { id: '100000000000001', name: 'Portefeuille Acme' },
    };
    for (const n of [BETA_NEW, ACME_NEW]) {
      world.graph.addToken(n.accessToken, { appId: n.appId, appSecret: n.appSecret, wabas: [n.wabaId] });
      world.graph.addWaba(n.wabaId, [{ id: n.pnid, phone: n.phone }]);
      world.graph.addApp(n.appId, n.appSecret, null);
      world.graph.setOwnerBusiness(n.wabaId, n.business);
    }
    const betaApi = await world.api('beta');
    const acmeApi = await world.api('acme');
    world.graph.clearCalls();

    // beta raccorde son compte avec son portefeuille, saisi dans le guide.
    const created = await betaApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: 'Compte beta portefeuille', waba_id: BETA_NEW.wabaId, access_token: BETA_NEW.accessToken,
      app_secret: BETA_NEW.appSecret, business_id: BETA_NEW.business.id,
    });
    expect([created.status, created.body.business]).toEqual([201, BETA_NEW.business]);
    // Le portefeuille gardé vient de la lecture faite avec le jeton du compte raccordé.
    const ownerReads = world.graph.calls.filter((c) => c.path === `/${BETA_NEW.wabaId}` && (c.query['fields'] ?? '').includes('owner_business_info'));
    expect(ownerReads.map((c) => [c.method, c.headers['authorization'], c.query['appsecret_proof']]))
      .toEqual([['GET', `Bearer ${BETA_NEW.accessToken}`, appSecretProof(BETA_NEW.accessToken, BETA_NEW.appSecret)]]);
    expect((await world.db.getWhatsAppAccount('beta', created.body.id))?.meta_business_id).toBe(BETA_NEW.business.id);
    const betaId = created.body.id as number;
    const betaView = (await betaApi.get(`/whatsapp-accounts/${betaId}`)).body;
    expect(betaView.business).toEqual(BETA_NEW.business);

    // Depuis acme : la vue, la liste et toute action sur ce compte ne disent rien de beta, et rien ne part chez Meta.
    world.graph.clearCalls();
    const betaLeaks = [BETA_NEW.business.id, BETA_NEW.business.name, BETA_NEW.wabaId, BETA_NEW.appId, 'Compte beta portefeuille', 'beta'];
    const crossed: Array<[string, request.Response]> = [
      ['GET', await acmeApi.get(`/whatsapp-accounts/${betaId}`)],
      ['GET webhook', await acmeApi.get(`/whatsapp-accounts/${betaId}/webhook`)],
      ['POST verify', await acmeApi.post(`/whatsapp-accounts/${betaId}/verify`)],
      ['POST refresh-numbers', await acmeApi.post(`/whatsapp-accounts/${betaId}/refresh-numbers`)],
      ['PATCH', await acmeApi.patch(`/whatsapp-accounts/${betaId}`, { name: 'Renommé par acme' })],
    ];
    for (const [route, res] of crossed) {
      expect([route, res.status, res.body.error?.reason]).toEqual([route, 404, 'whatsapp_account.not_found']);
      for (const leak of betaLeaks) expect([route, leak, JSON.stringify(res.body).includes(leak)]).toEqual([route, leak, false]);
    }
    const acmeList = await acmeApi.get('/whatsapp-accounts');
    expect(acmeList.status).toBe(200);
    for (const leak of betaLeaks) expect([leak, JSON.stringify(acmeList.body).includes(leak)]).toEqual([leak, false]);
    expect(world.graph.calls).toEqual([]);
    expect((await betaApi.get(`/whatsapp-accounts/${betaId}`)).body).toEqual(betaView);

    // acme saisit le portefeuille de beta pour sa propre WABA : refus avant toute écriture chez Meta, et le refus ne
    // nomme que le portefeuille lu avec le jeton d'acme.
    const mismatch = await acmeApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: 'Compte acme', waba_id: ACME_NEW.wabaId, access_token: ACME_NEW.accessToken,
      app_secret: ACME_NEW.appSecret, business_id: BETA_NEW.business.id,
    });
    expect([mismatch.status, mismatch.body.error?.reason]).toEqual([422, 'whatsapp_account.business_mismatch']);
    const found = (mismatch.body.error?.details as Array<{ business?: unknown }> | undefined)?.find((d) => d.business !== undefined);
    expect(found?.business).toEqual(ACME_NEW.business);
    expect(JSON.stringify(mismatch.body).includes(BETA_NEW.business.name)).toBe(false);
    expect(world.graph.posts()).toEqual([]);
    expect(world.graph.calls.length).toBeGreaterThan(0);
    for (const call of world.graph.calls) {
      expectNoMarker('raccordement refusé de A', call, [BETA_NEW.accessToken, BETA_NEW.appSecret, BETA_NEW.wabaId, BETA_NEW.appId, ...MARKERS.beta]);
      expect(call.headers['authorization']).toBe(`Bearer ${ACME_NEW.accessToken}`);
    }
    expect(world.graph.subscriptionsOf(ACME_NEW.wabaId)).toEqual([]);
    expect(world.graph.appCallback(ACME_NEW.appId)).toBeNull();
    expect((await acmeApi.get('/whatsapp-accounts')).body).toEqual(acmeList.body);
  });

  // spec R2a §9.6
  it("événement phone_number_name_update signé pour le compte de A, qui nomme le numéro de B : état du nom de B inchangé, aucune relecture du compte de B", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    await seedBetaNameState(world);
    // Chez Meta, le numéro d'acme a une demande de nom en revue et un code actif (contrôle positif de la relecture).
    Object.assign(world.graph.numberOf(PNID_A)!, { nameStatus: 'APPROVED', newNameStatus: 'PENDING_REVIEW', newDisplayName: 'Nom Acme Demandé', pinEnabled: true });
    const before = await betaState(world);
    world.graph.clearCalls();
    vi.mocked(world.providers.listMeta).mockClear();

    // L'événement nomme le numéro de beta (identifiant et numéro), dans l'entrée de la WABA d'acme, signé avec le secret
    // d'acme, sur l'adresse d'acme.
    const event = nameUpdateEvent(WABA_A, {
      display_phone_number: BETA_NUMBER.slice(1), phone_number_id: PNID_B, decision: 'APPROVED', requested_verified_name: 'Nom Pirate',
      rejection_reason: null,
    });
    expect((await world.postMeta('acme', event, SECRET_A)).status).toBe(200);
    await world.settle();

    // Seul le compte d'acme est relu, avec ses identifiants.
    expect(vi.mocked(world.providers.listMeta).mock.calls.map(([c]) => c.waba_id)).toEqual([WABA_A]);
    const calls = world.graph.calls;
    expect(calls.filter((c) => c.path === `/${WABA_A}/phone_numbers`).map((c) => c.headers['authorization'])).toEqual([`Bearer ${TOKEN_A}`]);
    for (const call of calls) {
      expectNoMarker('relecture sur événement', call, MARKERS.beta);
      expect(call.headers['authorization']).toBe(`Bearer ${TOKEN_A}`);
    }
    // L'état du nom de beta, son code, son compte, sa trace et son état chez Meta n'ont pas bougé.
    expect(await betaState(world)).toEqual(before);
    // Contrôle positif : la relecture d'acme a bien reporté l'état du nom et du code de son numéro.
    const acmeNumber = await world.db.getWhatsAppNumber('acme', ids(world, 'acme').numberId);
    // Audit des décisions R2a, texte 3 : l'état du nom actuel suit la même règle (colonne du numéro de cette organisation).
    expect([acmeNumber?.name_request?.status, acmeNumber?.name_request?.requested_name, acmeNumber?.pin_enabled, acmeNumber?.name_status])
      .toEqual(['in_review', 'Nom Acme Demandé', true, 'APPROVED']);
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
  });

  // spec R2a §9.6 : « un numéro de l'organisation B qui porterait le même provider_number_id dans la donnée du test »
  it("liste de la WABA de A chez Meta qui déclare l'identifiant du numéro de B : état du nom de B inchangé, numéro jamais repris", async () => {
    world = await setupTwoOrgs({ realGraph: true });
    await seedBetaNameState(world);
    const acme = ids(world, 'acme');
    // Meta déclare dans la WABA d'acme un numéro qui porte l'identifiant de celui de beta, avec un nom approuvé et un
    // code inactif : rien de cela ne doit atteindre le numéro de beta.
    const acmeNumbers = [
      { id: PNID_A, phone: ACME_NUMBER },
      { id: PNID_B, phone: '+33100000099', verifiedName: 'Nom Pirate', newNameStatus: 'APPROVED', newDisplayName: 'Nom Pirate Approuvé', pinEnabled: false },
    ];
    world.graph.addWaba(WABA_A, acmeNumbers, world.graph.subscriptionsOf(WABA_A));
    const before = await betaState(world);
    world.graph.clearCalls();

    const event = nameUpdateEvent(WABA_A, { display_phone_number: '33100000099', decision: 'APPROVED', requested_verified_name: 'Nom Pirate Approuvé' });
    expect((await world.postMeta('acme', event, SECRET_A)).status).toBe(200);
    await world.settle();
    // Relecture par l'admin d'acme (reprise permise) : le numéro de beta est tenu par un compte connecté, refusé.
    const refreshed = await (await world.api('acme')).post(`/whatsapp-accounts/${acme.accountId}/refresh-numbers`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.inventory?.refused).toBe(1);

    // Contrôle positif : la relecture sur événement a bien eu lieu, puis celle de l'admin.
    expect(world.graph.calls.filter((c) => c.path === `/${WABA_A}/phone_numbers`).map((c) => c.headers['authorization']))
      .toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_A}`]);
    expect(world.graph.calls.filter((c) => c.path.includes(WABA_B) || c.headers['authorization'] === `Bearer ${TOKEN_B}`)).toEqual([]);
    expect(await betaState(world)).toEqual(before);
    // acme ne gagne aucun numéro : ni l'identifiant de beta, ni le numéro déclaré avec lui.
    const acmeRows = await world.db.listWhatsAppNumbers('acme', acme.accountId);
    expect(acmeRows.map((n) => [n.provider_number_id, n.phone_e164])).toEqual([[PNID_A, ACME_NUMBER]]);
  });
});
