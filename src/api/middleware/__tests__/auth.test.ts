import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireAuth, requireRole, scopeToClient } from '../auth.js';
import { requestId } from '../context.js';
import { errorHandler } from '../error-handler.js';
import { signAccessToken } from '../../../core/auth/tokens.js';

function appWith(...mws: express.RequestHandler[]) {
  const app = express();
  app.use(requestId);
  app.get('/p', ...mws, (req, res) => { res.json({ auth: req.auth, scoped: req.scopedClientId ?? null }); });
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('sans header → 401 forme d\'erreur', async () => {
    const res = await request(appWith(requireAuth)).get('/p');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('bearer valide → req.auth peuplé', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: 'acme' });
    const res = await request(appWith(requireAuth)).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.auth).toEqual({ userId: 5, role: 'client_admin', clientId: 'acme' });
  });
});

describe('requireRole', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('mauvais rôle → 403', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: 'acme' });
    const res = await request(appWith(requireAuth, requireRole('super_admin'))).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('scopeToClient', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!'; });

  it('client_admin : scope forcé sur son client (ignore la query)', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: 'acme' });
    const res = await request(appWith(requireAuth, scopeToClient)).get('/p?client_id=other').set('Authorization', `Bearer ${t}`);
    expect(res.body.scoped).toBe('acme');
  });

  it('super_admin : scope pris de la query', async () => {
    const t = await signAccessToken({ sub: '1', role: 'super_admin', client_id: null });
    const res = await request(appWith(requireAuth, scopeToClient)).get('/p?client_id=acme').set('Authorization', `Bearer ${t}`);
    expect(res.body.scoped).toBe('acme');
  });

  it('client_admin sans clientId → 403', async () => {
    const t = await signAccessToken({ sub: '5', role: 'client_admin', client_id: null });
    const res = await request(appWith(requireAuth, scopeToClient)).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
