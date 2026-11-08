import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { SignJWT } from 'jose';
import { requireAuth, createRequireOrganization, requireAction } from '../auth.js';
import { cors, requestId } from '../context.js';
import { errorHandler } from '../error-handler.js';
import { signAccessToken } from '../../../core/auth/tokens.js';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import type { Database } from '../../../core/database/types.js';
import { migrateAccounts } from '../../../core/database/migrate-accounts.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';

const SECRET = 'test-secret-at-least-32-bytes-long!!';
const PWD = 'longenough1';

/** Jeton au format antérieur au modèle de comptes (porte client_id). */
async function signLegacyToken(sub: string, role: string, clientId: string | null): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { role };
  if (clientId !== null) payload['client_id'] = clientId;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(new TextEncoder().encode(SECRET));
}

function tokenFor(userId: number, role = 'member'): Promise<string> {
  return signAccessToken({ sub: String(userId), role });
}

function appWith(...mws: express.RequestHandler[]) {
  const app = express();
  app.use(requestId);
  app.get('/p', ...mws, (req, res) => { res.json({ auth: req.auth, scoped: req.scopedClientId ?? null }); });
  app.use(errorHandler);
  return app;
}

function orgApp(db: Database) {
  const app = express();
  app.use(requestId);
  const requireOrganization = createRequireOrganization(db);
  app.get('/read', requireAuth, requireOrganization, requireAction('org.read'), (req, res) => {
    res.json({ access: req.access, scoped: req.scopedClientId ?? null });
  });
  app.get('/configure', requireAuth, requireOrganization, requireAction('bots.configure'), (req, res) => {
    res.json({ access: req.access });
  });
  app.get('/no-org', requireAuth, requireAction('org.read'), (_req, res) => { res.json({ ok: true }); });
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  beforeEach(() => { process.env['ADMIN_JWT_SECRET'] = SECRET; });

  it('sans header → 401 forme d\'erreur', async () => {
    const res = await request(await serve(appWith(requireAuth))).get('/p');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('bearer valide → req.auth peuplé, sans organisation', async () => {
    const t = await signAccessToken({ sub: '5', role: 'member' });
    const res = await request(await serve(appWith(requireAuth))).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.auth).toEqual({ userId: 5, role: 'member' });
  });

  it('sub non numérique → 401', async () => {
    const t = await signAccessToken({ sub: 'abc', role: 'member' });
    const res = await request(await serve(appWith(requireAuth))).get('/p').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(401);
  });
});

describe('CORS', () => {
  it('autorise l\'en-tête X-Organization-Id', async () => {
    const app = express();
    app.use(cors('http://localhost:3000'));
    const res = await request(await serve(app)).options('/x');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-headers']).toContain('X-Organization-Id');
  });
});

describe('requireOrganization + requireAction', () => {
  let db: Database;

  beforeEach(() => {
    process.env['ADMIN_JWT_SECRET'] = SECRET;
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
  });

  it('admin mono-organisation sans en-tête : 200, organisation prise par repli (Review Focus 1)', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(200);
    expect(res.body.access.clientId).toBe('acme');
    expect(res.body.access.orgRole).toBe('admin');
    expect(res.body.access.platformAdmin).toBe(false);
    expect(res.body.access.readOnly).toBe(false);
    expect(res.body.scoped).toBe('acme');
  });

  it('jeton hérité client_admin, utilisateur migré par migrateAccounts : 200 sans en-tête (Review Focus 1)', async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    const user = await db.createUser({
      email: 'legacy@acme.test', password_hash: await hashPassword(PWD), role: 'client_admin', client_id: 'acme', status: 'active',
    });
    await migrateAccounts(db);
    const t = await signLegacyToken(String(user.id), 'client_admin', 'acme');
    const res = await request(await serve(orgApp(db))).get('/configure').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.access.clientId).toBe('acme');
    expect(res.body.access.orgRole).toBe('admin');
  });

  it('jeton hérité : le client_id du jeton ne choisit jamais l\'organisation', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
    const t = await signLegacyToken(String(userId), 'client_admin', 'other');
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.access.clientId).toBe('acme');
  });

  it('membre de deux organisations sans en-tête : 400, chemin X-Organization-Id', async () => {
    const { userId } = await seedOrgMember(db, { email: 'm@x.test', password: PWD, clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'm@x.test', password: PWD, clientId: 'other', grants: 'admin' });
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Organisation à préciser.');
    expect(res.body.error.details[0].path).toBe('X-Organization-Id');
  });

  it('membre de deux organisations avec en-tête : droits de l\'organisation désignée seulement', async () => {
    const { userId } = await seedOrgMember(db, { email: 'm@x.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const other = await seedOrgMember(db, { email: 'admin@other.test', password: PWD, clientId: 'other', grants: 'admin' });
    await seedOrgMember(db, { email: 'm@x.test', password: PWD, clientId: 'other', grants: [{ entity_id: other.entityId, role: 'advisor' }] });
    const t = await tokenFor(userId);
    const resOther = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`).set('x-organization-id', 'other');
    expect(resOther.status).toBe(200);
    expect(resOther.body.access).toEqual({
      userId, clientId: 'other', platformAdmin: false, orgRole: null,
      entityRoles: [{ entityId: other.entityId, role: 'advisor' }], readOnly: false,
    });
    expect(resOther.body.scoped).toBe('other');
    const resConf = await request(await serve(orgApp(db))).get('/configure').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'other');
    expect(resConf.status).toBe(403);
    const resAcme = await request(await serve(orgApp(db))).get('/configure').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'acme');
    expect(resAcme.status).toBe(200);
  });

  it('en-tête vers une organisation dont il n\'est pas membre : 403', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'b@other.test', password: PWD, clientId: 'other', grants: 'admin' });
    const res = await request(await serve(orgApp(db))).get('/read')
      .set('Authorization', `Bearer ${await tokenFor(userId)}`).set('X-Organization-Id', 'other');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('en-tête vers une organisation inexistante, membre : 403 (pas d\'oracle d\'existence)', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const res = await request(await serve(orgApp(db))).get('/read')
      .set('Authorization', `Bearer ${await tokenFor(userId)}`).set('X-Organization-Id', 'ghost');
    expect(res.status).toBe(403);
  });

  it('rôle super_admin dans le jeton mais member en base : aucun droit plateforme', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'b@other.test', password: PWD, clientId: 'other', grants: 'admin' });
    const t = await tokenFor(userId, 'super_admin');
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'other');
    expect(res.status).toBe(403);
    const own = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(own.status).toBe(200);
    expect(own.body.access.platformAdmin).toBe(false);
  });

  it('super admin sans en-tête : 400 ; avec en-tête acme : 200, platformAdmin', async () => {
    await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const id = await seedSuperAdmin(db, 'root@wab.test', PWD);
    const t = await tokenFor(id, 'super_admin');
    const without = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(without.status).toBe(400);
    expect(without.body.error.details[0].path).toBe('X-Organization-Id');
    const withHeader = await request(await serve(orgApp(db))).get('/configure').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'acme');
    expect(withHeader.status).toBe(200);
    expect(withHeader.body.access.platformAdmin).toBe(true);
    expect(withHeader.body.access.clientId).toBe('acme');
  });

  it('super admin vers une organisation inexistante : 404', async () => {
    const id = await seedSuperAdmin(db, 'root@wab.test', PWD);
    const res = await request(await serve(orgApp(db))).get('/read')
      .set('Authorization', `Bearer ${await tokenFor(id, 'super_admin')}`).set('X-Organization-Id', 'ghost');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('super admin rétrogradé en base : droits plateforme perdus à la requête suivante, même jeton', async () => {
    await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const id = await seedSuperAdmin(db, 'root@wab.test', PWD);
    const t = await tokenFor(id, 'super_admin');
    const before = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'acme');
    expect(before.status).toBe(200);
    await db.setUserRole(id, 'member');
    const after = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'acme');
    expect(after.status).toBe(403);
  });

  it('appartenances suspendues dans acme : 403 à la requête suivante, même jeton (Review Focus 3)', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const t = await tokenFor(userId);
    const before = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'acme');
    expect(before.status).toBe(200);
    await db.setMembershipsStatus(userId, 'acme', 'suspended');
    const after = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`).set('X-Organization-Id', 'acme');
    expect(after.status).toBe(403);
    const fallback = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(fallback.status).toBe(403);
  });

  it('suspendu dans acme, actif dans other : le repli prend other', async () => {
    const { userId } = await seedOrgMember(db, { email: 'm@x.test', password: PWD, clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'm@x.test', password: PWD, clientId: 'other', grants: 'admin' });
    await db.setMembershipsStatus(userId, 'acme', 'suspended');
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(200);
    expect(res.body.access.clientId).toBe('other');
  });

  it('users.status = disabled : 401 à la requête suivante, même jeton (Review Focus 3)', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const t = await tokenFor(userId);
    const before = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(before.status).toBe(200);
    await db.setUserStatus(userId, 'disabled');
    const after = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHORIZED');
  });

  it('super admin désactivé : 401', async () => {
    await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const id = await seedSuperAdmin(db, 'root@wab.test', PWD);
    await db.setUserStatus(id, 'disabled');
    const res = await request(await serve(orgApp(db))).get('/read')
      .set('Authorization', `Bearer ${await tokenFor(id, 'super_admin')}`).set('X-Organization-Id', 'acme');
    expect(res.status).toBe(401);
  });

  it('utilisateur inexistant (jeton valide) : 401', async () => {
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${await tokenFor(999)}`);
    expect(res.status).toBe(401);
  });

  it('conseiller sur une route requireAction(\'bots.configure\') : 403', async () => {
    const { entityId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const { userId } = await seedOrgMember(db, {
      email: 'c@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: entityId, role: 'advisor' }],
    });
    const t = await tokenFor(userId);
    const read = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${t}`);
    expect(read.status).toBe(200);
    expect(read.body.access.entityRoles).toEqual([{ entityId, role: 'advisor' }]);
    const conf = await request(await serve(orgApp(db))).get('/configure').set('Authorization', `Bearer ${t}`);
    expect(conf.status).toBe(403);
    expect(conf.body.error.code).toBe('FORBIDDEN');
  });

  it('super manager lecture seule : readOnly vrai', async () => {
    const { userId } = await seedOrgMember(db, {
      email: 's@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: null, role: 'super_manager', read_only: true }],
    });
    const res = await request(await serve(orgApp(db))).get('/read').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(200);
    expect(res.body.access.orgRole).toBe('super_manager');
    expect(res.body.access.readOnly).toBe(true);
  });

  it('requireAction sans requireOrganization : 403 (fail closed)', async () => {
    const { userId } = await seedOrgMember(db, { email: 'a@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    const res = await request(await serve(orgApp(db))).get('/no-org').set('Authorization', `Bearer ${await tokenFor(userId)}`);
    expect(res.status).toBe(403);
  });
});
