import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';

// Migration des numéros WhatsApp : l'ancien schéma stockait des chiffres seuls, sans '+'.

describe('migration E.164 des bot_numbers (SQLite)', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('préfixe les anciens numéros par + à l\'ouverture, et une seconde ouverture ne change rien', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-e164-'));
    const file = path.join(dir, 'legacy.db');

    // Première ouverture : crée le schéma ; puis écriture d'un numéro au format de l'ancien schéma.
    await createSqliteDriver(file).close();
    const raw = new BetterSqlite3(file);
    raw.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)').run('33612345678', 'acme', 'sales');
    raw.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)').run('+15551234567', 'acme', 'support');
    raw.close();

    const first = createSqliteDriver(file);
    const afterFirst = (await first.listBotNumbers()).map((n) => n.whatsapp_number);
    expect(afterFirst).toEqual(['+15551234567', '+33612345678']);
    await first.close();

    const second = createSqliteDriver(file);
    expect((await second.listBotNumbers()).map((n) => n.whatsapp_number)).toEqual(afterFirst);
    await second.close();
  });
});

const baseUrl = process.env['TEST_DATABASE_URL'];

describe.skipIf(!baseUrl)('migration E.164 des bot_numbers (Postgres)', () => {
  it('préfixe les anciens numéros par + à l\'ouverture, et une seconde ouverture ne change rien', async () => {
    const name = `wab_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    try {
      await (await createPostgresDriver(dbUrl)).close();
      const raw = new pg.Client({ connectionString: dbUrl });
      await raw.connect();
      await raw.query("INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES ('33612345678', 'acme', 'sales'), ('+15551234567', 'acme', 'support')");
      await raw.end();

      const first = await createPostgresDriver(dbUrl);
      const afterFirst = (await first.listBotNumbers()).map((n) => n.whatsapp_number);
      expect(afterFirst).toEqual(['+15551234567', '+33612345678']);
      await first.close();

      const second = await createPostgresDriver(dbUrl);
      expect((await second.listBotNumbers()).map((n) => n.whatsapp_number)).toEqual(afterFirst);
      await second.close();
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
