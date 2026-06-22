import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { hashPassword } from '../../../core/auth/passwords.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer {
  invites: Array<{ to: string; link: string }> = [];
  async sendInvitation(to: string, link: string) { this.invites.push({ to, link }); }
  async sendPasswordReset() {}
}

async function bearer(app: express.Express, email: string, password: string): Promise<string> {
  const r = await request(app).post('/api/admin/v1/auth/login').send({ email, password });
  return r.body.access_token as string;
}

describe('clients routes (super_admin)', () => {
  let db: Database;
  let mailer: FakeMailer;
  let app: express.Express;

  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    db = createSqliteDriver(':memory:');
    mailer = new FakeMailer();
    const authService = new AuthService({ db, mailer });
    const adminService = new AdminService({ db, mailer });
    const botService = new BotService({ db });
    const credentials = new CredentialsService({ db });
    const connectionsService = new ConnectionsService({ db, credentials });
    const dashboardService = new DashboardService({ db, credentials });
    const simulateService = new SimulateService({});
    app = express();
    app.use('/api/admin/v1', createAdminRouter({ db, authService, adminService, botService, connectionsService, dashboardService, simulateService }));
    await db.createUser({ email: 'root@flowlabs.test', password_hash: await hashPassword('motdepasse123'), role: 'super_admin', client_id: null, status: 'active' });
    await db.createUser({ email: 'ca@acme.test', password_hash: await hashPassword('motdepasse123'), role: 'client_admin', client_id: 'acme', status: 'active' });
  });

  it('super_admin crée un client puis l\'invitation', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    const c = await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme' });
    expect(c.status).toBe(201);
    const inv = await request(app).post('/api/admin/v1/clients/acme/invitations').set('Authorization', `Bearer ${tok}`).send({ email: 'new@acme.test', role: 'client_admin' });
    expect(inv.status).toBe(201);
    expect(mailer.invites).toHaveLength(1);
    const list = await request(app).get('/api/admin/v1/clients/acme/invitations').set('Authorization', `Bearer ${tok}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].token_hash).toBeUndefined();
  });

  it('client_admin ne peut pas accéder aux routes clients → 403', async () => {
    const tok = await bearer(app, 'ca@acme.test', 'motdepasse123');
    expect((await request(app).get('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`)).status).toBe(403);
  });

  it('création de client en doublon → 409', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme' });
    const dup = await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme2' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });
});
