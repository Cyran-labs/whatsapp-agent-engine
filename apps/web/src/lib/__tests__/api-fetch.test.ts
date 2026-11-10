import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, bindApiFetch, readJsonBody, sendMutation, type ApiFetchBinding } from '../api-fetch';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let binding: ApiFetchBinding;
beforeEach(() => {
  binding = { displayedOrg: 'c1', onOrgChanged: vi.fn(), onOrgError: vi.fn(), onUnauthorized: vi.fn() };
  bindApiFetch(binding);
});
afterEach(() => {
  bindApiFetch(null);
  vi.unstubAllGlobals();
});

test('ajoute X-Wab-Org avec l\'organisation affichée et garde les en-têtes de l\'appelant', async () => {
  const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ ok: true }, 200));
  vi.stubGlobal('fetch', fetchMock);
  const res = await apiFetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).toBe(200);
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect(init.method).toBe('POST');
  expect(init.body).toBe('{}');
  expect(init.headers).toEqual({ 'content-type': 'application/json', 'X-Wab-Org': 'c1' });
});

test('sans session liée : appel transmis tel quel, aucune réaction', async () => {
  bindApiFetch(null);
  const fetchMock = vi.fn(async () => json({ error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }, 401));
  vi.stubGlobal('fetch', fetchMock);
  await apiFetch('/api/bots');
  expect(fetchMock).toHaveBeenCalledWith('/api/bots');
  expect(binding.onUnauthorized).not.toHaveBeenCalled();
});

test('409 ORG_CHANGED : rechargement demandé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'ORG_CHANGED', message: 'Organisation changée dans un autre onglet.' } }, 409)));
  await apiFetch('/api/bots');
  expect(binding.onOrgChanged).toHaveBeenCalledTimes(1);
  expect(binding.onOrgError).not.toHaveBeenCalled();
});

test('409 métier (dernier admin) : aucune réaction, la réponse reste lisible par l\'appelant', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'CONFLICT', message: "L'organisation doit garder au moins un admin." } }, 409)));
  const res = await apiFetch('/api/users/2', { method: 'PATCH' });
  expect(binding.onOrgChanged).not.toHaveBeenCalled();
  expect(binding.onOrgError).not.toHaveBeenCalled();
  expect((await res.json()).error.message).toBe("L'organisation doit garder au moins un admin.");
});

test('403 « Organisation suspendue. » : erreur d\'organisation « suspended »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'FORBIDDEN', message: 'Organisation suspendue.' } }, 403)));
  await apiFetch('/api/bots');
  expect(binding.onOrgError).toHaveBeenCalledWith('suspended');
});

test('403 d\'appartenance (ou de rôle) : erreur d\'organisation « access »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }, 403)));
  await apiFetch('/api/bots');
  expect(binding.onOrgError).toHaveBeenCalledWith('access');
});

test('400 « Organisation à préciser. » : erreur d\'organisation « access »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({
    error: { code: 'VALIDATION_ERROR', message: 'Organisation à préciser.', details: [{ path: 'X-Organization-Id', message: 'Organisation à préciser.' }] },
  }, 400)));
  await apiFetch('/api/bots');
  expect(binding.onOrgError).toHaveBeenCalledWith('access');
});

test('404 « Organisation introuvable. » : erreur d\'organisation « access »', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'NOT_FOUND', message: 'Organisation introuvable.' } }, 404)));
  await apiFetch('/api/bots');
  expect(binding.onOrgError).toHaveBeenCalledWith('access');
});

test('400 de validation ordinaire et 404 ordinaire : aucune réaction', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(json({ error: { code: 'VALIDATION_ERROR', message: 'Le nom est requis.', details: [{ path: 'name', message: 'Le nom est requis.' }] } }, 400))
    .mockResolvedValueOnce(json({ error: { code: 'NOT_FOUND', message: 'Agent IA introuvable.' } }, 404)));
  await apiFetch('/api/entities', { method: 'POST' });
  await apiFetch('/api/bots/x');
  expect(binding.onOrgError).not.toHaveBeenCalled();
  expect(binding.onOrgChanged).not.toHaveBeenCalled();
});

test('401 de session : redirection vers la connexion demandée', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }, 401)));
  await apiFetch('/api/bots');
  expect(binding.onUnauthorized).toHaveBeenCalledTimes(1);
});

test('corps d\'erreur non JSON : pas de plantage, aucune réaction d\'organisation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 403 })));
  const res = await apiFetch('/api/bots');
  expect(res.status).toBe(403);
  expect(binding.onOrgError).not.toHaveBeenCalled();
});

test('sans organisation affichée (Mon compte) : pas d\'en-tête X-Wab-Org', async () => {
  bindApiFetch({ ...binding, displayedOrg: null });
  const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({}, 200));
  vi.stubGlobal('fetch', fetchMock);
  await apiFetch('/api/bots');
  expect(fetchMock).toHaveBeenCalledWith('/api/bots');
});

test('sendMutation : succès renvoie la réponse, corps JSON et X-Wab-Org envoyés', async () => {
  const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ id: 3 }, 201));
  vi.stubGlobal('fetch', fetchMock);
  const result = await sendMutation('/api/entities', 'POST', { name: 'A' }, 'Erreur.', 'Entities');
  expect('res' in result && result.res.status).toBe(201);
  expect(fetchMock.mock.calls[0][1]).toEqual({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Wab-Org': 'c1' },
    body: JSON.stringify({ name: 'A' }),
  });
});

test('sendMutation : erreur moteur renvoie son message, sans corps pas de content-type', async () => {
  const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => json({ error: { code: 'CONFLICT', message: "L'organisation doit garder au moins un admin." } }, 409));
  vi.stubGlobal('fetch', fetchMock);
  expect(await sendMutation('/api/invitations/3', 'DELETE', undefined, 'Erreur.', 'Users')).toEqual({
    error: "L'organisation doit garder au moins un admin.", status: 409, details: [], orgChanged: false, reason: null, requestId: null,
  });
  expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'DELETE', headers: { 'X-Wab-Org': 'c1' } });
});

test('sendMutation : échec réseau renvoie le message de repli et logue [Service]', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  expect(await sendMutation('/api/entities', 'POST', {}, 'Erreur.', 'Entities')).toEqual({
    error: 'Erreur.', status: 0, details: [], orgChanged: false, reason: null, requestId: null,
  });
  // tâche 15 : le journal reçoit le message de l'erreur, pas l'objet
  expect(errorSpy).toHaveBeenCalledWith('[Entities] envoi impossible', 'network');
  errorSpy.mockRestore();
});

test('sendMutation : statut et détails du moteur sont rendus avec le message', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({
    error: { code: 'WA_VALIDATION_FAILED', message: 'Vérification impossible.', details: [{ path: 'token', message: 'Jeton refusé' }, { path: 'x' }, 'bruit', { message: 'sans chemin' }] },
  }, 422)));
  expect(await sendMutation('/api/whatsapp-accounts/1/credentials', 'PUT', {}, 'Erreur.', 'Connections')).toEqual({
    error: 'Vérification impossible.', status: 422, details: [{ path: 'token', message: 'Jeton refusé' }, { path: 'x' }], orgChanged: false,
    reason: null, requestId: null,
  });
});

test('sendMutation : 409 ORG_CHANGED est signalé par orgChanged (apiFetch recharge la page)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'ORG_CHANGED', message: "L'organisation a changé." } }, 409)));
  const result = await sendMutation('/api/entities', 'POST', {}, 'Erreur.', 'Entities');
  expect(result).toMatchObject({ status: 409, orgChanged: true });
  expect(binding.onOrgChanged).toHaveBeenCalledTimes(1);
});

test('sendMutation : clé du refus et référence de requête relayées par le BFF', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({
    error: { code: 'CONFLICT', message: "L'organisation doit garder au moins un admin.", reason: 'member.last_admin', request_id: 'req-42' },
  }, 409)));
  expect(await sendMutation('/api/users/4', 'PATCH', {}, 'Erreur.', 'Users')).toMatchObject({ status: 409, reason: 'member.last_admin', requestId: 'req-42' });
});

// Point d'attention 2 : une clé que les contrats du web ne connaissent pas (moteur plus récent) n'est pas relayée ;
// l'écran lit alors le texte du moteur (français) ou son texte contextuel (anglais), jamais la clé brute.
test('sendMutation : clé inconnue des contrats, clé ou référence mal formées lues comme nulles', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'CONFLICT', message: 'Nouvelle règle.', reason: 'member.future_rule', request_id: 42 } }, 409)));
  expect(await sendMutation('/api/users/4', 'PATCH', {}, 'Erreur.', 'Users')).toMatchObject({ reason: null, requestId: null });
  vi.stubGlobal('fetch', vi.fn(async () => json({ error: { code: 'CONFLICT', message: 'Nouvelle règle.', reason: ['member.last_admin'] } }, 409)));
  expect(await sendMutation('/api/users/4', 'PATCH', {}, 'Erreur.', 'Users')).toMatchObject({ reason: null, requestId: null });
});

test('sendMutation : 500 au corps illisible, message de repli et référence nulle', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));
  expect(await sendMutation('/api/users/4', 'PATCH', {}, 'Erreur.', 'Users')).toEqual({
    error: 'Erreur.', status: 502, details: [], orgChanged: false, reason: null, requestId: null,
  });
});

test('readJsonBody : corps JSON, null pour un 204 ou un corps illisible', async () => {
  expect(await readJsonBody(json({ a: 1 }, 200))).toEqual({ a: 1 });
  expect(await readJsonBody(new Response(null, { status: 204 }))).toBeNull();
  expect(await readJsonBody(new Response('pas du json', { status: 200 }))).toBeNull();
});
