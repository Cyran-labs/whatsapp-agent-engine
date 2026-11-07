import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { EntityService } from '../../../core/services/entity-service.js';
import { UserAdminService } from '../../../core/services/user-admin-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  granted: Array<{ to: string; organizationName: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset() {}
  async sendAccessGranted(to: string, organizationName: string) { this.granted.push({ to, organizationName }); }
}

const BASE = '/api/admin/v1';
const PWD = 'motdepasse123';
const LAST_ADMIN = "L'organisation doit garder au moins un admin.";

function expectNoSecret(body: unknown): void {
  const json = JSON.stringify(body ?? null);
  expect(json).not.toContain('token');
  expect(json).not.toContain('accept-invite');
}

describe('users, invitations et plateforme (routes)', () => {
  let db: Database;
  let mailer: FakeMailer;
  let app: express.Express;
  let acmeEntity: number;
  let otherEntity: number;
  let otherAdmin: number;

  async function login(email: string): Promise<{ access: string; refresh: string }> {
    const r = await request(app).post(`${BASE}/auth/login`).send({ email, password: PWD });
    return { access: r.body.access_token as string, refresh: r.body.refresh_token as string };
  }
  async function auth(email: string, org = 'acme'): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${(await login(email)).access}`, 'X-Organization-Id': org };
  }

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use(BASE, createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }),
      entityService: new EntityService({ db }),
      userAdminService: new UserAdminService({ db, mailer }),
      connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({}),
    }));
    acmeEntity = (await seedOrgMember(db, { email: 'admin@acme.test', password: PWD, clientId: 'acme', grants: 'admin' })).entityId;
    const o = await seedOrgMember(db, { email: 'admin@other.test', password: PWD, clientId: 'other', grants: 'admin' });
    otherEntity = o.entityId; otherAdmin = o.userId;
    await seedOrgMember(db, { email: 'adv@acme.test', password: PWD, clientId: 'acme', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    await seedSuperAdmin(db, 'root@platform.test', PWD);
  });
  afterEach(async () => { resetConfigStore(); await db.close(); });

  it('POST /invitations nouvel e-mail : 201 outcome invited, un e-mail, aucune trace du jeton ni du lien', async () => {
    const h = await auth('admin@acme.test');
    const res = await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'New@Acme.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ email: 'new@acme.test', outcome: 'invited' });
    expectNoSecret(res.body);
    expect(mailer.invites).toHaveLength(1);

    const list = await request(app).get(`${BASE}/invitations`).set(h);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].grants).toEqual([{ entity_id: acmeEntity, role: 'advisor' }]);
    expectNoSecret(list.body);

    const resend = await request(app).post(`${BASE}/invitations/${list.body[0].id}/resend`).set(h);
    expect(resend.status).toBe(204);
    expectNoSecret(resend.body);
    expect(mailer.invites).toHaveLength(2);
  });

  it('POST /invitations utilisateur actif d\'une autre organisation : outcome added, accès immédiat', async () => {
    const h = await auth('admin@acme.test');
    const res = await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'admin@other.test', grants: [{ entity_id: acmeEntity, role: 'manager' }] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ email: 'admin@other.test', outcome: 'added' });
    expect(mailer.granted).toHaveLength(1);
    const other = await auth('admin@other.test', 'acme');
    expect((await request(app).get(`${BASE}/bots`).set(other)).status).toBe(200);
  });

  it('POST /invitations deux fois vers la même personne : une seule invitation, l\'ancien lien refusé, le nouveau accepté (R23b)', async () => {
    const h = await auth('admin@acme.test');
    await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'new@acme.test', grants: [{ entity_id: null, role: 'admin' }] });
    const again = await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'new@acme.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ email: 'new@acme.test', outcome: 'invited' });
    const list = await request(app).get(`${BASE}/invitations`).set(h);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].grants).toEqual([{ entity_id: acmeEntity, role: 'advisor' }]);
    const oldToken = new URL(mailer.invites[0]!.link).searchParams.get('token')!;
    const newToken = new URL(mailer.invites[1]!.link).searchParams.get('token')!;
    expect((await request(app).post(`${BASE}/auth/accept-invite`).send({ token: oldToken, password: PWD })).status).toBe(401);
    expect((await request(app).post(`${BASE}/auth/accept-invite`).send({ token: newToken, password: PWD })).status).toBe(200);
    const user = (await db.getUserByEmail('new@acme.test'))!;
    expect(await db.listUserMemberships(user.id, 'acme')).toEqual([expect.objectContaining({ entity_id: acmeEntity, role: 'advisor' })]);
  });

  it('POST /invitations d\'un membre existant : 409', async () => {
    const h = await auth('admin@acme.test');
    const res = await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'admin@acme.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Cette personne est déjà membre de l\'organisation : modifiez ses accès.');
  });

  it('grant vers une entité d\'une autre organisation : 400', async () => {
    const h = await auth('admin@acme.test');
    const res = await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'new@acme.test', grants: [{ entity_id: otherEntity, role: 'advisor' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('grants');
  });

  it('rôle super_admin dans les grants : 400 (aucune élévation plateforme)', async () => {
    const h = await auth('admin@acme.test');
    const res = await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'admin@other.test', grants: [{ entity_id: null, role: 'super_admin' }] });
    expect(res.status).toBe(400);
    const adv = (await db.getUserByEmail('adv@acme.test'))!;
    const put = await request(app).put(`${BASE}/users/${adv.id}/memberships`).set(h).send({ grants: [{ entity_id: null, role: 'super_admin' }] });
    expect(put.status).toBe(400);
    expect((await db.getUserById(adv.id))!.role).toBe('member');
  });

  it('conseiller : POST /invitations 403, GET /users 403, GET /invitations 403', async () => {
    const h = await auth('adv@acme.test');
    expect((await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'n@acme.test', grants: [{ entity_id: null, role: 'admin' }] })).status).toBe(403);
    expect((await request(app).get(`${BASE}/users`).set(h)).status).toBe(403);
    expect((await request(app).get(`${BASE}/invitations`).set(h)).status).toBe(403);
    expect(mailer.invites).toHaveLength(0);
  });

  it('GET /users : membres de acme seulement', async () => {
    const h = await auth('admin@acme.test');
    const res = await request(app).get(`${BASE}/users`).set(h);
    expect(res.status).toBe(200);
    expect(res.body.map((m: { email: string }) => m.email).sort()).toEqual(['admin@acme.test', 'adv@acme.test']);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('seul admin : se passer conseiller 409, se suspendre 409 ; avec deux admins : 204', async () => {
    const h = await auth('admin@acme.test');
    const me = (await db.getUserByEmail('admin@acme.test'))!;
    const downgrade = await request(app).put(`${BASE}/users/${me.id}/memberships`).set(h).send({ grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    expect(downgrade.status).toBe(409);
    expect(downgrade.body.error.message).toBe(LAST_ADMIN);
    const suspend = await request(app).patch(`${BASE}/users/${me.id}`).set(h).send({ status: 'suspended' });
    expect(suspend.status).toBe(409);
    expect(suspend.body.error.message).toBe(LAST_ADMIN);

    await seedOrgMember(db, { email: 'admin2@acme.test', password: PWD, clientId: 'acme', grants: 'admin' });
    expect((await request(app).put(`${BASE}/users/${me.id}/memberships`).set(h).send({ grants: [{ entity_id: null, role: 'admin' }] })).status).toBe(204);
    expect((await request(app).patch(`${BASE}/users/${me.id}`).set(h).send({ status: 'suspended' })).status).toBe(204);
    // Suspendu : l'accès à acme est coupé immédiatement.
    expect((await request(app).get(`${BASE}/bots`).set(h)).status).toBe(403);
  });

  it('suspension dans acme d\'un membre aussi présent dans other : il accède toujours à other', async () => {
    const h = await auth('admin@acme.test');
    await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'admin@other.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    const res = await request(app).patch(`${BASE}/users/${otherAdmin}`).set(h).send({ status: 'suspended' });
    expect(res.status).toBe(204);
    expect((await request(app).get(`${BASE}/bots`).set(await auth('admin@other.test', 'acme'))).status).toBe(403);
    expect((await request(app).get(`${BASE}/bots`).set(await auth('admin@other.test', 'other'))).status).toBe(200);
  });

  it('admin de acme sur un utilisateur ou une invitation de other : 404, rien ne change', async () => {
    const otherH = await auth('admin@other.test', 'other');
    await request(app).post(`${BASE}/invitations`).set(otherH).send({ email: 'p@other.test', grants: [{ entity_id: null, role: 'admin' }] });
    const otherInv = (await db.listInvitations('other'))[0]!;

    const h = await auth('admin@acme.test');
    expect((await request(app).put(`${BASE}/users/${otherAdmin}/memberships`).set(h).send({ grants: [{ entity_id: acmeEntity, role: 'advisor' }] })).status).toBe(404);
    expect((await request(app).patch(`${BASE}/users/${otherAdmin}`).set(h).send({ status: 'suspended' })).status).toBe(404);
    expect((await request(app).post(`${BASE}/invitations/${otherInv.id}/resend`).set(h)).status).toBe(404);
    expect((await request(app).delete(`${BASE}/invitations/${otherInv.id}`).set(h)).status).toBe(404);
    expect((await request(app).get(`${BASE}/invitations`).set(h)).body).toHaveLength(0);
    expect(await db.listUserMemberships(otherAdmin, 'acme')).toHaveLength(0);
    expect((await db.listUserMemberships(otherAdmin, 'other'))[0]!.status).toBe('active');
    expect(await db.listInvitations('other')).toHaveLength(1);
    expect(mailer.invites).toHaveLength(1);
    // En-tête other : l'admin de acme n'y a aucun droit.
    expect((await request(app).get(`${BASE}/invitations`).set(await auth('admin@acme.test', 'other'))).status).toBe(403);
  });

  it('identifiants non numériques : 404', async () => {
    const h = await auth('admin@acme.test');
    expect((await request(app).patch(`${BASE}/users/abc`).set(h).send({ status: 'suspended' })).status).toBe(404);
    expect((await request(app).delete(`${BASE}/invitations/-1`).set(h)).status).toBe(404);
  });

  it('DELETE /invitations/:id : 204 puis la liste est vide', async () => {
    const h = await auth('admin@acme.test');
    await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'new@acme.test', grants: [{ entity_id: null, role: 'admin' }] });
    const [inv] = (await request(app).get(`${BASE}/invitations`).set(h)).body as Array<{ id: number }>;
    expect((await request(app).delete(`${BASE}/invitations/${inv!.id}`).set(h)).status).toBe(204);
    expect((await request(app).get(`${BASE}/invitations`).set(h)).body).toHaveLength(0);
  });

  it('parcours complet : invitation, acceptation par le lien, connexion dans l\'organisation', async () => {
    const h = await auth('admin@acme.test');
    await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'new@acme.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    const token = new URL(mailer.invites[0]!.link).searchParams.get('token')!;
    const accepted = await request(app).post(`${BASE}/auth/accept-invite`).send({ token, password: PWD });
    expect(accepted.status).toBe(200);
    const nh = await auth('new@acme.test');
    expect((await request(app).get(`${BASE}/bots`).set(nh)).status).toBe(200);
  });

  it('GET /auth/me d\'un membre de deux organisations : organizations liste les deux', async () => {
    const h = await auth('admin@acme.test');
    await request(app).post(`${BASE}/invitations`).set(h).send({ email: 'admin@other.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] });
    const tok = (await login('admin@other.test')).access;
    const me = await request(app).get(`${BASE}/auth/me`).set('Authorization', `Bearer ${tok}`);
    expect(me.status).toBe(200);
    const orgs = [...me.body.organizations].sort((a: { client_id: string }, b: { client_id: string }) => a.client_id.localeCompare(b.client_id));
    expect(orgs).toEqual([
      { client_id: 'acme', name: 'acme', role: 'advisor', read_only: false },
      { client_id: 'other', name: 'other', role: 'admin', read_only: false },
    ]);
  });

  describe('plateforme', () => {
    it('admin d\'organisation sur POST /platform/users/:id/disable : 403', async () => {
      const tok = (await login('admin@acme.test')).access;
      const res = await request(app).post(`${BASE}/platform/users/${otherAdmin}/disable`).set('Authorization', `Bearer ${tok}`).set('X-Organization-Id', 'acme');
      expect(res.status).toBe(403);
      expect((await db.getUserById(otherAdmin))!.status).toBe('active');
    });

    it('super admin : 204, puis la session de la cible est révoquée (refresh 401) et son accès coupé', async () => {
      const target = await login('admin@other.test');
      const root = (await login('root@platform.test')).access;
      const res = await request(app).post(`${BASE}/platform/users/${otherAdmin}/disable`).set('Authorization', `Bearer ${root}`);
      expect(res.status).toBe(204);
      expect((await request(app).post(`${BASE}/auth/refresh`).send({ refresh_token: target.refresh })).status).toBe(401);
      expect((await request(app).get(`${BASE}/bots`).set('Authorization', `Bearer ${target.access}`).set('X-Organization-Id', 'other')).status).toBe(401);
      expect((await request(app).post(`${BASE}/auth/login`).send({ email: 'admin@other.test', password: PWD })).status).toBe(401);
    });

    it('super admin : utilisateur inconnu 404, sans jeton 401', async () => {
      const root = (await login('root@platform.test')).access;
      expect((await request(app).post(`${BASE}/platform/users/9999/disable`).set('Authorization', `Bearer ${root}`)).status).toBe(404);
      expect((await request(app).post(`${BASE}/platform/users/${otherAdmin}/disable`)).status).toBe(401);
    });

    it('super admin : POST /clients/:clientId/invitations avec grants, sans jeton dans la réponse', async () => {
      const root = (await login('root@platform.test')).access;
      await request(app).post(`${BASE}/clients`).set('Authorization', `Bearer ${root}`).send({ client_id: 'beta', name: 'Beta' });
      const res = await request(app).post(`${BASE}/clients/beta/invitations`).set('Authorization', `Bearer ${root}`).send({ email: 'first@beta.test', grants: [{ entity_id: null, role: 'admin' }] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ email: 'first@beta.test', outcome: 'invited' });
      expectNoSecret(res.body);
      const list = await request(app).get(`${BASE}/clients/beta/invitations`).set('Authorization', `Bearer ${root}`);
      expect(list.body).toHaveLength(1);
      expectNoSecret(list.body);
      // Ancien format { email, role } refusé.
      expect((await request(app).post(`${BASE}/clients/beta/invitations`).set('Authorization', `Bearer ${root}`).send({ email: 'x@beta.test', role: 'client_admin' })).status).toBe(400);
      // Grant vers une entité d'une autre organisation refusée.
      expect((await request(app).post(`${BASE}/clients/beta/invitations`).set('Authorization', `Bearer ${root}`).send({ email: 'x@beta.test', grants: [{ entity_id: acmeEntity, role: 'advisor' }] })).status).toBe(400);
    });

    it('super admin sur la route users d\'une organisation : droits admin implicites', async () => {
      const root = (await login('root@platform.test')).access;
      const res = await request(app).get(`${BASE}/users`).set('Authorization', `Bearer ${root}`).set('X-Organization-Id', 'acme');
      expect(res.status).toBe(200);
      expect(res.body.map((m: { email: string }) => m.email)).not.toContain('root@platform.test');
    });
  });
});
