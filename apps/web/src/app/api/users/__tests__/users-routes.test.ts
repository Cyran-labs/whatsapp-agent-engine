import { test, expect, vi, beforeEach } from 'vitest';
import { EngineError } from '@/lib/engine-client';

const engineFetch = vi.fn();
let fail: EngineError | null = null;
let result: unknown = undefined;
vi.mock('@/lib/engine-fetch', () => ({
  // Fonction simple (pas vi.fn().mockRejectedValue) : voir le piège noté au rapport de la tâche 12.
  engineFetch: async (...a: unknown[]) => {
    engineFetch(...a);
    if (fail) throw fail;
    return result;
  },
}));
beforeEach(() => { engineFetch.mockReset(); fail = null; result = undefined; });

import { GET as listUsers } from '../route';
import { PATCH as setStatus } from '../[userId]/route';
import { PUT as setMemberships } from '../[userId]/memberships/route';
import { GET as listInvitations, POST as invite } from '../../invitations/route';
import { DELETE as revoke } from '../../invitations/[id]/route';
import { POST as resend } from '../../invitations/[id]/resend/route';

const req = (method: string, body?: unknown) =>
  new Request('http://web.test/api/x', { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const userCtx = (userId: string) => ({ params: Promise.resolve({ userId }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

test('GET /api/users relaie la liste des membres', async () => {
  result = [{ user_id: 1, email: 'a@x.fr', status: 'active', memberships: [] }];
  const res = await listUsers();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(result);
  expect(engineFetch).toHaveBeenCalledWith('/users', { method: 'GET' });
});

test('GET /api/invitations relaie la liste', async () => {
  result = [];
  const res = await listInvitations();
  expect(res.status).toBe(200);
  expect(engineFetch).toHaveBeenCalledWith('/invitations', { method: 'GET' });
});

test('POST /api/invitations : 201, e-mail normalisé, grants validées', async () => {
  result = { email: 'lucas@x.fr' };
  const res = await invite(req('POST', { email: ' Lucas@X.fr ', grants: [{ entity_id: 3, role: 'advisor' }] }));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ email: 'lucas@x.fr' });
  expect(engineFetch).toHaveBeenCalledWith('/invitations', {
    method: 'POST',
    body: JSON.stringify({ email: 'lucas@x.fr', grants: [{ entity_id: 3, role: 'advisor' }] }),
  });
});

test('POST /api/invitations refuse des grants mélangées ou une lecture seule hors super manager (400)', async () => {
  const mixed = await invite(req('POST', { email: 'a@x.fr', grants: [{ entity_id: null, role: 'admin' }, { entity_id: 3, role: 'advisor' }] }));
  expect(mixed.status).toBe(400);
  const readOnlyAdmin = await invite(req('POST', { email: 'a@x.fr', grants: [{ entity_id: null, role: 'admin', read_only: true }] }));
  expect(readOnlyAdmin.status).toBe(400);
  expect(engineFetch).not.toHaveBeenCalled();
});

test('POST /api/invitations propage le 409 « déjà membre » tel quel', async () => {
  fail = new EngineError('CONFLICT', "Cette personne est déjà membre de l'organisation : modifiez ses accès.", 409);
  const res = await invite(req('POST', { email: 'a@x.fr', grants: [{ entity_id: null, role: 'admin' }] }));
  expect(res.status).toBe(409);
  expect((await res.json()).error.message).toBe("Cette personne est déjà membre de l'organisation : modifiez ses accès.");
});

test('DELETE /api/invitations/:id et POST .../resend répondent 204', async () => {
  const del = await revoke(req('DELETE'), idCtx('12'));
  expect(del.status).toBe(204);
  expect(engineFetch).toHaveBeenCalledWith('/invitations/12', { method: 'DELETE' });
  const re = await resend(req('POST'), idCtx('12'));
  expect(re.status).toBe(204);
  expect(engineFetch).toHaveBeenCalledWith('/invitations/12/resend', { method: 'POST' });
});

test('PUT /api/users/:userId/memberships remplace les accès (204) et valide les grants', async () => {
  const ok = await setMemberships(req('PUT', { grants: [{ entity_id: null, role: 'super_manager', read_only: true }] }), userCtx('4'));
  expect(ok.status).toBe(204);
  expect(engineFetch).toHaveBeenCalledWith('/users/4/memberships', {
    method: 'PUT',
    body: JSON.stringify({ grants: [{ entity_id: null, role: 'super_manager', read_only: true }] }),
  });
  engineFetch.mockReset();
  const bad = await setMemberships(req('PUT', { grants: [] }), userCtx('4'));
  expect(bad.status).toBe(400);
  expect(engineFetch).not.toHaveBeenCalled();
});

test('PUT /api/users/:userId/memberships propage le 409 « dernier admin »', async () => {
  fail = new EngineError('CONFLICT', "L'organisation doit garder au moins un admin.", 409);
  const res = await setMemberships(req('PUT', { grants: [{ entity_id: 2, role: 'manager' }] }), userCtx('4'));
  expect(res.status).toBe(409);
  expect((await res.json()).error.message).toBe("L'organisation doit garder au moins un admin.");
});

test('PATCH /api/users/:userId relaie la suspension, refuse un statut inconnu', async () => {
  const ok = await setStatus(req('PATCH', { status: 'suspended' }), userCtx('4'));
  expect(ok.status).toBe(204);
  expect(engineFetch).toHaveBeenCalledWith('/users/4', { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) });
  engineFetch.mockReset();
  const bad = await setStatus(req('PATCH', { status: 'disabled' }), userCtx('4'));
  expect(bad.status).toBe(400);
  expect(engineFetch).not.toHaveBeenCalled();
  fail = new EngineError('CONFLICT', "L'organisation doit garder au moins un admin.", 409);
  const conflict = await setStatus(req('PATCH', { status: 'suspended' }), userCtx('4'));
  expect(conflict.status).toBe(409);
});

test.each(['abc', '1x', '-1', '2.5', '', '1/../2'])('identifiant non numérique « %s » : 404 sans appel moteur', async (bad) => {
  const responses = [
    await setStatus(req('PATCH', { status: 'suspended' }), userCtx(bad)),
    await setMemberships(req('PUT', { grants: [{ entity_id: null, role: 'admin' }] }), userCtx(bad)),
    await revoke(req('DELETE'), idCtx(bad)),
    await resend(req('POST'), idCtx(bad)),
  ];
  for (const res of responses) {
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  }
  expect(engineFetch).not.toHaveBeenCalled();
});
