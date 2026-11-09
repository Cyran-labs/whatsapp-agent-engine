import { test, expect } from 'vitest';
import { NextRequest } from 'next/server';
import middleware, { config } from '../middleware';

function call(path: string, withSession: boolean) {
  const headers = withSession ? { cookie: 'wab_access=a' } : undefined;
  return middleware(new NextRequest(`http://web.test${path}`, { headers }));
}

test.each(['/fr/login', '/fr/accept-invite', '/fr/forgot-password', '/fr/reset-password', '/en/forgot-password'])(
  '%s est accessible sans cookie de session',
  (path) => {
    const res = call(path, false);
    expect(res.headers.get('location')).toBeNull();
  },
);

test('une page de l\'app sans cookie redirige vers la connexion, avec le chemin demandé en retour', () => {
  const res = call('/fr/agents', false);
  expect(res.headers.get('location')).toBe('http://web.test/fr/login?next=%2Ffr%2Fagents');
});

// audit R-10 : page profonde ouverte sans session, requête comprise ; jamais « session expirée » (on ne sait pas si une session existait)
test('page profonde avec requête : next reprend le chemin et la requête, sans reason', () => {
  const res = call('/fr/organisation/utilisateurs?tab=invitations&x=1', false);
  const location = new URL(res.headers.get('location') ?? '');
  expect(location.pathname).toBe('/fr/login');
  expect(location.searchParams.get('next')).toBe('/fr/organisation/utilisateurs?tab=invitations&x=1');
  expect(location.searchParams.has('reason')).toBe(false);
  expect([...location.searchParams.keys()]).toEqual(['next']);
});

test('les paramètres de l\'adresse d\'origine ne sont pas recopiés tels quels sur la connexion', () => {
  const res = call('/en/agents?reason=session&tab=x', false);
  const location = new URL(res.headers.get('location') ?? '');
  expect(location.pathname).toBe('/en/login');
  expect(location.searchParams.has('reason')).toBe(false);
  expect(location.searchParams.get('next')).toBe('/en/agents?reason=session&tab=x');
});

test('accueil (avec ou sans langue) sans cookie : connexion sans next', () => {
  expect(call('/fr', false).headers.get('location')).toBe('http://web.test/fr/login');
  expect(call('/', false).headers.get('location')).toBe('http://web.test/fr/login');
});

test('page de l\'app sans langue : next garde le chemin tel quel', () => {
  const res = call('/agents/12', false);
  expect(new URL(res.headers.get('location') ?? '').searchParams.get('next')).toBe('/agents/12');
});

test('avec cookie de session : aucune redirection', () => {
  expect(call('/fr/agents', true).headers.get('location')).toBeNull();
});

test('un appel /api sans cookie n\'est pas intercepté (il garde son 401), pages et routes publiques le sont comme avant', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  expect(matcher.test('/api/auth/me')).toBe(false);
  expect(matcher.test('/api/bots')).toBe(false);
  expect(matcher.test('/fr/agents')).toBe(true);
});
