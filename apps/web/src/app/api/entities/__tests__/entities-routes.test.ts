import { test, expect, vi, beforeEach } from 'vitest';
import { EngineError } from '@/lib/engine-client';

const engineFetch = vi.fn();
let fail: EngineError | null = null;
vi.mock('@/lib/engine-fetch', () => ({
  // Fonction simple (pas vi.fn().mockRejectedValue) : voir le piège noté au rapport de la tâche 12.
  engineFetch: async (...a: unknown[]) => {
    engineFetch(...a);
    if (fail) throw fail;
    return { id: 7, name: 'Boutique Bordeaux', status: 'active', bots: 0, members: 0 };
  },
}));
beforeEach(() => { engineFetch.mockReset(); fail = null; });

import { POST } from '../route';
import { PATCH } from '../[id]/route';

const json = (body: unknown) => new Request('http://web.test/api/entities', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test('POST /api/entities crée une entité (201) et relaie le nom nettoyé', async () => {
  const res = await POST(json({ name: '  Boutique Bordeaux  ', extra: 1 }));
  expect(res.status).toBe(201);
  expect(await res.json()).toMatchObject({ id: 7, name: 'Boutique Bordeaux' });
  expect(engineFetch).toHaveBeenCalledWith('/entities', { method: 'POST', body: JSON.stringify({ name: 'Boutique Bordeaux' }) });
});

test('POST /api/entities refuse un nom vide (400) sans appeler le moteur', async () => {
  const res = await POST(json({ name: '   ' }));
  expect(res.status).toBe(400);
  expect(engineFetch).not.toHaveBeenCalled();
});

test('POST /api/entities refuse un corps non JSON (400)', async () => {
  const res = await POST(new Request('http://web.test/api/entities', { method: 'POST', body: 'pas du json' }));
  expect(res.status).toBe(400);
  expect(engineFetch).not.toHaveBeenCalled();
});

test('POST /api/entities propage le 409 du moteur avec son message', async () => {
  fail = new EngineError('CONFLICT', 'Une entité active porte déjà ce nom.', 409);
  const res = await POST(json({ name: 'Service client' }));
  expect(res.status).toBe(409);
  expect((await res.json()).error.message).toBe('Une entité active porte déjà ce nom.');
});

test('PATCH /api/entities/:id relaie le renommage', async () => {
  const res = await PATCH(new Request('http://web.test/api/entities/7', { method: 'PATCH', body: JSON.stringify({ name: 'Bordeaux' }) }), ctx('7'));
  expect(res.status).toBe(200);
  expect(engineFetch).toHaveBeenCalledWith('/entities/7', { method: 'PATCH', body: JSON.stringify({ name: 'Bordeaux' }) });
});

test('PATCH /api/entities/:id relaie l archivage et la réactivation', async () => {
  await PATCH(new Request('http://web.test/api/entities/7', { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }), ctx('7'));
  expect(engineFetch).toHaveBeenLastCalledWith('/entities/7', { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) });
  await PATCH(new Request('http://web.test/api/entities/7', { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }), ctx('7'));
  expect(engineFetch).toHaveBeenLastCalledWith('/entities/7', { method: 'PATCH', body: JSON.stringify({ status: 'active' }) });
});

test('PATCH /api/entities/:id refuse un statut inconnu (400)', async () => {
  const res = await PATCH(new Request('http://web.test/api/entities/7', { method: 'PATCH', body: JSON.stringify({ status: 'deleted' }) }), ctx('7'));
  expect(res.status).toBe(400);
  expect(engineFetch).not.toHaveBeenCalled();
});

test('PATCH /api/entities/:id propage le 409 de l archivage refusé', async () => {
  fail = new EngineError('CONFLICT', "Déplacez d'abord les agents IA et les membres de cette entité.", 409);
  const res = await PATCH(new Request('http://web.test/api/entities/7', { method: 'PATCH', body: JSON.stringify({ status: 'archived' }) }), ctx('7'));
  expect(res.status).toBe(409);
  expect((await res.json()).error.message).toBe("Déplacez d'abord les agents IA et les membres de cette entité.");
});
