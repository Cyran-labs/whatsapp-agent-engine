import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot, upsertMapping, getMapping } from '../../config-store.js';
import { ConnectionsService } from '../connections-service.js';
import { CredentialsService } from '../credentials-service.js';
import type { Database, BotRecord } from '../../database/types.js';

const KEY = '0'.repeat(64);
const botRec = (over: Partial<BotRecord> = {}): BotRecord => ({
  client_id: 'acme', bot_id: 'sales', name: 'Ventes', status: 'draft',
  status_reason: null,
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null, ...over,
});

describe('ConnectionsService: CRM/LLM/mappings', () => {
  let db: Database;
  let conn: ConnectionsService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec());
    conn = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
  });
  afterEach(async () => { resetConfigStore(); vi.unstubAllGlobals(); await db.close(); });

  it('setCrm + getCrmMasked', async () => {
    await conn.setCrm('acme', 'sales', 7, 'hubspot', { access_token: 'pat-eu1-secret9999' });
    const m = await conn.getCrmMasked('acme', 'sales', 'hubspot');
    expect(m.configured).toBe(true);
    expect(m.fields!.access_token).toBe('••••9999');
  });

  it('validateCrm hubspot OK via fetch mocké', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    await upsertMapping('acme', null, 'hubspot', { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] } as never);
    await conn.setCrm('acme', 'sales', 7, 'hubspot', { access_token: 'pat-x' });
    expect(await conn.validateCrm('acme', 'sales', 'hubspot')).toEqual({ ok: true });
  });

  it('setLlm byo exige une clé + getLlm', async () => {
    await expect(conn.setLlm('acme', 'sales', 7, { mode: 'byo' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await conn.setLlm('acme', 'sales', 7, { mode: 'byo', model: 'claude-haiku-4-5', api_key: 'sk-ant-9999' });
    const llm = await conn.getLlm('acme', 'sales');
    expect(llm.mode).toBe('byo');
    expect(llm.key_configured).toBe(true);
    expect(llm.model).toBe('claude-haiku-4-5');
  });

  it('setLlm platform sans clé', async () => {
    await conn.setLlm('acme', 'sales', 7, { mode: 'platform', model: 'claude-haiku-4-5' });
    const llm = await conn.getLlm('acme', 'sales');
    expect(llm.mode).toBe('platform');
    expect(llm.key_configured).toBe(false);
  });

  it('putMapping persiste + getMapping relit', async () => {
    const mapping = { version: 1, connector: 'hubspot', target_object: 'contacts', client_id: 'acme', field_mapping: [{ source: 'email', target: 'email' }] };
    await conn.putMapping('acme', 'sales', 'hubspot', 7, mapping as never);
    expect((await getMapping('acme', 'sales', 'hubspot'))!.target_object).toBe('contacts');
  });
});
