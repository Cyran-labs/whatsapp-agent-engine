import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { EntityService } from '../../../core/services/entity-service.js';
import { SettingsService } from '../../../core/services/settings-service.js';
import { UserAdminService } from '../../../core/services/user-admin-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { generateRefreshToken, hashRefreshToken } from '../../../core/auth/tokens.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  resets: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset(to: string, link: string) { this.resets.push({ to, link }); }
}

function makeApp(db: Database, mailer: Mailer) {
  const authService = new AuthService({ db, mailer });
  const adminService = new AdminService({ db, mailer });
  const botService = new BotService({ db });
  const credentials = new CredentialsService({ db });
  const connectionsService = new ConnectionsService({ db, credentials });
  const dashboardService = new DashboardService({ db, credentials });
  const simulateService = new SimulateService({});
  const app = express();
  app.use('/api/admin/v1', createAdminRouter({ db, authService, adminService, botService, entityService: new EntityService({ db }), settingsService: new SettingsService({ db }), userAdminService: new UserAdminService({ db, mailer }), connectionsService, dashboardService, simulateService }));
  return app;
}

describe('auth routes', () => {
  let db: Database;
  let mailer: FakeMailer;
  let app: express.Express;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    app = makeApp(db, mailer);
    await db.createUser({ email: 'root@flowlabs.test', password_hash: await hashPassword('motdepasse123'), role: 'super_admin', client_id: null, status: 'active' });
  });

  it('login → 200 + tokens, puis GET /me avec le bearer', async () => {
    const login = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeTruthy();
    const me = await request(await serve(app)).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('root@flowlabs.test');
  });

  it('GET /me d\'un compte désactivé depuis l\'émission du jeton → 401', async () => {
    const login = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    const root = await db.getUserByEmail('root@flowlabs.test');
    await db.setUserStatus(root!.id, 'disabled');
    const me = await request(await serve(app)).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(401);
  });

  it('login payload invalide → 400 forme standard', async () => {
    const res = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('login mauvais mdp → 401', async () => {
    const res = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error).toMatchObject({ message: 'Identifiants invalides.', reason: 'auth.invalid_credentials' });
  });

  it('GET /me sans token → 401', async () => {
    expect((await request(await serve(app)).get('/api/admin/v1/auth/me')).status).toBe(401);
  });

  it('refresh → nouveau token ; ancien invalide', async () => {
    const login = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    const r2 = await request(await serve(app)).post('/api/admin/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(r2.status).toBe(200);
    const reuse = await request(await serve(app)).post('/api/admin/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(reuse.status).toBe(401);
  });

  it('endpoint inconnu → 404 forme standard', async () => {
    const res = await request(await serve(app)).get('/api/admin/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  describe('POST /auth/forgot-password avec invite', () => {
    async function inviteFor(email: string, expiresAt = '2099-01-01T00:00:00.000Z'): Promise<string> {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      const raw = generateRefreshToken();
      await db.createInvitation({ email, client_id: 'acme', role: 'member', token_hash: hashRefreshToken(raw), expires_at: expiresAt, grants: [{ entity_id: null, role: 'admin' }] });
      return raw;
    }

    it('204 identique, lien avec invite seulement si l\'invitation vise ce compte', async () => {
      const valid = await inviteFor('root@flowlabs.test');
      const ok = await request(await serve(app)).post('/api/admin/v1/auth/forgot-password').send({ email: 'root@flowlabs.test', invite: valid });
      const unknown = await request(await serve(app)).post('/api/admin/v1/auth/forgot-password').send({ email: 'root@flowlabs.test', invite: 'inconnu' });
      const ghost = await request(await serve(app)).post('/api/admin/v1/auth/forgot-password').send({ email: 'ghost@flowlabs.test', invite: valid });
      for (const res of [ok, unknown, ghost]) {
        expect(res.status).toBe(204);
        expect(res.text).toBe('');
      }
      expect(mailer.resets).toHaveLength(2);
      expect(new URL(mailer.resets[0]!.link).searchParams.get('invite')).toBe(valid);
      expect(new URL(mailer.resets[1]!.link).searchParams.has('invite')).toBe(false);
    });

    it('invite vide ou trop long : 400', async () => {
      const empty = await request(await serve(app)).post('/api/admin/v1/auth/forgot-password').send({ email: 'root@flowlabs.test', invite: '' });
      const long = await request(await serve(app)).post('/api/admin/v1/auth/forgot-password').send({ email: 'root@flowlabs.test', invite: 'x'.repeat(201) });
      expect(empty.status).toBe(400);
      expect(long.status).toBe(400);
    });
  });

  describe('POST /auth/change-password', () => {
    async function bearer(): Promise<string> {
      const login = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
      return login.body.access_token as string;
    }

    it('200 + nouveaux jetons', async () => {
      const token = await bearer();
      const res = await request(await serve(app)).post('/api/admin/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'motdepasse123', new_password: 'nouveau-mdp-123' });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();
      expect(res.body.refresh_token).toBeTruthy();
      expect(res.body.user.email).toBe('root@flowlabs.test');
    });

    it('new_password de 9 caractères : 400 forme standard', async () => {
      const token = await bearer();
      const res = await request(await serve(app)).post('/api/admin/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'motdepasse123', new_password: '123456789' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.request_id).toBeTruthy();
    });

    it('mauvais mot de passe actuel : 400 VALIDATION_ERROR sur current_password (pas 401)', async () => {
      const token = await bearer();
      const res = await request(await serve(app)).post('/api/admin/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'mauvais-mdp-123', new_password: 'nouveau-mdp-123' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Mot de passe actuel incorrect.');
      expect(res.body.error.reason).toBe('auth.current_password_incorrect');
      expect(res.body.error.details).toEqual([{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }]);
    });

    it('sans bearer : 401', async () => {
      const res = await request(await serve(app)).post('/api/admin/v1/auth/change-password')
        .send({ current_password: 'motdepasse123', new_password: 'nouveau-mdp-123' });
      expect(res.status).toBe(401);
    });
  });
});

// nav 5.1 : le web montre Organisation et Usage dans le rail quand le rôle de l'organisation active est `admin`
// (`session-provider.tsx`, `isAdmin`) ; l'opérateur de la plateforme les voit parce que `/auth/me` lui liste chaque
// organisation avec ce rôle. Deux pilotes : SQLite, et Postgres avec TEST_DATABASE_URL.
describe('GET /auth/me de l\'opérateur de la plateforme', () => {
  let db: Database;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = await createTestDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('nav 5.1 : chaque organisation, suspendue comprise, avec role admin et sans lecture seule', async () => {
    await db.createClientWithEntity({ client_id: 'acme', name: 'Acme', status: 'active' }, 'Siège');
    await db.createClientWithEntity({ client_id: 'beta', name: 'Beta', status: 'suspended' }, 'Siège');
    await db.createUser({ email: 'root@flowlabs.test', password_hash: await hashPassword('motdepasse123'), role: 'super_admin', client_id: null, status: 'active' });
    const app = makeApp(db, new FakeMailer());
    const login = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    expect(login.status).toBe(200);
    const me = await request(await serve(app)).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('super_admin');
    const orgs = (me.body.organizations as Array<{ client_id: string; role: string; read_only: boolean; status?: string }>)
      .slice()
      .sort((a, b) => a.client_id.localeCompare(b.client_id));
    expect(orgs.map((o) => [o.client_id, o.role, o.read_only])).toEqual([
      ['acme', 'admin', false],
      ['beta', 'admin', false],
    ]);
    expect(orgs.find((o) => o.client_id === 'beta')?.status).toBe('suspended');
  });
});
