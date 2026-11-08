// Module « comptes WhatsApp » du driver SQLite : schéma et méthodes WhatsAppStore.
// Les dates sont écrites et lues en ISO 8601 UTC (comme le pilote Postgres, via pgIso).

import type BetterSqlite3 from 'better-sqlite3';
import type {
  NewWhatsAppAccount, WhatsAppAccountAlert, WhatsAppAccountErrorReason, WhatsAppAccountRecord,
  WhatsAppAccountSecrets, WhatsAppNumberRecord, WhatsAppStore,
} from './whatsapp-types.js';

type SqliteDb = BetterSqlite3.Database;

const NOW_ISO = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const MAX_ALERTS = 20;

const WHATSAPP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS whatsapp_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('meta_manual', 'cm_com')),
    provider_account_id TEXT NOT NULL,
    waba_id TEXT,
    meta_app_id TEXT,
    secret_encrypted TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    webhook_key_hash TEXT,
    state TEXT NOT NULL DEFAULT 'connected' CHECK (state IN ('connected', 'error', 'disconnected')),
    error_reason TEXT CHECK (error_reason IS NULL OR error_reason IN ('token_invalid', 'signature_rejected', 'other')),
    error_detail TEXT,
    last_verified_at TEXT,
    token_expiry TEXT,
    last_signature_ok_at TEXT,
    alerts TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
    updated_at TEXT NOT NULL DEFAULT (${NOW_ISO})
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_accounts_webhook_key ON whatsapp_accounts(webhook_key_hash);
  CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_client ON whatsapp_accounts(client_id);

  CREATE TABLE IF NOT EXISTS whatsapp_numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    phone_e164 TEXT NOT NULL,
    provider_number_id TEXT NOT NULL,
    cm_channel_id TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    meta_status TEXT,
    quality TEXT,
    is_test INTEGER NOT NULL DEFAULT 0,
    bot_id TEXT,
    provider_state TEXT NOT NULL DEFAULT 'present' CHECK (provider_state IN ('present', 'removed')),
    removed_at TEXT,
    delivery_failures INTEGER NOT NULL DEFAULT 0,
    last_delivery_error_code INTEGER,
    last_delivery_error_at TEXT,
    active_e164 TEXT UNIQUE,
    active_provider_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
    updated_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
    CHECK (
      (provider_state = 'present' AND active_e164 IS NOT NULL AND active_provider_id IS NOT NULL)
      OR (provider_state = 'removed' AND active_e164 IS NULL AND active_provider_id IS NULL)
    )
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_numbers_bot ON whatsapp_numbers(client_id, bot_id);
  CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_account ON whatsapp_numbers(account_id);

  CREATE TABLE IF NOT EXISTS bot_allowlist (
    client_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    entry TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW_ISO}),
    PRIMARY KEY (client_id, bot_id, entry)
  );
`;

function ensureColumn(db: SqliteDb, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/** Crée les tables du module comptes WhatsApp et la colonne `bots.status_reason` (idempotent). */
export function ensureSqliteWhatsAppSchema(db: SqliteDb): void {
  db.exec(WHATSAPP_SCHEMA);
  ensureColumn(db, 'bots', 'status_reason', 'TEXT');
}

const ACCOUNT_COLUMNS =
  `id, client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
   webhook_key_hash, state, error_reason, error_detail, last_verified_at, token_expiry, last_signature_ok_at,
   alerts, created_at, updated_at`;

const NUMBER_COLUMNS =
  `id, account_id, client_id, phone_e164, provider_number_id, cm_channel_id, display_name, meta_status, quality,
   is_test, bot_id, provider_state, removed_at, delivery_failures, last_delivery_error_code, last_delivery_error_at,
   created_at, updated_at`;

type AccountRow = Omit<WhatsAppAccountRecord, 'alerts'> & { alerts: string };
type NumberRow = Omit<WhatsAppNumberRecord, 'is_test'> & { is_test: number };

function parseAlerts(raw: string): WhatsAppAccountAlert[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WhatsAppAccountAlert[]) : [];
  } catch {
    return [];
  }
}

function rowToAccount(row: AccountRow): WhatsAppAccountRecord {
  return { ...row, alerts: parseAlerts(row.alerts) };
}

function rowToNumber(row: NumberRow): WhatsAppNumberRecord {
  return { ...row, is_test: row.is_test === 1 };
}

export function createSqliteWhatsAppStore(db: SqliteDb): WhatsAppStore {
  const readAccount = (id: number): WhatsAppAccountRecord | undefined => {
    const row = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE id = ?`).get(id) as AccountRow | undefined;
    return row ? rowToAccount(row) : undefined;
  };

  return {
    async insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord> {
      const info = db.prepare(
        `INSERT INTO whatsapp_accounts
           (client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
            webhook_key_hash, state, token_expiry, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?)`
      ).run(a.client_id, a.name, a.mode, a.provider_account_id, a.waba_id, a.meta_app_id, a.secret_encrypted,
            a.key_version, a.webhook_key_hash, a.token_expiry, a.last_verified_at);
      return readAccount(Number(info.lastInsertRowid))!;
    },

    async getWhatsAppAccount(clientId: string, id: number): Promise<WhatsAppAccountRecord | undefined> {
      const row = db.prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE client_id = ? AND id = ?`
      ).get(clientId, id) as AccountRow | undefined;
      return row ? rowToAccount(row) : undefined;
    },

    async listWhatsAppAccounts(clientId: string): Promise<WhatsAppAccountRecord[]> {
      const rows = db.prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE client_id = ? ORDER BY id`
      ).all(clientId) as AccountRow[];
      return rows.map(rowToAccount);
    },

    async findWhatsAppAccountByWebhookKeyHash(hash: string): Promise<WhatsAppAccountRecord | undefined> {
      const row = db.prepare(
        `SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE webhook_key_hash = ? AND state <> 'disconnected'`
      ).get(hash) as AccountRow | undefined;
      return row ? rowToAccount(row) : undefined;
    },

    async renameWhatsAppAccount(clientId: string, id: number, name: string): Promise<boolean> {
      const info = db.prepare(
        `UPDATE whatsapp_accounts SET name = ?, updated_at = ${NOW_ISO} WHERE client_id = ? AND id = ?`
      ).run(name, clientId, id);
      return info.changes > 0;
    },

    async replaceWhatsAppAccountSecrets(clientId: string, id: number, s: WhatsAppAccountSecrets): Promise<boolean> {
      const info = db.prepare(
        `UPDATE whatsapp_accounts
           SET secret_encrypted = ?, key_version = ?, meta_app_id = ?, token_expiry = ?, last_verified_at = ?,
               state = 'connected', error_reason = NULL, error_detail = NULL, updated_at = ${NOW_ISO}
         WHERE client_id = ? AND id = ?`
      ).run(s.secret_encrypted, s.key_version, s.meta_app_id, s.token_expiry, s.verified_at, clientId, id);
      return info.changes > 0;
    },

    async markWhatsAppAccountVerified(id: number, v: { token_expiry: string | null; verified_at: string }): Promise<void> {
      db.prepare(
        `UPDATE whatsapp_accounts
           SET token_expiry = ?, last_verified_at = ?, state = 'connected', error_reason = NULL, error_detail = NULL,
               updated_at = ${NOW_ISO}
         WHERE id = ?`
      ).run(v.token_expiry, v.verified_at, id);
    },

    async setWhatsAppAccountError(id: number, reason: WhatsAppAccountErrorReason, detail: string): Promise<void> {
      db.prepare(
        `UPDATE whatsapp_accounts SET state = 'error', error_reason = ?, error_detail = ?, updated_at = ${NOW_ISO} WHERE id = ?`
      ).run(reason, detail, id);
    },

    async touchSignatureOk(id: number, at: string): Promise<void> {
      db.prepare(
        `UPDATE whatsapp_accounts SET last_signature_ok_at = ?, updated_at = ${NOW_ISO} WHERE id = ?`
      ).run(at, id);
    },

    async addWhatsAppAccountAlert(id: number, alert: WhatsAppAccountAlert): Promise<void> {
      const tx = db.transaction(() => {
        const row = db.prepare('SELECT alerts FROM whatsapp_accounts WHERE id = ?').get(id) as { alerts: string } | undefined;
        if (!row) return;
        const next = [...parseAlerts(row.alerts), alert].slice(-MAX_ALERTS);
        db.prepare(`UPDATE whatsapp_accounts SET alerts = ?, updated_at = ${NOW_ISO} WHERE id = ?`).run(JSON.stringify(next), id);
      });
      tx();
    },

    async listWhatsAppNumbers(clientId: string, accountId?: number): Promise<WhatsAppNumberRecord[]> {
      const rows = (accountId === undefined
        ? db.prepare(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? ORDER BY id`).all(clientId)
        : db.prepare(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND account_id = ? ORDER BY id`).all(clientId, accountId)
      ) as NumberRow[];
      return rows.map(rowToNumber);
    },

    async getWhatsAppNumber(clientId: string, numberId: number): Promise<WhatsAppNumberRecord | undefined> {
      const row = db.prepare(
        `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND id = ?`
      ).get(clientId, numberId) as NumberRow | undefined;
      return row ? rowToNumber(row) : undefined;
    },

    async getWhatsAppNumberForBot(clientId: string, botId: string): Promise<WhatsAppNumberRecord | undefined> {
      const row = db.prepare(
        `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND bot_id = ?`
      ).get(clientId, botId) as NumberRow | undefined;
      return row ? rowToNumber(row) : undefined;
    },

    async findPresentNumber(accountId: number, key: { providerNumberId: string } | { phoneE164: string }): Promise<WhatsAppNumberRecord | undefined> {
      const row = ('providerNumberId' in key
        ? db.prepare(
            `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers
             WHERE account_id = ? AND provider_state = 'present' AND provider_number_id = ?`
          ).get(accountId, key.providerNumberId)
        : db.prepare(
            `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers
             WHERE account_id = ? AND provider_state = 'present' AND phone_e164 = ?`
          ).get(accountId, key.phoneE164)
      ) as NumberRow | undefined;
      return row ? rowToNumber(row) : undefined;
    },

    async recordDeliveryFailure(numberId: number, code: number | null, at: string): Promise<void> {
      db.prepare(
        `UPDATE whatsapp_numbers
           SET delivery_failures = delivery_failures + 1, last_delivery_error_code = ?, last_delivery_error_at = ?,
               updated_at = ${NOW_ISO}
         WHERE id = ?`
      ).run(code, at, numberId);
    },

    async getAllowlist(clientId: string, botId: string): Promise<string[]> {
      const rows = db.prepare(
        'SELECT entry FROM bot_allowlist WHERE client_id = ? AND bot_id = ? ORDER BY entry'
      ).all(clientId, botId) as { entry: string }[];
      return rows.map((r) => r.entry);
    },

    async replaceAllowlist(clientId: string, botId: string, entries: string[]): Promise<void> {
      const unique = [...new Set(entries)];
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM bot_allowlist WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
        const ins = db.prepare('INSERT INTO bot_allowlist (client_id, bot_id, entry) VALUES (?, ?, ?)');
        for (const entry of unique) ins.run(clientId, botId, entry);
      });
      tx();
    },

    async resetContactConversation(waNumber: string, contactId: string, clientId: string, botId: string): Promise<void> {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM sessions WHERE wa_number = ? AND phone = ? AND client_id = ? AND bot_id = ?')
          .run(waNumber, contactId, clientId, botId);
        db.prepare('DELETE FROM conversations WHERE phone = ? AND client_id = ? AND bot_id = ?')
          .run(contactId, clientId, botId);
      });
      tx();
    },
  };
}
