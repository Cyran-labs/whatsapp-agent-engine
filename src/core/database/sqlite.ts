import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord, PlatformKeyRecord, PlatformKeyInput } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', '..', 'store', 'demo.db');

export function createSqliteDriver(dbPath: string = DB_PATH): Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS sessions (
      phone TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      name TEXT,
      qualified_data TEXT,
      rdv_requested INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_phone_bot ON conversations(phone, client_id, bot_id);
    CREATE INDEX IF NOT EXISTS idx_leads_phone_bot ON leads(phone, client_id, bot_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_leads_phone_bot ON leads(phone, client_id, bot_id);

    CREATE TABLE IF NOT EXISTS tenant_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      service TEXT NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'byo',
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_credentials
      ON tenant_credentials(client_id, COALESCE(bot_id, ''), service, provider);

    CREATE TABLE IF NOT EXISTS platform_llm_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_llm_keys_label
      ON platform_llm_keys(label);
  `;
  db.exec(SCHEMA);

  const driver: Database = {
    async getSession(phone: string): Promise<Session | undefined> {
      return db.prepare('SELECT phone, client_id, bot_id, created_at, updated_at FROM sessions WHERE phone = ?').get(phone) as Session | undefined;
    },

    async createSession(phone: string, clientId: string, botId: string): Promise<void> {
      db.prepare(
        `INSERT INTO sessions (phone, client_id, bot_id) VALUES (?, ?, ?)
         ON CONFLICT(phone) DO UPDATE SET client_id = ?, bot_id = ?, updated_at = datetime('now')`
      ).run(phone, clientId, botId, clientId, botId);
    },

    async getAllSessions(): Promise<SessionRow[]> {
      return db.prepare(`
        SELECT s.phone, s.client_id, s.bot_id, s.updated_at, COUNT(c.id) as msg_count
        FROM sessions s
        LEFT JOIN conversations c ON c.phone = s.phone AND c.client_id = s.client_id AND c.bot_id = s.bot_id
        GROUP BY s.phone
        ORDER BY s.updated_at DESC
      `).all() as SessionRow[];
    },

    async getConversation(phone: string, clientId: string, botId: string, limit = 20): Promise<{ role: string; content: string }[]> {
      return db
        .prepare('SELECT role, content FROM conversations WHERE phone = ? AND client_id = ? AND bot_id = ? ORDER BY id DESC LIMIT ?')
        .all(phone, clientId, botId, limit) as { role: string; content: string }[];
    },

    async addMessage(phone: string, clientId: string, botId: string, role: 'user' | 'assistant', content: string): Promise<void> {
      db.prepare('INSERT INTO conversations (phone, client_id, bot_id, role, content) VALUES (?, ?, ?, ?, ?)').run(
        phone, clientId, botId, role, content
      );
    },

    async getRecentHistory(phone: string, clientId: string, botId: string, limit = 10): Promise<HistoryRow[]> {
      return db
        .prepare('SELECT role, content, created_at FROM conversations WHERE phone = ? AND client_id = ? AND bot_id = ? ORDER BY id DESC LIMIT ?')
        .all(phone, clientId, botId, limit) as HistoryRow[];
    },

    async resetSession(phone: string): Promise<void> {
      db.prepare('DELETE FROM sessions WHERE phone = ?').run(phone);
      console.log(`[DB] Session reset: ${phone}`);
    },

    async resetBotSession(phone: string, clientId: string, botId: string): Promise<void> {
      db.prepare('DELETE FROM sessions WHERE phone = ? AND client_id = ? AND bot_id = ?').run(phone, clientId, botId);
      db.prepare('DELETE FROM conversations WHERE phone = ? AND client_id = ? AND bot_id = ?').run(phone, clientId, botId);
      db.prepare('DELETE FROM leads WHERE phone = ? AND client_id = ? AND bot_id = ?').run(phone, clientId, botId);
      console.log(`[DB] Bot session reset: ${phone} (${clientId}/${botId})`);
    },

    async getCrossConversations(phone: string, currentClientId: string, currentBotId: string, limit = 10): Promise<CrossConversationRow[]> {
      return db.prepare(
        `SELECT client_id, bot_id, role, content, created_at FROM conversations
         WHERE phone = ? AND NOT (client_id = ? AND bot_id = ?)
         ORDER BY id DESC LIMIT ?`
      ).all(phone, currentClientId, currentBotId, limit) as CrossConversationRow[];
    },

    async resetAll(phone: string): Promise<void> {
      db.prepare('DELETE FROM sessions WHERE phone = ?').run(phone);
      db.prepare('DELETE FROM conversations WHERE phone = ?').run(phone);
      db.prepare('DELETE FROM leads WHERE phone = ?').run(phone);
      console.log(`[DB] Full reset: ${phone}`);
    },

    async saveLead(phone: string, clientId: string, botId: string, data: Record<string, unknown>): Promise<void> {
      const existing = db.prepare('SELECT id, qualified_data, name FROM leads WHERE phone = ? AND client_id = ? AND bot_id = ?').get(phone, clientId, botId) as
        | { id: number; qualified_data: string | null; name: string | null }
        | undefined;
      const name = (data['name'] as string | undefined) || (data['profileName'] as string | undefined) || undefined;
      if (existing) {
        const merged = {
          ...(existing.qualified_data ? JSON.parse(existing.qualified_data) as Record<string, unknown> : {}),
          ...data,
        };
        db.prepare('UPDATE leads SET qualified_data = ?, name = COALESCE(?, name) WHERE id = ?').run(
          JSON.stringify(merged),
          name ?? null,
          existing.id
        );
      } else {
        db.prepare('INSERT INTO leads (phone, client_id, bot_id, name, qualified_data) VALUES (?, ?, ?, ?, ?)').run(
          phone, clientId, botId, name ?? null, JSON.stringify(data)
        );
      }
    },

    async getLeadData(phone: string, clientId: string, botId: string): Promise<Record<string, unknown> | null> {
      const row = db.prepare('SELECT qualified_data FROM leads WHERE phone = ? AND client_id = ? AND bot_id = ?').get(phone, clientId, botId) as
        | { qualified_data: string | null }
        | undefined;
      if (!row?.qualified_data) return null;
      try {
        return JSON.parse(row.qualified_data) as Record<string, unknown>;
      } catch {
        return null;
      }
    },

    async getAllLeads(): Promise<LeadRow[]> {
      return db.prepare(`
        SELECT l.phone, l.client_id, l.bot_id, l.name, l.qualified_data, l.rdv_requested, l.created_at,
          COALESCE(c.msg_count, 0) as message_count,
          c.last_msg_at as last_message_at
        FROM leads l
        LEFT JOIN (
          SELECT phone, client_id, bot_id, COUNT(*) as msg_count, MAX(created_at) as last_msg_at
          FROM conversations
          GROUP BY phone, client_id, bot_id
        ) c ON c.phone = l.phone AND c.client_id = l.client_id AND c.bot_id = l.bot_id
        ORDER BY l.created_at DESC
      `).all() as LeadRow[];
    },

    async isMessageProcessed(messageId: string): Promise<boolean> {
      const result = db.prepare('INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)').run(messageId);
      return result.changes === 0;
    },

    async markMessageProcessed(_messageId: string): Promise<void> {
      // No-op: isMessageProcessed handles insert atomically
    },

    async cleanupProcessedMessages(): Promise<void> {
      db.prepare(`DELETE FROM processed_messages WHERE created_at < datetime('now', '-7 days')`).run();
    },

    async purgeOldConversations(days = 90): Promise<void> {
      const result = db.prepare(`DELETE FROM conversations WHERE created_at < datetime('now', '-' || ? || ' days')`).run(days);
      if (result.changes > 0) {
        console.log(`[DB] Purged ${result.changes} conversations older than ${days} days`);
      }
    },

    async getCredential(clientId: string, botId: string | null, service: string, provider: string): Promise<CredentialRecord | undefined> {
      return db.prepare(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials
         WHERE client_id = ? AND bot_id IS ? AND service = ? AND provider = ?`
      ).get(clientId, botId, service, provider) as CredentialRecord | undefined;
    },

    async upsertCredential(rec: CredentialRecord): Promise<void> {
      const upd = db.prepare(
        `UPDATE tenant_credentials
         SET mode = ?, secret_encrypted = ?, key_version = ?, updated_at = datetime('now')
         WHERE client_id = ? AND bot_id IS ? AND service = ? AND provider = ?`
      ).run(rec.mode, rec.secret_encrypted, rec.key_version, rec.client_id, rec.bot_id, rec.service, rec.provider);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO tenant_credentials (client_id, bot_id, service, provider, mode, secret_encrypted, key_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version);
      }
    },

    async listCredentials(clientId: string): Promise<CredentialRecord[]> {
      return db.prepare(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials WHERE client_id = ? ORDER BY service, provider`
      ).all(clientId) as CredentialRecord[];
    },

    async listActivePlatformKeys(): Promise<PlatformKeyRecord[]> {
      const rows = db.prepare(
        `SELECT id, label, secret_encrypted, key_version, active
         FROM platform_llm_keys WHERE active = 1 ORDER BY id`
      ).all() as Array<{ id: number; label: string; secret_encrypted: string; key_version: number; active: number }>;
      return rows.map((r) => ({ ...r, active: r.active === 1 }));
    },

    async upsertPlatformKey(rec: PlatformKeyInput): Promise<void> {
      const upd = db.prepare(
        `UPDATE platform_llm_keys
         SET secret_encrypted = ?, key_version = ?, active = ?, updated_at = datetime('now')
         WHERE label = ?`
      ).run(rec.secret_encrypted, rec.key_version, rec.active ? 1 : 0, rec.label);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO platform_llm_keys (label, secret_encrypted, key_version, active)
           VALUES (?, ?, ?, ?)`
        ).run(rec.label, rec.secret_encrypted, rec.key_version, rec.active ? 1 : 0);
      }
    },

    async close(): Promise<void> {
      db.close();
    },
  };

  return driver;
}
