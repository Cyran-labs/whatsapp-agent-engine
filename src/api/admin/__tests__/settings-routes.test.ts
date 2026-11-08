import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { serve } from '../../../test-support/http.js';
import { createSqliteDriver } from '../../../core/database/sqlite.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore } from '../../../core/config-store.js';
import type { Database } from '../../../core/database/types.js';
import { AuthService } from '../../../core/auth/auth-service.js';
import { AdminService } from '../../../core/auth/admin-service.js';
import { BotService } from '../../../core/services/bot-service.js';
import { UserAdminService } from '../../../core/services/user-admin-service.js';
import { EntityService } from '../../../core/services/entity-service.js';
import { SettingsService } from '../../../core/services/settings-service.js';
import { CredentialsService } from '../../../core/services/credentials-service.js';
import { ConnectionsService } from '../../../core/services/connections-service.js';
import { DashboardService } from '../../../core/services/dashboard-service.js';
import { SimulateService } from '../../../core/services/simulate-service.js';
import type { Mailer } from '../../../core/auth/mailer.js';
import { createAdminRouter } from '../router.js';
import { seedOrgMember } from '../../../core/auth/__tests__/fixtures.js';

class FakeMailer implements Mailer {
  async sendInvitation() {} async sendPasswordReset() {}
}

async function bearer(app: express.Express, email: string): Promise<string> {
  return (await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: 'motdepasse123' })).body.access_token as string;
}

const URL = '/api/admin/v1/settings';

describe('settings routes', () => {
  let db: Database;
  let app: express.Express;
  let dir: string;
  let dbFile: string;
  beforeEach(async () => {
    process.env['ADMIN_JWT_SECRET'] = 'test-secret-at-least-32-bytes-long!!';
    process.env['ADMIN_BCRYPT_ROUNDS'] = '4';
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    // Base sur fichier : un test écrit une valeur brute par une seconde connexion.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-routes-'));
    dbFile = path.join(dir, 'test.db');
    db = createSqliteDriver(dbFile); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use('/api/admin/v1', createAdminRouter({
      db, authService: new AuthService({ db, mailer }),
      adminService: new AdminService({ db, mailer }), botService: new BotService({ db }),
      entityService: new EntityService({ db }), settingsService: new SettingsService({ db }),
      userAdminService: new UserAdminService({ db, mailer: new FakeMailer() }),
      connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }),
      simulateService: new SimulateService({}),
    }));
    await seedOrgMember(db, { email: 'admin@acme.test', password: 'motdepasse123', clientId: 'acme', grants: 'admin' });
    await seedOrgMember(db, { email: 'admin@other.test', password: 'motdepasse123', clientId: 'other', grants: 'admin' });
    const acmeEntity = (await db.listEntities('acme'))[0]!;
    await seedOrgMember(db, { email: 'adv@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: acmeEntity.id, role: 'advisor' }] });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    resetConfigStore();
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('admin : lit les défauts puis modifie partiellement, sans toucher les autres champs ni les autres organisations', async () => {
    const auth = { Authorization: `Bearer ${await bearer(app, 'admin@acme.test')}` };
    const got = await request(await serve(app)).get(URL).set(auth);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ visibility: 'all', pool_self_claim: true, reassign: 'managers', transfer: 'managers', takeover: 'owner' });

    const patched = await request(await serve(app)).patch(URL).set(auth).send({ transfer: 'everyone' });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual({ ...got.body, transfer: 'everyone' });
    expect((await request(await serve(app)).get(URL).set(auth)).body.transfer).toBe('everyone');

    const other = { Authorization: `Bearer ${await bearer(app, 'admin@other.test')}` };
    expect((await request(await serve(app)).get(URL).set(other)).body.transfer).toBe('managers');
  });

  it('réglages illisibles en base (texte non JSON) : GET renvoie les défauts (200) et le signale', async () => {
    const raw = new BetterSqlite3(dbFile);
    raw.prepare('UPDATE clients SET settings = ? WHERE client_id = ?').run('{pas du json', 'acme');
    raw.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const auth = { Authorization: `Bearer ${await bearer(app, 'admin@acme.test')}` };
    const got = await request(await serve(app)).get(URL).set(auth);
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ visibility: 'all', pool_self_claim: true, reassign: 'managers', transfer: 'managers', takeover: 'owner' });
    expect(warn).toHaveBeenCalledWith('[Settings] réglages illisibles pour acme');
  });

  it('visibility autre que « all » : 400 avec chemin visibility ; valeur hors énumération : 400', async () => {
    const auth = { Authorization: `Bearer ${await bearer(app, 'admin@acme.test')}` };
    const res = await request(await serve(app)).patch(URL).set(auth).send({ visibility: 'entities' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ path: 'visibility', message: "Ce mode de visibilité n'est pas encore disponible." }]);
    expect((await request(await serve(app)).patch(URL).set(auth).send({ reassign: 'personne' })).status).toBe(400);
  });

  it('conseiller : GET 200, PATCH 403 ; sans jeton : 401', async () => {
    const auth = { Authorization: `Bearer ${await bearer(app, 'adv@acme.test')}` };
    expect((await request(await serve(app)).get(URL).set(auth)).status).toBe(200);
    expect((await request(await serve(app)).patch(URL).set(auth).send({ transfer: 'everyone' })).status).toBe(403);
    expect((await request(await serve(app)).get(URL)).status).toBe(401);
  });
});
