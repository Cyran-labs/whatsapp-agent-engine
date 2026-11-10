import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';
import { testEngine } from '../../../test-support/test-database.js';
import type { Database, LlmUsageInput } from '../types.js';

// revue finale M-10 : la page Usage envoie l'instant ISO du minuit de Paris (`2026-11-02T23:00:00.000Z` pour le
// 3 novembre). `created_at` est stocké `AAAA-MM-JJ HH:MM:SS` (UTC, `datetime('now')`) sur SQLite et en TIMESTAMPTZ sur
// Postgres : les deux pilotes doivent comparer cet instant comme un instant, pas comme un texte.

const baseUrl = process.env['TEST_DATABASE_URL'];

interface DatableDb {
  db: Database;
  /** Fixe l'instant d'écriture (UTC) d'une ligne d'usage, retrouvée par son `anthropic_request_id`. */
  at(requestId: string, isoUtc: string): Promise<void>;
  close(): Promise<void>;
}

async function openDatable(): Promise<DatableDb> {
  if (testEngine() === 'postgres') {
    const name = `wab_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    const db = await createPostgresDriver(dbUrl);
    const raw = new pg.Client({ connectionString: dbUrl });
    await raw.connect();
    return {
      db,
      async at(requestId, isoUtc) {
        await raw.query('UPDATE llm_usage SET created_at = $1::timestamptz WHERE anthropic_request_id = $2', [isoUtc, requestId]);
      },
      async close() {
        await raw.end();
        await db.close();
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.end();
      },
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-usage-since-'));
  const file = path.join(dir, 'usage.db');
  const db = createSqliteDriver(file);
  const raw = new BetterSqlite3(file);
  return {
    db,
    async at(requestId, isoUtc) {
      // Même format que la valeur par défaut de la colonne (`datetime('now')`) : `AAAA-MM-JJ HH:MM:SS`, en UTC.
      raw.prepare('UPDATE llm_usage SET created_at = datetime(?) WHERE anthropic_request_id = ?').run(isoUtc, requestId);
    },
    async close() {
      raw.close();
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function usage(requestId: string): LlmUsageInput {
  return {
    client_id: 'acme', bot_id: 'sales', phone: null, call_type: 'chat', mode: 'platform', platform_key_id: null,
    model: 'claude-haiku-4-5-20251001', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0,
    cost_usd: 0.001, pricing_version: null, anthropic_request_id: requestId,
  };
}

describe('listLlmUsageByBot : début de période en instant ISO, à cheval sur minuit de Paris', () => {
  let ctx: DatableDb;
  beforeEach(async () => {
    ctx = await openDatable();
    // 3 novembre 2026 à Paris (UTC+1) : de 2026-11-02T23:00:00Z à 2026-11-03T23:00:00Z.
    for (const [id, at] of [
      ['veille-23h30-paris', '2026-11-02T22:30:00.000Z'],
      ['minuit-pile-paris', '2026-11-02T23:00:00.000Z'],
      ['00h30-paris', '2026-11-02T23:30:00.000Z'],
      ['01h30-paris', '2026-11-03T00:30:00.000Z'],
      ['midi-paris', '2026-11-03T11:00:00.000Z'],
    ] as const) {
      await ctx.db.insertLlmUsage(usage(id));
      await ctx.at(id, at);
    }
    // Autre organisation, même agent IA et même instant : jamais comptée.
    await ctx.db.insertLlmUsage({ ...usage('autre-org'), client_id: 'beta' });
    await ctx.at('autre-org', '2026-11-02T23:30:00.000Z');
  });
  afterEach(async () => { await ctx.close(); });

  const ids = async (since: string): Promise<string[]> =>
    (await ctx.db.listLlmUsageByBot('acme', 'sales', since)).map((r) => r.anthropic_request_id ?? '').sort();

  it("depuis le minuit de Paris : les deux premières heures du jour comptent, la veille non", async () => {
    expect(await ids('2026-11-02T23:00:00.000Z')).toEqual(['00h30-paris', '01h30-paris', 'midi-paris', 'minuit-pile-paris']);
  });

  it("un instant dans la journée : seules les lignes à partir de cet instant", async () => {
    expect(await ids('2026-11-03T00:00:00.000Z')).toEqual(['01h30-paris', 'midi-paris']);
  });
});
