/**
 * Numéros des contacts masqués par le moteur (spec « Refonte de la navigation », 8, 9.2 et 15.6). En entier pour
 * l'admin, l'opérateur, le super manager et les membres (manager ou conseiller) de l'entité de l'agent IA ; masqués pour
 * tout autre membre. Routes : `GET /bots`, `GET /bots/:botId` (liste d'accès limité), `GET /bots/:botId/leads` (`phone`
 * et recherche), `GET /bots/:botId/leads/:phone` (refusé à un membre masqué). Le numéro de l'agent IA reste entier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { maskContactNumber } from '@wabagent/contracts';
import { serve } from '../../../test-support/http.js';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../../core/config-store.js';
import type { BotRecord, Database } from '../../../core/database/types.js';
import type { MembershipGrantRecord } from '../../../core/database/accounts-types.js';
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
import { seedOrgMember, seedSuperAdmin } from '../../../core/auth/__tests__/fixtures.js';
import { createAdminRouter } from '../router.js';

class FakeMailer implements Mailer { async sendInvitation() {} async sendPasswordReset() {} }

const PWD = 'motdepasse123';
const BASE = '/api/admin/v1';
/** Contact de la whitelist et lead d'acme/ventes. Le lead porte aussi le numéro dans ses données, comme `handler.ts`. */
const CONTACT = '+33612345678';
/** Lead sans « + » (forme reçue de Meta) et sans nom. */
const RAW_CONTACT = '33699999999';
const BSUID = 'US.abc123';

function botFor(clientId: string, botId: string, entityId: number | null): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, status: 'draft', status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null,
    entity_id: entityId,
  };
}

interface BotJson { bot_id: string; allowlist: string[] }
interface LeadJson { phone: string; name: string | null; qualified_data: Record<string, unknown> | null }

describe('numéros des contacts : en entier ou masqués selon le membre', () => {
  let db: Database;
  let app: express.Express;
  const tokens = new Map<string, string>();

  const get = async (email: string, path: string): Promise<request.Response> => {
    let token = tokens.get(email);
    if (!token) {
      const login = await request(await serve(app)).post(`${BASE}/auth/login`).send({ email, password: PWD });
      expect(login.status).toBe(200);
      token = login.body.access_token as string;
      tokens.set(email, token);
    }
    return request(await serve(app)).get(`${BASE}${path}`).set('Authorization', `Bearer ${token}`).set('X-Organization-Id', 'acme');
  };

  beforeEach(async () => {
    tokens.clear();
    vi.stubEnv('ADMIN_JWT_SECRET', 'test-secret-at-least-32-bytes-long!!');
    vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase(); __setDatabaseForTests(db); resetConfigStore();
    const mailer = new FakeMailer();
    const credentials = new CredentialsService({ db });
    app = express();
    app.use(BASE, createAdminRouter({
      db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
      botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }),
      userAdminService: new UserAdminService({ db, mailer }), connectionsService: new ConnectionsService({ db, credentials }),
      dashboardService: new DashboardService({ db, credentials }), simulateService: new SimulateService({}),
    }));
    const entityId = (await seedOrgMember(db, { email: 'admin@acme.test', password: PWD, clientId: 'acme', grants: 'admin' })).entityId;
    const other = await db.createEntity('acme', 'Siège');
    await seedSuperAdmin(db, 'root@plateforme.test', PWD);
    const members: Record<string, MembershipGrantRecord[]> = {
      'super-manager@acme.test': [{ entity_id: null, role: 'super_manager' }],
      'super-manager-ro@acme.test': [{ entity_id: null, role: 'super_manager', read_only: true }],
      'manager@acme.test': [{ entity_id: entityId, role: 'manager' }],
      'advisor@acme.test': [{ entity_id: entityId, role: 'advisor' }],
      'other-advisor@acme.test': [{ entity_id: other.id, role: 'advisor' }],
      'other-manager@acme.test': [{ entity_id: other.id, role: 'manager' }],
    };
    for (const [email, grants] of Object.entries(members)) {
      await seedOrgMember(db, { email, password: PWD, clientId: 'acme', grants });
    }
    await upsertBot(botFor('acme', 'ventes', entityId));
    // Agent IA sans entité (organisations anciennes, point d'attention 2).
    await upsertBot(botFor('acme', 'orphelin', null));
    expect(await db.replaceAllowlist('acme', 'ventes', [CONTACT, BSUID])).toEqual({ ok: true });
    expect(await db.replaceAllowlist('acme', 'orphelin', [CONTACT])).toEqual({ ok: true });
    await db.saveLead(CONTACT, 'acme', 'ventes', { phone: CONTACT, name: 'Marie' });
    await db.saveLead(RAW_CONTACT, 'acme', 'ventes', { phone: RAW_CONTACT });
    await db.saveLead(CONTACT, 'acme', 'orphelin', { phone: CONTACT, name: 'Marie' });
  });

  afterEach(async () => {
    resetConfigStore();
    await db.close();
    vi.unstubAllEnvs();
  });

  const full = [
    ['admin', 'admin@acme.test'],
    ['opérateur', 'root@plateforme.test'],
    ['super manager', 'super-manager@acme.test'],
    ['super manager en lecture seule', 'super-manager-ro@acme.test'],
    ['manager de l\'entité', 'manager@acme.test'],
    ['conseiller de l\'entité', 'advisor@acme.test'],
  ] as const;
  const masked = [
    ['conseiller d\'une autre entité', 'other-advisor@acme.test'],
    ['manager d\'une autre entité', 'other-manager@acme.test'],
  ] as const;

  const ventesOf = (res: request.Response): BotJson => (res.body as BotJson[]).find((b) => b.bot_id === 'ventes')!;
  const byPhone = (leads: LeadJson[]): LeadJson[] => [...leads].sort((a, b) => a.phone.localeCompare(b.phone));

  // nav 15.6
  it.each(full)('%s : whitelist et leads en entier', async (_who, email) => {
    const list = await get(email, '/bots');
    expect(list.status).toBe(200);
    expect(ventesOf(list).allowlist).toEqual([CONTACT, BSUID]);
    const detail = await get(email, '/bots/ventes');
    expect(detail.status).toBe(200);
    expect((detail.body as BotJson).allowlist).toEqual([CONTACT, BSUID]);
    const leads = await get(email, '/bots/ventes/leads');
    expect(leads.status).toBe(200);
    expect(byPhone(leads.body.leads as LeadJson[]).map((l) => [l.phone, l.qualified_data?.['phone']])).toEqual([
      [CONTACT, CONTACT], [RAW_CONTACT, RAW_CONTACT],
    ]);
  });

  // nav 15.6
  it.each(masked)('%s : whitelist et leads masqués, aucun corps ne contient un numéro entier', async (_who, email) => {
    const list = await get(email, '/bots');
    const detail = await get(email, '/bots/ventes');
    const leads = await get(email, '/bots/ventes/leads');
    expect([list.status, detail.status, leads.status]).toEqual([200, 200, 200]);
    expect(ventesOf(list).allowlist).toEqual(['+33612 •• •• 78', 'US••••']);
    expect((detail.body as BotJson).allowlist).toEqual(['+33612 •• •• 78', 'US••••']);
    expect(leads.body.total).toBe(2);
    expect(byPhone(leads.body.leads as LeadJson[]).map((l) => [l.phone, l.name, l.qualified_data?.['phone']])).toEqual([
      ['+33612 •• •• 78', 'Marie', '+33612 •• •• 78'],
      ['+33699 •• •• 99', null, '+33699 •• •• 99'],
    ]);
    for (const res of [list, detail, leads]) {
      const json = JSON.stringify(res.body);
      expect([CONTACT, CONTACT.slice(1), RAW_CONTACT, BSUID].filter((n) => json.includes(n))).toEqual([]);
    }
  });

  // nav 15.6, point d'attention 2 : agent IA sans entité
  it('agent IA sans entité : en entier pour l\'admin, l\'opérateur et le super manager, masqué pour un manager ou un conseiller', async () => {
    for (const email of ['admin@acme.test', 'root@plateforme.test', 'super-manager@acme.test', 'super-manager-ro@acme.test']) {
      expect([email, ((await get(email, '/bots/orphelin')).body as BotJson).allowlist]).toEqual([email, [CONTACT]]);
      expect([email, ((await get(email, '/bots/orphelin/leads')).body.leads as LeadJson[])[0]?.phone]).toEqual([email, CONTACT]);
    }
    for (const email of ['manager@acme.test', 'advisor@acme.test', 'other-advisor@acme.test']) {
      expect([email, ((await get(email, '/bots/orphelin')).body as BotJson).allowlist]).toEqual([email, [maskContactNumber(CONTACT)]]);
      const leads = (await get(email, '/bots/orphelin/leads')).body.leads as LeadJson[];
      expect([email, leads[0]?.phone]).toEqual([email, maskContactNumber(CONTACT)]);
      expect((await get(email, `/bots/orphelin/leads/${encodeURIComponent(CONTACT)}`)).status).toBe(403);
    }
  });

  // nav 15.6, amendement A-9 : la recherche par le numéro ne dit pas à un membre masqué si un numéro est un contact.
  it('recherche : par le numéro, rien pour un membre masqué ; par le nom, le lead', async () => {
    const search = async (email: string, q: string): Promise<{ total: number; phones: string[] }> => {
      const res = await get(email, `/bots/ventes/leads?search=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      return { total: res.body.total as number, phones: (res.body.leads as LeadJson[]).map((l) => l.phone) };
    };
    for (const q of ['612345', '0612', CONTACT, '699999', RAW_CONTACT]) {
      expect([q, await search('other-advisor@acme.test', q)]).toEqual([q, { total: 0, phones: [] }]);
    }
    expect(await search('other-advisor@acme.test', 'Marie')).toEqual({ total: 1, phones: ['+33612 •• •• 78'] });
    // Témoin : l'admin et le conseiller de l'entité trouvent le lead par son numéro.
    expect(await search('admin@acme.test', '612345')).toEqual({ total: 1, phones: [CONTACT] });
    expect(await search('advisor@acme.test', CONTACT)).toEqual({ total: 1, phones: [CONTACT] });
    expect(await search('advisor@acme.test', 'Marie')).toEqual({ total: 1, phones: [CONTACT] });
  });

  // nav 15.6
  it.each(masked)('%s : GET /leads/:phone refusé (403), sans numéro ni historique', async (_who, email) => {
    const res = await get(email, `/bots/ventes/leads/${encodeURIComponent(CONTACT)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', message: 'Accès refusé.' });
    expect(JSON.stringify(res.body)).not.toContain(CONTACT.slice(1));
    // Même refus pour un numéro qui n'est pas un contact : aucun indice d'existence.
    const unknown = await get(email, `/bots/ventes/leads/${encodeURIComponent('+33700000000')}`);
    expect([unknown.status, unknown.body.error?.code, unknown.body.error?.message]).toEqual([403, 'FORBIDDEN', 'Accès refusé.']);
  });

  // nav 15.6
  it.each(full)('%s : GET /leads/:phone en entier (200)', async (_who, email) => {
    const res = await get(email, `/bots/ventes/leads/${encodeURIComponent(CONTACT)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ phone: CONTACT, name: 'Marie' });
  });

  // Agent IA inconnu ou d'une autre organisation : 404 avant tout refus lié au masque (comportement existant).
  it('membre masqué : 404 sur un agent IA inconnu, même pour le détail d\'un lead', async () => {
    const res = await get('other-advisor@acme.test', `/bots/inconnu/leads/${encodeURIComponent(CONTACT)}`);
    expect([res.status, res.body.error?.reason]).toEqual([404, 'bot.not_found']);
  });
});
