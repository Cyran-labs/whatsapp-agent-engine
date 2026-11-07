import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
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
import { signAccessToken } from '../../../core/auth/tokens.js';
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';

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
    app.use('/api/admin/v1', createAdminRouter({ db, authService, adminService, botService, entityService: new EntityService({ db }), userAdminService: new UserAdminService({ db, mailer }), connectionsService, dashboardService, simulateService }));
    await seedSuperAdmin(db, 'root@flowlabs.test', 'motdepasse123');
    await seedOrgMember(db, { email: 'ca@beta.test', password: 'motdepasse123', clientId: 'beta', grants: 'admin' });
  });

  it('super_admin crée un client puis l\'invitation', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    const c = await request(app).post('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`).send({ client_id: 'acme', name: 'Acme' });
    expect(c.status).toBe(201);
    const inv = await request(app).post('/api/admin/v1/clients/acme/invitations').set('Authorization', `Bearer ${tok}`).send({ email: 'new@acme.test', grants: [{ entity_id: null, role: 'admin' }] });
    expect(inv.status).toBe(201);
    expect(inv.body).toEqual({ email: 'new@acme.test' });
    expect(mailer.invites).toHaveLength(1);
    const list = await request(app).get('/api/admin/v1/clients/acme/invitations').set('Authorization', `Bearer ${tok}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].token_hash).toBeUndefined();
    expect(list.body[0].grants).toEqual([{ entity_id: null, role: 'admin' }]);
    expect(JSON.stringify(list.body)).not.toContain('token');
  });

  it('admin d\'organisation ne peut pas accéder aux routes clients → 403', async () => {
    const tok = await bearer(app, 'ca@beta.test', 'motdepasse123');
    expect((await request(app).get('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`)).status).toBe(403);
    expect((await request(app).get('/api/admin/v1/clients/beta/invitations').set('Authorization', `Bearer ${tok}`)).status).toBe(403);
    expect((await request(app).post('/api/admin/v1/clients/beta/invitations').set('Authorization', `Bearer ${tok}`).send({ email: 'n@beta.test', grants: [{ entity_id: null, role: 'admin' }] })).status).toBe(403);
    expect(mailer.invites).toHaveLength(0);
  });

  it('jeton qui affirme super_admin pour un membre en base : 403 sur GET /clients', async () => {
    const { userId } = await seedOrgMember(db, { email: 'm@beta.test', password: 'motdepasse123', clientId: 'beta', grants: 'admin' });
    const forged = await signAccessToken({ sub: String(userId), role: 'super_admin' });
    const res = await request(app).get('/api/admin/v1/clients').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it('super admin désactivé en base, jeton encore valide : 401 sur GET /clients', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    expect((await request(app).get('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`)).status).toBe(200);
    const root = await db.getUserByEmail('root@flowlabs.test');
    await db.setUserStatus(root!.id, 'disabled');
    expect((await request(app).get('/api/admin/v1/clients').set('Authorization', `Bearer ${tok}`)).status).toBe(401);
  });

  it('super admin rétrogradé en base, jeton encore valide : 403 sur GET /clients', async () => {
    const tok = await bearer(app, 'root@flowlabs.test', 'motdepasse123');
    const root = await db.getUserByEmail('root@flowlabs.test');
    await db.setUserRole(root!.id, 'member');
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
