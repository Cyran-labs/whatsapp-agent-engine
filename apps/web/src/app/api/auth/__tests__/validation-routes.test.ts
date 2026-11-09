import { test, expect, vi, beforeEach, describe } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

import { POST as login } from '../login/route';
import { POST as chooseOrg } from '../org/route';
import { POST as changePassword } from '../change-password/route';
import { POST as resetPassword } from '../reset-password/route';
import { POST as forgotPassword } from '../forgot-password/route';
import { POST as invitationInfo } from '../invitations/info/route';
import { POST as acceptInvitation } from '../invitations/accept/route';
import { POST as acceptInvite } from '../accept-invite/route';

beforeEach(() => {
  process.env.ENGINE_API_URL = 'http://engine.test/api/admin/v1';
  vi.restoreAllMocks();
});

// Familles de routes d'authentification : connexion et organisation, mot de passe, invitations.
const FAMILIES: Record<string, Record<string, (r: Request) => Promise<Response>>> = {
  'connexion et organisation': { login, org: chooseOrg },
  'mot de passe': { 'change-password': changePassword, 'reset-password': resetPassword, 'forgot-password': forgotPassword },
  invitations: { 'invitations/info': invitationInfo, 'invitations/accept': acceptInvitation, 'accept-invite': acceptInvite },
};
const ENGLISH = /String must|Invalid|Expected|Required/;

function post(body: BodyInit | null): Request {
  return new Request('http://web.test/api/auth/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
}

describe.each(Object.entries(FAMILIES))('%s', (_family, routes) => {
  describe.each(Object.entries(routes))('%s', (name, handler) => {
    // audit R-7
    test('champs absents ou vides : 400 en français, aucun message Zod par défaut, moteur non appelé', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      for (const body of [{}, { email: '', password: '', token: '', client_id: '', current_password: '', new_password: '' }]) {
        const res = await handler(post(JSON.stringify(body)));
        expect(res.status, name).toBe(400);
        const text = JSON.stringify(await res.json());
        expect(text, name).toContain('VALIDATION_ERROR');
        expect(text, name).not.toMatch(ENGLISH);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // audit R-24
    test('corps illisible : 400 VALIDATION_ERROR « Données invalides. », jamais 500, moteur non appelé', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const res = await handler(post('pas du json'));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: [] } });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// audit R-7
test('login : mot de passe absent, « Valeur manquante ou invalide. » sur password', async () => {
  vi.stubGlobal('fetch', vi.fn());
  const res = await login(post(JSON.stringify({ email: 'claire@maison-lumiere.fr' })));
  const body = await res.json();
  expect(body.error.details).toEqual([{ path: 'password', message: 'Valeur manquante ou invalide.' }]);
});
