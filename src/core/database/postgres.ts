import pg from 'pg';
import { PROCESSED_MESSAGES_RETENTION_HOURS } from './types.js';
import type { Database, Session, HistoryRow, LeadRow, LeadListResult, CredentialRecord, PlatformKeyRecord, PlatformKeyInput, ClientRecord, BotRecord, BotNumberRecord, LlmPricingRecord, LlmPricingInput, LlmUsageInput, LlmUsageRow, BotMetrics, UserRecord, UserInput, InvitationRecord, InvitationInput, AuthSessionRecord, AuthSessionInput, PasswordResetRecord, PasswordResetInput, ConnectorMappingInput, ConnectorMappingRecord, AuditLogInput, AuditLogRow, BotRuntimeStateRecord } from './types.js';
import { normalizeWhatsAppNumber, toStoredWhatsAppNumbers } from '../phone.js';
import { createPostgresAccountsStore, ensurePostgresAccountsSchema, pgIso, PG_INVITATION_COLUMNS } from './accounts-postgres.js';
import { createPostgresWhatsAppStore, ensurePostgresWhatsAppSchema, withTopologyTransaction } from './whatsapp-postgres.js';

const { Pool } = pg;

export async function createPostgresDriver(databaseUrl: string): Promise<Database> {
  const pool = new Pool({ connectionString: databaseUrl });

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS sessions (
      wa_number TEXT NOT NULL,
      phone TEXT NOT NULL,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (wa_number, phone)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);

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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      state TEXT NOT NULL DEFAULT 'done'
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

    CREATE TABLE IF NOT EXISTS platform_llm_keys (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uniq_platform_llm_keys_label
      ON platform_llm_keys(label);

    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bots (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      default_language TEXT NOT NULL DEFAULT 'fr',
      languages JSONB NOT NULL DEFAULT '["fr"]',
      system_prompt JSONB NOT NULL DEFAULT '{}',
      lead_fields TEXT NOT NULL DEFAULT '',
      welcome JSONB NOT NULL DEFAULT '{"enabled":false,"message":{}}',
      error_messages JSONB NOT NULL DEFAULT '{}',
      catalog JSONB,
      llm JSONB,
      crm JSONB,
      personality JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (client_id, bot_id)
    );

    CREATE TABLE IF NOT EXISTS bot_numbers (
      whatsapp_number TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bot_numbers_bot ON bot_numbers(client_id, bot_id);

    CREATE TABLE IF NOT EXISTS llm_pricing (
      id SERIAL PRIMARY KEY,
      model TEXT NOT NULL,
      input_per_mtok DOUBLE PRECISION NOT NULL,
      output_per_mtok DOUBLE PRECISION NOT NULL,
      cache_read_per_mtok DOUBLE PRECISION NOT NULL,
      cache_write_per_mtok DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      effective_from TIMESTAMPTZ DEFAULT NOW(),
      effective_to TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_llm_pricing_model ON llm_pricing(model, effective_to);

    CREATE TABLE IF NOT EXISTS llm_usage (
      id SERIAL PRIMARY KEY,
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
      cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      pricing_version INTEGER,
      anthropic_request_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_llm_usage_client ON llm_usage(client_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_bot ON llm_usage(client_id, bot_id, created_at);

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT,
      role TEXT NOT NULL,
      client_id TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      client_id TEXT,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_invitations_token ON invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_invitations_client ON invitations(client_id);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_auth_sessions_token ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_password_resets_token ON password_resets(token_hash);

    CREATE TABLE IF NOT EXISTS connector_mappings (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      bot_id TEXT,
      connector TEXT NOT NULL,
      mapping JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_connector_mappings
      ON connector_mappings(client_id, COALESCE(bot_id, ''), connector);

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      client_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_client ON audit_log(client_id, id);

    CREATE TABLE IF NOT EXISTS bot_runtime_state (
      client_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      transport_validated_at TIMESTAMPTZ,
      transport_error TEXT,
      last_crm_error TEXT,
      last_crm_error_at TIMESTAMPTZ,
      unserved_count INTEGER NOT NULL DEFAULT 0,
      unserved_last_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (client_id, bot_id)
    );
  `;

  // Sessions clées par (wa_number, phone) : l'ancienne table (phone seul) est supprimée avant la création du
  // schéma. Ce sont des données d'exécution éphémères ; conversations et leads ne sont pas touchés.
  const legacySessionCols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'sessions'`
  );
  if (legacySessionCols.rows.length > 0 && !legacySessionCols.rows.some((r: { column_name: string }) => r.column_name === 'wa_number')) {
    const dropped = Number((await pool.query('SELECT COUNT(*) AS n FROM sessions')).rows[0]?.n ?? 0);
    await pool.query('DROP TABLE sessions');
    console.log(`[DB] Sessions migrated to (wa_number, phone), ${dropped} legacy row(s) dropped`);
  }

  await pool.query(SCHEMA);

  // ensure-column : ajoute personality aux bases existantes.
  await pool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS personality JSONB');

  // ensure-column : dédoublonnage en deux temps (state) et compteur de messages non servis.
  // Les lignes existantes valent 'done' et 0.
  await pool.query("ALTER TABLE processed_messages ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'done'");
  await pool.query('ALTER TABLE bot_runtime_state ADD COLUMN IF NOT EXISTS unserved_count INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE bot_runtime_state ADD COLUMN IF NOT EXISTS unserved_last_at TIMESTAMPTZ');

  // Numéros WhatsApp en E.164 : préfixe '+' les numéros écrits par l'ancien schéma (chiffres seuls). Idempotent.
  await pool.query("UPDATE bot_numbers SET whatsapp_number = '+' || whatsapp_number WHERE whatsapp_number NOT LIKE '+%'");
  const legacyNumbers = await pool.query('SELECT whatsapp_number FROM bot_numbers');
  const invalidCount = (legacyNumbers.rows as { whatsapp_number: string }[]).filter((r) => normalizeWhatsAppNumber(r.whatsapp_number) === null).length;
  if (invalidCount > 0) console.warn(`[DB] ${invalidCount} numéro(s) WhatsApp non conformes E.164 restent dans bot_numbers`);

  // Module comptes : entities, memberships, agencies + colonnes bots.entity_id, clients.settings/agency_id, invitations.grants.
  await ensurePostgresAccountsSchema(pool);

  // Module comptes WhatsApp : whatsapp_accounts, whatsapp_numbers, bot_allowlist + colonne bots.status_reason.
  await ensurePostgresWhatsAppSchema(pool);

  console.log('[DB] PostgreSQL schema initialized');

  const driver: Database = {
    ...createPostgresAccountsStore(pool),
    ...createPostgresWhatsAppStore(pool),

    async getSession(waNumber: string, contactId: string): Promise<Session | undefined> {
      const result = await pool.query(
        'SELECT wa_number, phone, client_id, bot_id, created_at::text, updated_at::text FROM sessions WHERE wa_number = $1 AND phone = $2',
        [waNumber, contactId]
      );
      return result.rows[0] as Session | undefined;
    },

    async createSessionIfAbsent(waNumber: string, contactId: string, clientId: string, botId: string): Promise<boolean> {
      const result = await pool.query(
        `INSERT INTO sessions (wa_number, phone, client_id, bot_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (wa_number, phone) DO NOTHING RETURNING wa_number`,
        [waNumber, contactId, clientId, botId]
      );
      return (result.rowCount ?? 0) > 0;
    },

    async touchSession(waNumber: string, contactId: string): Promise<void> {
      await pool.query('UPDATE sessions SET updated_at = NOW() WHERE wa_number = $1 AND phone = $2', [waNumber, contactId]);
    },

    async purgeInactiveSessions(days: number): Promise<number> {
      if (!Number.isFinite(days) || days < 0) throw new Error('[DB] Nombre de jours invalide pour la purge des sessions');
      const result = await pool.query(`DELETE FROM sessions WHERE updated_at < NOW() - INTERVAL '1 day' * $1`, [days]);
      const count = result.rowCount ?? 0;
      if (count > 0) {
        console.log(`[DB] Purged ${count} sessions inactive for more than ${days} days`);
      }
      return count;
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

    async saveLead(phone: string, clientId: string, botId: string, data: Record<string, unknown>): Promise<void> {
      const name = (data['name'] as string | undefined) || (data['profileName'] as string | undefined) || undefined;
      // Une seule requête atomique. L'opérateur jsonb || conserve les valeurs null (contrairement à json_patch).
      await pool.query(
        `INSERT INTO leads (phone, client_id, bot_id, name, qualified_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (phone, client_id, bot_id) DO UPDATE SET
           qualified_data = COALESCE(leads.qualified_data, '{}'::jsonb) || EXCLUDED.qualified_data,
           name = COALESCE(EXCLUDED.name, leads.name)`,
        [phone, clientId, botId, name ?? null, JSON.stringify(data)]
      );
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

    async listLeadsByBot(clientId: string, botId: string, opts: { search?: string; rdvOnly?: boolean; limit: number; offset: number }): Promise<LeadListResult> {
      const where: string[] = ['l.client_id = $1', 'l.bot_id = $2'];
      const params: unknown[] = [clientId, botId];
      let i = 3;
      if (opts.rdvOnly) where.push('l.rdv_requested = 1');
      if (opts.search) {
        where.push(`(l.name ILIKE $${i} OR l.phone ILIKE $${i + 1})`);
        const like = `%${opts.search}%`;
        params.push(like, like);
        i += 2;
      }
      const whereSql = where.join(' AND ');
      const totalRes = await pool.query(`SELECT COUNT(*)::int as n FROM leads l WHERE ${whereSql}`, params);
      const total = (totalRes.rows[0] as { n: number }).n;
      const res = await pool.query(`
        SELECT l.phone, l.client_id, l.bot_id, l.name,
          l.qualified_data::text AS qualified_data, l.rdv_requested, l.created_at::text as created_at,
          COALESCE(c.msg_count, 0)::int as message_count,
          c.last_msg_at::text as last_message_at
        FROM leads l
        LEFT JOIN (
          SELECT phone, client_id, bot_id, COUNT(*)::int as msg_count, MAX(created_at) as last_msg_at
          FROM conversations GROUP BY phone, client_id, bot_id
        ) c ON c.phone = l.phone AND c.client_id = l.client_id AND c.bot_id = l.bot_id
        WHERE ${whereSql}
        ORDER BY l.created_at DESC
        LIMIT $${i} OFFSET $${i + 1}
      `, [...params, opts.limit, opts.offset]);
      return { leads: res.rows as LeadRow[], total };
    },

    async claimMessage(key: string, staleAfterSeconds: number): Promise<boolean> {
      // Une seule requête : insère la clé, ou la reprend si elle est en cours depuis au moins le délai.
      // La comparaison se fait côté serveur (horloge Postgres), jamais en JavaScript.
      const r = await pool.query(
        `INSERT INTO processed_messages (message_id, state, created_at) VALUES ($1, 'processing', NOW())
         ON CONFLICT (message_id) DO UPDATE SET state = 'processing', created_at = NOW()
         WHERE processed_messages.state = 'processing'
           AND processed_messages.created_at <= NOW() - make_interval(secs => $2::double precision)
         RETURNING message_id`,
        [key, staleAfterSeconds]
      );
      return (r.rowCount ?? 0) > 0;
    },

    async completeMessage(key: string): Promise<void> {
      await pool.query(`UPDATE processed_messages SET state = 'done' WHERE message_id = $1`, [key]);
    },

    async cleanupProcessedMessages(): Promise<void> {
      await pool.query(
        `DELETE FROM processed_messages WHERE created_at < NOW() - INTERVAL '1 hour' * $1`,
        [PROCESSED_MESSAGES_RETENTION_HOURS]
      );
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
      // La cible correspond à l'index unique uniq_tenant_credentials (expression COALESCE sur bot_id).
      await pool.query(
        `INSERT INTO tenant_credentials (client_id, bot_id, service, provider, mode, secret_encrypted, key_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (client_id, COALESCE(bot_id, ''), service, provider) DO UPDATE SET
           mode = EXCLUDED.mode, secret_encrypted = EXCLUDED.secret_encrypted,
           key_version = EXCLUDED.key_version, updated_at = NOW()`,
        [rec.client_id, rec.bot_id, rec.service, rec.provider, rec.mode, rec.secret_encrypted, rec.key_version]
      );
    },

    async listCredentials(clientId: string): Promise<CredentialRecord[]> {
      const result = await pool.query(
        `SELECT client_id, bot_id, service, provider, mode, secret_encrypted, key_version
         FROM tenant_credentials WHERE client_id = $1 ORDER BY service, provider`,
        [clientId]
      );
      return result.rows as CredentialRecord[];
    },

    async listActivePlatformKeys(): Promise<PlatformKeyRecord[]> {
      const result = await pool.query(
        `SELECT id, label, secret_encrypted, key_version, active
         FROM platform_llm_keys WHERE active = TRUE ORDER BY id`
      );
      return result.rows as PlatformKeyRecord[];
    },

    async upsertPlatformKey(rec: PlatformKeyInput): Promise<void> {
      const upd = await pool.query(
        `UPDATE platform_llm_keys
         SET secret_encrypted = $2, key_version = $3, active = $4, updated_at = NOW()
         WHERE label = $1`,
        [rec.label, rec.secret_encrypted, rec.key_version, rec.active]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO platform_llm_keys (label, secret_encrypted, key_version, active)
           VALUES ($1, $2, $3, $4)`,
          [rec.label, rec.secret_encrypted, rec.key_version, rec.active]
        );
      }
    },

    async listClients(): Promise<ClientRecord[]> {
      const result = await pool.query('SELECT client_id, name, status FROM clients ORDER BY client_id');
      return result.rows as ClientRecord[];
    },

    async upsertClient(rec: ClientRecord): Promise<void> {
      const upd = await pool.query(
        'UPDATE clients SET name = $2, status = $3, updated_at = NOW() WHERE client_id = $1',
        [rec.client_id, rec.name, rec.status]
      );
      if (upd.rowCount === 0) {
        await pool.query('INSERT INTO clients (client_id, name, status) VALUES ($1, $2, $3)', [rec.client_id, rec.name, rec.status]);
      }
    },

    async getBotRecord(clientId: string, botId: string): Promise<BotRecord | undefined> {
      const r = await pool.query(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality, entity_id, status_reason
         FROM bots WHERE client_id = $1 AND bot_id = $2`, [clientId, botId]
      );
      return r.rows[0] as BotRecord | undefined;
    },

    async listBotRecords(): Promise<BotRecord[]> {
      const r = await pool.query(
        `SELECT client_id, bot_id, name, transport, status, default_language, languages,
                system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality, entity_id, status_reason
         FROM bots ORDER BY client_id, bot_id`
      );
      return r.rows as BotRecord[];
    },

    async upsertBotRecord(rec: BotRecord): Promise<void> {
      const params = [
        rec.client_id, rec.bot_id, rec.name, rec.transport, rec.status, rec.default_language,
        JSON.stringify(rec.languages), JSON.stringify(rec.system_prompt), rec.lead_fields,
        JSON.stringify(rec.welcome), JSON.stringify(rec.error_messages),
        rec.catalog ? JSON.stringify(rec.catalog) : null,
        rec.llm ? JSON.stringify(rec.llm) : null,
        rec.crm ? JSON.stringify(rec.crm) : null,
        rec.personality ? JSON.stringify(rec.personality) : null,
        rec.entity_id ?? null,
        rec.status_reason ?? null,
      ];
      await pool.query(
        `INSERT INTO bots (client_id, bot_id, name, transport, status, default_language, languages,
           system_prompt, lead_fields, welcome, error_messages, catalog, llm, crm, personality, entity_id, status_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           name=EXCLUDED.name, transport=EXCLUDED.transport,
           default_language=EXCLUDED.default_language, languages=EXCLUDED.languages,
           system_prompt=EXCLUDED.system_prompt, lead_fields=EXCLUDED.lead_fields, welcome=EXCLUDED.welcome,
           error_messages=EXCLUDED.error_messages, catalog=EXCLUDED.catalog, llm=EXCLUDED.llm, crm=EXCLUDED.crm,
           personality=EXCLUDED.personality, entity_id=EXCLUDED.entity_id, updated_at=NOW()`,
        params
      );
    },

    // Temporaire, supprimée en tâche 8 (remplacée par le service de statut de la tâche 2).
    // Un changement de statut explicite efface le motif de pause automatique.
    async setBotStatusUnchecked(clientId: string, botId: string, status: string): Promise<void> {
      await pool.query('UPDATE bots SET status = $1, status_reason = NULL, updated_at = NOW() WHERE client_id = $2 AND bot_id = $3', [status, clientId, botId]);
    },

    async deleteBotRecord(clientId: string, botId: string): Promise<void> {
      // Libère le numéro de l'agent IA : change la topologie, donc sous le verrou du choix 10. Sans lui, un
      // branchement en cours (non validé) échappe à l'UPDATE ci-dessous et laisse un numéro tenu par un agent IA
      // supprimé, ou les deux transactions s'interbloquent (bots puis numéro contre numéro puis bots).
      await withTopologyTransaction(pool, async (client) => {
        await client.query('DELETE FROM bot_numbers WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
        await client.query('DELETE FROM bot_allowlist WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
        await client.query('UPDATE whatsapp_numbers SET bot_id = NULL, updated_at = NOW() WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
        await client.query('DELETE FROM bots WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
      });
    },

    async listBotNumbers(): Promise<BotNumberRecord[]> {
      const result = await pool.query('SELECT whatsapp_number, client_id, bot_id FROM bot_numbers ORDER BY whatsapp_number');
      return result.rows as BotNumberRecord[];
    },

    async setBotNumbers(clientId: string, botId: string, numbers: string[]): Promise<void> {
      const stored = toStoredWhatsAppNumbers(numbers);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM bot_numbers WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
        for (const n of stored) {
          await client.query('INSERT INTO bot_numbers (whatsapp_number, client_id, bot_id) VALUES ($1, $2, $3)', [n, clientId, botId]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async getLlmPricing(model: string): Promise<LlmPricingRecord | undefined> {
      const r = await pool.query(
        `SELECT id, model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok,
                currency, effective_from::text, effective_to::text
         FROM llm_pricing WHERE model = $1 AND effective_to IS NULL ORDER BY id DESC LIMIT 1`, [model]
      );
      return r.rows[0] as LlmPricingRecord | undefined;
    },

    async upsertLlmPricing(rec: LlmPricingInput): Promise<void> {
      await pool.query(`UPDATE llm_pricing SET effective_to = NOW() WHERE model = $1 AND effective_to IS NULL`, [rec.model]);
      await pool.query(
        `INSERT INTO llm_pricing (model, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, currency)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [rec.model, rec.input_per_mtok, rec.output_per_mtok, rec.cache_read_per_mtok, rec.cache_write_per_mtok, rec.currency]
      );
    },

    async insertLlmUsage(rec: LlmUsageInput): Promise<void> {
      await pool.query(
        `INSERT INTO llm_usage (client_id, bot_id, phone, call_type, mode, platform_key_id, model,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [rec.client_id, rec.bot_id, rec.phone, rec.call_type, rec.mode, rec.platform_key_id, rec.model,
         rec.input_tokens, rec.output_tokens, rec.cache_read_tokens, rec.cache_creation_tokens, rec.cost_usd, rec.pricing_version, rec.anthropic_request_id]
      );
    },

    async listLlmUsage(clientId: string): Promise<LlmUsageRow[]> {
      const r = await pool.query(
        `SELECT id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, pricing_version, anthropic_request_id, created_at::text
         FROM llm_usage WHERE client_id = $1 ORDER BY id DESC`, [clientId]
      );
      return r.rows as LlmUsageRow[];
    },

    async getBotMetrics(clientId: string, botId: string): Promise<BotMetrics> {
      const q = async (sql: string) => ((await pool.query(sql, [clientId, botId])).rows[0] as { n: number }).n;
      return {
        leads_total: await q('SELECT COUNT(*)::int as n FROM leads WHERE client_id = $1 AND bot_id = $2'),
        rdv_total: await q('SELECT COUNT(*)::int as n FROM leads WHERE client_id = $1 AND bot_id = $2 AND rdv_requested = 1'),
        conversations_total: await q('SELECT COUNT(DISTINCT phone)::int as n FROM conversations WHERE client_id = $1 AND bot_id = $2'),
        messages_total: await q('SELECT COUNT(*)::int as n FROM conversations WHERE client_id = $1 AND bot_id = $2'),
      };
    },

    async listLlmUsageByBot(clientId: string, botId: string, sinceIso?: string): Promise<LlmUsageRow[]> {
      const cols = `id, client_id, bot_id, phone, call_type, mode, platform_key_id, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, pricing_version, anthropic_request_id, created_at::text as created_at`;
      if (sinceIso) {
        const res = await pool.query(
          `SELECT ${cols} FROM llm_usage WHERE client_id = $1 AND bot_id = $2 AND created_at >= $3 ORDER BY created_at DESC`,
          [clientId, botId, sinceIso]
        );
        return res.rows as LlmUsageRow[];
      }
      const res = await pool.query(
        `SELECT ${cols} FROM llm_usage WHERE client_id = $1 AND bot_id = $2 ORDER BY created_at DESC`,
        [clientId, botId]
      );
      return res.rows as LlmUsageRow[];
    },

    async createUser(input: UserInput): Promise<UserRecord> {
      const r = await pool.query(
        `INSERT INTO users (email, password_hash, role, client_id, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, password_hash, role, client_id, status, created_at::text, updated_at::text`,
        [input.email, input.password_hash, input.role, input.client_id, input.status]
      );
      return r.rows[0] as UserRecord;
    },

    async getUserByEmail(email: string): Promise<UserRecord | undefined> {
      const r = await pool.query(
        `SELECT id, email, password_hash, role, client_id, status, created_at::text, updated_at::text
         FROM users WHERE email = $1`, [email]);
      return r.rows[0] as UserRecord | undefined;
    },

    async getUserById(id: number): Promise<UserRecord | undefined> {
      const r = await pool.query(
        `SELECT id, email, password_hash, role, client_id, status, created_at::text, updated_at::text
         FROM users WHERE id = $1`, [id]);
      return r.rows[0] as UserRecord | undefined;
    },

    async updateUserPassword(id: number, passwordHash: string): Promise<void> {
      await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [passwordHash, id]);
    },

    async setUserStatus(id: number, status: string): Promise<void> {
      await pool.query(`UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
    },

    async getClient(clientId: string): Promise<ClientRecord | undefined> {
      const r = await pool.query('SELECT client_id, name, status FROM clients WHERE client_id = $1', [clientId]);
      return r.rows[0] as ClientRecord | undefined;
    },

    async createInvitation(input: InvitationInput): Promise<InvitationRecord> {
      const r = await pool.query(
        `INSERT INTO invitations (email, client_id, role, token_hash, expires_at, grants)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING ${PG_INVITATION_COLUMNS}`,
        [input.email, input.client_id, input.role, input.token_hash, input.expires_at,
         input.grants == null ? null : JSON.stringify(input.grants)]
      );
      return r.rows[0] as InvitationRecord;
    },

    async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | undefined> {
      const r = await pool.query(
        `SELECT ${PG_INVITATION_COLUMNS} FROM invitations WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] as InvitationRecord | undefined;
    },

    async markInvitationAccepted(id: number): Promise<void> {
      await pool.query(`UPDATE invitations SET accepted_at = NOW() WHERE id = $1`, [id]);
    },

    async listInvitations(clientId: string): Promise<InvitationRecord[]> {
      const r = await pool.query(
        `SELECT ${PG_INVITATION_COLUMNS} FROM invitations WHERE client_id = $1 ORDER BY id DESC`, [clientId]);
      return r.rows as InvitationRecord[];
    },

    async deleteInvitation(id: number): Promise<void> {
      await pool.query('DELETE FROM invitations WHERE id = $1', [id]);
    },

    async createAuthSession(input: AuthSessionInput): Promise<AuthSessionRecord> {
      const r = await pool.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, token_hash, ${pgIso('expires_at')}, ${pgIso('revoked_at')}, created_at::text`,
        [input.user_id, input.token_hash, input.expires_at]
      );
      return r.rows[0] as AuthSessionRecord;
    },

    async getAuthSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | undefined> {
      const r = await pool.query(
        `SELECT id, user_id, token_hash, ${pgIso('expires_at')}, ${pgIso('revoked_at')}, created_at::text
         FROM auth_sessions WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] as AuthSessionRecord | undefined;
    },

    async revokeAuthSession(id: number): Promise<void> {
      await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`, [id]);
    },

    async revokeAllUserSessions(userId: number): Promise<void> {
      await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    },

    async createPasswordReset(input: PasswordResetInput): Promise<PasswordResetRecord> {
      const r = await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, token_hash, ${pgIso('expires_at')}, ${pgIso('used_at')}, created_at::text`,
        [input.user_id, input.token_hash, input.expires_at]
      );
      return r.rows[0] as PasswordResetRecord;
    },

    async getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
      const r = await pool.query(
        `SELECT id, user_id, token_hash, ${pgIso('expires_at')}, ${pgIso('used_at')}, created_at::text
         FROM password_resets WHERE token_hash = $1`, [tokenHash]);
      return r.rows[0] as PasswordResetRecord | undefined;
    },

    async markPasswordResetUsed(id: number): Promise<void> {
      await pool.query(`UPDATE password_resets SET used_at = NOW() WHERE id = $1`, [id]);
    },

    async getConnectorMapping(clientId: string, botId: string | null, connector: string): Promise<ConnectorMappingRecord | undefined> {
      const r = await pool.query(
        `SELECT id, client_id, bot_id, connector, mapping, created_at::text, updated_at::text
         FROM connector_mappings WHERE client_id = $1 AND bot_id IS NOT DISTINCT FROM $2 AND connector = $3`,
        [clientId, botId, connector]
      );
      return r.rows[0] as ConnectorMappingRecord | undefined;
    },

    async upsertConnectorMapping(rec: ConnectorMappingInput): Promise<void> {
      const json = JSON.stringify(rec.mapping);
      const upd = await pool.query(
        `UPDATE connector_mappings SET mapping = $1::jsonb, updated_at = NOW()
         WHERE client_id = $2 AND bot_id IS NOT DISTINCT FROM $3 AND connector = $4`,
        [json, rec.client_id, rec.bot_id, rec.connector]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO connector_mappings (client_id, bot_id, connector, mapping)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [rec.client_id, rec.bot_id, rec.connector, json]
        );
      }
    },

    async listConnectorMappings(clientId: string): Promise<ConnectorMappingRecord[]> {
      const r = await pool.query(
        `SELECT id, client_id, bot_id, connector, mapping, created_at::text, updated_at::text
         FROM connector_mappings WHERE client_id = $1 ORDER BY connector, bot_id`,
        [clientId]
      );
      return r.rows as ConnectorMappingRecord[];
    },

    async insertAuditLog(rec: AuditLogInput): Promise<void> {
      await pool.query(
        `INSERT INTO audit_log (actor_user_id, action, target, client_id, metadata)
         VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NULL THEN NULL ELSE $5::jsonb END)`,
        [rec.actor_user_id, rec.action, rec.target, rec.client_id, rec.metadata ? JSON.stringify(rec.metadata) : null]
      );
    },

    async listAuditLog(clientId: string, limit = 100): Promise<AuditLogRow[]> {
      const r = await pool.query(
        `SELECT id, actor_user_id, action, target, client_id, metadata, created_at::text
         FROM audit_log WHERE client_id = $1 ORDER BY id DESC LIMIT $2`,
        [clientId, limit]
      );
      return r.rows as AuditLogRow[];
    },

    async getBotRuntimeState(clientId: string, botId: string): Promise<BotRuntimeStateRecord | undefined> {
      const r = await pool.query(
        `SELECT client_id, bot_id, ${pgIso('transport_validated_at')}, transport_error, last_crm_error, ${pgIso('last_crm_error_at')},
                unserved_count, ${pgIso('unserved_last_at')}, updated_at::text
         FROM bot_runtime_state WHERE client_id = $1 AND bot_id = $2`,
        [clientId, botId]
      );
      return r.rows[0] as BotRuntimeStateRecord | undefined;
    },

    async setTransportValidation(clientId: string, botId: string, validatedAt: string | null, error: string | null): Promise<void> {
      await pool.query(
        `INSERT INTO bot_runtime_state (client_id, bot_id, transport_validated_at, transport_error)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           transport_validated_at = EXCLUDED.transport_validated_at,
           transport_error = EXCLUDED.transport_error,
           updated_at = NOW()`,
        [clientId, botId, validatedAt, error]
      );
    },

    async setLastCrmError(clientId: string, botId: string, error: string | null): Promise<void> {
      const at = error === null ? null : new Date().toISOString();
      await pool.query(
        `INSERT INTO bot_runtime_state (client_id, bot_id, last_crm_error, last_crm_error_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           last_crm_error = EXCLUDED.last_crm_error,
           last_crm_error_at = EXCLUDED.last_crm_error_at,
           updated_at = NOW()`,
        [clientId, botId, error, at],
      );
    },

    async incrementUnserved(clientId: string, botId: string): Promise<void> {
      await pool.query(
        `INSERT INTO bot_runtime_state (client_id, bot_id, unserved_count, unserved_last_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (client_id, bot_id) DO UPDATE SET
           unserved_count = bot_runtime_state.unserved_count + 1,
           unserved_last_at = NOW(),
           updated_at = NOW()`,
        [clientId, botId]
      );
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };

  return driver;
}
