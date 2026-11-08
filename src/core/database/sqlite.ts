import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PROCESSED_MESSAGES_RETENTION_HOURS } from './types.js';
import type { Database, Session, HistoryRow, LeadRow, LeadListResult, CredentialRecord, PlatformKeyRecord, PlatformKeyInput, ClientRecord, BotRecord, BotNumberRecord, LlmPricingRecord, LlmPricingInput, LlmUsageInput, LlmUsageRow, BotMetrics, UserRecord, UserInput, InvitationRecord, InvitationInput, AuthSessionRecord, AuthSessionInput, PasswordResetRecord, PasswordResetInput, ConnectorMappingInput, ConnectorMappingRecord, AuditLogInput, AuditLogRow, BotRuntimeStateRecord } from './types.js';
import { normalizeWhatsAppNumber, toStoredWhatsAppNumbers } from '../phone.js';
import { createSqliteAccountsStore, ensureSqliteAccountsSchema, rowToInvitationRecord, SQLITE_INVITATION_COLUMNS, type SqliteInvitationRow } from './accounts-sqlite.js';
import { createSqliteWhatsAppStore, ensureSqliteWhatsAppSchema } from './whatsapp-sqlite.js';

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
    personality: rec.personality ? JSON.stringify(rec.personality) : null,
    entity_id: rec.entity_id ?? null,
  };
}

function rowToBotRecord(row: Record<string, unknown>): BotRecord {
  const j = (v: unknown) => (v == null ? null : JSON.parse(String(v)));
  return {
    client_id: String(row.client_id), bot_id: String(row.bot_id), name: String(row.name),
    transport: String(row.transport), status: String(row.status),
    status_reason: row.status_reason == null ? null : String(row.status_reason),
    default_language: String(row.default_language),
    languages: j(row.languages) ?? [],
    system_prompt: j(row.system_prompt) ?? {},
    lead_fields: String(row.lead_fields ?? ''),
    welcome: j(row.welcome) ?? { enabled: false, message: {} },
    error_messages: j(row.error_messages) ?? {},
    catalog: j(row.catalog),
    llm: j(row.llm),
    crm: j(row.crm),
    personality: j(row.personality),
    entity_id: row.entity_id == null ? null : Number(row.entity_id),
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

  // Sessions clées par (wa_number, phone) : l'ancienne table (phone seul) est supprimée avant la création du
  // schéma. Ce sont des données d'exécution éphémères ; conversations et leads ne sont pas touchés.
  const legacySessionCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (legacySessionCols.length > 0 && !legacySessionCols.some((c) => c.name === 'wa_number')) {
    const dropped = (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
    db.exec('DROP TABLE sessions');
    console.log(`[DB] Sessions migrated to (wa_number, phone), ${dropped} legacy row(s) dropped`);
  }

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS sessions (
      wa_number TEXT NOT NULL,
      phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (wa_number, phone)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);

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
      created_at TEXT DEFAULT (datetime('now')),
      state TEXT NOT NULL DEFAULT 'done'
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
      personality TEXT,
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

    CREATE TABLE IF NOT EXISTS bot_runtime_state (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      transport_validated_at TEXT,
      transport_error TEXT,
      last_crm_error TEXT,
      last_crm_error_at TEXT,
      unserved_count INTEGER NOT NULL DEFAULT 0,
      unserved_last_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, bot_id)
    );
  `;
  db.exec(SCHEMA);

  // ensure-column : ajoute personality aux bases existantes (CREATE TABLE IF NOT EXISTS ne migre pas).
  const botCols = db.prepare('PRAGMA table_info(bots)').all() as { name: string }[];
  if (!botCols.some((c) => c.name === 'personality')) {
    db.exec('ALTER TABLE bots ADD COLUMN personality TEXT');
  }

  // ensure-column : dédoublonnage en deux temps (state) et compteur de messages non servis.
  // Les lignes existantes valent 'done' et 0.
  const processedCols = db.prepare('PRAGMA table_info(processed_messages)').all() as { name: string }[];
  if (!processedCols.some((c) => c.name === 'state')) {
    db.exec("ALTER TABLE processed_messages ADD COLUMN state TEXT NOT NULL DEFAULT 'done'");
  }
  const runtimeCols = db.prepare('PRAGMA table_info(bot_runtime_state)').all() as { name: string }[];
  if (!runtimeCols.some((c) => c.name === 'unserved_count')) {
    db.exec('ALTER TABLE bot_runtime_state ADD COLUMN unserved_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!runtimeCols.some((c) => c.name === 'unserved_last_at')) {
    db.exec('ALTER TABLE bot_runtime_state ADD COLUMN unserved_last_at TEXT');
  }

  // Numéros WhatsApp en E.164 : préfixe '+' les numéros écrits par l'ancien schéma (chiffres seuls). Idempotent.
  db.exec("UPDATE bot_numbers SET whatsapp_number = '+' || whatsapp_number WHERE whatsapp_number NOT LIKE '+%'");
  const legacyNumbers = db.prepare('SELECT whatsapp_number FROM bot_numbers').all() as { whatsapp_number: string }[];
  const invalidCount = legacyNumbers.filter((r) => normalizeWhatsAppNumber(r.whatsapp_number) === null).length;
  if (invalidCount > 0) console.warn(`[DB] ${invalidCount} numéro(s) WhatsApp non conformes E.164 restent dans bot_numbers`);

  // Module comptes : entities, memberships, agencies + colonnes bots.entity_id, clients.settings/agency_id, invitations.grants.
  ensureSqliteAccountsSchema(db);

  // Module comptes WhatsApp : whatsapp_accounts, whatsapp_numbers, bot_allowlist + colonne bots.status_reason.
  ensureSqliteWhatsAppSchema(db);

  const driver: Database = {
    ...createSqliteAccountsStore(db),
    ...createSqliteWhatsAppStore(db),

    async getSession(waNumber: string, contactId: string): Promise<Session | undefined> {
      return db.prepare(
        'SELECT wa_number, phone, client_id, bot_id, created_at, updated_at FROM sessions WHERE wa_number = ? AND phone = ?'
      ).get(waNumber, contactId) as Session | undefined;
    },

    async createSessionIfAbsent(waNumber: string, contactId: string, clientId: string, botId: string): Promise<boolean> {
      const row = db.prepare(
        `INSERT INTO sessions (wa_number, phone, client_id, bot_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(wa_number, phone) DO NOTHING RETURNING wa_number`
      ).get(waNumber, contactId, clientId, botId);
      return row !== undefined;
    },

    async touchSession(waNumber: string, contactId: string): Promise<void> {
      db.prepare(`UPDATE sessions SET updated_at = datetime('now') WHERE wa_number = ? AND phone = ?`).run(waNumber, contactId);
    },

    async purgeInactiveSessions(days: number): Promise<number> {
      if (!Number.isFinite(days) || days < 0) throw new Error('[DB] Nombre de jours invalide pour la purge des sessions');
      const result = db.prepare(`DELETE FROM sessions WHERE updated_at < datetime('now', '-' || ? || ' days')`).run(days);
      if (result.changes > 0) {
        console.log(`[DB] Purged ${result.changes} sessions inactive for more than ${days} days`);
      }
      return result.changes;
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

    async saveLead(phone: string, clientId: string, botId: string, data: Record<string, unknown>): Promise<void> {
      const name = (data['name'] as string | undefined) || (data['profileName'] as string | undefined) || undefined;
      // Lecture, fusion et écriture dans une transaction synchrone : atomique. Les valeurs null sont conservées.
      db.transaction(() => {
        const existing = db.prepare('SELECT id, qualified_data FROM leads WHERE phone = ? AND client_id = ? AND bot_id = ?').get(phone, clientId, botId) as
          | { id: number; qualified_data: string | null }
          | undefined;
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
      })();
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

    async listLeadsByBot(clientId: string, botId: string, opts: { search?: string; rdvOnly?: boolean; limit: number; offset: number }): Promise<LeadListResult> {
      const where: string[] = ['l.client_id = ?', 'l.bot_id = ?'];
      const params: unknown[] = [clientId, botId];
      if (opts.rdvOnly) where.push('l.rdv_requested = 1');
      if (opts.search) {
        where.push('(l.name LIKE ? OR l.phone LIKE ?)');
        const like = `%${opts.search}%`;
        params.push(like, like);
      }
      const whereSql = where.join(' AND ');
      const total = (db.prepare(`SELECT COUNT(*) as n FROM leads l WHERE ${whereSql}`).get(...params) as { n: number }).n;
      const leads = db.prepare(`
        SELECT l.phone, l.client_id, l.bot_id, l.name, l.qualified_data, l.rdv_requested, l.created_at,
          COALESCE(c.msg_count, 0) as message_count,
          c.last_msg_at as last_message_at
        FROM leads l
        LEFT JOIN (
          SELECT phone, client_id, bot_id, COUNT(*) as msg_count, MAX(created_at) as last_msg_at
          FROM conversations GROUP BY phone, client_id, bot_id
        ) c ON c.phone = l.phone AND c.client_id = l.client_id AND c.bot_id = l.bot_id
        WHERE ${whereSql}
        ORDER BY l.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params, opts.limit, opts.offset) as LeadRow[];
      return { leads, total };
    },

    async claimMessage(key: string, staleAfterSeconds: number): Promise<boolean> {
      // Une seule requête : insère la clé, ou la reprend si elle est en cours depuis au moins le délai.
      // created_at porte l'heure de réclamation, à la milliseconde ('YYYY-MM-DD HH:MM:SS.SSS'). Le format reste
      // comparable lexicalement aux lignes héritées ('YYYY-MM-DD HH:MM:SS') et à la limite de purge datetime('now', '-168 hours').
      const row = db.prepare(
        `INSERT INTO processed_messages (message_id, state, created_at) VALUES (?, 'processing', strftime('%Y-%m-%d %H:%M:%f', 'now'))
         ON CONFLICT (message_id) DO UPDATE SET state = 'processing', created_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
         WHERE processed_messages.state = 'processing'
           AND processed_messages.created_at <= strftime('%Y-%m-%d %H:%M:%f', 'now', '-' || ? || ' seconds')
         RETURNING message_id`
      ).get(key, staleAfterSeconds);
      return row !== undefined;
    },

    async completeMessage(key: string): Promise<void> {
      db.prepare(`UPDATE processed_messages SET state = 'done' WHERE message_id = ?`).run(key);
    },

    async cleanupProcessedMessages(): Promise<void> {
      db.prepare(`DELETE FROM processed_messages WHERE created_at < datetime('now', '-' || ? || ' hours')`).run(PROCESSED_MESSAGES_RETENTION_HOURS);
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
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality, entity_id, status_reason
         FROM bots WHERE client_id = ? AND bot_id = ?`
      ).get(clientId, botId) as Record<string, string> | undefined;
      return row ? rowToBotRecord(row) : undefined;
    },

    async listBotRecords(): Promise<BotRecord[]> {
      const rows = db.prepare(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality, entity_id, status_reason
         FROM bots ORDER BY client_id, bot_id`
      ).all() as Array<Record<string, string>>;
      return rows.map(rowToBotRecord);
    },

    async upsertBotRecord(rec: BotRecord): Promise<void> {
      const vals = botRecordToCols(rec);
      const upd = db.prepare(
        `UPDATE bots SET name=?, transport=?, default_language=?, languages=?,
           system_prompt=?, lead_fields=?, welcome=?, error_messages=?, catalog=?, llm=?, crm=?,
           personality=?, entity_id=?, updated_at=datetime('now')
         WHERE client_id=? AND bot_id=?`
      ).run(vals.name, vals.transport, vals.default_language, vals.languages,
            vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm,
            vals.personality, vals.entity_id, rec.client_id, rec.bot_id);
      if (upd.changes === 0) {
        db.prepare(
          `INSERT INTO bots (client_id, bot_id, name, transport, status, default_language, languages,
             system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality, entity_id, status_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(rec.client_id, rec.bot_id, vals.name, vals.transport, vals.status, vals.default_language, vals.languages,
              vals.system_prompt, vals.lead_fields, vals.welcome, vals.error_messages, vals.catalog, vals.llm, vals.crm,
              vals.personality, vals.entity_id, rec.status_reason ?? null);
      }
    },

    // Temporaire, supprimée en tâche 8 (remplacée par le service de statut de la tâche 2).
    async setBotStatusUnchecked(clientId: string, botId: string, status: string): Promise<void> {
      db.prepare(`UPDATE bots SET status = ?, updated_at = datetime('now') WHERE client_id = ? AND bot_id = ?`).run(status, clientId, botId);
    },

    async deleteBotRecord(clientId: string, botId: string): Promise<void> {
      db.prepare('DELETE FROM bot_numbers WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
      db.prepare('DELETE FROM bot_allowlist WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
      db.prepare(`UPDATE whatsapp_numbers SET bot_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE client_id = ? AND bot_id = ?`).run(clientId, botId);
      db.prepare('DELETE FROM bots WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
    },

    async listBotNumbers(): Promise<BotNumberRecord[]> {
      return db.prepare('SELECT whatsapp_number, client_id, bot_id FROM bot_numbers ORDER BY whatsapp_number').all() as BotNumberRecord[];
    },

    async setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void> {
      const stored = toStoredWhatsAppNumbers(numbers);
      const tx = db.transaction((nums: string[]) => {
        db.prepare('DELETE FROM bot_numbers WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
        const ins = db.prepare('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES (?, ?, ?)');
        for (const n of nums) ins.run(n, clientId, botId);
      });
      tx(stored);
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

    async getBotMetrics(clientId: string, botId: string): Promise<BotMetrics> {
      const leads = (db.prepare('SELECT COUNT(*) as n FROM leads WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;
      const rdv = (db.prepare('SELECT COUNT(*) as n FROM leads WHERE client_id = ? AND bot_id = ? AND rdv_requested = 1').get(clientId, botId) as { n: number }).n;
      const convs = (db.prepare('SELECT COUNT(DISTINCT phone) as n FROM conversations WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;
      const msgs = (db.prepare('SELECT COUNT(*) as n FROM conversations WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;
      return { leads_total: leads, rdv_total: rdv, conversations_total: convs, messages_total: msgs };
    },

    async listLlmUsageByBot(clientId: string, botId: string, sinceIso?: string): Promise<LlmUsageRow[]> {
      if (sinceIso) {
        return db.prepare(
          `SELECT id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
                  input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id, created_at
           FROM llm_usage WHERE client_id = ? AND bot_id = ? AND created_at >= ? ORDER BY created_at DESC`
        ).all(clientId, botId, sinceIso) as LlmUsageRow[];
      }
      return db.prepare(
        `SELECT id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id, created_at
         FROM llm_usage WHERE client_id = ? AND bot_id = ? ORDER BY created_at DESC`
      ).all(clientId, botId) as LlmUsageRow[];
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
      const grants = input.grants == null ? null : JSON.stringify(input.grants);
      const info = db.prepare(
        `INSERT INTO invitations (email, client_id, role, token_hash, expires_at, grants)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(input.email, input.client_id, input.role, input.token_hash, input.expires_at, grants);
      const row = db.prepare(
        `SELECT ${SQLITE_INVITATION_COLUMNS} FROM invitations WHERE id = ?`
      ).get(Number(info.lastInsertRowid)) as SqliteInvitationRow;
      return rowToInvitationRecord(row);
    },

    async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined> {
      const row = db.prepare(
        `SELECT ${SQLITE_INVITATION_COLUMNS} FROM invitations WHERE token_hash = ?`
      ).get(tokenHash) as SqliteInvitationRow | undefined;
      return row ? rowToInvitationRecord(row) : undefined;
    },

    async markInvitationAccepted(id: number): Promise<void> {
      db.prepare(`UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?`).run(id);
    },

    async listInvitations(clientId: string): Promise<InvitationRecord[]> {
      const rows = db.prepare(
        `SELECT ${SQLITE_INVITATION_COLUMNS} FROM invitations WHERE client_id = ? ORDER BY id DESC`
      ).all(clientId) as SqliteInvitationRow[];
      return rows.map(rowToInvitationRecord);
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

    async getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined> {
      return db.prepare(
        `SELECT client_id, bot_id, transport_validated_at, transport_error, last_crm_error, last_crm_error_at,
                unserved_count, unserved_last_at, updated_at
         FROM bot_runtime_state WHERE client_id = ? AND bot_id = ?`
      ).get(clientId, botId) as BotRuntimeStateRecord | undefined;
    },

    async setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void> {
      db.prepare(
        `INSERT INTO bot_runtime_state (client_id, bot_id, transport_validated_at, transport_error)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           transport_validated_at = excluded.transport_validated_at,
           transport_error = excluded.transport_error,
           updated_at = datetime('now')`
      ).run(clientId, botId, validatedAt, error);
    },

    async setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void> {
      const at = error === null ? null : new Date().toISOString();
      db.prepare(
        `INSERT INTO bot_runtime_state (client_id, bot_id, last_crm_error, last_crm_error_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           last_crm_error = excluded.last_crm_error,
           last_crm_error_at = excluded.last_crm_error_at,
           updated_at = datetime('now')`
      ).run(clientId, botId, error, at);
    },

    async incrementUnserved(clientId: string, botId: string): Promise<void> {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO bot_runtime_state (client_id, bot_id, unserved_count, unserved_last_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           unserved_count = bot_runtime_state.unserved_count + 1,
           unserved_last_at = excluded.unserved_last_at,
           updated_at = datetime('now')`
      ).run(clientId, botId, now);
    },

    async close(): Promise<void> {
      db.close();
    },
  };

  return driver;
}
