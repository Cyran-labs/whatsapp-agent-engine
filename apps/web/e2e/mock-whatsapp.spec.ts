import { test, expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { BotNumberSummary, WhatsAppAccountCreated, WhatsAppAccountReplaced, WhatsAppAccountView } from '@wabagent/contracts';
import { PASSWORD, resetMock } from './helpers';

/**
 * Le faux moteur répond sur les mêmes chemins, avec les mêmes vues, codes et messages de refus que le moteur réel
 * (`src/api/admin/routes/whatsapp-accounts.ts`, `bots.ts`). Ces tests appellent le faux moteur directement : les
 * parcours de bout en bout (tâche 9) s'appuient dessus.
 */

const API = 'http://localhost:4999/api/admin/v1';

// Messages exacts du moteur (packages/contracts/src/bot-status.ts, src/core/services/*).
const EMPTY_ALLOWLIST = "Ajoutez au moins un numéro à la liste d'accès limité.";
const NOT_FROM_DRAFT = "Passez d'abord en accès limité : seul un numéro de test peut être ouvert à tous directement.";
const NO_NUMBER = "Branchez un numéro WhatsApp avant d'activer l'agent IA.";
const INVALID_TRANSITION = 'Changement de statut impossible depuis le statut actuel.';
const BOT_NOT_FOUND = 'Agent IA introuvable.';
const BOT_OR_NUMBER_NOT_FOUND = 'Agent IA ou numéro WhatsApp introuvable.';
const NUMBERS_IN_USE = "Mettez d'abord en pause ou en brouillon les agents IA qui utilisent ce compte.";
const ALREADY_CONNECTED = 'Ce compte WhatsApp est déjà raccordé.';
const CANNOT_CONNECT = 'Ce compte ne peut pas être raccordé. Contactez le support.';
const ACCOUNT_NOT_FOUND = 'Compte WhatsApp introuvable.';
const INVALID_ENTRY = 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.';

const META_CREDENTIALS = {
  mode: 'meta_manual',
  name: 'Atelier Rive Gauche',
  waba_id: '556677889900112',
  access_token: 'EAAGtokenvalide-0123456789',
  app_secret: 'secretdelappmeta0123',
};

interface ApiError { code: string; message: string; details?: { path: string; message: string }[] }
/** Vue d'un agent IA telle que le moteur la renvoie (champs lus par ces tests). */
interface BotJson {
  bot_id: string;
  name: string;
  status: string;
  status_reason: string | null;
  allowlist: string[];
  unserved: { count: number; last_at: string | null };
  whatsapp_number: BotNumberSummary | null;
}

interface Session {
  get: (path: string) => Promise<APIResponse>;
  send: (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown) => Promise<APIResponse>;
}

async function sessionFor(request: APIRequestContext, email: string, clientId: string): Promise<Session> {
  const login = await request.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(200);
  const { access_token: token } = (await login.json()) as { access_token: string };
  const headers = { authorization: `Bearer ${token}`, 'x-organization-id': clientId };
  return {
    get: (path) => request.get(`${API}${path}`, { headers }),
    send: (method, path, data) => request.fetch(`${API}${path}`, { method, headers, ...(data === undefined ? {} : { data }) }),
  };
}

async function expectError(res: APIResponse, status: number, code: string, message?: string): Promise<ApiError> {
  expect(res.status()).toBe(status);
  const body = (await res.json()) as { error: ApiError };
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
  return body.error;
}

let admin: Session;

test.beforeEach(async ({ request }) => {
  await resetMock(request);
  admin = await sessionFor(request, 'demo@wabagent.test', 'c1');
});

test("comptes de l'organisation de démo : un compte, trois numéros, rien de l'autre organisation", async () => {
  const res = await admin.get('/whatsapp-accounts');
  expect(res.status()).toBe(200);
  const accounts = (await res.json()) as WhatsAppAccountView[];
  expect(accounts).toHaveLength(1);
  const [account] = accounts;
  expect(account).toMatchObject({
    id: 1,
    name: 'Boutique principale',
    mode: 'meta_manual',
    waba_id: '104829371625544',
    state: 'connected',
    error_reason: null,
    token_expiry: 'never',
    is_test: false,
    alerts: [],
  });
  // revue 2b-3 M-2 : la liste ne porte aucun secret de webhook, comme le moteur
  expect(JSON.stringify(accounts)).not.toContain('cle-demo');
  expect(JSON.stringify(accounts)).not.toContain('vt-demo-1234');
  expect(account).not.toHaveProperty('webhook');
  // la route dédiée sert le webhook du compte de l'organisation, 404 neutre pour celui d'une autre
  expect(await (await admin.get('/whatsapp-accounts/1/webhook')).json()).toEqual({
    path: '/webhook/meta/cle-demo', url: 'https://dev.wabagent.com/webhook/meta/cle-demo', verify_token: 'vt-demo-1234',
  });
  await expectError(await admin.get('/whatsapp-accounts/2/webhook'), 404, 'NOT_FOUND', ACCOUNT_NOT_FOUND);
  expect(account.numbers.map((n) => n.phone_e164)).toEqual(['+33184801234', '+33612457890', '+15551649072']);
  expect(account.numbers[0]).toMatchObject({ id: 1, provider_state: 'present', is_test: false, bot: { bot_id: 'demo-1', name: 'Support technique', status: 'active' } });
  expect(account.numbers[1]).toMatchObject({ id: 2, bot: null, is_test: false });
  expect(account.numbers[2]).toMatchObject({ id: 3, bot: null, is_test: true });
  expect(JSON.stringify(accounts)).not.toContain('+33955500123');

  const one = await admin.get('/whatsapp-accounts/1');
  expect(one.status()).toBe(200);
  expect((await one.json()) as WhatsAppAccountCreated).toMatchObject({ id: 1, name: 'Boutique principale' });
});

test("isolation : une ressource d'une autre organisation répond le même 404 qu'une ressource absente", async () => {
  // compte et numéro de c2 (compte 2, numéro 4) : 404 neutre, identique à un identifiant qui n'existe nulle part
  const other = await expectError(await admin.get('/whatsapp-accounts/2'), 404, 'NOT_FOUND', ACCOUNT_NOT_FOUND);
  const absent = await expectError(await admin.get('/whatsapp-accounts/999'), 404, 'NOT_FOUND', ACCOUNT_NOT_FOUND);
  expect(other.message).toBe(absent.message);
  for (const [method, path, data] of [
    ['GET', '/whatsapp-accounts/2/webhook', undefined],
    ['PATCH', '/whatsapp-accounts/2', { name: 'Pris' }],
    ['PUT', '/whatsapp-accounts/2/credentials', META_CREDENTIALS],
    ['POST', '/whatsapp-accounts/2/verify', undefined],
    ['POST', '/whatsapp-accounts/2/refresh-numbers', undefined],
    ['POST', '/whatsapp-accounts/2/disconnect', undefined],
    ['PATCH', '/whatsapp-accounts/2/numbers/4', { is_test: true }],
    ['PATCH', '/whatsapp-accounts/1/numbers/4', { is_test: true }],
  ] as const) {
    await expectError(await admin.send(method, path, data), 404, 'NOT_FOUND');
  }

  // brancher ou activer avec le numéro de c2, ou un agent IA de c2 : 404 neutre, rien ne change
  await expectError(await admin.send('PUT', '/bots/demo-3/number', { number_id: 4, expected_bot_id: null }), 404, 'NOT_FOUND', BOT_OR_NUMBER_NOT_FOUND);
  await expectError(await admin.send('POST', '/bots/demo-3/activate', { number_id: 4, expected_bot_id: null, status: 'active' }), 404, 'NOT_FOUND', BOT_OR_NUMBER_NOT_FOUND);
  for (const [method, path, data, message] of [
    ['GET', '/bots/demo-2', undefined, BOT_NOT_FOUND],
    ['PUT', '/bots/demo-2/number', { number_id: 2, expected_bot_id: null }, BOT_OR_NUMBER_NOT_FOUND],
    ['POST', '/bots/demo-2/number/unassign', { expected_number_id: 2 }, BOT_NOT_FOUND],
    ['PUT', '/bots/demo-2/status', { status: 'draft' }, BOT_NOT_FOUND],
    ['PUT', '/bots/demo-2/allowlist', { entries: ['+33611111111'] }, BOT_NOT_FOUND],
    ['POST', '/bots/demo-2/activate', { number_id: 2, expected_bot_id: null, status: 'limited', allowlist: ['+33611111111'] }, BOT_OR_NUMBER_NOT_FOUND],
  ] as const) {
    // même texte qu'un agent IA qui n'existe nulle part
    const res = method === 'GET' ? await admin.get(path) : await admin.send(method, path, data);
    await expectError(res, 404, 'NOT_FOUND', message);
  }
  const demo3 = (await (await admin.get('/bots/demo-3')).json()) as BotJson;
  expect(demo3).toMatchObject({ status: 'draft', whatsapp_number: null, allowlist: [] });
  const list = (await (await admin.get('/bots')).json()) as BotJson[];
  expect(list.map((b) => b.bot_id).sort()).toEqual(['demo-1', 'demo-3']);
});

test("un membre qui n'est pas administrateur ne lit ni ne modifie les comptes, ni les actions de l'agent IA", async ({ request }) => {
  const advisor = await sessionFor(request, 'advisor@wabagent.test', 'c1');
  await expectError(await advisor.get('/whatsapp-accounts'), 403, 'FORBIDDEN');
  await expectError(await advisor.send('POST', '/whatsapp-accounts', META_CREDENTIALS), 403, 'FORBIDDEN');
  await expectError(await advisor.send('POST', '/whatsapp-accounts/1/disconnect'), 403, 'FORBIDDEN');
  await expectError(await advisor.send('PUT', '/bots/demo-3/number', { number_id: 2, expected_bot_id: null }), 403, 'FORBIDDEN');
  await expectError(await advisor.send('POST', '/bots/demo-3/activate', { number_id: 3, expected_bot_id: null, status: 'active' }), 403, 'FORBIDDEN');
  // lecture de l'agent IA permise à tout membre
  expect((await advisor.get('/bots/demo-1')).status()).toBe(200);
});

test("vue d'un agent IA : numéro branché, liste d'accès limité, messages non servis, motif de statut", async () => {
  const demo1 = (await (await admin.get('/bots/demo-1')).json()) as BotJson;
  expect(demo1).toMatchObject({
    bot_id: 'demo-1',
    status: 'active',
    status_reason: null,
    allowlist: [],
    unserved: { count: 0, last_at: null },
    whatsapp_number: {
      id: 1,
      phone_e164: '+33184801234',
      display_name: 'Boutique Paris',
      is_test: false,
      provider_state: 'present',
      quality: 'GREEN',
      account: { id: 1, name: 'Boutique principale', mode: 'meta_manual', state: 'connected', error_reason: null },
    },
  });
  const demo3 = (await (await admin.get('/bots/demo-3')).json()) as BotJson;
  expect(demo3).toMatchObject({ bot_id: 'demo-3', name: 'Accueil boutique', status: 'draft', whatsapp_number: null, allowlist: [], status_reason: null });
  const health = (await (await admin.get('/bots/demo-1/health')).json()) as { whatsapp: { number: BotNumberSummary | null } };
  expect(health.whatsapp.number).toMatchObject({ id: 1, phone_e164: '+33184801234', account: { name: 'Boutique principale' } });
});

test("activer en accès limité sans liste est refusé avec le message du moteur, rien n'est branché", async () => {
  const res = await admin.send('POST', '/bots/demo-3/activate', { number_id: 2, expected_bot_id: null, status: 'limited', allowlist: [] });
  await expectError(res, 409, 'CONFLICT', EMPTY_ALLOWLIST);
  // aucun effet : l'agent IA reste en brouillon, le numéro reste libre
  const demo3 = (await (await admin.get('/bots/demo-3')).json()) as BotJson;
  expect(demo3).toMatchObject({ status: 'draft', whatsapp_number: null, allowlist: [] });
  const account = (await (await admin.get('/whatsapp-accounts/1')).json()) as WhatsAppAccountView;
  expect(account.numbers[1].bot).toBeNull();
});

test("activer en accès limité avec une liste : branche le numéro, enregistre la liste normalisée et passe en accès limité", async () => {
  const res = await admin.send('POST', '/bots/demo-3/activate', {
    number_id: 2, expected_bot_id: null, status: 'limited', allowlist: ['+33 6 12 34 56 78', '0033 6 11 22 33 44', '+33611223344', 'FR.abc123'],
  });
  expect(res.status()).toBe(200);
  const bot = (await res.json()) as BotJson;
  expect(bot).toMatchObject({ bot_id: 'demo-3', status: 'limited', whatsapp_number: { id: 2, phone_e164: '+33612457890' } });
  // doublons fusionnés, BSUID conservé, numéros en E.164
  expect(bot.allowlist).toEqual(['+33612345678', '+33611223344', 'FR.abc123']);
});

test("activer en accès limité : une entrée invalide est refusée sous son indice, sans rien enregistrer", async () => {
  const res = await admin.send('POST', '/bots/demo-3/activate', { number_id: 2, expected_bot_id: null, status: 'limited', allowlist: ['+33611223344', 'pas un numéro'] });
  const error = await expectError(res, 400, 'VALIDATION_ERROR');
  expect(error.details).toEqual([{ path: 'allowlist.1', message: INVALID_ENTRY }]);
  expect(((await (await admin.get('/bots/demo-3')).json()) as BotJson).whatsapp_number).toBeNull();
});

test("activer en accès à tous depuis le brouillon : permis sur un numéro de test, refusé sur un numéro réel", async () => {
  // numéro de test : activation directe en `active` acceptée
  const ok = await admin.send('POST', '/bots/demo-3/activate', { number_id: 3, expected_bot_id: null, status: 'active' });
  expect(ok.status()).toBe(200);
  expect((await ok.json()) as BotJson).toMatchObject({ status: 'active', whatsapp_number: { id: 3, phone_e164: '+15551649072', is_test: true } });

  // numéro réel depuis le brouillon : refusé
  await admin.send('POST', '/bots/demo-3/number/unassign', { expected_number_id: 3 });
  const refused = await admin.send('POST', '/bots/demo-3/activate', { number_id: 2, expected_bot_id: null, status: 'active' });
  await expectError(refused, 409, 'CONFLICT', NOT_FROM_DRAFT);
});

test("brancher et débrancher un numéro : le numéro d'un autre agent IA est repris, le débranchement répond 200 avec la vue", async () => {
  // demo-3 prend le numéro de demo-1 (actif) : demo-1 repasse en brouillon et le perd
  const taken = await admin.send('PUT', '/bots/demo-3/number', { number_id: 1, expected_bot_id: 'demo-1' });
  expect(taken.status()).toBe(200);
  expect((await taken.json()) as BotJson).toMatchObject({ bot_id: 'demo-3', status: 'draft', whatsapp_number: { id: 1 } });
  const demo1 = (await (await admin.get('/bots/demo-1')).json()) as BotJson;
  expect(demo1).toMatchObject({ status: 'draft', whatsapp_number: null });

  // brancher le même numéro une seconde fois : sans effet
  const again = await admin.send('PUT', '/bots/demo-3/number', { number_id: 1, expected_bot_id: 'demo-3' });
  expect(again.status()).toBe(200);

  // changer de numéro libère l'ancien
  await admin.send('PUT', '/bots/demo-3/number', { number_id: 2, expected_bot_id: null });
  const account = (await (await admin.get('/whatsapp-accounts/1')).json()) as WhatsAppAccountView;
  expect(account.numbers.map((n) => n.bot?.bot_id ?? null)).toEqual([null, 'demo-3', null]);

  // débrancher : 200 avec la vue de l'agent IA
  const removed = await admin.send('POST', '/bots/demo-3/number/unassign', { expected_number_id: 2 });
  expect(removed.status()).toBe(200);
  expect((await removed.json()) as BotJson).toMatchObject({ bot_id: 'demo-3', whatsapp_number: null });
  // plus de numéro branché : le numéro attendu n'est plus le bon, 409 comme le moteur
  await expectError(await admin.send('POST', '/bots/demo-3/number/unassign', { expected_number_id: 2 }), 409, 'CONFLICT');
});

// revue finale 2b-3 I-2 : même règle que le moteur pour le débranchement
test("débrancher avec un numéro attendu périmé : 409 avec le détail expected_bot_id, l'agent IA garde son numéro et son statut", async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  // demo-1 (actif) passe du numéro 1 au numéro 3 (test) ; l'écran visait encore le numéro 1
  expect((await admin.send('PUT', '/bots/demo-1/number', { number_id: 3, expected_bot_id: null })).status()).toBe(200);
  const error = await expectError(await admin.send('POST', '/bots/demo-1/number/unassign', { expected_number_id: 1 }), 409, 'CONFLICT', stale);
  expect(error.details).toEqual([{ path: 'expected_bot_id', message: stale }]);
  expect(((await (await admin.get('/bots/demo-1')).json()) as BotJson)).toMatchObject({ status: 'active', whatsapp_number: { id: 3 } });
  // le champ est obligatoire ; l'ancienne route DELETE n'existe plus
  await expectError(await admin.send('POST', '/bots/demo-1/number/unassign', {}), 400, 'VALIDATION_ERROR');
  expect((await admin.send('DELETE', '/bots/demo-1/number')).status()).toBe(404);
});

// revue 2b-3 M-1 : même règle que le moteur (409 sans rien écrire quand le détenteur vu n'est plus le bon)
test("détenteur attendu périmé : 409 « Ce numéro a changé » avec le détail expected_bot_id, rien n'est écrit, l'agent IA en service garde son numéro", async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  const assign = await admin.send('PUT', '/bots/demo-3/number', { number_id: 1, expected_bot_id: null });
  const error = await expectError(assign, 409, 'CONFLICT', stale);
  expect(error.details).toEqual([{ path: 'expected_bot_id', message: stale }]);
  await expectError(await admin.send('POST', '/bots/demo-3/activate', { number_id: 1, expected_bot_id: 'demo-9', status: 'limited', allowlist: ['+33611223344'] }), 409, 'CONFLICT', stale);
  expect(((await (await admin.get('/bots/demo-1')).json()) as BotJson)).toMatchObject({ status: 'active', whatsapp_number: { id: 1 } });
  expect(((await (await admin.get('/bots/demo-3')).json()) as BotJson)).toMatchObject({ status: 'draft', whatsapp_number: null, allowlist: [] });
  // le détenteur à jour est accepté
  expect((await admin.send('PUT', '/bots/demo-3/number', { number_id: 1, expected_bot_id: 'demo-1' })).status()).toBe(200);
  // le champ est obligatoire
  await expectError(await admin.send('PUT', '/bots/demo-3/number', { number_id: 2 }), 400, 'VALIDATION_ERROR');
  await expectError(await admin.send('POST', '/bots/demo-3/activate', { number_id: 2, status: 'limited', allowlist: ['+33611223344'] }), 400, 'VALIDATION_ERROR');
});

test("un agent IA actif qui change de numéro garde son statut et libère l'ancien numéro", async () => {
  const res = await admin.send('PUT', '/bots/demo-1/number', { number_id: 3, expected_bot_id: null });
  expect(res.status()).toBe(200);
  expect((await res.json()) as BotJson).toMatchObject({ bot_id: 'demo-1', status: 'active', whatsapp_number: { id: 3, is_test: true } });
  const account = (await (await admin.get('/whatsapp-accounts/1')).json()) as WhatsAppAccountView;
  expect(account.numbers.map((n) => n.bot?.bot_id ?? null)).toEqual([null, null, 'demo-1']);
});

test("statut : la machine d'états du moteur décide, avec ses messages exacts", async () => {
  // brouillon sans numéro
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'limited' }), 409, 'CONFLICT', NO_NUMBER);
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'active' }), 409, 'CONFLICT', NO_NUMBER);
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'paused' }), 409, 'CONFLICT', INVALID_TRANSITION);
  expect((await admin.send('PUT', '/bots/demo-3/status', { status: 'draft' })).status()).toBe(200);
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'ouvert' }), 400, 'VALIDATION_ERROR');

  // numéro branché mais liste vide
  await admin.send('PUT', '/bots/demo-3/number', { number_id: 2, expected_bot_id: null });
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'limited' }), 409, 'CONFLICT', EMPTY_ALLOWLIST);
  // numéro réel depuis le brouillon : pas d'ouverture directe
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'active' }), 409, 'CONFLICT', NOT_FROM_DRAFT);

  // liste puis accès limité, ouverture à tous, pause, retour en brouillon
  await admin.send('PUT', '/bots/demo-3/allowlist', { entries: ['+33611223344'] });
  expect(((await (await admin.send('PUT', '/bots/demo-3/status', { status: 'limited' })).json()) as BotJson).status).toBe('limited');
  expect(((await (await admin.send('PUT', '/bots/demo-3/status', { status: 'active' })).json()) as BotJson).status).toBe('active');
  expect(((await (await admin.send('PUT', '/bots/demo-3/status', { status: 'paused' })).json()) as BotJson).status).toBe('paused');
  expect(((await (await admin.send('PUT', '/bots/demo-3/status', { status: 'draft' })).json()) as BotJson).status).toBe('draft');
});

test("liste d'accès limité : normalisée, une erreur par entrée, 20 au plus, jamais vide pour un agent IA en accès limité", async () => {
  const res = await admin.send('PUT', '/bots/demo-3/allowlist', { entries: ['0033 6 11 22 33 44', '+33 6 11 22 33 44', '+33611223344', ' FR.abc123 ', '+44 7700 900123'] });
  expect(res.status()).toBe(200);
  expect(((await res.json()) as BotJson).allowlist).toEqual(['+33611223344', 'FR.abc123', '+447700900123']);

  const invalid = await expectError(await admin.send('PUT', '/bots/demo-3/allowlist', { entries: ['+33611223344', 'abc', '06 12 34 56 78'] }), 400, 'VALIDATION_ERROR');
  expect(invalid.details).toEqual([
    { path: 'entries.1', message: INVALID_ENTRY },
    { path: 'entries.2', message: INVALID_ENTRY },
  ]);
  // la liste précédente est conservée
  expect(((await (await admin.get('/bots/demo-3')).json()) as BotJson).allowlist).toEqual(['+33611223344', 'FR.abc123', '+447700900123']);

  const tooMany = Array.from({ length: 21 }, (_, i) => `+3361100${String(1000 + i)}`);
  const over = await expectError(await admin.send('PUT', '/bots/demo-3/allowlist', { entries: tooMany }), 400, 'VALIDATION_ERROR');
  expect(over.details).toEqual([{ path: 'entries', message: '20 entrées au plus.' }]);

  // liste vide : permise en brouillon, refusée en accès limité
  expect((await admin.send('PUT', '/bots/demo-3/allowlist', { entries: [] })).status()).toBe(200);
  await admin.send('PUT', '/bots/demo-3/number', { number_id: 2, expected_bot_id: null });
  await admin.send('PUT', '/bots/demo-3/allowlist', { entries: ['+33611223344'] });
  await admin.send('PUT', '/bots/demo-3/status', { status: 'limited' });
  await expectError(await admin.send('PUT', '/bots/demo-3/allowlist', { entries: [] }), 409, 'CONFLICT', EMPTY_ALLOWLIST);
});

test("déconnexion : refusée tant qu'un numéro sert un agent IA en accès limité ou actif, acceptée une fois en brouillon", async () => {
  const refused = await admin.send('POST', '/whatsapp-accounts/1/disconnect');
  const error = await expectError(refused, 409, 'CONFLICT', NUMBERS_IN_USE);
  expect(error.details).toEqual([{ path: 'bots.demo-1', message: 'Support technique' }]);
  // rien n'a changé
  expect(((await (await admin.get('/whatsapp-accounts/1')).json()) as WhatsAppAccountView).state).toBe('connected');

  // en pause, l'agent IA ne sert plus : la déconnexion passe
  await admin.send('PUT', '/bots/demo-1/status', { status: 'paused' });
  const done = await admin.send('POST', '/whatsapp-accounts/1/disconnect');
  expect(done.status()).toBe(204);
  const account = (await (await admin.get('/whatsapp-accounts/1')).json()) as WhatsAppAccountView;
  expect(account).toMatchObject({ state: 'disconnected', numbers: [], is_test: false });
  expect(await (await admin.get('/whatsapp-accounts/1/webhook')).json()).toEqual({ path: '', url: null, verify_token: null });
  // le compte déconnecté reste listé, l'agent IA a perdu son numéro, la déconnexion répétée est sans effet
  expect(((await (await admin.get('/whatsapp-accounts')).json()) as WhatsAppAccountView[]).map((a) => a.id)).toEqual([1]);
  expect(((await (await admin.get('/bots/demo-1')).json()) as BotJson).whatsapp_number).toBeNull();
  expect((await admin.send('POST', '/whatsapp-accounts/1/disconnect')).status()).toBe(204);
  // un compte déconnecté n'accepte ni vérification, ni nouveaux identifiants, ni rafraîchissement, et ses numéros ne se branchent plus
  await expectError(await admin.send('POST', '/whatsapp-accounts/1/verify'), 409, 'CONFLICT', 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.');
  await expectError(await admin.send('POST', '/whatsapp-accounts/1/refresh-numbers'), 409, 'CONFLICT', 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.');
  await expectError(await admin.send('PUT', '/whatsapp-accounts/1/credentials', { ...META_CREDENTIALS, waba_id: '104829371625544' }), 409, 'CONFLICT');
  await expectError(await admin.send('PUT', '/bots/demo-3/number', { number_id: 2, expected_bot_id: null }), 404, 'NOT_FOUND', BOT_OR_NUMBER_NOT_FOUND);
});

test("un compte déconnecté ne permet pas d'activer : le numéro n'existe plus", async () => {
  await admin.send('PUT', '/bots/demo-1/status', { status: 'draft' });
  expect((await admin.send('POST', '/whatsapp-accounts/1/disconnect')).status()).toBe(204);
  await expectError(await admin.send('POST', '/bots/demo-3/activate', { number_id: 3, expected_bot_id: null, status: 'active' }), 404, 'NOT_FOUND', BOT_OR_NUMBER_NOT_FOUND);
  // sans numéro, l'agent IA ne s'active pas (message du moteur)
  await expectError(await admin.send('PUT', '/bots/demo-3/status', { status: 'limited' }), 409, 'CONFLICT', NO_NUMBER);
});

test('raccordement : 201 avec la vue, les contrôles et le bilan ; WABA 000000 refusée en 422 avec les contrôles en échec', async () => {
  const failed = await admin.send('POST', '/whatsapp-accounts', { ...META_CREDENTIALS, waba_id: '000000' });
  const error = await expectError(failed, 422, 'WA_VALIDATION_FAILED');
  expect((error.details ?? []).length).toBeGreaterThan(0);
  expect((error.details ?? [])[0]).toMatchObject({ path: 'waba_access' });
  // rien n'a été créé
  expect(((await (await admin.get('/whatsapp-accounts')).json()) as WhatsAppAccountView[]).map((a) => a.id)).toEqual([1]);

  const created = await admin.send('POST', '/whatsapp-accounts', META_CREDENTIALS);
  expect(created.status()).toBe(201);
  const account = (await created.json()) as WhatsAppAccountCreated;
  expect(account).toMatchObject({
    name: 'Atelier Rive Gauche', mode: 'meta_manual', waba_id: '556677889900112', provider_account_id: '556677889900112',
    state: 'connected', error_reason: null, alerts: [],
    inventory: { added: 1, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 },
  });
  expect(account.id).toBeGreaterThan(2);
  expect(account.checks.every((c) => c.status === 'ok' || c.status === 'created')).toBe(true);
  expect(account.webhook.path).toMatch(/^\/webhook\/meta\/[A-Za-z0-9_-]+$/);
  expect(account.webhook.url).toBe(`https://dev.wabagent.com${account.webhook.path}`);
  expect(account.webhook.verify_token).toBeTruthy();
  expect(account.numbers).toHaveLength(1);
  // aucun secret dans la vue
  expect(JSON.stringify(account)).not.toContain(META_CREDENTIALS.access_token);
  expect(JSON.stringify(account)).not.toContain(META_CREDENTIALS.app_secret);
  expect(((await (await admin.get('/whatsapp-accounts')).json()) as WhatsAppAccountView[]).map((a) => a.id)).toEqual([1, account.id]);
});

test('raccordement : compte déjà raccordé, compte tenu par une autre organisation (message neutre), corps invalide en 400', async () => {
  await expectError(await admin.send('POST', '/whatsapp-accounts', { ...META_CREDENTIALS, waba_id: '104829371625544' }), 409, 'CONFLICT', ALREADY_CONNECTED);
  // WABA de c2 : même message neutre que n'importe quel refus du choix 3, rien ne dit à qui elle appartient
  await expectError(await admin.send('POST', '/whatsapp-accounts', { ...META_CREDENTIALS, waba_id: '208374650192837' }), 409, 'CONFLICT', CANNOT_CONNECT);
  // revue 2b-2 I-1 : le refus neutre vient après la vérification du fournisseur. Avec de mauvais identifiants sur une
  // WABA tenue par c2, la réponse est le 422 de vérification, qui ne révèle pas que la WABA est tenue.
  const unverified = await expectError(
    await admin.send('POST', '/whatsapp-accounts', { ...META_CREDENTIALS, waba_id: '208374650192837', access_token: 'EAAG-jeton-refuse-0000' }),
    422, 'WA_VALIDATION_FAILED',
  );
  expect(unverified.details).toEqual([{ path: 'token', message: 'Le jeton est refusé par Meta.' }]);
  // même organisation : « déjà raccordé » sans attendre la vérification
  await expectError(
    await admin.send('POST', '/whatsapp-accounts', { ...META_CREDENTIALS, waba_id: '104829371625544', access_token: 'EAAG-jeton-refuse-0000' }),
    409, 'CONFLICT', ALREADY_CONNECTED,
  );

  const invalid = await expectError(await admin.send('POST', '/whatsapp-accounts', { ...META_CREDENTIALS, waba_id: 'abc', name: '  ' }), 400, 'VALIDATION_ERROR');
  expect((invalid.details ?? []).map((d) => d.path).sort()).toEqual(['name', 'waba_id']);
  await expectError(await admin.send('POST', '/whatsapp-accounts', { mode: 'sms' }), 400, 'VALIDATION_ERROR');
});

test("renommer, marquer un numéro de test, vérifier, rafraîchir, remplacer les identifiants", async () => {
  const renamed = await admin.send('PATCH', '/whatsapp-accounts/1', { name: '  Boutique Lyon  ' });
  expect(renamed.status()).toBe(200);
  expect((await renamed.json()) as WhatsAppAccountCreated).toMatchObject({ id: 1, name: 'Boutique Lyon' });
  const blank = await expectError(await admin.send('PATCH', '/whatsapp-accounts/1', { name: ' ' }), 400, 'VALIDATION_ERROR');
  expect((blank.details ?? [])[0]).toMatchObject({ path: 'name' });

  const flagged = await admin.send('PATCH', '/whatsapp-accounts/1/numbers/2', { is_test: true });
  expect(flagged.status()).toBe(200);
  const account = (await flagged.json()) as WhatsAppAccountCreated;
  expect(account.numbers[1]).toMatchObject({ id: 2, is_test: true });
  const unflagged = (await (await admin.send('PATCH', '/whatsapp-accounts/1/numbers/3', { is_test: false })).json()) as WhatsAppAccountCreated;
  expect(unflagged.numbers[2].is_test).toBe(false);
  await expectError(await admin.send('PATCH', '/whatsapp-accounts/1/numbers/2', { is_test: 'oui' }), 400, 'VALIDATION_ERROR');

  const verified = await admin.send('POST', '/whatsapp-accounts/1/verify');
  expect(verified.status()).toBe(200);
  const v = (await verified.json()) as WhatsAppAccountCreated;
  expect(v).toMatchObject({ id: 1, state: 'connected', outcome: 'verified' });
  expect(Array.isArray(v.checks)).toBe(true);
  expect(v.last_verified_at).not.toBe('2026-11-08T10:00:00.000Z');

  const refreshed = await admin.send('POST', '/whatsapp-accounts/1/refresh-numbers');
  expect(refreshed.status()).toBe(200);
  expect((await refreshed.json()) as WhatsAppAccountCreated).toMatchObject({ id: 1, inventory: { added: 0, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 } });

  // remplacement des identifiants : même WABA seulement, le webhook est conservé
  const replaced = await admin.send('PUT', '/whatsapp-accounts/1/credentials', { ...META_CREDENTIALS, waba_id: '104829371625544' });
  expect(replaced.status()).toBe(200);
  const r = (await replaced.json()) as WhatsAppAccountReplaced;
  expect(r).toMatchObject({ id: 1, state: 'connected', inventory: { added: 0 } });
  expect(r).not.toHaveProperty('webhook');
  expect(await (await admin.get('/whatsapp-accounts/1/webhook')).json()).toMatchObject({ path: '/webhook/meta/cle-demo', verify_token: 'vt-demo-1234' });
  expect(Array.isArray(r.checks)).toBe(true);
  await expectError(
    await admin.send('PUT', '/whatsapp-accounts/1/credentials', META_CREDENTIALS),
    409, 'CONFLICT', 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.',
  );
  await expectError(await admin.send('PUT', '/whatsapp-accounts/1/credentials', { ...META_CREDENTIALS, waba_id: '000000' }), 409, 'CONFLICT');
});

test("identifiants non numériques et corps invalides : 404 pour un identifiant de chemin, 400 pour un corps", async () => {
  await expectError(await admin.get('/whatsapp-accounts/abc'), 404, 'NOT_FOUND');
  await expectError(await admin.send('PUT', '/bots/demo-3/number', { number_id: 'deux', expected_bot_id: null }), 400, 'VALIDATION_ERROR');
  await expectError(await admin.send('PUT', '/bots/demo-3/number', {}), 400, 'VALIDATION_ERROR');
  await expectError(await admin.send('POST', '/bots/demo-3/activate', { number_id: 2, expected_bot_id: null, status: 'paused' }), 400, 'VALIDATION_ERROR');
});
