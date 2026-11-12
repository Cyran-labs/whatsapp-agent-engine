/**
 * Suite d'isolation « deux organisations », scénarios des comptes WhatsApp (lot 2b-2) : rebranchement d'un numéro,
 * reprise d'un numéro par une autre organisation, accès limité, compte déconnecté. Tout passe par le vrai chemin
 * HTTP : webhooks par compte (signatures réelles) et API d'administration (session, organisation active). Seuls
 * le LLM, `fetch` et les clients des fournisseurs de l'API d'administration sont simulés (harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import request from 'supertest';
import { serve } from '../../test-support/http.js';
import { metaBody, metaTexts } from '../../test-support/whatsapp.js';
import { llmBehavior } from './llm-mock.js';
import {
  ACME_META_KEY, ACME_NUMBER, BETA_CM_KEY, BETA_CM_NUMBER, BETA_NUMBER, PNID_A, PNID_B, SECRET_A, SECRET_B,
  SHARED_CONTACT, TOKEN_A, TOKEN_B, WABA_A, WABA_B, providerNumber, setupTwoOrgs,
} from './harness.js';
import type { TwoOrgs } from './harness.js';

const CONTACT = SHARED_CONTACT;
const CONTACT_E164 = `+${SHARED_CONTACT}`;

/** Compte que beta raccorde par l'API dans les scénarios de reprise (WABA, app, jeton et secret propres à beta). */
const BETA_TAKEOVER = {
  wabaId: '7777777777',
  appId: 'APP-BETA-REPRISE',
  name: 'Compte repris',
  accessToken: 'EAAG-jeton-beta-reprise-0123456789',
  appSecret: 'secret-app-beta-reprise-0123456789',
};

/** Tout ce qui identifie acme : présent dans une réponse, un envoi ou un prompt de beta, c'est une fuite. */
const ACME_MARKERS = ['acme', 'Compte WABA-A', 'ventes', TOKEN_A, SECRET_A, WABA_A, 'APP-A', 'VERIF-A', ACME_META_KEY];

/** Ce qui identifie le compte repris et l'agent IA de beta : jamais dans une réponse de l'API d'acme. */
const BETA_TAKEOVER_MARKERS = ['beta', BETA_TAKEOVER.name, 'reprise', BETA_TAKEOVER.accessToken, BETA_TAKEOVER.appSecret, BETA_TAKEOVER.wabaId, BETA_TAKEOVER.appId];

function expectNoMarker(what: string, value: unknown, markers: string[]): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const marker of markers) expect([what, marker, text.includes(marker)]).toEqual([what, marker, false]);
}

describe('isolation entre deux organisations : comptes WhatsApp (chemin HTTP réel)', () => {
  let world: TwoOrgs;

  beforeEach(async () => {
    world = await setupTwoOrgs();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  const chatCalls = () => world.llmCalls.filter((c) => c.kind === 'chat');

  /** Tous les envois Meta depuis l'indice `from` partent du phone_number_id `pnid` avec le jeton `token`. Renvoie leur nombre. */
  function expectAllMetaSentWith(pnid: string, token: string, from: number): number {
    const calls = world.sent.slice(from);
    for (const call of calls) {
      expect(call.url).toMatch(new RegExp(`^https://graph\\.facebook\\.com/[^/]+/${pnid}/`));
      expect(call.headers['Authorization']).toBe(`Bearer ${token}`);
    }
    return calls.length;
  }

  async function unserved(clientId: string, botId: string): Promise<number> {
    return (await world.db.getBotRuntimeState(clientId, botId))?.unserved_count ?? 0;
  }

  async function sessionOf(waNumber: string, contactId: string = CONTACT): Promise<string | null> {
    const session = await world.db.getSession(waNumber, contactId);
    return session ? `${session.client_id}/${session.bot_id}` : null;
  }

  /** Message de CONTACT vers le numéro d'acme, sur l'URL du compte d'acme, signé par son secret. */
  async function writeToAcme(id: string, text: string, from: string = CONTACT): Promise<void> {
    const res = await world.postMeta('acme', world.metaMessage({ org: 'acme', id, from, text }), SECRET_A);
    expect(res.status).toBe(200);
    await world.settle();
  }

  const newBot = (botId: string, name: string) => ({
    bot_id: botId, name, system_prompt: { fr: 'Tu es un agent IA.' }, lead_fields: 'prenom', welcome: { enabled: false, message: {} },
  });

  // spec §7.6 : les échecs de remise du résumé du numéro sont ceux du numéro de l'agent IA, dans son organisation
  it("échecs de remise : l'agent IA d'acme voit ceux de son numéro, jamais ceux du numéro de beta", async () => {
    const acmeNumber = world.accounts.acme.numbers[ACME_NUMBER]!;
    const betaNumber = world.accounts.beta.numbers[BETA_NUMBER]!;
    await world.db.recordDeliveryFailure(acmeNumber.id, 131047, '2026-11-09T10:00:00.000Z');
    await world.db.recordDeliveryFailure(betaNumber.id, 131042, '2026-11-09T10:00:00.000Z');
    await world.db.recordDeliveryFailure(betaNumber.id, 131042, '2026-11-09T10:01:00.000Z');
    const acmeView = (await (await world.api('acme')).get('/bots/ventes')).body;
    expect(acmeView.whatsapp_number).toMatchObject({ id: acmeNumber.id, delivery_failures: 1, last_delivery_error_code: 131047 });
    expectNoMarker('vue acme', acmeView, ['beta', BETA_NUMBER, '131042']);
    const betaView = (await (await world.api('beta')).get('/bots/accueil')).body;
    expect(betaView.whatsapp_number).toMatchObject({ id: betaNumber.id, delivery_failures: 2, last_delivery_error_code: 131042 });
    expectNoMarker('vue beta', betaView, ['acme', ACME_NUMBER, '131047']);
  });

  // audit 6.3, revue 2b-1 M-1
  it("numéro rebranché de acme/ventes vers acme/relance par l'API : servi par relance avec le jeton du compte d'acme, sans session ni historique de ventes", async () => {
    await writeToAcme('wamid.avant', 'Message pour ventes');
    expect(await sessionOf(ACME_NUMBER)).toBe('acme/ventes');
    const ventesHistory = await world.db.getConversation(CONTACT, 'acme', 'ventes', 100);
    expect(ventesHistory).toHaveLength(2);
    const acmeApi = await world.api('acme');
    const numberId = world.accounts.acme.numbers[ACME_NUMBER]!.id;

    expect((await acmeApi.post('/bots', newBot('relance', 'Relance'))).status).toBe(201);
    const assigned = await acmeApi.put('/bots/relance/number', { number_id: numberId, expected_bot_id: 'ventes' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.whatsapp_number).toMatchObject({ id: numberId, phone_e164: ACME_NUMBER });
    // décision François A9 : l'ancien détenteur perd le numéro et passe en Désactivé avec son motif ; aucune session ne
    // reste sur le numéro. L'agent IA de beta n'est pas touché et aucune ligne d'audit n'est écrite chez beta.
    const betaBefore = await world.db.getBotRecord('beta', 'accueil');
    const betaAuditBefore = await world.db.listAuditLog('beta');
    const ventes = await acmeApi.get('/bots/ventes');
    expect(ventes.body).toMatchObject({ status: 'paused', status_reason: 'number_unassigned', whatsapp_number: null });
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect((await world.db.listAuditLog('acme')).filter((a) => a.action === 'bot.status.auto'))
      .toEqual([expect.objectContaining({ target: 'bot:acme/ventes', client_id: 'acme', metadata: { to: 'paused', reason: 'number_unassigned' } })]);
    expect(await world.db.getBotRecord('beta', 'accueil')).toEqual(betaBefore);
    expect(await world.db.listAuditLog('beta')).toEqual(betaAuditBefore);

    // Message reçu pendant que relance est en brouillon : compté pour relance, jamais pour ventes, rien de servi.
    await writeToAcme('wamid.brouillon', 'Pendant le brouillon');
    expect(world.llmCalls).toHaveLength(2); // réponse et extraction du premier message seulement
    expect(world.sent.length).toBeGreaterThan(0);
    const sentBefore = world.sent.length;
    expect([await unserved('acme', 'relance'), await unserved('acme', 'ventes')]).toEqual([1, 0]);
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();

    expect((await acmeApi.put('/bots/relance/allowlist', { entries: [CONTACT_E164] })).status).toBe(200);
    expect((await acmeApi.put('/bots/relance/status', { status: 'limited' })).status).toBe(200);
    expect((await acmeApi.put('/bots/relance/status', { status: 'active' })).body.status).toBe('active');
    world.llmCalls.length = 0;

    await writeToAcme('wamid.apres', 'Message pour relance');
    expect(metaTexts(world.sent.slice(sentBefore))).toEqual([
      { phoneNumberId: PNID_A, authorization: `Bearer ${TOKEN_A}`, to: CONTACT, text: 'Réponse de acme/relance à : Message pour relance' },
    ]);
    expect(expectAllMetaSentWith(PNID_A, TOKEN_A, sentBefore)).toBeGreaterThan(0);
    // relance ne voit pas l'historique de ventes : son prompt ne porte que le nouveau message.
    expect(chatCalls().map((c) => `${c.clientId}/${c.botId}`)).toEqual(['acme/relance']);
    expect(chatCalls()[0]?.messages).toEqual([{ role: 'user', content: 'Message pour relance' }]);
    expect(await sessionOf(ACME_NUMBER)).toBe('acme/relance');
    // L'historique de ventes reste attaché à ventes, intact ; relance a le sien.
    expect(await world.db.getConversation(CONTACT, 'acme', 'ventes', 100)).toEqual(ventesHistory);
    expect(await world.db.getConversation(CONTACT, 'acme', 'relance', 100)).toHaveLength(2);
    expect(await unserved('acme', 'ventes')).toBe(0);
  });

  // spec §6, audit 1.5
  it("reprise : compte d'acme en erreur, beta raccorde un compte dont l'inventaire porte le même numéro : servi par beta avec son jeton, sans rien d'acme", async () => {
    const markerA = 'ZEBRE-CONFIDENTIEL-A-7731';
    llmBehavior.extraction = (call) => (call.clientId === 'acme' ? '{"prenom":"PrenomDeLaSocieteA"}' : '{}');
    await writeToAcme('wamid.a', `Mon code est ${markerA}`);
    expect(await world.db.getLeadData(CONTACT, 'acme', 'ventes')).toMatchObject({ prenom: 'PrenomDeLaSocieteA' });
    expect(await sessionOf(ACME_NUMBER)).toBe('acme/ventes');
    const acmeHistory = await world.db.getConversation(CONTACT, 'acme', 'ventes', 100);

    // Compte d'acme passé en erreur par le vrai chemin : « Vérifier maintenant », jeton refusé par le fournisseur.
    world.providerAccounts.get(WABA_A)!.verifyError = 'token_invalid';
    const acmeApi = await world.api('acme');
    const verified = await acmeApi.post(`/whatsapp-accounts/${world.accounts.acme.account.id}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ state: 'error', error_reason: 'token_invalid' });

    // beta raccorde un compte dont l'inventaire chez le fournisseur porte le numéro d'acme (même phone_number_id).
    world.providerAccounts.set(BETA_TAKEOVER.wabaId, { appId: BETA_TAKEOVER.appId, numbers: [providerNumber(ACME_NUMBER, PNID_A)] });
    const betaApi = await world.api('beta');
    const created = await betaApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: BETA_TAKEOVER.name, waba_id: BETA_TAKEOVER.wabaId,
      access_token: BETA_TAKEOVER.accessToken, app_secret: BETA_TAKEOVER.appSecret,
    });
    expect(created.status).toBe(201);
    expect(created.body.inventory).toMatchObject({ added: 1, refused: 0 });
    expect(created.body.numbers).toHaveLength(1);
    expect(created.body.numbers[0]).toMatchObject({ phone_e164: ACME_NUMBER, provider_state: 'present', bot: null });
    const takenNumberId = created.body.numbers[0].id as number;
    const betaKey = String(created.body.webhook.path).replace('/webhook/meta/', '');
    expect(betaKey).not.toBe('');

    // L'agent IA d'acme est en pause, motif « numéro retiré » ; les sessions du numéro ont disparu.
    expect((await world.db.getBotRecord('acme', 'ventes'))).toMatchObject({ status: 'paused', status_reason: 'number_removed' });
    expect((await acmeApi.get('/bots/ventes')).body).toMatchObject({ status: 'paused', whatsapp_number: { provider_state: 'removed' } });
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();

    expect((await betaApi.post('/bots', newBot('reprise', 'Reprise'))).status).toBe(201);
    const activated = await betaApi.post('/bots/reprise/activate', { number_id: takenNumberId, expected_bot_id: null, status: 'limited', allowlist: [CONTACT_E164] });
    expect(activated.status).toBe(200);
    expect((await betaApi.put('/bots/reprise/status', { status: 'active' })).body.status).toBe('active');
    world.llmCalls.length = 0;
    const from = world.sent.length;

    const payload = metaBody([{
      wabaId: BETA_TAKEOVER.wabaId, displayPhone: ACME_NUMBER, phoneNumberId: PNID_A, id: 'wamid.reprise', from: CONTACT, text: 'Bonjour après reprise',
    }]);
    expect((await world.postMetaKey(betaKey, payload, BETA_TAKEOVER.appSecret)).status).toBe(200);
    await world.settle();

    // Servi par l'agent IA de beta, avec le jeton du compte de beta.
    expect(metaTexts(world.sent.slice(from))).toEqual([{
      phoneNumberId: PNID_A, authorization: `Bearer ${BETA_TAKEOVER.accessToken}`, to: CONTACT, text: 'Réponse de beta/reprise à : Bonjour après reprise',
    }]);
    expect(expectAllMetaSentWith(PNID_A, BETA_TAKEOVER.accessToken, from)).toBeGreaterThan(0);
    for (const call of world.sent.slice(from)) expectNoMarker('envoi de beta', { headers: call.headers, body: call.body }, ACME_MARKERS);
    expect(await sessionOf(ACME_NUMBER)).toBe('beta/reprise');

    // Le prompt de beta ne porte aucun contenu d'acme : ni son message, ni son lead, ni sa réponse.
    const callsOfB = world.llmCalls;
    expect(callsOfB.length).toBeGreaterThan(0);
    for (const call of callsOfB) {
      expect(`${call.clientId}/${call.botId}`).toBe('beta/reprise');
      expectNoMarker('prompt de beta', call.everything, [markerA, 'PrenomDeLaSocieteA', ...ACME_MARKERS]);
    }
    expect(chatCalls()[0]?.messages).toEqual([{ role: 'user', content: 'Bonjour après reprise' }]);
    expect(await world.db.getConversation(CONTACT, 'acme', 'ventes', 100)).toEqual(acmeHistory);

    // Les réponses de l'API de beta (compte, numéros, agents IA, audit) ne portent rien d'acme.
    const accountId = created.body.id as number;
    const betaViews: Array<[string, unknown]> = [
      ['raccordement', created.body],
      ['activation', activated.body],
      ['comptes', (await betaApi.get('/whatsapp-accounts')).body],
      ['compte', (await betaApi.get(`/whatsapp-accounts/${accountId}`)).body],
      ['rafraîchissement', (await betaApi.post(`/whatsapp-accounts/${accountId}/refresh-numbers`)).body],
      ['agents IA', (await betaApi.get('/bots')).body],
      ['agent IA', (await betaApi.get('/bots/reprise')).body],
      ['audit', (await betaApi.get('/audit')).body],
    ];
    for (const [what, body] of betaViews) expectNoMarker(`API de beta : ${what}`, body, ACME_MARKERS);
    // Et inversement : l'API d'acme ne nomme ni beta, ni son compte, ni son agent IA.
    const acmeAccount = await acmeApi.get(`/whatsapp-accounts/${world.accounts.acme.account.id}`);
    // Le détail porte bien les numéros du compte : le numéro repris y figure, retiré, sans rien de son nouveau détenteur.
    expect(acmeAccount.body.numbers).toEqual([
      expect.objectContaining({ phone_e164: ACME_NUMBER, provider_state: 'removed', bot: expect.objectContaining({ bot_id: 'ventes', status: 'paused' }) }),
    ]);
    const acmeViews: Array<[string, unknown]> = [
      ['comptes', (await acmeApi.get('/whatsapp-accounts')).body],
      ['compte et ses numéros', acmeAccount.body],
      ['agent IA', (await acmeApi.get('/bots/ventes')).body],
      ['audit', (await acmeApi.get('/audit')).body],
    ];
    for (const [what, body] of acmeViews) expectNoMarker(`API d'acme : ${what}`, body, BETA_TAKEOVER_MARKERS);

    // L'URL d'acme ne sert plus ce numéro : ni LLM, ni envoi, ni compteur.
    world.llmCalls.length = 0;
    const afterBeta = world.sent.length;
    await writeToAcme('wamid.ancien', 'Encore pour acme');
    expect(world.llmCalls).toEqual([]);
    expect(world.sent.length).toBe(afterBeta);
    expect(await unserved('acme', 'ventes')).toBe(0);
    expect(await sessionOf(ACME_NUMBER)).toBe('beta/reprise');
  });

  // spec §6, audit 1.5
  it("pas de reprise tant que le compte d'acme est connecté : numéro refusé à beta, sans rien d'acme dans la réponse, acme toujours servi", async () => {
    world.providerAccounts.set(BETA_TAKEOVER.wabaId, { appId: BETA_TAKEOVER.appId, numbers: [providerNumber(ACME_NUMBER, PNID_A)] });
    const betaApi = await world.api('beta');
    const created = await betaApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: BETA_TAKEOVER.name, waba_id: BETA_TAKEOVER.wabaId,
      access_token: BETA_TAKEOVER.accessToken, app_secret: BETA_TAKEOVER.appSecret,
    });
    expect(created.status).toBe(201);
    expect(created.body.inventory).toMatchObject({ added: 0, refused: 1 });
    expect(created.body.numbers).toEqual([]);
    expectNoMarker('API de beta : raccordement refusé', created.body, ACME_MARKERS);
    expect((await world.db.getBotRecord('acme', 'ventes'))?.status).toBe('active');

    // Le numéro d'acme envoyé sur l'URL du compte de beta, signé par beta : inconnu de ce compte, ignoré.
    const betaKey = String(created.body.webhook.path).replace('/webhook/meta/', '');
    const payload = metaBody([{ wabaId: BETA_TAKEOVER.wabaId, displayPhone: ACME_NUMBER, phoneNumberId: PNID_A, id: 'wamid.vol', from: CONTACT }]);
    expect((await world.postMetaKey(betaKey, payload, BETA_TAKEOVER.appSecret)).status).toBe(200);
    await world.settle();
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();

    await writeToAcme('wamid.toujours', 'Toujours acme');
    expect(metaTexts(world.sent).map((t) => [t.phoneNumberId, t.authorization])).toEqual([[PNID_A, `Bearer ${TOKEN_A}`]]);
    expect(await sessionOf(ACME_NUMBER)).toBe('acme/ventes');
  });

  // audit R-5
  it("compte d'acme en erreur parce que son jeton relève de l'app de beta : error_detail neutre dans la vue d'acme, rien de beta", async () => {
    // Le fournisseur répond maintenant avec l'app APP-B, tenue par le compte de beta : même refus que « app tenue ailleurs ».
    world.providerAccounts.get(WABA_A)!.appId = 'APP-B';
    const acmeApi = await world.api('acme');
    const id = world.accounts.acme.account.id;
    const verified = await acmeApi.post(`/whatsapp-accounts/${id}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ state: 'error', outcome: 'refused', error_detail: 'Ce compte ne peut pas être raccordé. Contactez le support.' });

    const betaMarkers = ['beta', 'APP-B', WABA_B, BETA_NUMBER, PNID_B, TOKEN_B, SECRET_B, 'VERIF-B'];
    expectNoMarker('API d\'acme : vérification refusée', verified.body, betaMarkers);
    const one = await acmeApi.get(`/whatsapp-accounts/${id}`);
    expect(one.body.error_detail).toBe('Ce compte ne peut pas être raccordé. Contactez le support.');
    expectNoMarker("API d'acme : vue du compte", one.body, betaMarkers);
    const list = await acmeApi.get('/whatsapp-accounts');
    expectNoMarker("API d'acme : liste des comptes", list.body, betaMarkers);

    // Le compte de beta ne porte aucun motif d'erreur : le refus d'acme n'a rien écrit chez lui.
    const betaApi = await world.api('beta');
    const betaList = await betaApi.get('/whatsapp-accounts');
    expect(betaList.body.length).toBeGreaterThan(0);
    for (const a of betaList.body as Array<{ state: string; error_detail: string | null }>) expect([a.state, a.error_detail]).toEqual(['connected', null]);
    expectNoMarker("API de beta : liste des comptes", betaList.body, ['acme', 'APP-A', WABA_A, TOKEN_A, SECRET_A, 'Ce compte ne peut pas']);
  });

  // revue 2b-2 I-1
  it("beta raccorde avec ses identifiants la WABA d'un compte d'acme, connecté puis en erreur : 409 neutre, aucune écriture chez le fournisseur, rien écrit chez beta", async () => {
    const SHARED_WABA = '8888888888';
    world.providerAccounts.set(SHARED_WABA, { appId: 'APP-A', numbers: [providerNumber('+33100000009', 'PNID-A9')] });
    const acmeApi = await world.api('acme');
    const acmeCreated = await acmeApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: 'Compte WABA partagée', waba_id: SHARED_WABA, access_token: 'EAAG-jeton-acme-9-0123456789', app_secret: 'secret-acme-9-0123456789',
    });
    expect(acmeCreated.status).toBe(201);

    const betaApi = await world.api('beta');
    const betaAccountsBefore = (await betaApi.get('/whatsapp-accounts')).body;
    const attempt = () => betaApi.post('/whatsapp-accounts', {
      mode: 'meta_manual', name: BETA_TAKEOVER.name, waba_id: SHARED_WABA, access_token: BETA_TAKEOVER.accessToken, app_secret: BETA_TAKEOVER.appSecret,
    });
    for (const state of ['connected', 'error'] as const) {
      if (state === 'error') await world.db.setWhatsAppAccountError(acmeCreated.body.id as number, 'token_invalid', 'Jeton refusé');
      vi.mocked(world.providers.verifyMeta).mockClear();
      vi.mocked(world.providers.listMeta).mockClear();
      const refused = await attempt();
      expect([state, refused.status, refused.body.error?.message]).toEqual([state, 409, 'Ce compte ne peut pas être raccordé. Contactez le support.']);
      expectNoMarker(`API de beta : raccordement refusé (${state})`, refused.body, [...ACME_MARKERS, 'Compte WABA partagée']);
      // Re-revue : le contrôle entre organisations suit la preuve d'accès (vérification lancée, en lecture seule) et précède toute écriture.
      expect(world.providers.verifyMeta).toHaveBeenCalledTimes(1);
      expect(world.providers.listMeta).not.toHaveBeenCalled();
      expect((await betaApi.get('/whatsapp-accounts')).body).toEqual(betaAccountsBefore);
    }
    expect((await world.db.getWhatsAppAccount('acme', acmeCreated.body.id as number))?.state).toBe('error');
  });

  // revue 2b-2 I-1 (décision 2) : seule une action d'admin reprend un numéro.
  it("compte d'acme en erreur, événement Meta sur l'URL de beta dont l'inventaire porte le numéro d'acme : rien n'est repris ; « Rafraîchir les numéros » de l'admin de beta le reprend", async () => {
    await world.db.setWhatsAppAccountError(world.accounts.acme.account.id, 'token_invalid', 'Jeton refusé');
    world.providerAccounts.get(WABA_B)!.numbers.push(providerNumber(ACME_NUMBER, PNID_A));
    vi.mocked(world.providers.listMeta).mockClear();

    const event = { object: 'whatsapp_business_account', entry: [{ id: WABA_B, changes: [{ field: 'phone_number_quality_update', value: { event: 'FLAGGED', display_phone_number: ACME_NUMBER.slice(1) } }] }] };
    expect((await world.postMeta('beta', event, SECRET_B)).status).toBe(200);
    await world.settle();
    // Le rafraîchissement sur événement a bien eu lieu, pour le compte de beta seulement.
    expect(vi.mocked(world.providers.listMeta).mock.calls.map((c) => c[0].waba_id)).toEqual([WABA_B]);
    expect(await world.db.getBotRecord('acme', 'ventes')).toMatchObject({ status: 'active', status_reason: null });
    expect(await world.db.getWhatsAppNumber('acme', world.accounts.acme.numbers[ACME_NUMBER]!.id)).toMatchObject({ provider_state: 'present', bot_id: 'ventes' });
    expect((await world.db.listWhatsAppNumbers('beta', world.accounts.beta.account.id)).map((n) => n.phone_e164)).toEqual([BETA_NUMBER]);
    const refreshAudit = (await world.db.listAuditLog('beta')).filter((a) => a.action === 'whatsapp_account.refresh');
    expect(refreshAudit.map((a) => [a.actor_user_id, a.metadata])).toEqual([[null, { added: 0, removed: 0, refused: 1 }]]);
    expect((await world.db.listAuditLog('acme')).filter((a) => a.action === 'bot.status.auto')).toEqual([]);

    // Action de l'admin de beta : la reprise a lieu.
    const betaApi = await world.api('beta');
    const refreshed = await betaApi.post(`/whatsapp-accounts/${world.accounts.beta.account.id}/refresh-numbers`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.inventory).toMatchObject({ added: 1, refused: 0 });
    expectNoMarker('API de beta : rafraîchissement', refreshed.body, ACME_MARKERS);
    expect(await world.db.getBotRecord('acme', 'ventes')).toMatchObject({ status: 'paused', status_reason: 'number_removed' });
  });

  // spec §8.3
  it("accès limité : contact hors liste, ni LLM, ni envoi, ni session, compteur à 1 ; contact de la liste servi", async () => {
    const acmeApi = await world.api('acme');
    const ALLOWED = '33600000077';
    expect((await acmeApi.put('/bots/ventes/allowlist', { entries: [`+${ALLOWED}`] })).status).toBe(200);
    expect((await acmeApi.put('/bots/ventes/status', { status: 'limited' })).body.status).toBe('limited');

    await writeToAcme('wamid.hors-liste', 'Je ne suis pas dans la liste');
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(await world.db.getConversation(CONTACT, 'acme', 'ventes', 100)).toEqual([]);
    expect(await world.db.getLeadData(CONTACT, 'acme', 'ventes')).toBeNull();
    expect(await unserved('acme', 'ventes')).toBe(1);
    expect((await acmeApi.get('/bots/ventes')).body.unserved.count).toBe(1);

    // Contrôle positif : le contact de la liste est servi, avec le jeton d'acme.
    await writeToAcme('wamid.liste', 'Je suis dans la liste', ALLOWED);
    expect(metaTexts(world.sent)).toEqual([
      { phoneNumberId: PNID_A, authorization: `Bearer ${TOKEN_A}`, to: ALLOWED, text: 'Réponse de acme/ventes à : Je suis dans la liste' },
    ]);
    expect(expectAllMetaSentWith(PNID_A, TOKEN_A, 0)).toBeGreaterThan(0);
    expect(await unserved('acme', 'ventes')).toBe(1);
  });

  // spec §6 (choix 6)
  it("compte Meta déconnecté par l'API : son URL répond 404, sans aucun effet ; l'autre organisation reste servie", async () => {
    const acmeApi = await world.api('acme');
    const accountId = world.accounts.acme.account.id;
    expect((await acmeApi.put('/bots/ventes/status', { status: 'draft' })).status).toBe(200);
    expect((await acmeApi.post(`/whatsapp-accounts/${accountId}/disconnect`)).status).toBe(204);
    const before = await world.db.getWhatsAppAccount('acme', accountId);
    expect(before?.state).toBe('disconnected');

    const res = await world.postMeta('acme', world.metaMessage({ org: 'acme', id: 'wamid.deconnecte', from: CONTACT }), SECRET_A);
    expect(res.status).toBe(404);
    const server = await serve(world.app);
    const verifyQuery = { 'hub.mode': 'subscribe', 'hub.verify_token': 'VERIF-A', 'hub.challenge': '1' };
    expect((await request(server).get(`/webhook/meta/${ACME_META_KEY}`).query(verifyQuery)).status).toBe(403);
    await world.settle();

    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect(await world.db.getConversation(CONTACT, 'acme', 'ventes', 100)).toEqual([]);
    expect(await unserved('acme', 'ventes')).toBe(0);
    expect(await world.db.getWhatsAppAccount('acme', accountId)).toEqual(before);
    // En dernier (la vérification écrit) : la clé de dédoublonnage n'a jamais été réservée.
    expect(await world.db.claimMessage(`${ACME_NUMBER}:wamid.deconnecte`, 0)).toBe(true);

    await world.postMeta('beta', world.metaMessage({ org: 'beta', id: 'wamid.beta', from: CONTACT }), SECRET_B);
    await world.settle();
    expect(metaTexts(world.sent).map((t) => [t.phoneNumberId, t.authorization])).toEqual([[PNID_B, `Bearer ${TOKEN_B}`]]);
    expect(await sessionOf(BETA_NUMBER)).toBe('beta/accueil');
  });

  // spec §6 (choix 6), audit 4.1
  it("compte CM.com déconnecté par l'API : son URL répond 404, sans aucun effet", async () => {
    const betaApi = await world.api('beta');
    const accountId = world.accounts.betaCm.account.id;
    expect((await betaApi.put('/bots/cm/status', { status: 'draft' })).status).toBe(200);
    expect((await betaApi.post(`/whatsapp-accounts/${accountId}/disconnect`)).status).toBe(204);

    const res = await world.postCm(BETA_CM_KEY, world.cmMessage({ id: 'cm.deconnecte', from: `00${CONTACT}` }));
    expect(res.status).toBe(404);
    await world.settle();

    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    expect(await world.db.getSession(BETA_CM_NUMBER, CONTACT)).toBeUndefined();
    expect(await world.db.getConversation(CONTACT, 'beta', 'cm', 100)).toEqual([]);
    expect(await unserved('beta', 'cm')).toBe(0);
    expect(await world.db.claimMessage(`${BETA_CM_NUMBER}:cm.deconnecte`, 0)).toBe(true);
  });
});

