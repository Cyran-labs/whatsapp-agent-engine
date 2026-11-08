// Module « comptes WhatsApp » du driver PostgreSQL : schéma et méthodes WhatsAppStore.
// Symétrique de whatsapp-sqlite.ts : dates en TIMESTAMPTZ lues en ISO UTC (pgIso), alertes en JSONB.

import type pg from 'pg';
import { pgIso } from './accounts-postgres.js';
import type {
  NewWhatsAppAccount, WhatsAppAccountAlert, WhatsAppAccountErrorReason, WhatsAppAccountRecord,
  WhatsAppAccountSecrets, WhatsAppNumberRecord, WhatsAppStore,
} from './whatsapp-types.js';

const MAX_ALERTS = 20;

const WHATSAPP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS whatsapp_accounts (
    id SERIAL PRIMARY KEY,
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
    last_verified_at TIMESTAMPTZ,
    token_expiry TEXT,
    last_signature_ok_at TIMESTAMPTZ,
    alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_accounts_webhook_key ON whatsapp_accounts(webhook_key_hash);
  CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_client ON whatsapp_accounts(client_id);

  CREATE TABLE IF NOT EXISTS whatsapp_numbers (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    phone_e164 TEXT NOT NULL,
    provider_number_id TEXT NOT NULL,
    cm_channel_id TEXT,
    display_name TEXT NOT NULL DEFAULT '',
    meta_status TEXT,
    quality TEXT,
    is_test BOOLEAN NOT NULL DEFAULT FALSE,
    bot_id TEXT,
    provider_state TEXT NOT NULL DEFAULT 'present' CHECK (provider_state IN ('present', 'removed')),
    removed_at TIMESTAMPTZ,
    delivery_failures INTEGER NOT NULL DEFAULT 0,
    last_delivery_error_code INTEGER,
    last_delivery_error_at TIMESTAMPTZ,
    active_e164 TEXT UNIQUE,
    active_provider_id TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((provider_state = 'present') = (active_e164 IS NOT NULL AND active_provider_id IS NOT NULL))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_whatsapp_numbers_bot ON whatsapp_numbers(client_id, bot_id);
  CREATE INDEX IF NOT EXISTS idx_whatsapp_numbers_account ON whatsapp_numbers(account_id);

  CREATE TABLE IF NOT EXISTS bot_allowlist (
    client_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    entry TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, bot_id, entry)
  );
`;

/** Crée les tables du module comptes WhatsApp et la colonne `bots.status_reason` (idempotent). */
export async function ensurePostgresWhatsAppSchema(pool: pg.Pool): Promise<void> {
  await pool.query(WHATSAPP_SCHEMA);
  await pool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS status_reason TEXT');
}

const ACCOUNT_COLUMNS =
  `id, client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
   webhook_key_hash, state, error_reason, error_detail, ${pgIso('last_verified_at')}, token_expiry,
   ${pgIso('last_signature_ok_at')}, alerts, ${pgIso('created_at')}, ${pgIso('updated_at')}`;

const NUMBER_COLUMNS =
  `id, account_id, client_id, phone_e164, provider_number_id, cm_channel_id, display_name, meta_status, quality,
   is_test, bot_id, provider_state, ${pgIso('removed_at')}, delivery_failures, last_delivery_error_code,
   ${pgIso('last_delivery_error_at')}, ${pgIso('created_at')}, ${pgIso('updated_at')}`;

export function createPostgresWhatsAppStore(pool: pg.Pool): WhatsAppStore {
  const one = async <T>(sql: string, params: unknown[]): Promise<T | undefined> => {
    const r = await pool.query(sql, params);
    return r.rows[0] as T | undefined;
  };

  return {
    async insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord> {
      const r = await pool.query(
        `INSERT INTO whatsapp_accounts
           (client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
            webhook_key_hash, state, token_expiry, last_verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'connected', $10, $11)
         RETURNING ${ACCOUNT_COLUMNS}`,
        [a.client_id, a.name, a.mode, a.provider_account_id, a.waba_id, a.meta_app_id, a.secret_encrypted,
         a.key_version, a.webhook_key_hash, a.token_expiry, a.last_verified_at]
      );
      return r.rows[0] as WhatsAppAccountRecord;
    },

    getWhatsAppAccount(clientId: string, id: number): Promise<WhatsAppAccountRecord | undefined> {
      return one<WhatsAppAccountRecord>(
        `SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE client_id = $1 AND id = $2`, [clientId, id]
      );
    },

    async listWhatsAppAccounts(clientId: string): Promise<WhatsAppAccountRecord[]> {
      const r = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE client_id = $1 ORDER BY id`, [clientId]);
      return r.rows as WhatsAppAccountRecord[];
    },

    findWhatsAppAccountByWebhookKeyHash(hash: string): Promise<WhatsAppAccountRecord | undefined> {
      return one<WhatsAppAccountRecord>(
        `SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE webhook_key_hash = $1 AND state <> 'disconnected'`, [hash]
      );
    },

    async renameWhatsAppAccount(clientId: string, id: number, name: string): Promise<boolean> {
      const r = await pool.query(
        'UPDATE whatsapp_accounts SET name = $1, updated_at = NOW() WHERE client_id = $2 AND id = $3',
        [name, clientId, id]
      );
      return (r.rowCount ?? 0) > 0;
    },

    async replaceWhatsAppAccountSecrets(clientId: string, id: number, s: WhatsAppAccountSecrets): Promise<boolean> {
      const r = await pool.query(
        `UPDATE whatsapp_accounts
           SET secret_encrypted = $1, key_version = $2, meta_app_id = $3, token_expiry = $4, last_verified_at = $5,
               state = 'connected', error_reason = NULL, error_detail = NULL, updated_at = NOW()
         WHERE client_id = $6 AND id = $7`,
        [s.secret_encrypted, s.key_version, s.meta_app_id, s.token_expiry, s.verified_at, clientId, id]
      );
      return (r.rowCount ?? 0) > 0;
    },

    async markWhatsAppAccountVerified(id: number, v: { token_expiry: string | null; verified_at: string }): Promise<void> {
      await pool.query(
        `UPDATE whatsapp_accounts
           SET token_expiry = $1, last_verified_at = $2, state = 'connected', error_reason = NULL, error_detail = NULL,
               updated_at = NOW()
         WHERE id = $3`,
        [v.token_expiry, v.verified_at, id]
      );
    },

    async setWhatsAppAccountError(id: number, reason: WhatsAppAccountErrorReason, detail: string): Promise<void> {
      await pool.query(
        `UPDATE whatsapp_accounts SET state = 'error', error_reason = $1, error_detail = $2, updated_at = NOW() WHERE id = $3`,
        [reason, detail, id]
      );
    },

    async touchSignatureOk(id: number, at: string): Promise<void> {
      await pool.query('UPDATE whatsapp_accounts SET last_signature_ok_at = $1, updated_at = NOW() WHERE id = $2', [at, id]);
    },

    async addWhatsAppAccountAlert(id: number, alert: WhatsAppAccountAlert): Promise<void> {
      // Une seule requête : le verrou de ligne sérialise deux ajouts concurrents. On garde les plus récentes,
      // dans l'ordre chronologique.
      await pool.query(
        `UPDATE whatsapp_accounts SET
           alerts = (
             SELECT COALESCE(jsonb_agg(x.e ORDER BY x.ord), '[]'::jsonb)
             FROM (
               SELECT t.e, t.ord
               FROM jsonb_array_elements(whatsapp_accounts.alerts || jsonb_build_array($2::jsonb))
                    WITH ORDINALITY AS t(e, ord)
               ORDER BY t.ord DESC
               LIMIT $3
             ) x
           ),
           updated_at = NOW()
         WHERE id = $1`,
        [id, JSON.stringify(alert), MAX_ALERTS]
      );
    },

    async listWhatsAppNumbers(clientId: string, accountId?: number): Promise<WhatsAppNumberRecord[]> {
      const r = accountId === undefined
        ? await pool.query(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 ORDER BY id`, [clientId])
        : await pool.query(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 AND account_id = $2 ORDER BY id`, [clientId, accountId]);
      return r.rows as WhatsAppNumberRecord[];
    },

    getWhatsAppNumber(clientId: string, numberId: number): Promise<WhatsAppNumberRecord | undefined> {
      return one<WhatsAppNumberRecord>(
        `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 AND id = $2`, [clientId, numberId]
      );
    },

    getWhatsAppNumberForBot(clientId: string, botId: string): Promise<WhatsAppNumberRecord | undefined> {
      return one<WhatsAppNumberRecord>(
        `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 AND bot_id = $2`, [clientId, botId]
      );
    },

    findPresentNumber(accountId: number, key: { providerNumberId: string } | { phoneE164: string }): Promise<WhatsAppNumberRecord | undefined> {
      return 'providerNumberId' in key
        ? one<WhatsAppNumberRecord>(
            `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers
             WHERE account_id = $1 AND provider_state = 'present' AND provider_number_id = $2`,
            [accountId, key.providerNumberId]
          )
        : one<WhatsAppNumberRecord>(
            `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers
             WHERE account_id = $1 AND provider_state = 'present' AND phone_e164 = $2`,
            [accountId, key.phoneE164]
          );
    },

    async recordDeliveryFailure(numberId: number, code: number | null, at: string): Promise<void> {
      await pool.query(
        `UPDATE whatsapp_numbers
           SET delivery_failures = delivery_failures + 1, last_delivery_error_code = $1, last_delivery_error_at = $2,
               updated_at = NOW()
         WHERE id = $3`,
        [code, at, numberId]
      );
    },

    async getAllowlist(clientId: string, botId: string): Promise<string[]> {
      const r = await pool.query(
        'SELECT entry FROM bot_allowlist WHERE client_id = $1 AND bot_id = $2 ORDER BY entry',
        [clientId, botId]
      );
      return (r.rows as { entry: string }[]).map((row) => row.entry);
    },

    async replaceAllowlist(clientId: string, botId: string, entries: string[]): Promise<void> {
      const unique = [...new Set(entries)];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Verrou transactionnel par (organisation, agent IA) : deux remplacements concurrents se suivent.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text || ':allowlist:' || $2::text))`, [clientId, botId]);
        await client.query('DELETE FROM bot_allowlist WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
        for (const entry of unique) {
          await client.query('INSERT INTO bot_allowlist (client_id, bot_id, entry) VALUES ($1, $2, $3)', [clientId, botId, entry]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async resetContactConversation(waNumber: string, contactId: string, clientId: string, botId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          'DELETE FROM sessions WHERE wa_number = $1 AND phone = $2 AND client_id = $3 AND bot_id = $4',
          [waNumber, contactId, clientId, botId]
        );
        await client.query(
          'DELETE FROM conversations WHERE phone = $1 AND client_id = $2 AND bot_id = $3',
          [contactId, clientId, botId]
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
