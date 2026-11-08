// Module « comptes WhatsApp » du driver SQLite : schéma et méthodes WhatsAppStore.
// Les dates sont écrites et lues en ISO 8601 UTC (comme le pilote Postgres, via pgIso).

import type BetterSqlite3 from 'better-sqlite3';
import { decideAssign, decideTransition, isServingStatus, toBotStatus, type AssignDecision } from '../bot-status.js';
import { encryptJson } from '../credentials/crypto.js';
import { planInventory, type InventoryHolder } from '../../whatsapp/inventory-plan.js';
import type {
  ActivateResult, BotStatus, DisconnectResult, InventoryResult, NewWhatsAppAccount, ProviderNumber, TopologyOptions,
  TransitionResult, WhatsAppAccountAlert, WhatsAppAccountErrorReason, WhatsAppAccountRecord, WhatsAppAccountSecrets,
  WhatsAppAccountState, WhatsAppNumberRecord, WhatsAppStore,
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

/** Lancé dans une transaction pour l'annuler en renvoyant un refus (better-sqlite3 annule sur exception). */
class Rollback<T> {
  constructor(readonly result: T) {}
}

export function createSqliteWhatsAppStore(db: SqliteDb): WhatsAppStore {
  const readAccount = (id: number): WhatsAppAccountRecord | undefined => {
    const row = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE id = ?`).get(id) as AccountRow | undefined;
    return row ? rowToAccount(row) : undefined;
  };

  const insertAccount = (a: NewWhatsAppAccount): number => {
    const info = db.prepare(
      `INSERT INTO whatsapp_accounts
         (client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
          webhook_key_hash, state, token_expiry, last_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?)`
    ).run(a.client_id, a.name, a.mode, a.provider_account_id, a.waba_id, a.meta_app_id, a.secret_encrypted,
          a.key_version, a.webhook_key_hash, a.token_expiry, a.last_verified_at);
    return Number(info.lastInsertRowid);
  };

  const writeAllowlist = (clientId: string, botId: string, entries: string[]): void => {
    db.prepare('DELETE FROM bot_allowlist WHERE client_id = ? AND bot_id = ?').run(clientId, botId);
    const ins = db.prepare('INSERT INTO bot_allowlist (client_id, bot_id, entry) VALUES (?, ?, ?)');
    for (const entry of new Set(entries)) ins.run(clientId, botId, entry);
  };

  // Topologie des numéros. Les fonctions ci-dessous sont synchrones et ne s'appellent que dans
  // db.transaction : better-sqlite3 n'a qu'une connexion, rien ne s'intercale entre la lecture et l'écriture.

  const readBot = (clientId: string, botId: string): { bot_id: string; status: BotStatus } | null => {
    const row = db.prepare('SELECT bot_id, status FROM bots WHERE client_id = ? AND bot_id = ?')
      .get(clientId, botId) as { bot_id: string; status: string } | undefined;
    return row ? { bot_id: row.bot_id, status: toBotStatus(row.status) } : null;
  };

  /** État du compte vu par la machine d'états : `isAccountBlocked` le fait compter comme non connecté (choix 4). */
  const accountStateFor = (accountId: number, opts?: TopologyOptions): WhatsAppAccountState => {
    const row = db.prepare('SELECT state FROM whatsapp_accounts WHERE id = ?').get(accountId) as { state: WhatsAppAccountState } | undefined;
    const state = row?.state ?? 'disconnected';
    return state === 'connected' && opts?.isAccountBlocked?.(accountId) ? 'error' : state;
  };

  const allowlistCount = (clientId: string, botId: string): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM bot_allowlist WHERE client_id = ? AND bot_id = ?').get(clientId, botId) as { n: number }).n;

  const numberOfBot = (clientId: string, botId: string): WhatsAppNumberRecord | undefined => {
    const row = db.prepare(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND bot_id = ?`)
      .get(clientId, botId) as NumberRow | undefined;
    return row ? rowToNumber(row) : undefined;
  };

  /** Sessions d'un numéro vivant (choix 7). Jamais appelé sur un numéro retiré : il peut être tenu ailleurs. */
  const deleteNumberSessions = (phoneE164: string): void => {
    db.prepare('DELETE FROM sessions WHERE wa_number = ?').run(phoneE164);
  };

  const writeBotStatus = (clientId: string, botId: string, status: BotStatus, reason: string | null): void => {
    db.prepare(`UPDATE bots SET status = ?, status_reason = ?, updated_at = datetime('now') WHERE client_id = ? AND bot_id = ?`)
      .run(status, reason, clientId, botId);
  };

  /**
   * Retire un numéro vivant (reprise par un autre compte ou retrait chez le fournisseur) : la ligne garde son
   * agent IA, ses sessions sont supprimées, son agent IA `limited` ou `active` passe en pause avec motif,
   * audité dans sa propre organisation, sans rien sur le nouveau détenteur.
   */
  const removeLiveNumber = (row: WhatsAppNumberRecord, paused: InventoryResult['paused_bots']): void => {
    db.prepare(
      `UPDATE whatsapp_numbers
         SET provider_state = 'removed', active_e164 = NULL, active_provider_id = NULL,
             removed_at = ${NOW_ISO}, updated_at = ${NOW_ISO}
       WHERE id = ?`
    ).run(row.id);
    deleteNumberSessions(row.phone_e164);
    if (row.bot_id === null) return;
    const holderBot = readBot(row.client_id, row.bot_id);
    if (!holderBot || !isServingStatus(holderBot.status)) return;
    writeBotStatus(row.client_id, row.bot_id, 'paused', 'number_removed');
    db.prepare(
      `INSERT INTO audit_log (actor_user_id, action, target, client_id, metadata) VALUES (NULL, 'bot.status.auto', ?, ?, ?)`
    ).run(`bot:${row.client_id}/${row.bot_id}`, row.client_id, JSON.stringify({ to: 'paused', reason: 'number_removed' }));
    paused.push({ client_id: row.client_id, bot_id: row.bot_id });
  };

  const inventory = (clientId: string, accountId: number, found: ProviderNumber[]): InventoryResult => {
    const acc = db.prepare('SELECT state FROM whatsapp_accounts WHERE client_id = ? AND id = ?')
      .get(clientId, accountId) as { state: WhatsAppAccountState } | undefined;
    if (!acc) throw new Error('[WhatsAppStore] Compte WhatsApp introuvable');
    if (acc.state === 'disconnected') throw new Error('[WhatsAppStore] Compte WhatsApp déconnecté');

    const own = (db.prepare(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND account_id = ? ORDER BY id`)
      .all(clientId, accountId) as NumberRow[]).map(rowToNumber);
    let holders: InventoryHolder[] = [];
    if (found.length > 0) {
      const phones = found.map((f) => f.phone_e164);
      const providerIds = found.map((f) => f.provider_number_id);
      const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');
      const rows = db.prepare(
        `SELECT ${NUMBER_COLUMNS},
                COALESCE((SELECT a.state FROM whatsapp_accounts a WHERE a.id = n.account_id), 'disconnected') AS holder_account_state
         FROM whatsapp_numbers n
         WHERE provider_state = 'present' AND account_id <> ?
           AND (active_e164 IN (${marks(phones.length)}) OR active_provider_id IN (${marks(providerIds.length)}))
         ORDER BY id`
      ).all(accountId, ...phones, ...providerIds) as Array<NumberRow & { holder_account_state: WhatsAppAccountState }>;
      holders = rows.map((r) => ({ ...rowToNumber(r), holder_account_state: r.holder_account_state }));
    }

    const plan = planInventory({ accountId, own, holders, found });
    const paused: InventoryResult['paused_bots'] = [];
    const byId = new Map<number, WhatsAppNumberRecord>([...own, ...holders].map((r) => [r.id, r]));
    for (const id of [...plan.removals, ...plan.takeovers]) removeLiveNumber(byId.get(id)!, paused);
    const update = db.prepare(
      `UPDATE whatsapp_numbers
         SET phone_e164 = ?, provider_number_id = ?, cm_channel_id = ?, display_name = ?, meta_status = ?, quality = ?,
             is_test = ?, provider_state = 'present', active_e164 = ?, active_provider_id = ?, removed_at = NULL,
             updated_at = ${NOW_ISO}
       WHERE id = ?`
    );
    for (const u of plan.updates) {
      const v = u.values;
      // Même identifiant fournisseur, autre E.164 : les sessions de l'ancien numéro vivant disparaissent (choix 7).
      const before = byId.get(u.id)!;
      if (before.provider_state === 'present' && before.phone_e164 !== v.phone_e164) deleteNumberSessions(before.phone_e164);
      update.run(v.phone_e164, v.provider_number_id, v.cm_channel_id, v.display_name, v.meta_status, v.quality,
        v.is_test ? 1 : 0, v.phone_e164, v.provider_number_id, u.id);
    }
    const insert = db.prepare(
      `INSERT INTO whatsapp_numbers
         (account_id, client_id, phone_e164, provider_number_id, cm_channel_id, display_name, meta_status, quality, is_test,
          provider_state, active_e164, active_provider_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?, ?)`
    );
    for (const v of plan.inserts) {
      insert.run(accountId, clientId, v.phone_e164, v.provider_number_id, v.cm_channel_id, v.display_name, v.meta_status,
        v.quality, v.is_test ? 1 : 0, v.phone_e164, v.provider_number_id);
    }
    return {
      added: plan.inserts.length, updated: plan.updates.length, removed: plan.removals.length, refused: plan.refused,
      took_over: plan.takeovers.length, paused_bots: paused,
    };
  };

  const assign = (clientId: string, botId: string, numberId: number, opts: TopologyOptions | undefined, checkServingStatus: boolean): AssignDecision => {
    const bot = readBot(clientId, botId);
    const row = db.prepare(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND id = ?`)
      .get(clientId, numberId) as NumberRow | undefined;
    const target = row ? rowToNumber(row) : undefined;
    const current = numberOfBot(clientId, botId);
    const decision = decideAssign({
      bot,
      number: target ? {
        id: target.id, present: target.provider_state === 'present', is_test: target.is_test, bot_id: target.bot_id,
        account_state: accountStateFor(target.account_id, opts),
      } : null,
      currentNumberId: current?.id ?? null,
      allowlistCount: allowlistCount(clientId, botId),
      checkServingStatus,
    });
    if (!decision.ok || !decision.changed || !target) return decision;

    const setBot = db.prepare(`UPDATE whatsapp_numbers SET bot_id = ?, updated_at = ${NOW_ISO} WHERE id = ?`);
    if (current) {
      setBot.run(null, current.id);
      if (current.provider_state === 'present') deleteNumberSessions(current.phone_e164);
    }
    if (target.bot_id !== null) {
      const previous = readBot(clientId, target.bot_id);
      if (previous && isServingStatus(previous.status)) writeBotStatus(clientId, target.bot_id, 'draft', null);
    }
    setBot.run(botId, target.id);
    deleteNumberSessions(target.phone_e164);
    return decision;
  };

  const transition = (clientId: string, botId: string, to: BotStatus, opts: TopologyOptions | undefined): TransitionResult => {
    const bot = readBot(clientId, botId);
    if (!bot) return { ok: false, reason: 'not_found' };
    const current = numberOfBot(clientId, botId);
    const decision = decideTransition(to, {
      from: bot.status,
      number: current ? {
        present: current.provider_state === 'present', is_test: current.is_test,
        account_state: accountStateFor(current.account_id, opts),
      } : null,
      allowlistCount: allowlistCount(clientId, botId),
    });
    if (!decision.ok) return decision;
    writeBotStatus(clientId, botId, to, null);
    return { ok: true, from: bot.status, to };
  };

  return {
    async insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord> {
      return readAccount(insertAccount(a))!;
    },

    async createWhatsAppAccountWithInventory(a: NewWhatsAppAccount, found: ProviderNumber[]): Promise<{ account: WhatsAppAccountRecord; inventory: InventoryResult }> {
      return db.transaction(() => {
        const id = insertAccount(a);
        const result = inventory(a.client_id, id, found);
        return { account: readAccount(id)!, inventory: result };
      })();
    },

    async applyInventory(clientId: string, accountId: number, found: ProviderNumber[]): Promise<InventoryResult> {
      return db.transaction(() => inventory(clientId, accountId, found))();
    },

    async assignNumber(clientId: string, botId: string, numberId: number, opts?: TopologyOptions) {
      return db.transaction(() => assign(clientId, botId, numberId, opts, true))();
    },

    async unassignNumber(clientId: string, botId: string): Promise<boolean> {
      return db.transaction(() => {
        const bot = readBot(clientId, botId);
        const current = bot ? numberOfBot(clientId, botId) : undefined;
        if (!bot || !current) return false;
        db.prepare(`UPDATE whatsapp_numbers SET bot_id = NULL, updated_at = ${NOW_ISO} WHERE id = ?`).run(current.id);
        if (current.provider_state === 'present') deleteNumberSessions(current.phone_e164);
        if (isServingStatus(bot.status)) writeBotStatus(clientId, botId, 'draft', null);
        return true;
      })();
    },

    async transitionBotStatus(clientId: string, botId: string, to: BotStatus, opts?: TopologyOptions): Promise<TransitionResult> {
      return db.transaction(() => transition(clientId, botId, to, opts))();
    },

    async activateWithNumber(
      clientId: string, botId: string, numberId: number, to: 'limited' | 'active', allowlist: string[] | null, opts?: TopologyOptions,
    ): Promise<ActivateResult> {
      try {
        return db.transaction((): ActivateResult => {
          const assigned = assign(clientId, botId, numberId, opts, false);
          if (!assigned.ok) return { ok: false, reason: assigned.reason, assign: assigned };
          if (allowlist !== null) writeAllowlist(clientId, botId, allowlist);
          const result = transition(clientId, botId, to, opts);
          if (!result.ok) throw new Rollback<ActivateResult>(result);
          return { ...result, assign: assigned };
        })();
      } catch (e) {
        if (e instanceof Rollback) return e.result as ActivateResult;
        throw e;
      }
    },

    async disconnectWhatsAppAccount(clientId: string, id: number): Promise<DisconnectResult> {
      const emptySecret = encryptJson({});
      return db.transaction((): DisconnectResult => {
        const acc = db.prepare('SELECT id FROM whatsapp_accounts WHERE client_id = ? AND id = ?').get(clientId, id);
        if (!acc) return { ok: false, reason: 'not_found' };
        const present = (db.prepare(
          `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = ? AND account_id = ? AND provider_state = 'present' ORDER BY id`
        ).all(clientId, id) as NumberRow[]).map(rowToNumber);
        const inUse = present
          .filter((n) => n.bot_id !== null && isServingStatus(readBot(clientId, n.bot_id)?.status ?? 'draft'))
          .map((n) => n.bot_id as string)
          .sort();
        if (inUse.length > 0) return { ok: false, reason: 'number_in_use', bot_ids: inUse };
        for (const n of present) deleteNumberSessions(n.phone_e164);
        db.prepare('DELETE FROM whatsapp_numbers WHERE client_id = ? AND account_id = ?').run(clientId, id);
        db.prepare(
          `UPDATE whatsapp_accounts
             SET state = 'disconnected', webhook_key_hash = NULL, secret_encrypted = ?, key_version = ?,
                 error_reason = NULL, error_detail = NULL, updated_at = ${NOW_ISO}
           WHERE id = ?`
        ).run(emptySecret.secret, emptySecret.keyVersion, id);
        return { ok: true };
      })();
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
      db.transaction(() => writeAllowlist(clientId, botId, entries))();
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
