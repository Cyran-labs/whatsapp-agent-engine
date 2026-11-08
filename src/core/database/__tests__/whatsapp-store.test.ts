import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../sqlite.js';
import { createPostgresDriver } from '../postgres.js';
import { testEngine } from '../../../test-support/test-database.js';
import type { BotRecord, Database } from '../types.js';
import type { NewWhatsAppAccount } from '../whatsapp-types.js';

const baseUrl = process.env['TEST_DATABASE_URL'];

/** Base de test avec un accès brut au pilote, pour forcer un état que le code de production ne produit pas encore. */
interface RawDb {
  db: Database;
  /** SQL brut avec des paramètres `?` (convertis en `$n` sur Postgres). */
  run(sql: string, params?: (string | number | null)[]): Promise<void>;
  all(sql: string, params?: (string | number | null)[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function openRaw(): Promise<RawDb> {
  if (testEngine() === 'postgres') {
    const name = `wab_test_${randomBytes(4).toString('hex')}`;
    const withAdmin = async (fn: (admin: pg.Client) => Promise<void>): Promise<void> => {
      const admin = new pg.Client({ connectionString: baseUrl });
      await admin.connect();
      try {
        await fn(admin);
      } finally {
        await admin.end();
      }
    };
    await withAdmin(async (admin) => { await admin.query(`CREATE DATABASE ${name}`); });
    const url = new URL(baseUrl!);
    url.pathname = `/${name}`;
    const dbUrl = url.toString();
    let db: Database | undefined;
    let raw: pg.Client | undefined;
    try {
      db = await createPostgresDriver(dbUrl);
      raw = new pg.Client({ connectionString: dbUrl });
      await raw.connect();
    } catch (e) {
      // Ouverture partielle : on ne laisse ni connexion ni base orpheline.
      await raw?.end().catch(() => undefined);
      await db?.close().catch(() => undefined);
      await withAdmin(async (admin) => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); });
      throw e;
    }
    const rawClient = raw;
    const driver = db;
    return {
      db: driver,
      async run(sql, params = []) { await rawClient.query(toPgPlaceholders(sql), params); },
      async all(sql, params = []) { return (await rawClient.query(toPgPlaceholders(sql), params)).rows as Record<string, unknown>[]; },
      async close() {
        try {
          await rawClient.end();
          await driver.close();
        } finally {
          await withAdmin(async (admin) => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); });
        }
      },
    };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wab-whatsapp-'));
  const file = path.join(dir, 'whatsapp.db');
  const db = createSqliteDriver(file);
  const raw = new BetterSqlite3(file);
  return {
    db,
    async run(sql, params = []) { raw.prepare(sql).run(...params); },
    async all(sql, params = []) { return raw.prepare(sql).all(...params) as Record<string, unknown>[]; },
    async close() {
      raw.close();
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function newAccount(clientId: string, over: Partial<NewWhatsAppAccount> = {}): NewWhatsAppAccount {
  return {
    client_id: clientId,
    name: 'Compte principal',
    mode: 'meta_manual',
    provider_account_id: `waba-${clientId}`,
    waba_id: `waba-${clientId}`,
    meta_app_id: 'app-1',
    secret_encrypted: 'enc:secret',
    key_version: 1,
    webhook_key_hash: `hash-${clientId}`,
    token_expiry: null,
    last_verified_at: '2026-11-08T10:00:00.000Z',
    ...over,
  };
}

function bot(over: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: 'acme', bot_id: 'ventes', name: 'Ventes', transport: 'meta-cloud', status: 'draft',
    status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent.' },
    lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {},
    catalog: null, llm: null, crm: null, personality: null, entity_id: null, ...over,
  };
}

describe('store des comptes WhatsApp', () => {
  let t: RawDb;
  let db: Database;
  beforeEach(async () => {
    t = await openRaw();
    db = t.db;
  });
  afterEach(async () => { await t.close(); });

  /** Pose un numéro inventorié par SQL brut (aucune méthode de production ne l'écrit encore). */
  async function insertNumber(accountId: number, clientId: string, over: {
    e164: string; providerId: string; botId?: string | null; state?: 'present' | 'removed';
  }): Promise<number> {
    const state = over.state ?? 'present';
    await t.run(
      `INSERT INTO whatsapp_numbers
         (account_id, client_id, phone_e164, provider_number_id, display_name, bot_id, provider_state, active_e164, active_provider_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [accountId, clientId, over.e164, over.providerId, 'Boutique', over.botId ?? null, state,
        state === 'present' ? over.e164 : null, state === 'present' ? over.providerId : null],
    );
    const rows = await t.all('SELECT id FROM whatsapp_numbers WHERE provider_number_id = ? AND account_id = ?', [over.providerId, accountId]);
    return Number(rows[0]!['id']);
  }

  describe('comptes', () => {
    it("un compte d'une autre organisation est introuvable", async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      expect(await db.getWhatsAppAccount('beta', acc.id)).toBeUndefined();
      expect(await db.renameWhatsAppAccount('beta', acc.id, 'X')).toBe(false);
      expect((await db.getWhatsAppAccount('acme', acc.id))?.name).toBe('Compte principal');
      expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
    });

    it('un compte neuf est connecté, sans motif, sans alerte, avec ses dates', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme', { token_expiry: 'never' }));
      expect(acc).toMatchObject({
        client_id: 'acme', name: 'Compte principal', mode: 'meta_manual', provider_account_id: 'waba-acme',
        waba_id: 'waba-acme', meta_app_id: 'app-1', secret_encrypted: 'enc:secret', key_version: 1,
        webhook_key_hash: 'hash-acme', state: 'connected', error_reason: null, error_detail: null,
        last_verified_at: '2026-11-08T10:00:00.000Z', token_expiry: 'never', last_signature_ok_at: null, alerts: [],
      });
      expect(acc.id).toBeGreaterThan(0);
      expect(typeof acc.created_at).toBe('string');
      expect(typeof acc.updated_at).toBe('string');
    });

    it('le renommage ne touche que le nom, dans la bonne organisation', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      expect(await db.renameWhatsAppAccount('acme', acc.id, 'Boutique Paris')).toBe(true);
      expect((await db.getWhatsAppAccount('acme', acc.id))?.name).toBe('Boutique Paris');
    });

    it('listWhatsAppAccounts ne renvoie que les comptes de l\'organisation', async () => {
      await db.insertWhatsAppAccount(newAccount('acme', { webhook_key_hash: 'h1' }));
      await db.insertWhatsAppAccount(newAccount('acme', { webhook_key_hash: 'h2', name: 'Second' }));
      await db.insertWhatsAppAccount(newAccount('beta'));
      const acme = await db.listWhatsAppAccounts('acme');
      expect(acme.map((a) => a.name)).toEqual(['Compte principal', 'Second']);
      expect((await db.listWhatsAppAccounts('beta')).map((a) => a.client_id)).toEqual(['beta']);
    });

    it("la recherche par empreinte de clé ignore un compte déconnecté", async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      expect((await db.findWhatsAppAccountByWebhookKeyHash('hash-acme'))?.id).toBe(acc.id);
      expect(await db.findWhatsAppAccountByWebhookKeyHash('inconnue')).toBeUndefined();
      await t.run(`UPDATE whatsapp_accounts SET state = 'disconnected' WHERE id = ?`, [acc.id]);
      expect(await db.findWhatsAppAccountByWebhookKeyHash('hash-acme')).toBeUndefined();
    });

    it('un compte en erreur reste trouvable par empreinte (le webhook doit encore être authentifié)', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      await db.setWhatsAppAccountError(acc.id, 'token_invalid', 'Jeton refusé');
      expect((await db.findWhatsAppAccountByWebhookKeyHash('hash-acme'))?.state).toBe('error');
    });

    it("l'empreinte de clé est unique sur la plateforme", async () => {
      await db.insertWhatsAppAccount(newAccount('acme', { webhook_key_hash: 'dup' }));
      await expect(db.insertWhatsAppAccount(newAccount('beta', { webhook_key_hash: 'dup' }))).rejects.toThrow();
    });

    // revue 2b-1 M-2 : une app Meta ne sert qu'une organisation tant que son compte n'y est pas déconnecté.
    it("isMetaAppHeldElsewhere voit les comptes non déconnectés d'une autre organisation, compte en erreur compris", async () => {
      expect(await db.isMetaAppHeldElsewhere('beta', 'app-1')).toBe(false);
      const acc = await db.insertWhatsAppAccount(newAccount('acme', { meta_app_id: 'app-1' }));
      expect(await db.isMetaAppHeldElsewhere('beta', 'app-1')).toBe(true);
      expect(await db.isMetaAppHeldElsewhere('acme', 'app-1')).toBe(false);
      expect(await db.isMetaAppHeldElsewhere('beta', 'app-2')).toBe(false);
      // Un compte en erreur revient seul en connected : il détient encore l'app.
      await db.setWhatsAppAccountError(acc.id, 'token_invalid', 'Jeton refusé');
      expect(await db.isMetaAppHeldElsewhere('beta', 'app-1')).toBe(true);
      expect(await db.disconnectWhatsAppAccount('acme', acc.id)).toEqual({ ok: true });
      expect(await db.isMetaAppHeldElsewhere('beta', 'app-1')).toBe(false);
    });

    it("un compte déconnecté ne revient jamais en connected ni en error", async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      expect(await db.disconnectWhatsAppAccount('acme', acc.id)).toEqual({ ok: true });
      await db.markWhatsAppAccountVerified(acc.id, { token_expiry: null, verified_at: '2026-11-08T11:00:00.000Z' });
      expect(await db.replaceWhatsAppAccountSecrets('acme', acc.id, {
        secret_encrypted: 'enc:nouveau', key_version: 1, meta_app_id: 'app-1', token_expiry: null, verified_at: '2026-11-08T11:00:00.000Z',
      })).toBe(false);
      await db.setWhatsAppAccountError(acc.id, 'other', 'Erreur');
      const after = (await db.getWhatsAppAccount('acme', acc.id))!;
      expect([after.state, after.error_reason, after.webhook_key_hash]).toEqual(['disconnected', null, null]);
      expect(after.secret_encrypted).not.toBe('enc:nouveau');
    });

    it.each([
      ['state', 'banane', 'disconnected'],
      ['mode', 'banane', 'cm_com'],
      ['error_reason', 'banane', 'other'],
    ])('la colonne %s refuse une valeur hors liste en base', async (column, bad, good) => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      await expect(t.run(`UPDATE whatsapp_accounts SET ${column} = ? WHERE id = ?`, [bad, acc.id])).rejects.toThrow();
      // Une valeur de la liste reste acceptée.
      await t.run(`UPDATE whatsapp_accounts SET ${column} = ? WHERE id = ?`, [good, acc.id]);
    });

    it("setWhatsAppAccountError puis markWhatsAppAccountVerified : le compte repasse connecté, motif effacé", async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      await db.setWhatsAppAccountError(acc.id, 'signature_rejected', 'Signature refusée');
      const err = await db.getWhatsAppAccount('acme', acc.id);
      expect(err).toMatchObject({ state: 'error', error_reason: 'signature_rejected', error_detail: 'Signature refusée' });
      await db.markWhatsAppAccountVerified(acc.id, { token_expiry: '2026-12-01T00:00:00.000Z', verified_at: '2026-11-08T12:00:00.000Z' });
      const ok = await db.getWhatsAppAccount('acme', acc.id);
      expect(ok).toMatchObject({
        state: 'connected', error_reason: null, error_detail: null,
        token_expiry: '2026-12-01T00:00:00.000Z', last_verified_at: '2026-11-08T12:00:00.000Z',
      });
    });

    it('replaceWhatsAppAccountSecrets est propre à l\'organisation, repasse connecté et efface le motif', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      await db.setWhatsAppAccountError(acc.id, 'token_invalid', 'Jeton refusé');
      const secrets = { secret_encrypted: 'enc:neuf', key_version: 2, meta_app_id: 'app-2', token_expiry: 'never', verified_at: '2026-11-08T13:00:00.000Z' };
      expect(await db.replaceWhatsAppAccountSecrets('beta', acc.id, secrets)).toBe(false);
      expect((await db.getWhatsAppAccount('acme', acc.id))?.secret_encrypted).toBe('enc:secret');
      expect(await db.replaceWhatsAppAccountSecrets('acme', acc.id, secrets)).toBe(true);
      expect(await db.getWhatsAppAccount('acme', acc.id)).toMatchObject({
        secret_encrypted: 'enc:neuf', key_version: 2, meta_app_id: 'app-2', token_expiry: 'never',
        last_verified_at: '2026-11-08T13:00:00.000Z', state: 'connected', error_reason: null, error_detail: null,
      });
    });

    it('touchSignatureOk enregistre la dernière signature valide', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      await db.touchSignatureOk(acc.id, '2026-11-08T14:00:00.000Z');
      expect((await db.getWhatsAppAccount('acme', acc.id))?.last_signature_ok_at).toBe('2026-11-08T14:00:00.000Z');
    });

    it('les alertes gardent les 20 plus récentes', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      for (let i = 1; i <= 25; i += 1) {
        await db.addWhatsAppAccountAlert(acc.id, { kind: 'policy_block', code: i, event: null, at: `2026-11-08T10:00:${String(i).padStart(2, '0')}.000Z` });
      }
      const alerts = (await db.getWhatsAppAccount('acme', acc.id))!.alerts;
      expect(alerts).toHaveLength(20);
      expect(alerts[0]!.code).toBe(6);
      expect(alerts[19]!.code).toBe(25);
    });
  });

  describe('numéros inventoriés', () => {
    it('un numéro est lu par organisation, par compte et par agent IA', async () => {
      const accA = await db.insertWhatsAppAccount(newAccount('acme'));
      const accB = await db.insertWhatsAppAccount(newAccount('beta'));
      const nA = await insertNumber(accA.id, 'acme', { e164: '+33100000001', providerId: 'pn-1', botId: 'ventes' });
      await insertNumber(accB.id, 'beta', { e164: '+33100000002', providerId: 'pn-2', botId: 'ventes' });

      expect((await db.listWhatsAppNumbers('acme')).map((n) => n.id)).toEqual([nA]);
      expect(await db.listWhatsAppNumbers('acme', accB.id)).toEqual([]);
      expect((await db.listWhatsAppNumbers('acme', accA.id))[0]).toMatchObject({
        id: nA, account_id: accA.id, client_id: 'acme', phone_e164: '+33100000001', provider_number_id: 'pn-1',
        display_name: 'Boutique', bot_id: 'ventes', provider_state: 'present', is_test: false,
        delivery_failures: 0, last_delivery_error_code: null, removed_at: null,
      });
      expect(await db.getWhatsAppNumber('beta', nA)).toBeUndefined();
      expect((await db.getWhatsAppNumber('acme', nA))?.phone_e164).toBe('+33100000001');
      expect((await db.getWhatsAppNumberForBot('acme', 'ventes'))?.id).toBe(nA);
      expect((await db.getWhatsAppNumberForBot('beta', 'ventes'))?.phone_e164).toBe('+33100000002');
      expect(await db.getWhatsAppNumberForBot('acme', 'autre')).toBeUndefined();
    });

    it('findPresentNumber retrouve par identifiant fournisseur ou par numéro, jamais un numéro retiré', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      const present = await insertNumber(acc.id, 'acme', { e164: '+33100000001', providerId: 'pn-1' });
      await insertNumber(acc.id, 'acme', { e164: '+33100000009', providerId: 'pn-9', state: 'removed' });
      expect((await db.findPresentNumber(acc.id, { providerNumberId: 'pn-1' }))?.id).toBe(present);
      expect((await db.findPresentNumber(acc.id, { phoneE164: '+33100000001' }))?.id).toBe(present);
      expect(await db.findPresentNumber(acc.id, { providerNumberId: 'pn-9' })).toBeUndefined();
      expect(await db.findPresentNumber(acc.id, { phoneE164: '+33100000009' })).toBeUndefined();
      expect(await db.findPresentNumber(acc.id + 1, { providerNumberId: 'pn-1' })).toBeUndefined();
    });

    it('un numéro vivant est unique sur la plateforme, un numéro retiré libère la place', async () => {
      const accA = await db.insertWhatsAppAccount(newAccount('acme'));
      const accB = await db.insertWhatsAppAccount(newAccount('beta'));
      await insertNumber(accA.id, 'acme', { e164: '+33100000001', providerId: 'pn-1' });
      await expect(insertNumber(accB.id, 'beta', { e164: '+33100000001', providerId: 'pn-2' })).rejects.toThrow();
      await expect(insertNumber(accB.id, 'beta', { e164: '+33100000002', providerId: 'pn-1' })).rejects.toThrow();
      await insertNumber(accB.id, 'beta', { e164: '+33100000001', providerId: 'pn-3', state: 'removed' });
      await insertNumber(accB.id, 'beta', { e164: '+33100000001', providerId: 'pn-4', state: 'removed' });
    });

    describe('cohérence entre l\'état du numéro et ses clés de détention (CHECK)', () => {
      const insertRaw = async (state: string, activeE164: string | null, activeProviderId: string | null): Promise<void> => {
        const acc = await db.insertWhatsAppAccount(newAccount('acme', { webhook_key_hash: `h-${state}-${activeE164}` }));
        await t.run(
          `INSERT INTO whatsapp_numbers
             (account_id, client_id, phone_e164, provider_number_id, display_name, provider_state, active_e164, active_provider_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [acc.id, 'acme', '+33100000101', 'pn-c1', 'Boutique', state, activeE164, activeProviderId],
        );
      };
      it('(a) refuse un numéro présent sans active_e164', async () => {
        await expect(insertRaw('present', null, 'pn-c1')).rejects.toThrow();
      });
      it('(b) refuse un numéro présent sans active_provider_id', async () => {
        await expect(insertRaw('present', '+33100000101', null)).rejects.toThrow();
      });
      it('(c) refuse un numéro retiré avec active_e164 renseigné', async () => {
        await expect(insertRaw('removed', '+33100000101', null)).rejects.toThrow();
      });
      it('(c bis) refuse un numéro retiré avec active_provider_id renseigné', async () => {
        await expect(insertRaw('removed', null, 'pn-c1')).rejects.toThrow();
      });
      it('accepte les deux formes cohérentes', async () => {
        await insertRaw('present', '+33100000101', 'pn-c1');
        await insertRaw('removed', null, null);
      });
    });

    it('un agent IA a au plus un numéro', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      await insertNumber(acc.id, 'acme', { e164: '+33100000001', providerId: 'pn-1', botId: 'ventes' });
      await expect(insertNumber(acc.id, 'acme', { e164: '+33100000002', providerId: 'pn-2', botId: 'ventes' })).rejects.toThrow();
      await insertNumber(acc.id, 'acme', { e164: '+33100000003', providerId: 'pn-3', botId: null });
      await insertNumber(acc.id, 'acme', { e164: '+33100000004', providerId: 'pn-4', botId: null });
    });

    it('recordDeliveryFailure incrémente le compteur et garde le dernier code', async () => {
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      const id = await insertNumber(acc.id, 'acme', { e164: '+33100000001', providerId: 'pn-1' });
      await db.recordDeliveryFailure(id, 131030, '2026-11-08T10:00:00.000Z');
      await db.recordDeliveryFailure(id, null, '2026-11-08T11:00:00.000Z');
      const n = await db.getWhatsAppNumber('acme', id);
      expect(n).toMatchObject({ delivery_failures: 2, last_delivery_error_code: null, last_delivery_error_at: '2026-11-08T11:00:00.000Z' });
    });
  });

  describe("liste d'accès limité", () => {
    it('liste d’accès limité remplacée, propre à l’agent IA', async () => {
      await db.replaceAllowlist('acme', 'ventes', ['+33612345678', 'FR.abc123']);
      await db.replaceAllowlist('beta', 'ventes', ['+33700000000']);
      expect(await db.getAllowlist('acme', 'ventes')).toEqual(['+33612345678', 'FR.abc123']);
      expect(await db.getAllowlist('beta', 'ventes')).toEqual(['+33700000000']);
      expect(await db.getAllowlist('acme', 'autre')).toEqual([]);

      await db.replaceAllowlist('acme', 'ventes', ['FR.abc123', 'FR.abc123', '+33611111111']);
      expect(await db.getAllowlist('acme', 'ventes')).toEqual(['+33611111111', 'FR.abc123']);
      expect(await db.getAllowlist('beta', 'ventes')).toEqual(['+33700000000']);

      await db.replaceAllowlist('acme', 'ventes', []);
      expect(await db.getAllowlist('acme', 'ventes')).toEqual([]);
      expect(await db.getAllowlist('beta', 'ventes')).toEqual(['+33700000000']);
    });

    it("supprimer l'agent IA supprime sa liste d'accès limité et détache son numéro", async () => {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await db.upsertBotRecord(bot());
      await db.replaceAllowlist('acme', 'ventes', ['+33612345678']);
      const acc = await db.insertWhatsAppAccount(newAccount('acme'));
      const id = await insertNumber(acc.id, 'acme', { e164: '+33100000001', providerId: 'pn-1', botId: 'ventes' });
      await db.deleteBotRecord('acme', 'ventes');
      expect(await db.getAllowlist('acme', 'ventes')).toEqual([]);
      expect((await db.getWhatsAppNumber('acme', id))?.bot_id).toBeNull();
    });
  });

  describe('statut des agents IA', () => {
    it("upsertBotRecord ne change jamais le statut d'un agent IA existant", async () => {
      // revue 2b-1 I-3, audit 6.2
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await db.upsertBotRecord(bot({ status: 'draft' }));
      await t.run(`UPDATE bots SET status = 'paused', status_reason = 'number_removed' WHERE client_id = ? AND bot_id = ?`, ['acme', 'ventes']);
      await db.upsertBotRecord(bot({ status: 'active', status_reason: null, name: 'Renommé' }));
      const rec = await db.getBotRecord('acme', 'ventes');
      expect(rec?.status).toBe('paused');
      expect(rec?.status_reason).toBe('number_removed');
      expect(rec?.name).toBe('Renommé');
    });

    it("upsertBotRecord écrit le statut fourni à l'insertion, motif absent par défaut", async () => {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await db.upsertBotRecord(bot({ status: 'limited' }));
      const rec = await db.getBotRecord('acme', 'ventes');
      expect(rec?.status).toBe('limited');
      expect(rec?.status_reason).toBeNull();
      expect((await db.listBotRecords())[0]?.status_reason).toBeNull();
    });

    it('setBotStatusUnchecked change le statut sans toucher au reste ni aux autres agents IA', async () => {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
      await db.upsertBotRecord(bot({ status: 'draft' }));
      await db.upsertBotRecord(bot({ client_id: 'beta', status: 'draft' }));
      await db.setBotStatusUnchecked('acme', 'ventes', 'paused');
      expect((await db.getBotRecord('acme', 'ventes'))?.status).toBe('paused');
      expect((await db.getBotRecord('beta', 'ventes'))?.status).toBe('draft');
    });

    it('setBotStatusUnchecked efface le motif de pause automatique, sans toucher à un autre agent IA', async () => {
      await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
      await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
      await db.upsertBotRecord(bot());
      await db.upsertBotRecord(bot({ client_id: 'beta' }));
      await t.run(`UPDATE bots SET status = 'paused', status_reason = 'number_removed'`);
      await db.setBotStatusUnchecked('acme', 'ventes', 'active');
      expect(await db.getBotRecord('acme', 'ventes')).toMatchObject({ status: 'active', status_reason: null });
      expect(await db.getBotRecord('beta', 'ventes')).toMatchObject({ status: 'paused', status_reason: 'number_removed' });
    });
  });

  describe('resetContactConversation', () => {
    it('resetContactConversation efface session et messages de cet agent IA, pas le lead ni un autre agent IA', async () => {
      await db.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes');
      await db.createSessionIfAbsent('+33100000002', '33600000001', 'acme', 'support');
      await db.addMessage('33600000001', 'acme', 'ventes', 'user', 'bonjour');
      await db.addMessage('33600000001', 'acme', 'ventes', 'assistant', 'salut');
      await db.addMessage('33600000001', 'acme', 'support', 'user', 'aide');
      await db.addMessage('33600000001', 'beta', 'ventes', 'user', 'autre organisation');
      await db.saveLead('33600000001', 'acme', 'ventes', { nom: 'Dupont' });

      await db.resetContactConversation('+33100000001', '33600000001', 'acme', 'ventes');

      expect(await db.getSession('+33100000001', '33600000001')).toBeUndefined();
      expect(await db.getConversation('33600000001', 'acme', 'ventes')).toEqual([]);
      expect(await db.getSession('+33100000002', '33600000001')).toBeDefined();
      expect(await db.getConversation('33600000001', 'acme', 'support')).toHaveLength(1);
      expect(await db.getConversation('33600000001', 'beta', 'ventes')).toHaveLength(1);
      expect(await db.getLeadData('33600000001', 'acme', 'ventes')).toEqual({ nom: 'Dupont' });
    });
  });
});
