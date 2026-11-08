import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
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
    const login = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeTruthy();
    const me = await request(app).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('root@flowlabs.test');
  });

  it('GET /me d\'un compte désactivé depuis l\'émission du jeton → 401', async () => {
    const login = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    const root = await db.getUserByEmail('root@flowlabs.test');
    await db.setUserStatus(root!.id, 'disabled');
    const me = await request(app).get('/api/admin/v1/auth/me').set('Authorization', `Bearer ${login.body.access_token}`);
    expect(me.status).toBe(401);
  });

  it('login payload invalide → 400 forme standard', async () => {
    const res = await request(app).post('/api/admin/v1/auth/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.request_id).toBeTruthy();
  });

  it('login mauvais mdp → 401', async () => {
    const res = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /me sans token → 401', async () => {
    expect((await request(app).get('/api/admin/v1/auth/me')).status).toBe(401);
  });

  it('refresh → nouveau token ; ancien invalide', async () => {
    const login = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
    const r2 = await request(app).post('/api/admin/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(r2.status).toBe(200);
    const reuse = await request(app).post('/api/admin/v1/auth/refresh').send({ refresh_token: login.body.refresh_token });
    expect(reuse.status).toBe(401);
  });

  it('endpoint inconnu → 404 forme standard', async () => {
    const res = await request(app).get('/api/admin/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  describe('POST /auth/change-password', () => {
    async function bearer(): Promise<string> {
      const login = await request(app).post('/api/admin/v1/auth/login').send({ email: 'root@flowlabs.test', password: 'motdepasse123' });
      return login.body.access_token as string;
    }

    it('200 + nouveaux jetons', async () => {
      const token = await bearer();
      const res = await request(app).post('/api/admin/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'motdepasse123', new_password: 'nouveau-mdp-123' });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();
      expect(res.body.refresh_token).toBeTruthy();
      expect(res.body.user.email).toBe('root@flowlabs.test');
    });

    it('new_password de 9 caractères : 400 forme standard', async () => {
      const token = await bearer();
      const res = await request(app).post('/api/admin/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'motdepasse123', new_password: '123456789' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.request_id).toBeTruthy();
    });

    it('mauvais mot de passe actuel : 400 VALIDATION_ERROR sur current_password (pas 401)', async () => {
      const token = await bearer();
      const res = await request(app).post('/api/admin/v1/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ current_password: 'mauvais-mdp-123', new_password: 'nouveau-mdp-123' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Mot de passe actuel incorrect.');
      expect(res.body.error.details).toEqual([{ path: 'current_password', message: 'Mot de passe actuel incorrect.' }]);
    });

    it('sans bearer : 401', async () => {
      const res = await request(app).post('/api/admin/v1/auth/change-password')
        .send({ current_password: 'motdepasse123', new_password: 'nouveau-mdp-123' });
      expect(res.status).toBe(401);
    });
  });
});
