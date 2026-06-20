import pg from 'pg';
import type { Database, Session, SessionRow, HistoryRow, LeadRow, CrossConversationRow, CredentialRecord } from './types.js';

const { Pool } = pg;

export async function createPostgresDriver(databaseUrl: string): Promise<Database> {
  const pool = new Pool({ connectionString: databaseUrl });

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS sessions (
      phone TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      name TEXT,
      qualified_data JSONB,
      rdv_requested INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (phone, client_id, bot_id)
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_phone_bot ON conversations(phone, client_id, bot_id);
    CREATE INDEX IF NOT EXISTS idx_leads_phone_bot ON leads(phone, client_id, bot_id);

    CREATE TABLE IF NOT EXISTS tenant_credentials (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      service TEXT NOT NULL,
      provider TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'byo',
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_credentials
      ON tenant_credentials(client_id, COALESCE(bot_id, ''), service, provider);
  `;
  await pool.query(SCHEMA);

  console.log('[DB] PostgreSQL schema initialized');

  const driver: Database = {
    async getSession(phone: string): Promise<Session | undefined> {
      const result = await pool.query(
        'SELECT phone, client_id, bot_id, created_at::text, updated_at::text FROM sessions WHERE phone = $1',
        [phone]
      );
      return result.rows[0] as Session | undefined;
    },

    async createSession(phone: string, clientId: string, botId: string): Promise<void> {
      await pool.query(
        `INSERT INTO sessions (phone, client_id, bot_id) VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE SET client_id = $2, bot_id = $3, updated_at = NOW()`,
        [phone, clientId, botId]
      );
    },

    async getAllSessions(): Promise<SessionRow[]> {
      const result = await pool.query(`
        SELECT s.phone, s.client_id, s.bot_id, s.updated_at::text, COUNT(c.id)::int as msg_count
        FROM sessions s
        LEFT JOIN conversations c ON c.phone = s.phone AND c.client_id = s.client_id AND c.bot_id = s.bot_id
        GROUP BY s.phone, s.client_id, s.bot_id, s.updated_at
        ORDER BY s.updated_at DESC
      `);
      return result.rows as SessionRow[];
    },

    async getConversation(phone: string, clientId: string, botId: string, limit = 20): Promise<{ role: string; content: string }[]> {
      const result = await pool.query(
        'SELECT role, content FROM conversations WHERE phone = $1 AND client_id = $2 AND bot_id = $3 ORDER BY id DESC LIMIT $4',
        [phone, clientId, botId, limit]
      );
      return result.rows as { role: string; content: string }[];
    },

    async addMessage(phone: string, clientId: string, botId: string, role: 'user' | 'assistant', content: string): Promise<void> {
      await pool.query(
        'INSERT INTO conversations (phone, client_id, bot_id, role, content) VALUES ($1, $2, $3, $4, $5)',
        [phone, clientId, botId, role, content]
      );
    },

    async getRecentHistory(phone: string, clientId: string, botId: string, limit = 10): Promise<HistoryRow[]> {
      const result = await pool.query(
        'SELECT role, content, created_at::text FROM conversations WHERE phone = $1 AND client_id = $2 AND bot_id = $3 ORDER BY id DESC LIMIT $4',
        [phone, clientId, botId, limit]
      );
      return result.rows as HistoryRow[];
    },

    async resetSession(phone: string): Promise<void> {
      await pool.query('DELETE FROM sessions WHERE phone = $1', [phone]);
      console.log(`[DB] Session reset: ${phone}`);
    },

    async resetBotSession(phone: string, clientId: string, botId: string): Promise<void> {
      await pool.query('DELETE FROM sessions WHERE phone = $1 AND client_id = $2 AND bot_id = $3', [phone, clientId, botId]);
      await pool.query('DELETE FROM conversations WHERE phone = $1 AND client_id = $2 AND bot_id = $3', [phone, clientId, botId]);
      await pool.query('DELETE FROM leads WHERE phone = $1 AND client_id = $2 AND bot_id = $3', [phone, clientId, botId]);
      console.log(`[DB] Bot session reset: ${phone} (${clientId}/${botId})`);
    },

    async getCrossConversations(phone: string, currentClientId: string, currentBotId: string, limit = 10): Promise<CrossConversationRow[]> {
      const result = await pool.query(
        `SELECT client_id, bot_id, role, content, created_at::text FROM conversations
         WHERE phone = $1 AND NOT (client_id = $2 AND bot_id = $3)
         ORDER BY id DESC LIMIT $4`,
        [phone, currentClientId, currentBotId, limit]
      );
      return result.rows as CrossConversationRow[];
    },

    async resetAll(phone: string): Promise<void> {
      await pool.query('DELETE FROM sessions WHERE phone = $1', [phone]);
      await pool.query('DELETE FROM conversations WHERE phone = $1', [phone]);
      await pool.query('DELETE FROM leads WHERE phone = $1', [phone]);
      console.log(`[DB] Full reset: ${phone}`);
    },

    async saveLead(phone: string, clientId: string, botId: string, data: Record<string, unknown>): Promise<void> {
      const existing = await pool.query(
        'SELECT id, qualified_data, name FROM leads WHERE phone = $1 AND client_id = $2 AND bot_id = $3',
        [phone, clientId, botId]
      );
      const name = (data['name'] as string | undefined) || (data['profileName'] as string | undefined) || undefined;
      if (existing.rows[0]) {
        const row = existing.rows[0] as { id: number; qualified_data: Record<string, unknown> | null; name: string | null };
        const merged = { ...(row.qualified_data ?? {}), ...data };
        await pool.query(
          'UPDATE leads SET qualified_data = $1, name = COALESCE($2, name) WHERE id = $3',
          [JSON.stringify(merged), name ?? null, row.id]
        );
      } else {
        await pool.query(
          'INSERT INTO leads (phone, client_id, bot_id, name, qualified_data) VALUES ($1, $2, $3, $4, $5)',
          [phone, clientId, botId, name ?? null, JSON.stringify(data)]
        );
      }
    },

    async getLeadData(phone: string, clientId: string, botId: string): Promise<Record<string, unknown> | null> {
      const result = await pool.query(
        'SELECT qualified_data FROM leads WHERE phone = $1 AND client_id = $2 AND bot_id = $3',
        [phone, clientId, botId]
      );
      const row = result.rows[0] as { qualified_data: Record<string, unknown> | null } | undefined;
      if (!row?.qualified_data) return null;
      return row.qualified_data;
    },

    async getAllLeads(): Promise<LeadRow[]> {
      const result = await pool.query(`
        SELECT l.phone, l.client_id, l.bot_id, l.name, l.qualified_data::text, l.rdv_requested, l.created_at::text,
          COALESCE(c.msg_count, 0)::int as message_count,
          c.last_msg_at::text as last_message_at
        FROM leads l
        LEFT JOIN (
          SELECT phone, client_id, bot_id, COUNT(*) as msg_count, MAX(created_at) as last_msg_at
          FROM conversations
          GROUP BY phone, client_id, bot_id
        ) c ON c.phone = l.phone AND c.client_id = l.client_id AND c.bot_id = l.bot_id
        ORDER BY l.created_at DESC
      `);
      return result.rows as LeadRow[];
    },

    async isMessageProcessed(messageId: string): Promise<boolean> {
      const check = await pool.query(
        'SELECT 1 FROM processed_messages WHERE message_id = $1',
        [messageId]
      );
      if (check.rows.length > 0) return true;
      await pool.query(
        'INSERT INTO processed_messages (message_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [messageId]
      );
      return false;
    },

    async markMessageProcessed(_messageId: string): Promise<void> {
      // No-op: isMessageProcessed handles insert
    },

    async cleanupProcessedMessages(): Promise<void> {
      await pool.query(`DELETE FROM processed_messages WHERE created_at < NOW() - INTERVAL '7 days'`);
    },

    async purgeOldConversations(days = 90): Promise<void> {
      const result = await pool.query(
        `DELETE FROM conversations WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
        [days]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[DB] Purged ${result.rowCount} conversations older than ${days} days`);
      }
    },

    async getCredential(clientId: string, botId: string | null, service: string, provider: string): Promise<CredentialRecord | undefined> {
      const result = await pool.query(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials
         WHERE client_id = $1 AND bot_id IS NOT DISTINCT FROM $2 AND service = $3 AND provider = $4`,
        [clientId, botId, service, provider]
      );
      return result.rows[0] as CredentialRecord | undefined;
    },

    async upsertCredential(rec: CredentialRecord): Promise<void> {
      const upd = await pool.query(
        `UPDATE tenant_credentials
         SET mode = $5, secret_encrypted = $6, key_version = $7, updated_at = NOW()
         WHERE client_id = $1 AND bot_id IS NOT DISTINCT FROM $2 AND service = $3 AND provider = $4`,
        [rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO tenant_credentials (client_id, bot_id, service, provider, mode, secret_encrypted, key_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version]
        );
      }
    },

    async listCredentials(clientId: string): Promise<CredentialRecord[]> {
      const result = await pool.query(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials WHERE client_id = $1 ORDER BY service, provider`,
        [clientId]
      );
      return result.rows as CredentialRecord[];
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };

  return driver;
}
