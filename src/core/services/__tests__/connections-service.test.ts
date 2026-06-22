import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot } from '../../config-store.js';
import { ConnectionsService } from '../connections-service.js';
import { CredentialsService } from '../credentials-service.js';
import { BotService } from '../bot-service.js';
import type { Database, BotRecord } from '../../database/types.js';

const KEY = '0'.repeat(64);
const botRec = (over: Partial<BotRecord> = {}): BotRecord => ({
  client_id: 'acme', bot_id: 'immo', name: 'Immo', transport: 'meta-cloud', status: 'draft',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, ...over,
});

describe('ConnectionsService — transport', () => {
  let db: Database;
  let conn: ConnectionsService;
  let bots: BotService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec(), ['+33611111111']);
    conn = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
    bots = new BotService({ db });
  });
  afterEach(async () => { resetConfigStore(); vi.unstubAllGlobals(); await db.close(); });

  it('setTransport stocke + getTransportMasked masque + non validé', async () => {
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'EAAtok9876', app_secret: 'sek5555' });
    const m = await conn.getTransportMasked('acme', 'immo');
    expect(m.configured).toBe(true);
    expect(m.fields!.access_token).toBe('••••9876');
    expect(m.validated_at).toBeNull();
  });

  it('validateTransport OK persiste la validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'EAAtok', app_secret: 'sek' });
    const r = await conn.validateTransport('acme', 'immo', 7);
    expect(r.ok).toBe(true);
    expect((await db.getBotRuntimeState('acme', 'immo'))!.transport_validated_at).toBeTruthy();
  });

  it('validateTransport KO enregistre l\'erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' }));
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'EAAtok', app_secret: 'sek' });
    const r = await conn.validateTransport('acme', 'immo', 7);
    expect(r.ok).toBe(false);
    const st = await db.getBotRuntimeState('acme', 'immo');
    expect(st!.transport_validated_at).toBeNull();
    expect(st!.transport_error).toContain('401');
  });

  it('setTransport réinitialise une validation existante', async () => {
    await db.setTransportValidation('acme', 'immo', '2026-01-01T00:00:00.000Z', null);
    await conn.setTransport('acme', 'immo', 7, { phone_number_id: '123', access_token: 'x', app_secret: 'y' });
    expect((await db.getBotRuntimeState('acme', 'immo'))!.transport_validated_at).toBeNull();
  });

  it('gate : activation refusée tant que le transport n\'est pas validé', async () => {
    await expect(bots.setStatus('acme', 'immo', 7, 'active')).rejects.toMatchObject({ code: 'CONFLICT' });
    await db.setTransportValidation('acme', 'immo', '2026-06-22T00:00:00.000Z', null);
    const bot = await bots.setStatus('acme', 'immo', 7, 'active');
    expect(bot.status).toBe('active');
  });
});
