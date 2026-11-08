import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, bindApiFetch, type ApiFetchBinding } from '../api-fetch';

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
  expect(fetchMock).toHaveBeenCalledWith('/api/bots', undefined);
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
    .mockResolvedValueOnce(json({ error: { code: 'NOT_FOUND', message: 'Bot introuvable.' } }, 404)));
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
  expect(fetchMock).toHaveBeenCalledWith('/api/bots', undefined);
});
