import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot, upsertMapping, getMapping } from '../../config-store.js';
import { ConnectionsService } from '../connections-service.js';
import { CredentialsService } from '../credentials-service.js';
import { BotService } from '../bot-service.js';
import type { Database, BotRecord } from '../../database/types.js';
import { getCredentialRecord } from '../../credentials/store.js';
import { decryptJson } from '../../credentials/crypto.js';
import * as transports from '../../../transport/index.js';

const KEY = '0'.repeat(64);
const botRec = (over: Partial<BotRecord> = {}): BotRecord => ({
  client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null, ...over,
});

describe('ConnectionsService: transport', () => {
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
    await conn.setTransport('acme', 'sales', 7, { phone_number_id: '123', access_token: 'EAAtok9876', app_secret: 'sek5555' });
    const m = await conn.getTransportMasked('acme', 'sales');
    expect(m.configured).toBe(true);
    expect(m.fields!.access_token).toBe('••••9876');
    expect(m.validated_at).toBeNull();
  });

  it('validateTransport OK persiste la validation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' }));
    await conn.setTransport('acme', 'sales', 7, { phone_number_id: '123', access_token: 'EAAtok', app_secret: 'sek' });
    const r = await conn.validateTransport('acme', 'sales', 7);
    expect(r.ok).toBe(true);
    expect((await db.getBotRuntimeState('acme', 'sales'))!.transport_validated_at).toBeTruthy();
  });

  it('validateTransport KO enregistre l\'erreur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' }));
    await conn.setTransport('acme', 'sales', 7, { phone_number_id: '123', access_token: 'EAAtok', app_secret: 'sek' });
    const r = await conn.validateTransport('acme', 'sales', 7);
    expect(r.ok).toBe(false);
    const st = await db.getBotRuntimeState('acme', 'sales');
    expect(st!.transport_validated_at).toBeNull();
    expect(st!.transport_error).toContain('401');
  });

  it('setTransport réinitialise une validation existante', async () => {
    await db.setTransportValidation('acme', 'sales', '2026-01-01T00:00:00.000Z', null);
    await conn.setTransport('acme', 'sales', 7, { phone_number_id: '123', access_token: 'x', app_secret: 'y' });
    expect((await db.getBotRuntimeState('acme', 'sales'))!.transport_validated_at).toBeNull();
  });

  it('gate : activation refusée tant que le transport n\'est pas validé', async () => {
    await expect(bots.setStatus('acme', 'sales', 7, 'active')).rejects.toMatchObject({ code: 'CONFLICT' });
    await db.setTransportValidation('acme', 'sales', '2026-06-22T00:00:00.000Z', null);
    const bot = await bots.setStatus('acme', 'sales', 7, 'active');
    expect(bot.status).toBe('active');
  });
});

describe('ConnectionsService, transport CM.com et identifiants incomplets', () => {
  let db: Database;
  let conn: ConnectionsService;
  const CM = { product_token: 'tok-cm-1234', from_number: '0033600000000' };
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec({ bot_id: 'cm', transport: 'cm-com' }), ['+33622222222']);
    await upsertBot(botRec(), ['+33611111111']);
    conn = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
  });
  afterEach(async () => { resetConfigStore(); vi.unstubAllGlobals(); await db.close(); });

  it('setTransport CM.com deux fois conserve le même webhook_path', async () => {
    await conn.setTransport('acme', 'cm', 7, CM);
    const first = (await conn.getTransportMasked('acme', 'cm')).webhook_path;
    await conn.setTransport('acme', 'cm', 7, { ...CM, product_token: 'tok-autre-5678' });
    const second = (await conn.getTransportMasked('acme', 'cm')).webhook_path;
    expect(first).toMatch(/^\/webhook\/cm-com\/acme\/cm\/[A-Za-z0-9_-]{32}$/);
    expect(second).toBe(first);
  });

  it('webhook_path : secret propre à chaque agent IA, segments encodés', async () => {
    await upsertBot(botRec({ bot_id: 'cm2', transport: 'cm-com' }), ['+33633333333']);
    await conn.setTransport('acme', 'cm', 7, CM);
    await conn.setTransport('acme', 'cm2', 7, CM);
    const a = (await conn.getTransportMasked('acme', 'cm')).webhook_path!;
    const b = (await conn.getTransportMasked('acme', 'cm2')).webhook_path!;
    expect(a.split('/').pop()).not.toBe(b.split('/').pop());
    expect(b).toContain('/acme/cm2/');
  });

  it('getTransportMasked ne contient pas le secret dans fields', async () => {
    await conn.setTransport('acme', 'cm', 7, CM);
    const m = await conn.getTransportMasked('acme', 'cm');
    const rec = await getCredentialRecord('acme', 'cm', 'transport', 'cm-com');
    const secret = (decryptJson(rec!.secret_encrypted, rec!.key_version) as Record<string, string>)['webhook_secret']!;
    expect(secret).toBeTruthy();
    expect(Object.keys(m.fields!).sort()).toEqual(['from_number', 'product_token']);
    expect(JSON.stringify(m.fields)).not.toContain(secret);
    expect(m.webhook_path!.endsWith(`/${secret}`)).toBe(true);
  });

  it('pas de webhook_path pour Meta ni tant que CM.com n\'est pas configuré', async () => {
    expect((await conn.getTransportMasked('acme', 'cm')).webhook_path).toBeUndefined();
    await conn.setTransport('acme', 'sales', 7, { phone_number_id: '1', access_token: 'a', app_secret: 's' });
    const m = await conn.getTransportMasked('acme', 'sales');
    expect(m.configured).toBe(true);
    expect(m.webhook_path).toBeUndefined();
  });

  // audit 2.1
  it('setTransport refuse des identifiants incomplets', async () => {
    await expect(conn.setTransport('acme', 'sales', 7, { phone_number_id: '1', access_token: 'a' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(conn.setTransport('acme', 'cm', 7, { product_token: 't' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // audit 2.1
  it('validateTransport sur un enregistrement hérité incomplet : ok false, sans exception ni appel réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { encryptJson } = await import('../../credentials/crypto.js');
    const { upsertCredentialRecord } = await import('../../credentials/store.js');
    const { secret, keyVersion } = encryptJson({ phone_number_id: '1', access_token: 'a' });
    await upsertCredentialRecord({ client_id: 'acme', bot_id: 'sales', service: 'transport', provider: 'meta-cloud', mode: 'byo', secret_encrypted: secret, key_version: keyVersion });
    const r = await conn.validateTransport('acme', 'sales', 7);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await db.getBotRuntimeState('acme', 'sales'))!.transport_validated_at).toBeNull();
  });

  it('validateTransport CM.com complet : ok', async () => {
    await conn.setTransport('acme', 'cm', 7, CM);
    expect(await conn.validateTransport('acme', 'cm', 7)).toEqual({ ok: true });
  });

  // audit 5.8
  it('setTransport invalide le cache de transports de l\'agent IA', async () => {
    const spy = vi.spyOn(transports, 'invalidateTransports');
    await conn.setTransport('acme', 'cm', 7, CM);
    expect(spy).toHaveBeenCalledWith('acme', 'cm');
    spy.mockRestore();
  });
});

describe('ConnectionsService: CRM/LLM/mappings', () => {
  let db: Database;
  let conn: ConnectionsService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = KEY;
    db = createSqliteDriver(':memory:'); __setDatabaseForTests(db); resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await upsertBot(botRec(), []);
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
