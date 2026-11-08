/**
 * Suite d'isolation « deux organisations » : permanente, par le vrai chemin webhook (HTTP, URL propre à chaque
 * compte WhatsApp, signatures réelles, secrets des comptes chiffrés en base). Elle doit casser si l'isolation
 * entre organisations est violée : repli sur l'environnement, routage par session, historique partagé entre
 * agents IA, authentification contournée, traitement d'un agent IA inactif.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import request from 'supertest';
import { serve } from '../../test-support/http.js';
import { encryptJson } from '../../core/credentials/crypto.js';
import { hashWebhookKey } from '../../whatsapp/webhook-key.js';
import { cmTexts, createConnectedBot, metaBody, metaTexts, setBotStatus as setBotStatusOf } from '../../test-support/whatsapp.js';
import type { SentRequest } from './harness.js';
import { llmBehavior } from './llm-mock.js';
import {
  ACME_META_KEY, ACME_NUMBER, BETA_CM_KEY, BETA_CM_NUMBER, BETA_META_KEY, BETA_NUMBER, CM_TOKEN_B, PNID_A, PNID_B,
  SECRET_A, SECRET_B, SHARED_CONTACT, TOKEN_A, TOKEN_B, WABA_B, setupTwoOrgs,
} from './harness.js';
import type { ContactData, TwoOrgs } from './harness.js';

const CONTACT = SHARED_CONTACT;
const CM_CONTACT = `00${SHARED_CONTACT}`;

describe('isolation entre deux organisations (chemin webhook réel)', () => {
  let world: TwoOrgs;

  beforeEach(async () => {
    world = await setupTwoOrgs();
  });

  afterEach(async () => {
    // Espions de console restaurés même si une assertion a échoué avant leur restauration.
    vi.restoreAllMocks();
    await world.close();
  });

  const META_AUTH = {
    acme: { pnid: PNID_A, authorization: `Bearer ${TOKEN_A}` },
    beta: { pnid: PNID_B, authorization: `Bearer ${TOKEN_B}` },
  } as const;

  /**
   * TOUS les appels sortants depuis l'indice `from` (réponses, accusés de lecture, indicateurs de saisie)
   * visent l'organisation attendue : son phone_number_id et son jeton (Meta), ou son jeton de produit (CM.com).
   * Renvoie leur nombre.
   */
  function expectAllSentBy(who: 'acme' | 'beta' | 'beta-cm', from = 0): number {
    const calls: SentRequest[] = world.sent.slice(from);
    for (const call of calls) {
      if (who === 'beta-cm') {
        expect(call.headers['X-CM-PRODUCTTOKEN']).toBe(CM_TOKEN_B);
        expect(call.url).not.toContain('graph.facebook.com');
      } else {
        expect(call.url).toMatch(new RegExp(`^https://graph\\.facebook\\.com/[^/]+/${META_AUTH[who].pnid}/`));
        expect(call.headers['Authorization']).toBe(META_AUTH[who].authorization);
      }
    }
    return calls.length;
  }

  const chatCalls = () => world.llmCalls.filter((c) => c.kind === 'chat');

  /** Données d'un contact : aucune session, aucune conversation, aucun lead. Le compteur est vérifié à part. */
  function expectNoContactData(data: ContactData): void {
    expect(data.sessions).toEqual([]);
    for (const rows of Object.values(data.conversations)) expect(rows).toEqual([]);
    for (const lead of Object.values(data.leads)) expect(lead).toBeNull();
  }

  /** Rien n'est arrivé : ni LLM, ni envoi, ni donnée, ni compteur, ni clé de dédoublonnage. */
  async function expectNothingHappened(waNumber: string, messageId: string, contactId: string = CONTACT): Promise<void> {
    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    const data = await world.dataOf(contactId);
    expectNoContactData(data);
    for (const count of Object.values(data.unserved)) expect(count).toBe(0);
    // En dernier (la vérification écrit) : une clé jamais réservée est réservable, délai de reprise nul.
    expect(await world.db.claimMessage(`${waNumber}:${messageId}`, 0)).toBe(true);
  }

  // audit 1.1
  it.each([
    { first: 'acme', second: 'beta' },
    { first: 'beta', second: 'acme' },
  ] as const)('contact commun ($first puis $second) : chaque message est traité par l\'agent IA du numéro destinataire, avec ses identifiants', async ({ first, second }) => {
    const expected = {
      acme: { pnid: PNID_A, authorization: `Bearer ${TOKEN_A}`, agent: 'acme/ventes', number: ACME_NUMBER, secret: SECRET_A },
      beta: { pnid: PNID_B, authorization: `Bearer ${TOKEN_B}`, agent: 'beta/accueil', number: BETA_NUMBER, secret: SECRET_B },
    };
    for (const org of [first, second]) {
      const from = world.sent.length;
      const res = await world.postMeta(org, world.metaMessage({ org, id: `wamid.${org}.1`, from: CONTACT, text: `Question ${org}` }), expected[org].secret);
      expect(res.status).toBe(200);
      await world.settle();
      expect(expectAllSentBy(org, from)).toBeGreaterThan(0);
    }

    expect(metaTexts(world.sent)).toEqual([first, second].map((org) => ({
      phoneNumberId: expected[org].pnid,
      authorization: expected[org].authorization,
      to: CONTACT,
      text: `Réponse de ${expected[org].agent} à : Question ${org}`,
    })));
    expect(chatCalls().map((c) => `${c.clientId}/${c.botId}`)).toEqual([expected[first].agent, expected[second].agent]);

    const data = await world.dataOf(CONTACT);
    expect(data.sessions).toEqual(expect.arrayContaining([
      { wa_number: ACME_NUMBER, client_id: 'acme', bot_id: 'ventes' },
      { wa_number: BETA_NUMBER, client_id: 'beta', bot_id: 'accueil' },
    ]));
    expect(data.sessions).toHaveLength(2);
    expect(data.conversations['acme/ventes']).toHaveLength(2);
    expect(data.conversations['beta/accueil']).toHaveLength(2);
    expect(data.conversations['beta/cm']).toEqual([]);
  });

  // audit 1.1
  it("contact commun sur CM.com : l'agent IA CM.com de l'URL répond avec son jeton de produit, sans toucher aux autres", async () => {
        const res = await world.postCm(BETA_CM_KEY, world.cmMessage({ id: 'cm.1', from: CM_CONTACT, text: 'Bonjour CM' }));
    expect(res.status).toBe(200);
    await world.settle();
    expect(expectAllSentBy('beta-cm')).toBeGreaterThan(0);
    const afterCm = world.sent.length;
    await world.postMeta('acme', world.metaMessage({ org: 'acme', id: 'wamid.acme.cm', from: CONTACT, text: 'Bonjour ACME' }), SECRET_A);
    await world.settle();
    expect(expectAllSentBy('acme', afterCm)).toBeGreaterThan(0);

    // Expéditeur : le numéro E.164 du compte sans « + » (transport par compte, tâche 4 du lot 2b-2).
    expect(cmTexts(world.sent)).toEqual([{ productToken: CM_TOKEN_B, from: BETA_CM_NUMBER.slice(1), text: 'Réponse de beta/cm à : Bonjour CM' }]);
    expect(metaTexts(world.sent).map((t) => t.phoneNumberId)).toEqual([PNID_A]);
    const data = await world.dataOf(CONTACT);
    expect(data.sessions.map((s) => `${s.client_id}/${s.bot_id}`).sort()).toEqual(['acme/ventes', 'beta/cm']);
    expect(data.conversations['beta/accueil']).toEqual([]);
  });

  // audit 1.2
  it("prompt de l'organisation B : aucun contenu échangé avec l'organisation A, ni son lead, ni sa réponse", async () => {
    const markerA = 'ZEBRE-CONFIDENTIEL-A-7731';
    llmBehavior.extraction = (call) => (call.clientId === 'acme' ? '{"prenom":"PrenomDeLaSocieteA"}' : '{}');
    await world.postMeta('acme', world.metaMessage({ org: 'acme', id: 'wamid.a', from: CONTACT, text: `Mon code est ${markerA}` }), SECRET_A);
    await world.settle();
    expect((await world.dataOf(CONTACT)).leads['acme/ventes']).toMatchObject({ prenom: 'PrenomDeLaSocieteA' });

    await world.postMeta('beta', world.metaMessage({ org: 'beta', id: 'wamid.b', from: CONTACT, text: 'Bonjour BETA' }), SECRET_B);
    await world.settle();

    const callsOfB = world.llmCalls.filter((c) => c.clientId === 'beta');
    expect(callsOfB.length).toBeGreaterThan(0);
    for (const call of callsOfB) {
      expect(call.everything).not.toContain(markerA);
      expect(call.everything).not.toContain('PrenomDeLaSocieteA');
      expect(call.everything).not.toContain('acme');
    }
    const chatOfB = callsOfB.find((c) => c.kind === 'chat');
    expect(chatOfB?.messages).toEqual([{ role: 'user', content: 'Bonjour BETA' }]);
  });

  // audit 3.1
  it.each([
    { cas: 'agent IA en brouillon', setup: () => setBotStatusOf(world.db, 'acme', 'ventes', 'draft') },
    { cas: 'agent IA en pause', setup: () => setBotStatusOf(world.db, 'acme', 'ventes', 'paused') },
    { cas: 'organisation suspendue', setup: () => world.db.upsertClient({ client_id: 'acme', name: 'acme', status: 'suspended' }) },
  ])("$cas : aucun appel LLM, aucun envoi, aucune session, compteur incrémenté, l'autre organisation reste servie", async ({ setup }) => {
    await setup();
    const res = await world.postMeta('acme', world.metaMessage({ org: 'acme', id: 'wamid.inactive', from: CONTACT }), SECRET_A);
    expect(res.status).toBe(200);
    await world.settle();

    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    const data = await world.dataOf(CONTACT);
    expectNoContactData(data);
    expect(data.unserved['acme/ventes']).toBe(1);
    expect(data.unserved['beta/accueil']).toBe(0);

    // L'autre organisation n'est pas touchée par l'arrêt de la première.
    await world.postMeta('beta', world.metaMessage({ org: 'beta', id: 'wamid.still', from: CONTACT }), SECRET_B);
    await world.settle();
    expect(metaTexts(world.sent).map((t) => t.phoneNumberId)).toEqual([PNID_B]);
    expect(expectAllSentBy('beta')).toBeGreaterThan(0);
  });

  // audit 3.1
  it('agent IA CM.com en pause : aucun appel LLM, aucun envoi, aucune session, compteur incrémenté', async () => {
        await setBotStatusOf(world.db, 'beta', 'cm', 'paused');
    const res = await world.postCm(BETA_CM_KEY, world.cmMessage({ id: 'cm.paused', from: CM_CONTACT }));
    expect(res.status).toBe(200);
    await world.settle();

    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    const data = await world.dataOf(CONTACT);
    expectNoContactData(data);
    expect(data.unserved['beta/cm']).toBe(1);
  });

  // audit 2.1 : sans secrets complets en base pour le compte, aucun repli sur les identifiants de la plateforme.
  describe("compte WhatsApp aux secrets incomplets, variables META_* et CM_* présentes dans l'environnement", () => {
    const ENV = {
      META_PHONE_NUMBER_ID: 'PNID-ENV', META_ACCESS_TOKEN: 'TOKEN-ENV', META_APP_SECRET: 'SECRET-ENV', META_VERIFY_TOKEN: 'VERIF-ENV',
      CM_PRODUCT_TOKEN: 'PRODUIT-ENV', CM_FROM_NUMBER: '0033100000099',
    };
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const [key, value] of Object.entries(ENV)) { saved[key] = process.env[key]; process.env[key] = value; }
    });

    afterEach(() => {
      for (const key of Object.keys(ENV)) {
        if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
      }
    });

    /** Compte de l'organisation dont le contenu chiffré ne porte que la clé d'URL, numéro branché sur un agent IA actif. */
    async function partialAccount(clientId: string, mode: 'meta_manual' | 'cm_com', key: string, phone: string, botId: string): Promise<number> {
      const { secret, keyVersion } = encryptJson({ mode, webhook_key: key });
      const created = await world.db.createWhatsAppAccountWithInventory({
        client_id: clientId, name: 'Partiel', mode, provider_account_id: `PARTIEL-${botId}`, waba_id: mode === 'meta_manual' ? `PARTIEL-${botId}` : null,
        meta_app_id: null, secret_encrypted: secret, key_version: keyVersion, webhook_key_hash: hashWebhookKey(key),
        token_expiry: null, last_verified_at: null,
      }, [{ provider_number_id: ENV.META_PHONE_NUMBER_ID, phone_e164: phone, display_name: phone, meta_status: null, quality: null, is_test: false, cm_channel_id: null }]);
      if (!created.ok) throw new Error('compte partiel refusé');
      const [numberRec] = await world.db.listWhatsAppNumbers(clientId, created.account.id);
      await createConnectedBot(world.db, { clientId, botId, numberId: numberRec!.id });
      return created.account.id;
    }

    // audit 2.1
    it('Meta : secret d\'app absent du compte, message signé avec le secret de la plateforme : ni envoi, ni LLM, ni donnée', async () => {
      const accountId = await partialAccount('acme', 'meta_manual', 'cle-partielle-meta', '+33100000009', 'sansidentifiants');
      const warn = vi.spyOn(console, 'warn');
      const payload = metaBody([{ wabaId: 'PARTIEL-sansidentifiants', displayPhone: '+33100000009', phoneNumberId: ENV.META_PHONE_NUMBER_ID, id: 'wamid.env', from: CONTACT }]);
      const res = await world.postMetaKey('cle-partielle-meta', payload, ENV.META_APP_SECRET);
      expect(res.status).toBe(200);
      await world.settle();
      // Contrôle positif : le compte a bien été identifié par sa clé, puis le lot écarté faute de secret.
      expect(warn.mock.calls.some((args) => String(args[0]).includes(`Secrets du compte ${accountId} illisibles ou incomplets`))).toBe(true);
      await expectNothingHappened('+33100000009', 'wamid.env');
    });

    // audit 2.1, 2.2
    it("CM.com : compte sans jeton de produit, URL authentifiée par sa clé : ni envoi avec CM_PRODUCT_TOKEN, ni LLM, ni donnée", async () => {
      const accountId = await partialAccount('beta', 'cm_com', 'cle-partielle-cm', '+33100000007', 'cmpartiel');
      const warn = vi.spyOn(console, 'warn');
      const res = await world.postCm('cle-partielle-cm', world.cmMessage({ id: 'cm.partiel', from: CM_CONTACT, to: '+33100000007' }));
      expect(res.status).toBe(200);
      await world.settle();
      // Contrôle positif : la clé est authentifiée et le message atteint la résolution du transport.
      expect(warn.mock.calls.some((args) => String(args[0]).includes(`Transport indisponible pour le compte ${accountId}`))).toBe(true);
      await expectNothingHappened('+33100000007', 'cm.partiel');
    });

    // audit 2.1
    it('CM.com : jeton de produit de la plateforme en guise de clé d\'URL : refusé, ni envoi, ni LLM, ni donnée', async () => {
      const res = await world.postCm(ENV.CM_PRODUCT_TOKEN, world.cmMessage({ id: 'cm.env', from: CM_CONTACT }));
      expect(res.status).toBe(404);
      await world.settle();
      await expectNothingHappened(BETA_CM_NUMBER, 'cm.env');
    });

    // audit 2.1, 4.3
    it('Meta : META_VERIFY_TOKEN de la plateforme n\'ouvre la vérification d\'aucun compte', async () => {
      const server = await serve(world.app);
      const query = { 'hub.mode': 'subscribe', 'hub.verify_token': ENV.META_VERIFY_TOKEN, 'hub.challenge': '1' };
      expect((await request(server).get(`/webhook/meta/${ACME_META_KEY}`).query(query)).status).toBe(403);
      expect((await request(server).get('/webhook/meta').query(query)).status).toBe(404);
    });
  });

  // audit 4.2
  describe('Meta : signature absente, fausse ou d\'une autre organisation', () => {
    it.each([
      { cas: 'signature absente', status: 401, url: 'acme' as const, secret: null as string | null, org: 'acme' as const, pnid: undefined, waba: undefined },
      { cas: 'signature calculée avec un faux secret', status: 200, url: 'acme' as const, secret: 'FAUX', org: 'acme' as const, pnid: undefined, waba: undefined },
      { cas: "signature du secret de l'autre organisation", status: 200, url: 'acme' as const, secret: SECRET_B, org: 'acme' as const, pnid: undefined, waba: undefined },
      { cas: "message de l'autre organisation signé avec le secret de la première, sur l'URL de la première", status: 200, url: 'acme' as const, secret: SECRET_A, org: 'beta' as const, pnid: undefined, waba: undefined },
      { cas: "message de l'autre organisation signé avec le secret de la première, sur l'URL de l'autre", status: 200, url: 'beta' as const, secret: SECRET_A, org: 'beta' as const, pnid: undefined, waba: undefined },
      { cas: "phone_number_id de l'autre organisation, signature valide", status: 200, url: 'acme' as const, secret: SECRET_A, org: 'acme' as const, pnid: PNID_B, waba: undefined },
      { cas: "numéro de la première, entrée et signature de l'autre sur l'URL de l'autre", status: 200, url: 'beta' as const, secret: SECRET_B, org: 'acme' as const, pnid: undefined, waba: WABA_B },
    ])('$cas : aucune session, conversation, lead, réservation, compteur, appel LLM ni envoi', async ({ status, url, secret, org, pnid, waba }) => {
      const id = 'wamid.refus';
      const number = org === 'acme' ? ACME_NUMBER : BETA_NUMBER;
      const res = await world.postMeta(url, world.metaMessage({ org, id, from: CONTACT, ...(pnid ? { phoneNumberId: pnid } : {}), ...(waba ? { wabaId: waba } : {}) }), secret);
      expect(res.status).toBe(status);
      await world.settle();
      await expectNothingHappened(number, id);
    });
  });

  // audit 4.1
  describe('CM.com : URL sans clé valide', () => {
    it.each([
      { cas: 'clé fausse', path: '/webhook/cm-com/FAUX' },
      { cas: 'jeton de produit en guise de clé', path: `/webhook/cm-com/${CM_TOKEN_B}` },
      { cas: 'clé tronquée', path: `/webhook/cm-com/${BETA_CM_KEY.slice(0, -1)}` },
      { cas: "ancienne forme d'URL avec la vraie clé (organisation et agent IA inconnus)", path: `/webhook/cm-com/beta/inconnu/${BETA_CM_KEY}` },
      { cas: 'clé du compte Meta appelée par la route CM.com', path: `/webhook/cm-com/${BETA_META_KEY}` },
      { cas: "ancienne forme d'URL d'une organisation inconnue avec la vraie clé", path: `/webhook/cm-com/gamma/cm/${BETA_CM_KEY}` },
    ])('$cas : 404, aucune session, conversation, lead, réservation, compteur, appel LLM ni envoi', async ({ path }) => {
      const res = await world.postPath(path, world.cmMessage({ id: 'cm.refus', from: CM_CONTACT }));
      expect(res.status).toBe(404);
      await world.settle();
      await expectNothingHappened(BETA_CM_NUMBER, 'cm.refus');
    });
  });

  // audit 5.3
  // Repose sur un vrai chevauchement des deux requêtes, sans barrière : une course de largeur nulle peut passer sur Postgres.
  it('relivraison concurrente du même message Meta : une seule réponse, un seul appel LLM, puis une relivraison tardive ignorée', async () => {
    const payload = world.metaMessage({ org: 'acme', id: 'wamid.double', from: CONTACT, text: 'Une seule fois' });
    const [a, b] = await Promise.all([world.postMeta('acme', payload, SECRET_A), world.postMeta('acme', payload, SECRET_A)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await world.settle();
    await world.postMeta('acme', payload, SECRET_A);
    await world.settle();

    expect(metaTexts(world.sent).map((t) => t.text)).toEqual(['Réponse de acme/ventes à : Une seule fois']);
    expect(chatCalls()).toHaveLength(1);
    expect(expectAllSentBy('acme')).toBeGreaterThan(0);
    expect((await world.dataOf(CONTACT)).conversations['acme/ventes']).toHaveLength(2);
  });

  // audit 5.3
  it('relivraison concurrente du même message CM.com : une seule réponse', async () => {
        const payload = world.cmMessage({ id: 'cm.double', from: CM_CONTACT, text: 'Une seule fois' });
    await Promise.all([world.postCm(BETA_CM_KEY, payload), world.postCm(BETA_CM_KEY, payload)]);
    await world.settle();

    expect(cmTexts(world.sent).map((t) => t.text)).toEqual(['Réponse de beta/cm à : Une seule fois']);
    expect(expectAllSentBy('beta-cm')).toBeGreaterThan(0);
    expect(chatCalls()).toHaveLength(1);
  });

  // audit 1.3
  it("commandes /sessions, /leads et /reset all envoyées par un contact : du texte ordinaire pour le LLM de son agent IA, aucune donnée d'une autre organisation", async () => {
    const markerB = 'DONNEE-CONFIDENTIELLE-B-4410';
    llmBehavior.extraction = (call) => (call.clientId === 'beta' ? '{"prenom":"PrenomDeLaSocieteB"}' : '{}');
    await world.postMeta('beta', world.metaMessage({ org: 'beta', id: 'wamid.b0', from: CONTACT, text: markerB }), SECRET_B);
    await world.settle();
    const betaBefore = await world.dataOf(CONTACT);
    expect(betaBefore.conversations['beta/accueil']).toHaveLength(2);
    expect(betaBefore.leads['beta/accueil']).toMatchObject({ prenom: 'PrenomDeLaSocieteB' });
    world.llmCalls.length = 0;
    world.sent.length = 0;

    const commands = ['/sessions', '/leads', '/reset all'];
    for (const [i, command] of commands.entries()) {
      await world.postMeta('acme', world.metaMessage({ org: 'acme', id: `wamid.cmd${i}`, from: CONTACT, text: command }), SECRET_A);
      await world.settle();
    }

    expect(chatCalls().map((c) => `${c.clientId}/${c.botId}`)).toEqual(['acme/ventes', 'acme/ventes', 'acme/ventes']);
    expect(chatCalls().map((c) => c.messages[c.messages.length - 1]?.content)).toEqual(commands);
    expect(metaTexts(world.sent).map((t) => t.text)).toEqual(commands.map((c) => `Réponse de acme/ventes à : ${c}`));
    for (const call of world.llmCalls) {
      expect(call.everything).not.toContain(markerB);
      expect(call.everything).not.toContain('PrenomDeLaSocieteB');
    }
    for (const sentCall of world.sent) {
      expect(JSON.stringify(sentCall.body)).not.toContain(markerB);
    }
    expect(expectAllSentBy('acme')).toBeGreaterThan(0);
    // Rien n'a été lu ni effacé chez l'autre organisation.
    const after = await world.dataOf(CONTACT);
    expect(after.conversations['beta/accueil']).toEqual(betaBefore.conversations['beta/accueil']);
    expect(after.leads['beta/accueil']).toEqual(betaBefore.leads['beta/accueil']);
    expect(after.sessions).toEqual(expect.arrayContaining(betaBefore.sessions));
    expect(after.conversations['acme/ventes']).toHaveLength(6);
  });

  // audit 5.10
  it.each(['reset', 'RESET'])('mot « %s » envoyé par un contact : message ordinaire, historique et lead du contact intacts', async (word) => {
    llmBehavior.extraction = () => '{"prenom":"Camille"}';
    await world.postMeta('acme', world.metaMessage({ org: 'acme', id: 'wamid.r0', from: CONTACT, text: 'Je suis Camille' }), SECRET_A);
    await world.settle();
    const before = await world.dataOf(CONTACT);
    expect(before.leads['acme/ventes']).toMatchObject({ prenom: 'Camille' });
    world.llmCalls.length = 0;
    world.sent.length = 0;

    await world.postMeta('acme', world.metaMessage({ org: 'acme', id: 'wamid.r1', from: CONTACT, text: word }), SECRET_A);
    await world.settle();

    const [chat] = chatCalls();
    expect(chatCalls()).toHaveLength(1);
    expect(chat?.messages.map((m) => m.content)).toEqual([
      'Je suis Camille', JSON.stringify({ type: 'text', text: 'Réponse de acme/ventes à : Je suis Camille' }), word,
    ]);
    const after = await world.dataOf(CONTACT);
    expect(after.conversations['acme/ventes']).toHaveLength(4);
    expect(after.conversations['acme/ventes']).toEqual(expect.arrayContaining(before.conversations['acme/ventes']));
    expect(after.leads['acme/ventes']).toMatchObject({ prenom: 'Camille' });
    expect(after.sessions).toEqual(before.sessions);
    expect(metaTexts(world.sent).map((t) => t.text)).toEqual([`Réponse de acme/ventes à : ${word}`]);
    expect(expectAllSentBy('acme')).toBeGreaterThan(0);
  });
});
