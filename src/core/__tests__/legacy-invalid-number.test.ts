import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createSqliteDriver } from '../database/sqlite.js';
import { __setDatabaseForTests } from '../database/index.js';
import { initConfigStore, resetConfigStore, findBotConfigByNumber, getBotConfig } from '../config-store.js';
import { BotService } from '../services/bot-service.js';
import { ConnectionsService } from '../services/connections-service.js';
import { CredentialsService } from '../services/credentials-service.js';
import { ensureDefaultEntity } from '../database/migrate-accounts.js';
import type { BotRecord, Database } from '../database/types.js';

// Numéro hérité invalide : '0612345678' devient '+0612345678' à la migration (non conforme E.164).
const LEGACY = '0612345678';
const LEGACY_AFTER_MIGRATION = '+0612345678';

const botRec: BotRecord = {
  client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
};

describe('numéro WhatsApp hérité invalide', () => {
  let dir: string;
  let file: string;
  let db: Database;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-legacy-num-'));
    file = path.join(dir, 'legacy.db');
    // Base écrite avec l'ancien format : un numéro valide et un numéro national hérité.
    const seed = createSqliteDriver(file);
    await seed.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await ensureDefaultEntity(seed, 'acme');
    await seed.upsertBotRecord(botRec);
    await seed.close();
    const raw = new BetterSqlite3(file);
    raw.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)').run('33612345678', 'acme', 'sales');
    raw.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)').run(LEGACY, 'acme', 'sales');
    raw.close();

    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db = createSqliteDriver(file);
    __setDatabaseForTests(db);
    resetConfigStore();
    await initConfigStore();
  });
  afterEach(async () => {
    warn.mockRestore();
    resetConfigStore();
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const storedNumbers = async () => (await db.listBotNumbers()).map((n) => n.whatsapp_number).sort();

  it('le chargement journalise une fois le numéro ignoré, sans le numéro, et le retire du routage', () => {
    const configWarns = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[ConfigStore]'));
    expect(configWarns).toEqual(['[ConfigStore] Numéro WhatsApp invalide ignoré pour acme/sales']);
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain(LEGACY);
    }
    expect(getBotConfig('acme', 'sales').whatsapp_numbers).toEqual(['+33612345678']);
    expect(findBotConfigByNumber('33612345678')?.bot_id).toBe('sales');
  });

  it('la migration journalise le nombre de numéros non conformes, sans les valeurs', () => {
    const dbWarns = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[DB]'));
    expect(dbWarns).toEqual(['[DB] 1 numéro(s) WhatsApp non conformes E.164 restent dans bot_numbers']);
  });

  it('updateBot, setStatus et setLlm fonctionnent sans toucher aux numéros stockés', async () => {
    const before = await storedNumbers();
    expect(before).toEqual(['+33612345678', LEGACY_AFTER_MIGRATION].sort());

    const bots = new BotService({ db });
    const conn = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });

    const renamed = await bots.updateBot('acme', 'sales', 7, { name: 'Ventes 2' });
    expect(renamed.name).toBe('Ventes 2');
    expect(await storedNumbers()).toEqual(before);

    const paused = await bots.setStatus('acme', 'sales', 7, 'paused');
    expect(paused.status).toBe('paused');
    expect(await storedNumbers()).toEqual(before);

    await conn.setLlm('acme', 'sales', 7, { mode: 'platform', model: 'claude-haiku-4-5' });
    expect((await db.getBotRecord('acme', 'sales'))!.llm).toMatchObject({ mode: 'platform' });
    expect(await storedNumbers()).toEqual(before);

    // Le routage reste celui du numéro valide.
    expect(findBotConfigByNumber('33612345678')?.bot_id).toBe('sales');
  });
});
