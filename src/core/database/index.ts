import type { Database } from './types.js';

export type { Database } from './types.js';
export type { Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow } from './types.js';

let _db: Database | null = null;

export async function initDatabase(): Promise<Database> {
  if (_db) return _db;

  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl) {
    console.log('[DB] Using PostgreSQL');
    const { createPostgresDriver } = await import('./postgres.js');
    _db = await createPostgresDriver(databaseUrl);
  } else {
    console.log('[DB] Using SQLite');
    const { createSqliteDriver } = await import('./sqlite.js');
    _db = createSqliteDriver();
  }

  return _db;
}

export function getDatabase(): Database {
  if (!_db) throw new Error('[DB] Database not initialized. Call initDatabase() first.');
  return _db;
}

/** Test-only: injecte un driver (sqlite in-memory) sans passer par initDatabase. */
export function __setDatabaseForTests(db: Database): void {
  _db = db;
}
