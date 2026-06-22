import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord, PlatformKeyRecord, PlatformKeyInput, ClientRecord, BotRecord, BotNumberRecord, LlmPricingRecord, LlmPricingInput, LlmUsageInput, LlmUsageRow, UserRecord, UserInput, InvitationRecord, InvitationInput, AuthSessionRecord, AuthSessionInput, PasswordResetRecord, PasswordResetInput, ConnectorMappingInput, ConnectorMappingRecord, AuditLogInput, AuditLogRow } from './types.js';

function normalizePhone(num: string): string {
  return num.replace(/\D/g, '');
}

function botRecordToCols(rec: BotRecord) {
  return {
    name: rec.name, transport: rec.transport, status: rec.status,
    default_language: rec.default_language,
    languages: JSON.stringify(rec.languages),
    system_prompt: JSON.stringify(rec.system_prompt),
    lead_fields: rec.lead_fields,
    welcome: JSON.stringify(rec.welcome),
    error_messages: JSON.stringify(rec.error_messages),
    catalog: rec.catalog ? JSON.stringify(rec.catalog) : null,
    llm: rec.llm ? JSON.stringify(rec.llm) : null,
    crm: rec.crm ? JSON.stringify(rec.crm) : null,
  };
}

function rowToBotRecord(row: Record<string, unknown>): BotRecord {
  const j = (v: unknown) => (v == null ? null : JSON.parse(String(v)));
  return {
    client_id: String(row.client_id), bot_id: String(row.bot_id), name: String(row.name),
    transport: String(row.transport), status: String(row.status),
    default_language: String(row.default_language),
    languages: j(row.languages) ?? [],
    system_prompt: j(row.system_prompt) ?? {},
    lead_fields: String(row.lead_fields ?? ''),
    welcome: j(row.welcome) ?? { enabled: false, message: {} },
    error_messages: j(row.error_messages) ?? {},
    catalog: j(row.catalog),
    llm: j(row.llm),
    crm: j(row.crm),
  };
}

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

    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bots (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      default_language TEXT NOT NULL DEFAULT 'fr',
      languages TEXT NOT NULL DEFAULT '["fr"]',
      system_prompt TEXT NOT NULL DEFAULT '{}',
      lead_fields TEXT NOT NULL DEFAULT '',
      welcome TEXT NOT NULL DEFAULT '{"enabled":false,"message":{}}',
      error_messages TEXT NOT NULL DEFAULT '{}',
      catalog TEXT,
      llm TEXT,
      crm TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, bot_id)
    );

    CREATE TABLE IF NOT EXISTS bot_numbers (
      whatsapp_number TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_numbers_bot ON bot_numbers(client_id, bot_id);

    CREATE TABLE IF NOT EXISTS llm_pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      input_per_mtok REAL NOT NULL,
      output_per_mtok REAL NOT NULL,
      cache_read_per_mtok REAL NOT NULL,
      cache_write_per_mtok REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      effective_from TEXT DEFAULT (datetime('now')),
      effective_to TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_llm_pricing_model ON llm_pricing(model, effective_to);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      phone TEXT,
      call_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      platform_key_id INTEGER,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      pricing_version INTEGER,
      anthropic_request_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_client ON llm_usage(client_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_bot ON llm_usage(client_id, bot_id, created_at);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL,
      client_id TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      client_id TEXT,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_invitations_token ON invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invitations_client ON invitations(client_id);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_password_resets_token ON password_resets(token_hash);

    CREATE TABLE IF NOT EXISTS connector_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      connector TEXT NOT NULL,
      mapping TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_connector_mappings
      ON connector_mappings(client_id, COALESCE(bot_id, ''), connector);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      client_id TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, id);
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

    async listClients(): Promise<ClientRecord[]> {
      return db.prepare('SELECT client_id, name, status FROM clients ORDER BY client_id').all() as ClientRecord[];
    },

    async upsertClient(rec: ClientRecord): Promise<void> {
      const upd = db.prepare(
        `UPDATE clients SET name = ?, status = ?, updated_at = datetime('now') WHERE client_id = ?`
      ).run(rec.name, rec.status, rec.client_id);
      if (upd.changes === 0) {
        db.prepare('INSERT INTO clients (client_id, name, status) VALUES (?, ?, ?)').run(rec.client_id, rec.name, rec.status);
      }
    },

    async getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined> {
      const row = db.prepare(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm
         FROM bots WHERE client_id = ? AND bot_id = ?`
      ).get(clientId, botId) as Record<string, string> | undefined;
      return row ? rowToBotRecord(row) : undefined;
    },

    async listBotRecords(): Promise<BotRecord[]> {
      const rows = db.prepare(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm
         FROM bots ORDER BY client_id, bot_id`
      ).all() as Array<Record<string, string>>;
      return rows.map(rowToBotRecord);
    },

    async upsertBotRecord(rec: BotRecord): Promise<void> {
      const vals = botRecordToCols(rec);
      const upd = db.prepare(
        `UPDATE bots SET name=?, transport=?, status=?, default_language=?, languages=?,
           system_prompt=?, lead_fields=?, welcome=?, error_messages=?, catalog=?, llm=?, crm=?,
           updated_at=datetime('now')
         WHERE client_id=? AND bot_id=?`
      ).run(vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
            vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm,
            rec.client_id, rec.bot_id);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO bots (client_id, bot_id, name, transport, status, default_language, languages,
             system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(rec.client_id, rec.bot_id, vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
              vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm);
      }
    },

    async deleteBotRecord(clientId: string, botId: string): Promise<void> {
      db.prepare('DELETE FROM bot_numbers WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
      db.prepare('DELETE FROM bots WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
    },

    async listBotNumbers(): Promise<BotNumberRecord[]> {
      return db.prepare('SELECT whatsapp_number, client_id, bot_id FROM bot_numbers ORDER BY whatsapp_number').all() as BotNumberRecord[];
    },

    async setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void> {
      const tx = db.transaction((nums: string[]) => {
        db.prepare('DELETE FROM bot_numbers WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
        const ins = db.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)');
        for (const n of nums) {
          const norm = normalizePhone(n);
          if (norm) ins.run(norm, clientId, botId);
        }
      });
      tx(numbers);
    },

    async getLlmPricing(model: string): Promise<LlmPricingRecord | undefined> {
      return db.prepare(
        `SELECT id, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
                currency, effective_from, effective_to
         FROM llm_pricing WHERE model = ? AND effective_to IS NULL ORDER BY id DESC LIMIT 1`
      ).get(model) as LlmPricingRecord | undefined;
    },

    async upsertLlmPricing(rec: LlmPricingInput): Promise<void> {
      db.prepare(`UPDATE llm_pricing SET effective_to = datetime('now') WHERE model = ? AND effective_to IS NULL`).run(rec.model);
      db.prepare(
        `INSERT INTO llm_pricing (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, currency)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(rec.model, rec.input_per_mtok, rec.output_per_mtok, rec.cache_read_per_mtok, rec.cache_write_per_mtok, rec.currency);
    },

    async insertLlmUsage(rec: LlmUsageInput): Promise<void> {
      db.prepare(
        `INSERT INTO llm_usage (client_id, bot_id, phone, call_type, mode, platform_key_id, model,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(rec.client_id, rec.bot_id, rec.phone, rec.call_type, rec.mode, rec.platform_key_id, rec.model,
            rec.input_tokens, rec.output_tokens, rec.cache_read_tokens, rec.cache_creation_tokens,
            rec.cost_usd, rec.pricing_version, rec.anthropic_request_id);
    },

    async listLlmUsage(clientId: string): Promise<LlmUsageRow[]> {
      return db.prepare(
        `SELECT id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id, created_at
         FROM llm_usage WHERE client_id = ? ORDER BY id DESC`
      ).all(clientId) as LlmUsageRow[];
    },

    async createUser(input: UserInput): Promise<UserRecord> {
      const info = db.prepare(
        `INSERT INTO users (email, password_hash, role, client_id, status)
         VALUES (?, ?, ?, ?, ?)`
      ).run(input.email, input.password_hash, input.role, input.client_id, input.status);
      return db.prepare(
        `SELECT id, email, password_hash, role, client_id, status, created_at, updated_at
         FROM users WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as UserRecord;
    },

    async getUserByEmail(email: string): Promise<UserRecord | undefined> {
      return db.prepare(
        `SELECT id, email, password_hash, role, client_id, status, created_at, updated_at
         FROM users WHERE email = ?`
      ).get(email) as UserRecord | undefined;
    },

    async getUserById(id: number): Promise<UserRecord | undefined> {
      return db.prepare(
        `SELECT id, email, password_hash, role, client_id, status, created_at, updated_at
         FROM users WHERE id = ?`
      ).get(id) as UserRecord | undefined;
    },

    async updateUserPassword(id: number, passwordHash: string): Promise<void> {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(passwordHash, id);
    },

    async setUserStatus(id: number, status: string): Promise<void> {
      db.prepare(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
    },

    async getClient(clientId: string): Promise<ClientRecord | undefined> {
      return db.prepare('SELECT client_id, name, status FROM clients WHERE client_id = ?').get(clientId) as ClientRecord | undefined;
    },

    async createInvitation(input: InvitationInput): Promise<InvitationRecord> {
      const info = db.prepare(
        `INSERT INTO invitations (email, client_id, role, token_hash, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(input.email, input.client_id, input.role, input.token_hash, input.expires_at);
      return db.prepare(
        `SELECT id, email, client_id, role, token_hash, expires_at, accepted_at, created_at
         FROM invitations WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as InvitationRecord;
    },

    async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined> {
      return db.prepare(
        `SELECT id, email, client_id, role, token_hash, expires_at, accepted_at, created_at
         FROM invitations WHERE token_hash = ?`
      ).get(tokenHash) as InvitationRecord | undefined;
    },

    async markInvitationAccepted(id: number): Promise<void> {
      db.prepare(`UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?`).run(id);
    },

    async listInvitations(clientId: string): Promise<InvitationRecord[]> {
      return db.prepare(
        `SELECT id, email, client_id, role, token_hash, expires_at, accepted_at, created_at
         FROM invitations WHERE client_id = ? ORDER BY id DESC`
      ).all(clientId) as InvitationRecord[];
    },

    async deleteInvitation(id: number): Promise<void> {
      db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
    },

    async createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord> {
      const info = db.prepare(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
      ).run(input.user_id, input.token_hash, input.expires_at);
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
         FROM auth_sessions WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as AuthSessionRecord;
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined> {
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
         FROM auth_sessions WHERE token_hash = ?`
      ).get(tokenHash) as AuthSessionRecord | undefined;
    },

    async revokeAuthSession(id: number): Promise<void> {
      db.prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(id);
    },

    async revokeAllUserSessions(userId: number): Promise<void> {
      db.prepare(`UPDATE auth_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(userId);
    },

    async createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord> {
      const info = db.prepare(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
      ).run(input.user_id, input.token_hash, input.expires_at);
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, used_at, created_at
         FROM password_resets WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as PasswordResetRecord;
    },

    async getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
      return db.prepare(
        `SELECT id, user_id, token_hash, expires_at, used_at, created_at
         FROM password_resets WHERE token_hash = ?`
      ).get(tokenHash) as PasswordResetRecord | undefined;
    },

    async markPasswordResetUsed(id: number): Promise<void> {
      db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE id = ?`).run(id);
    },

    async getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined> {
      const row = db.prepare(
        `SELECT id, client_id, bot_id, connector, mapping, created_at, updated_at
         FROM connector_mappings WHERE client_id = ? AND bot_id IS ? AND connector = ?`
      ).get(clientId, botId, connector) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { ...row, mapping: JSON.parse(String(row.mapping)) } as ConnectorMappingRecord;
    },

    async upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void> {
      const json = JSON.stringify(rec.mapping);
      const upd = db.prepare(
        `UPDATE connector_mappings SET mapping = ?, updated_at = datetime('now')
         WHERE client_id = ? AND bot_id IS ? AND connector = ?`
      ).run(json, rec.client_id, rec.bot_id, rec.connector);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO connector_mappings (client_id, bot_id, connector, mapping) VALUES (?, ?, ?, ?)`
        ).run(rec.client_id, rec.bot_id, rec.connector, json);
      }
    },

    async listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]> {
      const rows = db.prepare(
        `SELECT id, client_id, bot_id, connector, mapping, created_at, updated_at
         FROM connector_mappings WHERE client_id = ? ORDER BY connector, bot_id`
      ).all(clientId) as Array<Record<string, unknown>>;
      return rows.map((r) => ({ ...r, mapping: JSON.parse(String(r.mapping)) }) as ConnectorMappingRecord);
    },

    async insertAuditLog(rec: AuditLogInput): Promise<void> {
      db.prepare(
        `INSERT INTO audit_log (actor_user_id, action, target, client_id, metadata)
         VALUES (?, ?, ?, ?, ?)`
      ).run(rec.actor_user_id, rec.action, rec.target, rec.client_id, rec.metadata ? JSON.stringify(rec.metadata) : null);
    },

    async listAuditLog(clientId: string, limit = 100): Promise<AuditLogRow[]> {
      const rows = db.prepare(
        `SELECT id, actor_user_id, action, target, client_id, metadata, created_at
         FROM audit_log WHERE client_id = ? ORDER BY id DESC LIMIT ?`
      ).all(clientId, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(String(r.metadata)) : null }) as AuditLogRow);
    },

    async close(): Promise<void> {
      db.close();
    },
  };

  return driver;
}
