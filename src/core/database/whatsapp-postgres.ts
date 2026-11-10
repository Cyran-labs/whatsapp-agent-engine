// Module « comptes WhatsApp » du driver PostgreSQL : schéma et méthodes WhatsAppStore.
// Symétrique de whatsapp-sqlite.ts : dates en TIMESTAMPTZ lues en ISO UTC (pgIso), alertes en JSONB.

import type pg from 'pg';
import {
  decideActivation, decideAssign, decideTransition, isServingStatus, toBotStatus,
  type AssignDecision, type BotPauseReason, type TransitionDecision, type TransitionFacts,
} from '@wabagent/contracts';
import { encryptJson } from '../credentials/crypto.js';
import { planInventory, type InventoryHolder } from '../../whatsapp/inventory-plan.js';
import { pgIso } from './accounts-postgres.js';
import type {
  AccountWriteResult, ActivateResult, AllowlistResult, BotStatus, CreateAccountResult, DisconnectResult, InventoryResult, NewWhatsAppAccount,
  AssignOptions, InventoryOptions, ProviderAccountHolder, ProviderNumber, TopologyOptions, TransitionResult, UnassignResult, WhatsAppAccountAlert, WhatsAppAccountErrorReason,
  WhatsAppAccountMode, WhatsAppAccountRecord, WhatsAppAccountSecrets, WhatsAppAccountState, WhatsAppNumberRecord, WhatsAppStore,
} from './whatsapp-types.js';

const MAX_ALERTS = 20;
const EMPTY_INVENTORY: InventoryResult = { added: 0, updated: 0, removed: 0, refused: 0, took_over: 0, paused_bots: [] };

/** Verrou consultatif commun à toutes les opérations qui changent la topologie des numéros (choix 10). */
const TOPOLOGY_LOCK = `SELECT pg_advisory_xact_lock(hashtext('wab:whatsapp-topology'))`;

/** Lancé dans une transaction pour l'annuler en renvoyant un refus. */
class Rollback<T> {
  constructor(readonly result: T) {}
}

/**
 * Transaction de topologie : BEGIN, verrou consultatif commun (choix 10), `fn`, COMMIT. Une exception annule
 * tout et remonte telle quelle ; un `Rollback` annule tout et renvoie son résultat. Si le ROLLBACK échoue,
 * l'erreur d'origine est gardée et la connexion est détruite (`release(err)`) au lieu de revenir au pool.
 * Utilisée aussi par `deleteBotRecord` (postgres.ts), qui libère le numéro de l'agent IA supprimé.
 */
export async function withTopologyTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  let broken: Error | undefined;
  try {
    await c.query('BEGIN');
    await c.query(TOPOLOGY_LOCK);
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      console.error('[WhatsAppStore] ROLLBACK impossible, connexion détruite');
    }
    // Connexion cassée : le serveur annule la transaction ouverte, le refus reste exact.
    if (e instanceof Rollback) return e.result as T;
    throw e;
  } finally {
    c.release(broken);
  }
}

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
    error_provider_text TEXT,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, bot_id, entry)
  );
`;

/** Crée les tables du module comptes WhatsApp et la colonne `bots.status_reason` (idempotent). */
export async function ensurePostgresWhatsAppSchema(pool: pg.Pool): Promise<void> {
  await pool.query(WHATSAPP_SCHEMA);
  await pool.query('ALTER TABLE bots ADD COLUMN IF NOT EXISTS status_reason TEXT');
  // Ajout sans perte de données pour une base créée avant le texte brut du fournisseur.
  await pool.query('ALTER TABLE whatsapp_accounts ADD COLUMN IF NOT EXISTS error_provider_text TEXT');
}

const ACCOUNT_COLUMNS =
  `id, client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
   webhook_key_hash, state, error_reason, error_detail, error_provider_text, ${pgIso('last_verified_at')}, token_expiry,
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

  type Q = pg.PoolClient | pg.Pool;

  const insertAccount = async (q: Q, a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord> => {
    const r = await q.query(
      `INSERT INTO whatsapp_accounts
         (client_id, name, mode, provider_account_id, waba_id, meta_app_id, secret_encrypted, key_version,
          webhook_key_hash, state, token_expiry, last_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'connected', $10, $11)
       RETURNING ${ACCOUNT_COLUMNS}`,
      [a.client_id, a.name, a.mode, a.provider_account_id, a.waba_id, a.meta_app_id, a.secret_encrypted,
       a.key_version, a.webhook_key_hash, a.token_expiry, a.last_verified_at]
    );
    return r.rows[0] as WhatsAppAccountRecord;
  };

  const writeAllowlist = async (c: pg.PoolClient, clientId: string, botId: string, entries: string[]): Promise<void> => {
    // Verrou de la liste par (organisation, agent IA), pris après celui de topologie par tous les appelants.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1::text || ':allowlist:' || $2::text))`, [clientId, botId]);
    await c.query('DELETE FROM bot_allowlist WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
    for (const entry of new Set(entries)) {
      await c.query('INSERT INTO bot_allowlist (client_id, bot_id, entry) VALUES ($1, $2, $3)', [clientId, botId, entry]);
    }
  };

  const withTopology = <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> => withTopologyTransaction(pool, fn);

  const metaAppHeldElsewhere = async (q: Q, clientId: string, metaAppId: string): Promise<boolean> => {
    const r = await q.query(
      `SELECT 1 AS hit FROM whatsapp_accounts WHERE meta_app_id = $1 AND client_id <> $2 AND state <> 'disconnected' LIMIT 1`,
      [metaAppId, clientId]
    );
    return r.rows.length > 0;
  };

  /** Revue 2b-2 I-1 : même comparaison que `sameProviderAccount` du service (casse ignorée). */
  const providerAccountHolder = async (
    q: Q, clientId: string, mode: WhatsAppAccountMode, providerAccountId: string,
  ): Promise<ProviderAccountHolder> => {
    const r = await q.query(
      `SELECT DISTINCT client_id FROM whatsapp_accounts
       WHERE mode = $1 AND LOWER(provider_account_id) = LOWER($2) AND state <> 'disconnected'`,
      [mode, providerAccountId]
    );
    const holders = (r.rows as Array<{ client_id: string }>).map((row) => row.client_id);
    if (holders.includes(clientId)) return 'same_organization';
    return holders.length > 0 ? 'other_organization' : 'none';
  };

  // Topologie des numéros : chaque lecture verrouille ses lignes (FOR UPDATE) dans la transaction.

  const readBot = async (c: pg.PoolClient, clientId: string, botId: string): Promise<{ bot_id: string; status: BotStatus } | null> => {
    const r = await c.query('SELECT bot_id, status FROM bots WHERE client_id = $1 AND bot_id = $2 FOR UPDATE', [clientId, botId]);
    const row = r.rows[0] as { bot_id: string; status: string } | undefined;
    return row ? { bot_id: row.bot_id, status: toBotStatus(row.status) } : null;
  };

  /** État du compte vu par la machine d'états : `isAccountBlocked` le fait compter comme non connecté (choix 4). */
  const accountStateFor = async (c: pg.PoolClient, accountId: number, opts?: TopologyOptions): Promise<WhatsAppAccountState> => {
    const r = await c.query('SELECT state FROM whatsapp_accounts WHERE id = $1 FOR UPDATE', [accountId]);
    const state = (r.rows[0] as { state: WhatsAppAccountState } | undefined)?.state ?? 'disconnected';
    return state === 'connected' && opts?.isAccountBlocked?.(accountId) ? 'error' : state;
  };

  const allowlistCount = async (c: pg.PoolClient, clientId: string, botId: string): Promise<number> => {
    // Verrou de la liste (celui de writeAllowlist) : la liste comptée ne change pas avant la fin de la transaction.
    // Ordre toujours identique (topologie puis liste), replaceAllowlist compris : aucun interblocage.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1::text || ':allowlist:' || $2::text))`, [clientId, botId]);
    const r = await c.query('SELECT COUNT(*)::int AS n FROM bot_allowlist WHERE client_id = $1 AND bot_id = $2', [clientId, botId]);
    return (r.rows[0] as { n: number }).n;
  };

  const numberOfBot = async (c: pg.PoolClient, clientId: string, botId: string): Promise<WhatsAppNumberRecord | undefined> => {
    const r = await c.query(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 AND bot_id = $2 FOR UPDATE`, [clientId, botId]);
    return r.rows[0] as WhatsAppNumberRecord | undefined;
  };

  /** Sessions d'un numéro vivant (choix 7). Jamais appelé sur un numéro retiré : il peut être tenu ailleurs. */
  const deleteNumberSessions = async (c: pg.PoolClient, phoneE164: string): Promise<void> => {
    await c.query('DELETE FROM sessions WHERE wa_number = $1', [phoneE164]);
  };

  const writeBotStatus = async (c: pg.PoolClient, clientId: string, botId: string, status: BotStatus, reason: string | null): Promise<void> => {
    await c.query(
      'UPDATE bots SET status = $1, status_reason = $2, updated_at = NOW() WHERE client_id = $3 AND bot_id = $4',
      [status, reason, clientId, botId]
    );
  };

  /**
   * Pause automatique (motifs `BOT_PAUSE_REASONS` des contrats) : un agent IA `limited` ou `active` passe en pause avec
   * son motif, audité dans sa propre organisation (acteur null) ; un agent IA en brouillon ou désactivé garde son statut
   * et son motif. Renvoie vrai si l'agent IA a été mis en pause.
   */
  const pauseServingBot = async (c: pg.PoolClient, clientId: string, botId: string, reason: BotPauseReason): Promise<boolean> => {
    const holderBot = await readBot(c, clientId, botId);
    if (!holderBot || !isServingStatus(holderBot.status)) return false;
    await writeBotStatus(c, clientId, botId, 'paused', reason);
    await c.query(
      `INSERT INTO audit_log (actor_user_id, action, target, client_id, metadata) VALUES (NULL, 'bot.status.auto', $1, $2, $3::jsonb)`,
      [`bot:${clientId}/${botId}`, clientId, JSON.stringify({ to: 'paused', reason })]
    );
    return true;
  };

  /**
   * Retire un numéro vivant (reprise par un autre compte ou retrait chez le fournisseur) : la ligne garde son
   * agent IA, ses sessions sont supprimées, son agent IA `limited` ou `active` passe en pause avec motif,
   * audité dans sa propre organisation, sans rien sur le nouveau détenteur.
   */
  const removeLiveNumber = async (c: pg.PoolClient, row: WhatsAppNumberRecord, paused: InventoryResult['paused_bots']): Promise<void> => {
    await c.query(
      `UPDATE whatsapp_numbers
         SET provider_state = 'removed', active_e164 = NULL, active_provider_id = NULL, removed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );
    await deleteNumberSessions(c, row.phone_e164);
    if (row.bot_id === null) return;
    if (await pauseServingBot(c, row.client_id, row.bot_id, 'number_removed')) paused.push({ client_id: row.client_id, bot_id: row.bot_id });
  };

  const inventory = async (
    c: pg.PoolClient, clientId: string, accountId: number, found: ProviderNumber[], opts: InventoryOptions | undefined,
  ): Promise<InventoryResult> => {
    const accR = await c.query('SELECT state FROM whatsapp_accounts WHERE client_id = $1 AND id = $2 FOR UPDATE', [clientId, accountId]);
    const acc = accR.rows[0] as { state: WhatsAppAccountState } | undefined;
    if (!acc) throw new Error('[WhatsAppStore] Compte WhatsApp introuvable');
    if (acc.state === 'disconnected') throw new Error('[WhatsAppStore] Compte WhatsApp déconnecté');

    const ownR = await c.query(
      `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 AND account_id = $2 ORDER BY id FOR UPDATE`,
      [clientId, accountId]
    );
    const own = ownR.rows as WhatsAppNumberRecord[];
    // Revue 2b-2 M-3 : une liste vide (réponse transitoire du fournisseur) ne retire jamais les numéros présents
    // du compte ni ne met en pause ses agents IA ; rien n'est écrit.
    if (found.length === 0 && own.some((r) => r.provider_state === 'present')) return { ...EMPTY_INVENTORY, ignored_empty: true };
    let holders: InventoryHolder[] = [];
    if (found.length > 0) {
      const holdersR = await c.query(
        `SELECT ${NUMBER_COLUMNS},
                COALESCE((SELECT a.state FROM whatsapp_accounts a WHERE a.id = n.account_id), 'disconnected') AS holder_account_state
         FROM whatsapp_numbers n
         WHERE provider_state = 'present' AND account_id <> $1
           AND (active_e164 = ANY($2::text[]) OR active_provider_id = ANY($3::text[]))
         ORDER BY id
         FOR UPDATE OF n`,
        [accountId, found.map((f) => f.phone_e164), found.map((f) => f.provider_number_id)]
      );
      holders = holdersR.rows as InventoryHolder[];
    }

    const plan = planInventory({ accountId, own, holders, found, allowTakeover: opts?.allowTakeover ?? false });
    const paused: InventoryResult['paused_bots'] = [];
    const byId = new Map<number, WhatsAppNumberRecord>([...own, ...holders].map((r) => [r.id, r]));
    for (const id of [...plan.removals, ...plan.takeovers]) await removeLiveNumber(c, byId.get(id)!, paused);
    for (const u of plan.updates) {
      const v = u.values;
      // Même identifiant fournisseur, autre E.164 : les sessions de l'ancien numéro vivant disparaissent (choix 7).
      const before = byId.get(u.id)!;
      if (before.provider_state === 'present' && before.phone_e164 !== v.phone_e164) await deleteNumberSessions(c, before.phone_e164);
      // is_test n'est écrit qu'à l'insertion : sur une ligne existante, le marquage manuel est conservé.
      await c.query(
        `UPDATE whatsapp_numbers
           SET phone_e164 = $1, provider_number_id = $2, cm_channel_id = $3, display_name = $4, meta_status = $5, quality = $6,
               provider_state = 'present', active_e164 = $1, active_provider_id = $2, removed_at = NULL,
               updated_at = NOW()
         WHERE id = $7`,
        [v.phone_e164, v.provider_number_id, v.cm_channel_id, v.display_name, v.meta_status, v.quality, u.id]
      );
    }
    for (const v of plan.inserts) {
      await c.query(
        `INSERT INTO whatsapp_numbers
           (account_id, client_id, phone_e164, provider_number_id, cm_channel_id, display_name, meta_status, quality, is_test,
            provider_state, active_e164, active_provider_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'present', $3, $4)`,
        [accountId, clientId, v.phone_e164, v.provider_number_id, v.cm_channel_id, v.display_name, v.meta_status, v.quality, v.is_test]
      );
    }
    return {
      added: plan.inserts.length, updated: plan.updates.length, removed: plan.removals.length, refused: plan.refused,
      took_over: plan.takeovers.length, paused_bots: paused,
    };
  };

  const assign = async (
    c: pg.PoolClient, clientId: string, botId: string, numberId: number, opts: AssignOptions, checkServingStatus: boolean,
  ): Promise<AssignDecision> => {
    const bot = await readBot(c, clientId, botId);
    const targetR = await c.query(`SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers WHERE client_id = $1 AND id = $2 FOR UPDATE`, [clientId, numberId]);
    const target = targetR.rows[0] as WhatsAppNumberRecord | undefined;
    const current = await numberOfBot(c, clientId, botId);
    const decision = decideAssign({
      bot,
      number: target ? {
        id: target.id, present: target.provider_state === 'present', is_test: target.is_test, bot_id: target.bot_id,
        account_state: await accountStateFor(c, target.account_id, opts),
      } : null,
      currentNumberId: current?.id ?? null,
      allowlistCount: await allowlistCount(c, clientId, botId),
      checkServingStatus,
      expectedHolder: opts.expectedHolder,
    });
    if (!decision.ok || !decision.changed || !target) return decision;

    const setBot = 'UPDATE whatsapp_numbers SET bot_id = $1, updated_at = NOW() WHERE id = $2';
    if (current) {
      await c.query(setBot, [null, current.id]);
      if (current.provider_state === 'present') await deleteNumberSessions(c, current.phone_e164);
    }
    // décision François A9 : l'agent IA qui perd le numéro est désactivé s'il était en service (jamais en brouillon).
    if (target.bot_id !== null) await pauseServingBot(c, clientId, target.bot_id, 'number_unassigned');
    await c.query(setBot, [botId, target.id]);
    // Le motif de pause automatique (ex. number_removed) visait l'ancien numéro : il ne survit pas au nouveau.
    await c.query('UPDATE bots SET status_reason = NULL WHERE client_id = $1 AND bot_id = $2 AND status_reason IS NOT NULL', [clientId, botId]);
    await deleteNumberSessions(c, target.phone_e164);
    return decision;
  };

  /**
   * Change le statut si la décision des contrats l'accepte : `decideTransition` par défaut, `decideActivation` pour une
   * activation avec numéro (revue finale M-7 : aucune règle de statut écrite dans le pilote).
   */
  const transition = async (
    c: pg.PoolClient, clientId: string, botId: string, to: BotStatus, opts: TopologyOptions | undefined,
    decide: (facts: TransitionFacts) => TransitionDecision = (facts) => decideTransition(to, facts),
  ): Promise<TransitionResult> => {
    const bot = await readBot(c, clientId, botId);
    if (!bot) return { ok: false, reason: 'not_found' };
    const current = await numberOfBot(c, clientId, botId);
    const decision = decide({
      from: bot.status,
      number: current ? {
        present: current.provider_state === 'present', is_test: current.is_test,
        account_state: await accountStateFor(c, current.account_id, opts),
      } : null,
      allowlistCount: await allowlistCount(c, clientId, botId),
    });
    if (!decision.ok) return decision;
    await writeBotStatus(c, clientId, botId, to, null);
    return { ok: true, from: bot.status, to };
  };

  return {
    insertWhatsAppAccount(a: NewWhatsAppAccount): Promise<WhatsAppAccountRecord> {
      return insertAccount(pool, a);
    },

    createWhatsAppAccountWithInventory(a: NewWhatsAppAccount, found: ProviderNumber[], opts?: InventoryOptions): Promise<CreateAccountResult> {
      // Contrôles du compte du fournisseur et de l'app sous le verrou de topologie : deux créations simultanées
      // avec la même WABA ou la même app se suivent, la seconde voit le compte de la première (lecture faite après
      // l'obtention du verrou).
      return withTopology(async (c): Promise<CreateAccountResult> => {
        const holder = await providerAccountHolder(c, a.client_id, a.mode, a.provider_account_id);
        if (holder !== 'none') return { ok: false, reason: 'provider_account_taken', same_organization: holder === 'same_organization' };
        if (a.meta_app_id !== null && await metaAppHeldElsewhere(c, a.client_id, a.meta_app_id)) return { ok: false, reason: 'meta_app_taken' };
        const created = await insertAccount(c, a);
        const result = await inventory(c, a.client_id, created.id, found, opts);
        const r = await c.query(`SELECT ${ACCOUNT_COLUMNS} FROM whatsapp_accounts WHERE id = $1`, [created.id]);
        return { ok: true, account: r.rows[0] as WhatsAppAccountRecord, inventory: result };
      });
    },

    applyInventory(clientId: string, accountId: number, found: ProviderNumber[], opts?: InventoryOptions): Promise<InventoryResult> {
      return withTopology((c) => inventory(c, clientId, accountId, found, opts));
    },

    assignNumber(clientId: string, botId: string, numberId: number, opts: AssignOptions) {
      return withTopology((c) => assign(c, clientId, botId, numberId, opts, true));
    },

    unassignNumber(clientId: string, botId: string, expectedNumberId: number): Promise<UnassignResult> {
      return withTopology(async (c): Promise<UnassignResult> => {
        const bot = await readBot(c, clientId, botId);
        if (!bot) return { ok: false, reason: 'not_found' };
        const current = await numberOfBot(c, clientId, botId);
        if (!current || current.id !== expectedNumberId) return { ok: false, reason: 'holder_changed' };
        await c.query('UPDATE whatsapp_numbers SET bot_id = NULL, updated_at = NOW() WHERE id = $1', [current.id]);
        if (current.provider_state === 'present') await deleteNumberSessions(c, current.phone_e164);
        // décision François A9 : un agent IA en service dont on débranche le numéro est désactivé.
        await pauseServingBot(c, clientId, botId, 'number_unassigned');
        return { ok: true, number_id: current.id };
      });
    },

    transitionBotStatus(clientId: string, botId: string, to: BotStatus, opts?: TopologyOptions): Promise<TransitionResult> {
      return withTopology((c) => transition(c, clientId, botId, to, opts));
    },

    activateWithNumber(
      clientId: string, botId: string, numberId: number, to: 'limited' | 'active', allowlist: string[] | null, opts: AssignOptions,
    ): Promise<ActivateResult> {
      return withTopology(async (c): Promise<ActivateResult> => {
        const assigned = await assign(c, clientId, botId, numberId, opts, false);
        if (!assigned.ok) return { ok: false, reason: assigned.reason, assign: assigned };
        if (allowlist !== null) await writeAllowlist(c, clientId, botId, allowlist);
        // recette Q-10 : `decideActivation` exige une entrée pour activer en accès limité, même depuis `limited`.
        const result = await transition(c, clientId, botId, to, opts, (facts) => decideActivation(to, facts));
        if (!result.ok) throw new Rollback<ActivateResult>(result);
        return { ...result, assign: assigned };
      });
    },

    disconnectWhatsAppAccount(clientId: string, id: number): Promise<DisconnectResult> {
      const emptySecret = encryptJson({});
      return withTopology(async (c): Promise<DisconnectResult> => {
        const acc = await c.query('SELECT id FROM whatsapp_accounts WHERE client_id = $1 AND id = $2 FOR UPDATE', [clientId, id]);
        if (acc.rows.length === 0) return { ok: false, reason: 'not_found' };
        const presentR = await c.query(
          `SELECT ${NUMBER_COLUMNS} FROM whatsapp_numbers
           WHERE client_id = $1 AND account_id = $2 AND provider_state = 'present' ORDER BY id FOR UPDATE`,
          [clientId, id]
        );
        const present = presentR.rows as WhatsAppNumberRecord[];
        const inUse: string[] = [];
        for (const n of present) {
          if (n.bot_id === null) continue;
          const holder = await readBot(c, clientId, n.bot_id);
          if (holder && isServingStatus(holder.status)) inUse.push(n.bot_id);
        }
        if (inUse.length > 0) return { ok: false, reason: 'number_in_use', bot_ids: inUse.sort() };
        for (const n of present) await deleteNumberSessions(c, n.phone_e164);
        await c.query('DELETE FROM whatsapp_numbers WHERE client_id = $1 AND account_id = $2', [clientId, id]);
        await c.query(
          `UPDATE whatsapp_accounts
             SET state = 'disconnected', webhook_key_hash = NULL, secret_encrypted = $1, key_version = $2,
                 error_reason = NULL, error_detail = NULL, error_provider_text = NULL, updated_at = NOW()
           WHERE id = $3`,
          [emptySecret.secret, emptySecret.keyVersion, id]
        );
        return { ok: true };
      });
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

    isMetaAppHeldElsewhere(clientId: string, metaAppId: string): Promise<boolean> {
      return metaAppHeldElsewhere(pool, clientId, metaAppId);
    },

    findProviderAccountHolder(clientId: string, mode: WhatsAppAccountMode, providerAccountId: string): Promise<ProviderAccountHolder> {
      return providerAccountHolder(pool, clientId, mode, providerAccountId);
    },

    async renameWhatsAppAccount(clientId: string, id: number, name: string): Promise<boolean> {
      const r = await pool.query(
        'UPDATE whatsapp_accounts SET name = $1, updated_at = NOW() WHERE client_id = $2 AND id = $3',
        [name, clientId, id]
      );
      return (r.rowCount ?? 0) > 0;
    },

    replaceWhatsAppAccountSecrets(clientId: string, id: number, s: WhatsAppAccountSecrets): Promise<AccountWriteResult> {
      // Sous le verrou de topologie, comme la création : contrôle de l'app et écriture ne se séparent pas.
      return withTopology(async (c): Promise<AccountWriteResult> => {
        const acc = await c.query('SELECT state FROM whatsapp_accounts WHERE client_id = $1 AND id = $2 FOR UPDATE', [clientId, id]);
        const state = (acc.rows[0] as { state: WhatsAppAccountState } | undefined)?.state;
        if (state === undefined || state === 'disconnected') return { ok: false, reason: 'not_found' };
        if (s.meta_app_id !== null && await metaAppHeldElsewhere(c, clientId, s.meta_app_id)) return { ok: false, reason: 'meta_app_taken' };
        await c.query(
          `UPDATE whatsapp_accounts
             SET secret_encrypted = $1, key_version = $2, waba_id = $3, meta_app_id = $4, token_expiry = $5, last_verified_at = $6,
                 state = 'connected', error_reason = NULL, error_detail = NULL, error_provider_text = NULL, updated_at = NOW()
           WHERE id = $7`,
          [s.secret_encrypted, s.key_version, s.waba_id, s.meta_app_id, s.token_expiry, s.verified_at, id]
        );
        return { ok: true };
      });
    },

    markWhatsAppAccountVerified(id: number, v: { token_expiry: string | null; verified_at: string }): Promise<AccountWriteResult> {
      return withTopology(async (c): Promise<AccountWriteResult> => {
        const acc = await c.query('SELECT client_id, meta_app_id, state FROM whatsapp_accounts WHERE id = $1 FOR UPDATE', [id]);
        const row = acc.rows[0] as { client_id: string; meta_app_id: string | null; state: WhatsAppAccountState } | undefined;
        if (!row || row.state === 'disconnected') return { ok: false, reason: 'not_found' };
        if (row.meta_app_id !== null && await metaAppHeldElsewhere(c, row.client_id, row.meta_app_id)) return { ok: false, reason: 'meta_app_taken' };
        await c.query(
          `UPDATE whatsapp_accounts
             SET token_expiry = $1, last_verified_at = $2, state = 'connected', error_reason = NULL, error_detail = NULL, error_provider_text = NULL,
                 updated_at = NOW()
           WHERE id = $3`,
          [v.token_expiry, v.verified_at, id]
        );
        return { ok: true };
      });
    },

    async setWhatsAppAccountError(
      id: number, reason: WhatsAppAccountErrorReason, detail: string, expectedSecretEncrypted?: string, providerText?: string | null,
    ): Promise<boolean> {
      const r = await pool.query(
        `UPDATE whatsapp_accounts SET state = 'error', error_reason = $1, error_detail = $2, error_provider_text = $5, updated_at = NOW()
         WHERE id = $3 AND state <> 'disconnected' AND ($4::text IS NULL OR secret_encrypted = $4::text)`,
        [reason, detail, id, expectedSecretEncrypted ?? null, providerText ?? null]
      );
      return (r.rowCount ?? 0) > 0;
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

    setWhatsAppNumberTestFlag(clientId: string, accountId: number, numberId: number, isTest: boolean): Promise<boolean> {
      // Sous le verrou de topologie : le marquage est un fait lu par les transitions de statut (draft vers active).
      return withTopology(async (c) => {
        const r = await c.query(
          'UPDATE whatsapp_numbers SET is_test = $1, updated_at = NOW() WHERE client_id = $2 AND account_id = $3 AND id = $4',
          [isTest, clientId, accountId, numberId]
        );
        return (r.rowCount ?? 0) > 0;
      });
    },

    async getAllowlist(clientId: string, botId: string): Promise<string[]> {
      const r = await pool.query(
        'SELECT entry FROM bot_allowlist WHERE client_id = $1 AND bot_id = $2 ORDER BY entry',
        [clientId, botId]
      );
      return (r.rows as { entry: string }[]).map((row) => row.entry);
    },

    replaceAllowlist(clientId: string, botId: string, entries: string[]): Promise<AllowlistResult> {
      // Sous le verrou de topologie, comme deleteBotRecord : l'agent IA relu ici ne peut pas être supprimé avant la
      // fin de la transaction, donc aucune liste orpheline ne naît d'un remplacement concurrent d'une suppression.
      return withTopology(async (c): Promise<AllowlistResult> => {
        const bot = await readBot(c, clientId, botId);
        if (!bot) return { ok: false, reason: 'not_found' };
        await writeAllowlist(c, clientId, botId, entries);
        return { ok: true };
      });
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
