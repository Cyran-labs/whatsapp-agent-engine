/**
 * Suite d'isolation « deux organisations » : permanente, par le vrai chemin webhook (HTTP, signatures
 * réelles, identifiants chiffrés en base). Elle doit casser si l'isolation entre organisations est violée :
 * repli sur l'environnement, routage par session, historique partagé entre agents IA, authentification
 * contournée, traitement d'un agent IA inactif.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import { upsertBot } from '../../core/config-store.js';
import { botRecord, cmTexts, metaBody, metaTexts } from '../../test-support/whatsapp.js';
import { llmBehavior } from './llm-mock.js';
import {
  ACME_NUMBER, BETA_CM_NUMBER, BETA_NUMBER, CM_TOKEN_B, PNID_A, PNID_B, SECRET_A, SECRET_B, SHARED_CONTACT,
  TOKEN_A, TOKEN_B, setupTwoOrgs,
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
    await world.close();
  });

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
      const res = await world.postMeta(world.metaMessage({ org, id: `wamid.${org}.1`, from: CONTACT, text: `Question ${org}` }), expected[org].secret);
      expect(res.status).toBe(200);
      await world.settle();
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
    const secretCm = await world.cmSecret('beta', 'cm');
    const res = await world.postCm('beta', 'cm', secretCm, world.cmMessage({ id: 'cm.1', from: CM_CONTACT, text: 'Bonjour CM' }));
    expect(res.status).toBe(200);
    await world.settle();
    await world.postMeta(world.metaMessage({ org: 'acme', id: 'wamid.acme.cm', from: CONTACT, text: 'Bonjour ACME' }), SECRET_A);
    await world.settle();

    expect(cmTexts(world.sent)).toEqual([{ productToken: CM_TOKEN_B, from: BETA_CM_NUMBER.replace('+', '00'), text: 'Réponse de beta/cm à : Bonjour CM' }]);
    expect(metaTexts(world.sent).map((t) => t.phoneNumberId)).toEqual([PNID_A]);
    const data = await world.dataOf(CONTACT);
    expect(data.sessions.map((s) => `${s.client_id}/${s.bot_id}`).sort()).toEqual(['acme/ventes', 'beta/cm']);
    expect(data.conversations['beta/accueil']).toEqual([]);
  });

  // audit 1.2
  it("prompt de l'organisation B : aucun contenu échangé avec l'organisation A, ni son lead, ni sa réponse", async () => {
    const markerA = 'ZEBRE-CONFIDENTIEL-A-7731';
    llmBehavior.extraction = (call) => (call.clientId === 'acme' ? '{"prenom":"PrenomDeLaSocieteA"}' : '{}');
    await world.postMeta(world.metaMessage({ org: 'acme', id: 'wamid.a', from: CONTACT, text: `Mon code est ${markerA}` }), SECRET_A);
    await world.settle();
    expect((await world.dataOf(CONTACT)).leads['acme/ventes']).toMatchObject({ prenom: 'PrenomDeLaSocieteA' });

    await world.postMeta(world.metaMessage({ org: 'beta', id: 'wamid.b', from: CONTACT, text: 'Bonjour BETA' }), SECRET_B);
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
    { cas: 'agent IA en brouillon', setup: () => upsertBot(botRecord('acme', 'ventes', 'meta-cloud', { status: 'draft' })) },
    { cas: 'agent IA en pause', setup: () => upsertBot(botRecord('acme', 'ventes', 'meta-cloud', { status: 'paused' })) },
    { cas: 'organisation suspendue', setup: () => world.db.upsertClient({ client_id: 'acme', name: 'acme', status: 'suspended' }) },
  ])("$cas : aucun appel LLM, aucun envoi, aucune session, compteur incrémenté, l'autre organisation reste servie", async ({ setup }) => {
    await setup();
    const res = await world.postMeta(world.metaMessage({ org: 'acme', id: 'wamid.inactive', from: CONTACT }), SECRET_A);
    expect(res.status).toBe(200);
    await world.settle();

    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    const data = await world.dataOf(CONTACT);
    expectNoContactData(data);
    expect(data.unserved['acme/ventes']).toBe(1);
    expect(data.unserved['beta/accueil']).toBe(0);

    // L'autre organisation n'est pas touchée par l'arrêt de la première.
    await world.postMeta(world.metaMessage({ org: 'beta', id: 'wamid.still', from: CONTACT }), SECRET_B);
    await world.settle();
    expect(metaTexts(world.sent).map((t) => t.phoneNumberId)).toEqual([PNID_B]);
  });

  // audit 3.1
  it('agent IA CM.com en pause : aucun appel LLM, aucun envoi, aucune session, compteur incrémenté', async () => {
    const secretCm = await world.cmSecret('beta', 'cm');
    await upsertBot(botRecord('beta', 'cm', 'cm-com', { status: 'paused' }));
    const res = await world.postCm('beta', 'cm', secretCm, world.cmMessage({ id: 'cm.paused', from: CM_CONTACT }));
    expect(res.status).toBe(200);
    await world.settle();

    expect(world.llmCalls).toEqual([]);
    expect(world.fetchMock).not.toHaveBeenCalled();
    const data = await world.dataOf(CONTACT);
    expectNoContactData(data);
    expect(data.unserved['beta/cm']).toBe(1);
  });

  // audit 2.1
  describe('agent IA sans identifiants, variables META_* et CM_* présentes dans l\'environnement', () => {
    const ENV = {
      META_PHONE_NUMBER_ID: 'PNID-ENV', META_ACCESS_TOKEN: 'TOKEN-ENV', META_APP_SECRET: 'SECRET-ENV',
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

    // audit 2.1
    it('Meta : message signé avec le secret de la plateforme, ni envoi, ni LLM, ni donnée', async () => {
      await upsertBot(botRecord('acme', 'sansidentifiants', 'meta-cloud'), ['+33100000009']);
      const warn = vi.spyOn(console, 'warn');
      const payload = metaBody([{ displayPhone: '+33100000009', phoneNumberId: ENV.META_PHONE_NUMBER_ID, id: 'wamid.env', from: CONTACT }]);
      const res = await world.postMeta(payload, ENV.META_APP_SECRET);
      expect(res.status).toBe(200);
      await world.settle();
      // Le message a bien été routé vers l'agent IA sans identifiants, puis écarté faute d'identifiants.
      expect(warn.mock.calls.some((args) => String(args[0]).includes('Identifiants de transport incomplets pour acme/sansidentifiants'))).toBe(true);
      warn.mockRestore();
      await expectNothingHappened('+33100000009', 'wamid.env');
    });

    // audit 2.1
    it('CM.com : URL de webhook sans identifiants enregistrés, refusée, ni envoi, ni LLM, ni donnée', async () => {
      await upsertBot(botRecord('beta', 'cmsansidentifiants', 'cm-com'), ['+33100000008']);
      const res = await world.postCm('beta', 'cmsansidentifiants', ENV.CM_PRODUCT_TOKEN, world.cmMessage({ id: 'cm.env', from: CM_CONTACT, to: '+33100000008' }));
      expect(res.status).toBe(404);
      await world.settle();
      await expectNothingHappened('+33100000008', 'cm.env');
    });
  });

  // audit 4.2
  describe('Meta : signature absente, fausse ou d\'une autre organisation', () => {
    it.each([
      { cas: 'signature absente', status: 401, secret: null as string | null, org: 'acme' as const, pnid: undefined },
      { cas: 'signature calculée avec un faux secret', status: 200, secret: 'FAUX', org: 'acme' as const, pnid: undefined },
      { cas: "signature du secret de l'autre organisation", status: 200, secret: SECRET_B, org: 'acme' as const, pnid: undefined },
      { cas: "message de l'autre organisation signé avec le secret de la première", status: 200, secret: SECRET_A, org: 'beta' as const, pnid: undefined },
      { cas: "phone_number_id de l'autre organisation, signature valide", status: 200, secret: SECRET_A, org: 'acme' as const, pnid: PNID_B },
    ])('$cas : aucune session, conversation, lead, réservation, compteur, appel LLM ni envoi', async ({ status, secret, org, pnid }) => {
      const id = 'wamid.refus';
      const number = org === 'acme' ? ACME_NUMBER : BETA_NUMBER;
      const res = await world.postMeta(world.metaMessage({ org, id, from: CONTACT, ...(pnid ? { phoneNumberId: pnid } : {}) }), secret);
      expect(res.status).toBe(status);
      await world.settle();
      await expectNothingHappened(number, id);
    });
  });

  // audit 4.1
  describe('CM.com : URL sans secret valide', () => {
    it.each([
      { cas: 'secret faux' },
      { cas: 'secret vide du jeton de produit', secret: CM_TOKEN_B },
      { cas: "agent IA inconnu de l'organisation", botId: 'inconnu', useRealSecret: true },
      { cas: 'agent IA Meta appelé par la route CM.com', botId: 'accueil', useRealSecret: true },
      { cas: "organisation inconnue avec le secret d'un autre agent IA", clientId: 'gamma', useRealSecret: true },
    ] as Array<{ cas: string; secret?: string; botId?: string; clientId?: string; useRealSecret?: boolean }>)('$cas : 404, aucune session, conversation, lead, réservation, compteur, appel LLM ni envoi', async (c) => {
      const real = await world.cmSecret('beta', 'cm');
      const res = await world.postCm(c.clientId ?? 'beta', c.botId ?? 'cm', c.useRealSecret ? real : (c.secret ?? 'FAUX'), world.cmMessage({ id: 'cm.refus', from: CM_CONTACT }));
      expect(res.status).toBe(404);
      await world.settle();
      await expectNothingHappened(BETA_CM_NUMBER, 'cm.refus');
    });
  });

  // audit 5.3
  it('relivraison concurrente du même message Meta : une seule réponse, un seul appel LLM, puis une relivraison tardive ignorée', async () => {
    const payload = world.metaMessage({ org: 'acme', id: 'wamid.double', from: CONTACT, text: 'Une seule fois' });
    const [a, b] = await Promise.all([world.postMeta(payload, SECRET_A), world.postMeta(payload, SECRET_A)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await world.settle();
    await world.postMeta(payload, SECRET_A);
    await world.settle();

    expect(metaTexts(world.sent).map((t) => t.text)).toEqual(['Réponse de acme/ventes à : Une seule fois']);
    expect(chatCalls()).toHaveLength(1);
    expect((await world.dataOf(CONTACT)).conversations['acme/ventes']).toHaveLength(2);
  });

  // audit 5.3
  it('relivraison concurrente du même message CM.com : une seule réponse', async () => {
    const secretCm = await world.cmSecret('beta', 'cm');
    const payload = world.cmMessage({ id: 'cm.double', from: CM_CONTACT, text: 'Une seule fois' });
    await Promise.all([world.postCm('beta', 'cm', secretCm, payload), world.postCm('beta', 'cm', secretCm, payload)]);
    await world.settle();

    expect(cmTexts(world.sent).map((t) => t.text)).toEqual(['Réponse de beta/cm à : Une seule fois']);
    expect(chatCalls()).toHaveLength(1);
  });

  // audit 1.3
  it("commandes /sessions, /leads et /reset all envoyées par un contact : du texte ordinaire pour le LLM de son agent IA, aucune donnée d'une autre organisation", async () => {
    const markerB = 'DONNEE-CONFIDENTIELLE-B-4410';
    llmBehavior.extraction = (call) => (call.clientId === 'beta' ? '{"prenom":"PrenomDeLaSocieteB"}' : '{}');
    await world.postMeta(world.metaMessage({ org: 'beta', id: 'wamid.b0', from: CONTACT, text: markerB }), SECRET_B);
    await world.settle();
    const betaBefore = await world.dataOf(CONTACT);
    expect(betaBefore.conversations['beta/accueil']).toHaveLength(2);
    expect(betaBefore.leads['beta/accueil']).toMatchObject({ prenom: 'PrenomDeLaSocieteB' });
    world.llmCalls.length = 0;
    world.sent.length = 0;

    const commands = ['/sessions', '/leads', '/reset all'];
    for (const [i, command] of commands.entries()) {
      await world.postMeta(world.metaMessage({ org: 'acme', id: `wamid.cmd${i}`, from: CONTACT, text: command }), SECRET_A);
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
    await world.postMeta(world.metaMessage({ org: 'acme', id: 'wamid.r0', from: CONTACT, text: 'Je suis Camille' }), SECRET_A);
    await world.settle();
    const before = await world.dataOf(CONTACT);
    expect(before.leads['acme/ventes']).toMatchObject({ prenom: 'Camille' });
    world.llmCalls.length = 0;
    world.sent.length = 0;

    await world.postMeta(world.metaMessage({ org: 'acme', id: 'wamid.r1', from: CONTACT, text: word }), SECRET_A);
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
  });
});
