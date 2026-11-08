import { test, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { EngineError } from '../engine-client';

// Fonction simple plutôt que vi.fn().mockRejectedValue : vitest signale alors la promesse rejetée comme non gérée.
const engine = vi.hoisted(() => ({ calls: [] as unknown[][], impl: (async () => undefined) as (...a: unknown[]) => Promise<unknown> }));
vi.mock('@/lib/engine-fetch', () => ({
  engineFetch: (...a: unknown[]) => {
    engine.calls.push(a);
    return engine.impl(...a);
  },
}));
import { proxyEngine } from '../proxy';

const engineFetch = {
  resolve(value: unknown) { engine.impl = async () => value; },
  reject(err: unknown) { engine.impl = () => Promise.reject(err); },
  get calls() { return engine.calls; },
};
beforeEach(() => { engine.calls.length = 0; engine.impl = async () => undefined; });

const Schema = z.object({ name: z.string().min(1, 'Le nom est requis.') });

test('relaie la réponse JSON du moteur avec le statut demandé', async () => {
  engineFetch.resolve({ id: 3, name: 'Boutique' });
  const res = await proxyEngine('/entities', { method: 'POST', body: { name: 'Boutique' }, schema: Schema, status: 201 });
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ id: 3, name: 'Boutique' });
  expect(engineFetch.calls).toEqual([['/entities', { method: 'POST', body: JSON.stringify({ name: 'Boutique' }) }]]);
});

test('GET sans corps : un seul appel moteur, statut 200', async () => {
  engineFetch.resolve({ visibility: 'all' });
  const res = await proxyEngine('/settings');
  expect(res.status).toBe(200);
  expect(engineFetch.calls).toEqual([['/settings', { method: 'GET' }]]);
});

test('corps invalide : 400 au format standard, le moteur n\'est pas appelé', async () => {
  const res = await proxyEngine('/entities', { method: 'POST', body: { name: '' }, schema: Schema });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Le nom est requis.',
      details: [{ path: 'name', message: 'Le nom est requis.' }],
    },
  });
  expect(engineFetch.calls).toEqual([]);
});

test('les champs inconnus sont retirés avant l\'appel moteur', async () => {
  engineFetch.resolve({});
  await proxyEngine('/entities', { method: 'POST', body: { name: 'A', extra: 1 }, schema: Schema });
  expect(engineFetch.calls).toEqual([['/entities', { method: 'POST', body: JSON.stringify({ name: 'A' }) }]]);
});

test('réponse vide du moteur : 204 sans corps', async () => {
  engineFetch.resolve(undefined);
  const res = await proxyEngine('/entities/3', { method: 'DELETE' });
  expect(res.status).toBe(204);
  expect(await res.text()).toBe('');
});

test('erreur moteur propagée avec son statut et son message', async () => {
  engineFetch.reject(new EngineError('CONFLICT', "L'organisation doit garder au moins un admin.", 409));
  const res = await proxyEngine('/users/2', { method: 'PATCH', body: { status: 'suspended' } });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: { code: 'CONFLICT', message: "L'organisation doit garder au moins un admin." } });
});

test('requête dont le corps n\'est pas du JSON : 400 et non 500', async () => {
  const request = new Request('http://web.test/api/entities', { method: 'POST', body: 'pas du json' });
  const res = await proxyEngine('/entities', { method: 'POST', body: request, schema: Schema });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: [] } });
  expect(engineFetch.calls).toEqual([]);
});

test('requête au corps JSON valide : lu puis validé', async () => {
  engineFetch.resolve({ id: 1 });
  const request = new Request('http://web.test/api/entities', { method: 'POST', body: JSON.stringify({ name: 'A' }) });
  const res = await proxyEngine('/entities', { method: 'POST', body: request, schema: Schema, status: 201 });
  expect(res.status).toBe(201);
  expect(engineFetch.calls).toEqual([['/entities', { method: 'POST', body: JSON.stringify({ name: 'A' }) }]]);
});

test('erreur inattendue (non EngineError) : loguée [BFF] puis 500 standard', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const boom = new TypeError('fetch failed');
  engineFetch.reject(boom);
  const res = await proxyEngine('/settings');
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Erreur interne.' } });
  expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[BFF\] /), boom);
  errorSpy.mockRestore();
});

test('erreur moteur (EngineError) : pas de log d\'erreur inattendue', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  engineFetch.reject(new EngineError('NOT_FOUND', 'Entité introuvable.', 404));
  await proxyEngine('/entities/3', { method: 'PATCH', body: {} });
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
