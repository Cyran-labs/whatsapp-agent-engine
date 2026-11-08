import { test, expect } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '../middleware';

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

test('une page de l\'app sans cookie redirige vers la connexion', () => {
  const res = call('/fr/agents', false);
  expect(res.headers.get('location')).toBe('http://web.test/fr/login');
});
