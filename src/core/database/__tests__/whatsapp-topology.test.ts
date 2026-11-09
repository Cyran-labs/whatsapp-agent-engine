import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../../test-support/test-database.js';
import { withTopologyTransaction } from '../whatsapp-postgres.js';
import { decryptJson } from '../../credentials/crypto.js';
import type { BotRecord, Database } from '../types.js';
import type { NewWhatsAppAccount, ProviderNumber, WhatsAppAccountRecord } from '../whatsapp-types.js';
import { UNCHECKED } from '../../../test-support/whatsapp.js';

// Inventaire, branchement, statuts et déconnexion : chaque opération est une transaction qui relit ses faits.
// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL).

const CONTACT = '33600000001';

function newAccount(clientId: string, over: Partial<NewWhatsAppAccount> = {}): NewWhatsAppAccount {
  return {
    client_id: clientId, name: `Compte ${clientId}`, mode: 'meta_manual', provider_account_id: `waba-${clientId}`,
    waba_id: `waba-${clientId}`, meta_app_id: `app-${clientId}`, secret_encrypted: 'enc:secret', key_version: 1,
    webhook_key_hash: `hash-${clientId}`, token_expiry: null, last_verified_at: '2026-11-08T10:00:00.000Z', ...over,
  };
}

function num(i: number, over: Partial<ProviderNumber> = {}): ProviderNumber {
  return {
    provider_number_id: `pn-${i}`, phone_e164: `+3310000000${i}`, display_name: `Boutique ${i}`, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null, ...over,
  };
}

function bot(clientId: string, botId: string, status: string): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, status, status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent IA.' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null,
    personality: null, entity_id: null,
  };
}

async function warmUp(db: Database): Promise<void> {
  await Promise.all(Array.from({ length: 10 }, () => db.getSession('warm-up', 'warm-up')));
}

describe('topologie des numéros WhatsApp (transactions)', () => {
  let db: Database;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
  });
  afterEach(async () => {
    await db.close();
    vi.unstubAllEnvs();
  });

  /**
   * Création qui doit réussir (aucun conflit d'app Meta attendu), comme le raccordement par un admin : reprise permise
   * (revue 2b-2 I-1, la reprise n'a lieu que sur une action d'admin).
   */
  async function createOk(a: NewWhatsAppAccount, found: ProviderNumber[]) {
    const r = await db.createWhatsAppAccountWithInventory(a, found, { allowTakeover: true });
    if (!r.ok) throw new Error(`création refusée : ${r.reason}`);
    return r;
  }

  /** Compte d'acme avec ses numéros, et l'identifiant de chaque numéro par indice. */
  async function acmeWith(found: ProviderNumber[]): Promise<{ account: WhatsAppAccountRecord; ids: number[] }> {
    const { account } = await createOk(newAccount('acme'), found);
    const rows = await db.listWhatsAppNumbers('acme', account.id);
    return { account, ids: found.map((f) => rows.find((r) => r.provider_number_id === f.provider_number_id)!.id) };
  }

  /** Met l'agent IA en service par la machine d'états (liste d'accès limité posée, puis limited, puis active). */
  async function putInService(clientId: string, botId: string, to: 'limited' | 'active'): Promise<void> {
    expect((await db.replaceAllowlist(clientId, botId, ['+33699999999'])).ok).toBe(true);
    expect((await db.transitionBotStatus(clientId, botId, 'limited')).ok).toBe(true);
    if (to === 'active') expect((await db.transitionBotStatus(clientId, botId, 'active')).ok).toBe(true);
  }

  async function statusOf(clientId: string, botId: string): Promise<{ status: string; status_reason: string | null }> {
    const rec = await db.getBotRecord(clientId, botId);
    return { status: rec!.status, status_reason: rec!.status_reason };
  }

  describe('inventaire', () => {
    it('création du compte et inventaire en une opération', async () => {
      const { account, inventory } = await createOk(newAccount('acme'), [num(1), num(2, { is_test: true })]);
      expect(account).toMatchObject({ client_id: 'acme', state: 'connected', webhook_key_hash: 'hash-acme' });
      expect(inventory).toEqual({ added: 2, updated: 0, removed: 0, refused: 0, took_over: 0, paused_bots: [] });
      const rows = await db.listWhatsAppNumbers('acme', account.id);
      expect(rows.map((r) => [r.phone_e164, r.provider_number_id, r.is_test, r.provider_state, r.bot_id, r.client_id])).toEqual([
        ['+33100000001', 'pn-1', false, 'present', null, 'acme'],
        ['+33100000002', 'pn-2', true, 'present', null, 'acme'],
      ]);
    });

    // audit 1.5
    it('un numéro tenu par un compte connected d\'une autre organisation est refusé, sans rien toucher', async () => {
      const { account: acmeAcc } = await acmeWith([num(1)]);
      const before = await db.listWhatsAppNumbers('acme', acmeAcc.id);
      const { account: betaAcc, inventory } = await createOk(newAccount('beta'), [num(1)]);
      expect(inventory.refused).toBe(1);
      expect(inventory.added).toBe(0);
      expect(await db.listWhatsAppNumbers('beta')).toEqual([]);
      expect(await db.listWhatsAppNumbers('acme', acmeAcc.id)).toEqual(before);
      // Rafraîchir n'y change rien.
      expect((await db.applyInventory('beta', betaAcc.id, [num(1)])).refused).toBe(1);
      expect(await db.listWhatsAppNumbers('beta')).toEqual([]);
    });

    it("reprise d'un numéro dont le compte est en erreur : l'ancien agent IA en pause, rien ne change d'organisation", async () => {
      const { account: acmeAcc, ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      expect(await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED)).toMatchObject({ ok: true, changed: true });
      await putInService('acme', 'ventes', 'active');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'ventes');
      await db.addMessage(CONTACT, 'acme', 'ventes', 'user', 'bonjour');
      await db.saveLead(CONTACT, 'acme', 'ventes', { nom: 'Dupont' });
      await db.setWhatsAppAccountError(acmeAcc.id, 'token_invalid', 'Jeton refusé');

      const { account: betaAcc, inventory } = await createOk(newAccount('beta'), [num(1)]);
      expect(inventory).toMatchObject({ added: 1, took_over: 1, refused: 0, paused_bots: [{ client_id: 'acme', bot_id: 'ventes' }] });

      const acmeRow = await db.getWhatsAppNumber('acme', ids[0]!);
      expect(acmeRow).toMatchObject({ provider_state: 'removed', bot_id: 'ventes' });
      expect(acmeRow?.removed_at).toEqual(expect.any(String));
      const betaRows = await db.listWhatsAppNumbers('beta', betaAcc.id);
      expect(betaRows).toHaveLength(1);
      expect(betaRows[0]).toMatchObject({ client_id: 'beta', phone_e164: '+33100000001', provider_state: 'present', bot_id: null });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'paused', status_reason: 'number_removed' });
      expect(await db.getSession('+33100000001', CONTACT)).toBeUndefined();
      expect(await db.getConversation(CONTACT, 'acme', 'ventes')).toHaveLength(1);
      expect(await db.getLeadData(CONTACT, 'acme', 'ventes')).toEqual({ nom: 'Dupont' });

      const acmeAudit = (await db.listAuditLog('acme')).filter((a) => a.action === 'bot.status.auto');
      expect(acmeAudit).toHaveLength(1);
      expect(acmeAudit[0]).toMatchObject({
        actor_user_id: null, target: 'bot:acme/ventes', client_id: 'acme', metadata: { to: 'paused', reason: 'number_removed' },
      });
      expect(JSON.stringify(acmeAudit)).not.toContain('beta');
      expect((await db.listAuditLog('beta')).filter((a) => a.action === 'bot.status.auto')).toEqual([]);
    });

    // revue 2b-2 I-1
    it("sans reprise permise (défaut, événement du fournisseur) : le numéro d'un compte en erreur est refusé, rien ne change chez acme", async () => {
      const { account: acmeAcc, ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await putInService('acme', 'ventes', 'active');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'ventes');
      await db.setWhatsAppAccountError(acmeAcc.id, 'token_invalid', 'Jeton refusé');
      const { account: betaAcc } = await createOk(newAccount('beta'), [num(2)]);

      for (const inventory of [
        await db.applyInventory('beta', betaAcc.id, [num(1), num(2)]),
        await db.applyInventory('beta', betaAcc.id, [num(1), num(2)], { allowTakeover: false }),
      ]) {
        expect(inventory).toMatchObject({ added: 0, updated: 1, removed: 0, refused: 1, took_over: 0, paused_bots: [] });
      }
      expect((await db.getWhatsAppNumber('acme', ids[0]!))).toMatchObject({ provider_state: 'present', bot_id: 'ventes' });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'active', status_reason: null });
      expect(await db.getSession('+33100000001', CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
      expect((await db.listWhatsAppNumbers('beta')).map((n) => n.phone_e164)).toEqual(['+33100000002']);
      expect(await db.listAuditLog('acme')).toEqual([]);
      // Création sans reprise permise : même refus.
      const third = await db.createWhatsAppAccountWithInventory(
        newAccount('beta', { provider_account_id: 'waba-beta-2', webhook_key_hash: 'hash-beta-2' }), [num(1)],
      );
      expect(third).toMatchObject({ ok: true, inventory: { added: 0, refused: 1, took_over: 0 } });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'active', status_reason: null });
    });

    // revue 2b-2 M-3
    it("inventaire vide sur un compte qui a des numéros présents : jamais appliqué, ni retrait ni pause ; sans numéro présent : sans effet", async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await putInService('acme', 'ventes', 'active');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'ventes');
      const before = await db.listWhatsAppNumbers('acme', account.id);

      for (const opts of [undefined, { allowTakeover: true }, { allowTakeover: false }]) {
        expect(await db.applyInventory('acme', account.id, [], opts)).toEqual({
          added: 0, updated: 0, removed: 0, refused: 0, took_over: 0, paused_bots: [], ignored_empty: true,
        });
      }
      expect(await db.listWhatsAppNumbers('acme', account.id)).toEqual(before);
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'active', status_reason: null });
      expect(await db.getSession('+33100000001', CONTACT)).toMatchObject({ client_id: 'acme', bot_id: 'ventes' });
      expect((await db.listAuditLog('acme')).filter((a) => a.action === 'bot.status.auto')).toEqual([]);

      // Compte sans numéro présent (création, ou numéros déjà retirés) : sans effet, sans refus.
      const empty = await createOk(newAccount('acme', { provider_account_id: 'waba-acme-vide', webhook_key_hash: 'hash-vide' }), []);
      expect(empty.inventory).toEqual({ added: 0, updated: 0, removed: 0, refused: 0, took_over: 0, paused_bots: [] });
      expect(await db.applyInventory('acme', empty.account.id, [])).toEqual({ added: 0, updated: 0, removed: 0, refused: 0, took_over: 0, paused_bots: [] });
    });

    it('un agent IA en brouillon dont le numéro est repris reste en brouillon, sans audit', async () => {
      const { account: acmeAcc, ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await db.setWhatsAppAccountError(acmeAcc.id, 'other', 'x');
      const { inventory } = await createOk(newAccount('beta'), [num(1)]);
      expect(inventory).toMatchObject({ took_over: 1, paused_bots: [] });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'draft', status_reason: null });
      expect(await db.listAuditLog('acme')).toEqual([]);
    });

    it('retrait par le fournisseur : numéro retiré gardant son agent IA, agent IA en pause, sessions supprimées, audit', async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await putInService('acme', 'ventes', 'limited');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'ventes');
      await db.createSessionIfAbsent('+33100000002', CONTACT, 'acme', 'autre');

      const res = await db.applyInventory('acme', account.id, [num(2)]);
      expect(res).toEqual({ added: 0, updated: 1, removed: 1, refused: 0, took_over: 0, paused_bots: [{ client_id: 'acme', bot_id: 'ventes' }] });
      expect(await db.getWhatsAppNumber('acme', ids[0]!)).toMatchObject({ provider_state: 'removed', bot_id: 'ventes' });
      expect(await db.getWhatsAppNumberForBot('acme', 'ventes')).toMatchObject({ id: ids[0], provider_state: 'removed' });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'paused', status_reason: 'number_removed' });
      expect(await db.getSession('+33100000001', CONTACT)).toBeUndefined();
      expect(await db.getSession('+33100000002', CONTACT)).toBeDefined();
      const audit = (await db.listAuditLog('acme')).filter((a) => a.action === 'bot.status.auto');
      expect(audit).toHaveLength(1);

      // Le numéro réapparaît : ravivé, même ligne, l'agent IA reste en pause (réactivation manuelle).
      const back = await db.applyInventory('acme', account.id, [num(1, { display_name: 'Retour' }), num(2)]);
      expect(back).toMatchObject({ added: 0, updated: 2, removed: 0 });
      expect(await db.getWhatsAppNumber('acme', ids[0]!)).toMatchObject({
        provider_state: 'present', removed_at: null, bot_id: 'ventes', display_name: 'Retour',
      });
      expect((await db.listWhatsAppNumbers('acme', account.id))).toHaveLength(2);
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'paused', status_reason: 'number_removed' });
    });

    // choix 7
    it("même identifiant fournisseur, autre E.164 : les sessions de l'ancien numéro sont supprimées", async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'ventes');
      await db.createSessionIfAbsent('+33100000002', CONTACT, 'acme', 'autre');
      const res = await db.applyInventory('acme', account.id, [num(1, { phone_e164: '+33100000009' }), num(2)]);
      expect(res).toMatchObject({ added: 0, updated: 2, removed: 0 });
      expect(await db.getWhatsAppNumber('acme', ids[0]!)).toMatchObject({ phone_e164: '+33100000009', provider_state: 'present', bot_id: 'ventes' });
      expect(await db.getSession('+33100000001', CONTACT)).toBeUndefined();
      expect(await db.getSession('+33100000002', CONTACT)).toBeDefined();
    });

    it("l'inventaire d'un compte d'une autre organisation ou déconnecté est refusé", async () => {
      const { account } = await acmeWith([num(1)]);
      await expect(db.applyInventory('beta', account.id, [num(2)])).rejects.toThrow();
      expect(await db.listWhatsAppNumbers('beta')).toEqual([]);
      expect(await db.disconnectWhatsAppAccount('acme', account.id)).toEqual({ ok: true });
      await expect(db.applyInventory('acme', account.id, [num(2)])).rejects.toThrow();
      expect(await db.listWhatsAppNumbers('acme')).toEqual([]);
    });

    // revue 2b-1 M-2 : le contrôle de l'app se fait dans la transaction de création.
    it("création refusée meta_app_taken si l'app est détenue par une autre organisation, même en erreur ; rien écrit", async () => {
      const { account } = await acmeWith([num(1)]);
      await db.setWhatsAppAccountError(account.id, 'token_invalid', 'Jeton refusé');
      const refused = await db.createWhatsAppAccountWithInventory(newAccount('beta', { meta_app_id: 'app-acme' }), [num(2)]);
      expect(refused).toEqual({ ok: false, reason: 'meta_app_taken' });
      expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
      expect(await db.listWhatsAppNumbers('beta')).toEqual([]);
      // Même organisation : permis (deuxième WABA sur la même app).
      expect((await db.createWhatsAppAccountWithInventory(
        newAccount('acme', { provider_account_id: 'waba-acme-2', webhook_key_hash: 'hash-acme-2' }), [num(3)],
      )).ok).toBe(true);
    });

    // revue 2b-1 M-2
    it("deux créations simultanées par deux organisations avec la même app : une seule réussit", async () => {
      await warmUp(db);
      const results = await Promise.all([
        db.createWhatsAppAccountWithInventory(newAccount('acme', { meta_app_id: 'app-partagee' }), [num(1)]),
        db.createWhatsAppAccountWithInventory(newAccount('beta', { meta_app_id: 'app-partagee' }), [num(2)]),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'meta_app_taken' }]);
      const accounts = [...await db.listWhatsAppAccounts('acme'), ...await db.listWhatsAppAccounts('beta')];
      expect(accounts).toHaveLength(1);
    });

    // revue 2b-2 I-1 : le contrôle du compte du fournisseur se fait aussi dans la transaction de création.
    it("création refusée provider_account_taken si la WABA est tenue par un compte non déconnecté, d'une autre organisation ou de la même ; rien écrit", async () => {
      const { account } = await acmeWith([num(1)]);
      await db.setWhatsAppAccountError(account.id, 'token_invalid', 'Jeton refusé');
      const sameWaba = { provider_account_id: 'WABA-ACME', webhook_key_hash: 'hash-2' };
      expect(await db.createWhatsAppAccountWithInventory(newAccount('beta', sameWaba), [num(2)]))
        .toEqual({ ok: false, reason: 'provider_account_taken', same_organization: false });
      expect(await db.createWhatsAppAccountWithInventory(newAccount('acme', { ...sameWaba, meta_app_id: 'app-acme' }), [num(2)]))
        .toEqual({ ok: false, reason: 'provider_account_taken', same_organization: true });
      expect(await db.listWhatsAppAccounts('beta')).toEqual([]);
      expect(await db.listWhatsAppAccounts('acme')).toHaveLength(1);
      expect(await db.listWhatsAppNumbers('beta')).toEqual([]);
      // Lecture préalable du service : même verdict, sans écrire.
      expect(await db.findProviderAccountHolder('beta', 'meta_manual', 'waba-acme')).toBe('other_organization');
      expect(await db.findProviderAccountHolder('acme', 'meta_manual', 'waba-acme')).toBe('same_organization');
      expect(await db.findProviderAccountHolder('beta', 'cm_com', 'waba-acme')).toBe('none');
      // Compte déconnecté : la WABA est libre.
      expect(await db.disconnectWhatsAppAccount('acme', account.id)).toEqual({ ok: true });
      expect(await db.findProviderAccountHolder('beta', 'meta_manual', 'waba-acme')).toBe('none');
      expect((await db.createWhatsAppAccountWithInventory(newAccount('beta', sameWaba), [num(2)])).ok).toBe(true);
    });

    // revue 2b-2 I-1
    it("deux créations simultanées de la même WABA par deux organisations (apps différentes) : une seule réussit", async () => {
      await warmUp(db);
      const sameWaba = { provider_account_id: 'waba-partagee' };
      const results = await Promise.all([
        db.createWhatsAppAccountWithInventory(newAccount('acme', sameWaba), [num(1)]),
        db.createWhatsAppAccountWithInventory(newAccount('beta', sameWaba), [num(2)]),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'provider_account_taken', same_organization: false }]);
      expect([...await db.listWhatsAppAccounts('acme'), ...await db.listWhatsAppAccounts('beta')]).toHaveLength(1);
    });

    it("un inventaire ultérieur conserve le marquage « numéro de test » posé à la main, et met à jour le reste", async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      expect(await db.setWhatsAppNumberTestFlag('acme', account.id, ids[0]!, true)).toBe(true);
      await db.applyInventory('acme', account.id, [num(1, { display_name: 'Renommé', quality: 'RED' }), num(2)]);
      const rows = await db.listWhatsAppNumbers('acme', account.id);
      expect(rows.map((r) => [r.id, r.is_test, r.display_name, r.quality])).toEqual([
        [ids[0], true, 'Renommé', 'RED'],
        [ids[1], false, 'Boutique 2', 'GREEN'],
      ]);
    });
  });

  describe('marquage « numéro de test »', () => {
    it("pose et retire le marquage sur un numéro de l'organisation et du compte", async () => {
      const { account, ids } = await acmeWith([num(1)]);
      expect(await db.setWhatsAppNumberTestFlag('acme', account.id, ids[0]!, true)).toBe(true);
      expect((await db.getWhatsAppNumber('acme', ids[0]!))!.is_test).toBe(true);
      expect(await db.setWhatsAppNumberTestFlag('acme', account.id, ids[0]!, false)).toBe(true);
      expect((await db.getWhatsAppNumber('acme', ids[0]!))!.is_test).toBe(false);
    });

    it("refuse un numéro d'une autre organisation ou d'un autre compte, sans rien modifier", async () => {
      const { account, ids } = await acmeWith([num(1)]);
      const { account: other } = await createOk(
        newAccount('acme', { provider_account_id: 'waba-acme-2', webhook_key_hash: 'hash-acme-2' }), [num(2)],
      );
      const { account: betaAccount } = await createOk(newAccount('beta'), [num(3)]);
      expect(await db.setWhatsAppNumberTestFlag('beta', account.id, ids[0]!, true)).toBe(false);
      expect(await db.setWhatsAppNumberTestFlag('beta', betaAccount.id, ids[0]!, true)).toBe(false);
      expect(await db.setWhatsAppNumberTestFlag('acme', other.id, ids[0]!, true)).toBe(false);
      expect((await db.getWhatsAppNumber('acme', ids[0]!))!.is_test).toBe(false);
    });
  });

  describe('branchement', () => {
    // revue 2b-1 M-1, audit 6.3
    it("le numéro de A1 (actif) branché sur A2 : A1 en brouillon sans numéro, A2 détient le numéro, plus aucune session", async () => {
      const { ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED);
      await db.assignNumber('acme', 'A2', ids[1]!, UNCHECKED);
      await putInService('acme', 'A1', 'active');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'A1');
      await db.createSessionIfAbsent('+33100000002', CONTACT, 'acme', 'A2');

      const res = await db.assignNumber('acme', 'A2', ids[0]!, UNCHECKED);
      expect(res).toEqual({ ok: true, changed: true, previous_bot_id: 'A1', previous_number_id: ids[1] });
      expect(await statusOf('acme', 'A1')).toEqual({ status: 'draft', status_reason: null });
      expect(await db.getWhatsAppNumberForBot('acme', 'A1')).toBeUndefined();
      expect((await db.getWhatsAppNumberForBot('acme', 'A2'))?.id).toBe(ids[0]);
      expect((await db.getWhatsAppNumber('acme', ids[1]!))?.bot_id).toBeNull();
      expect(await db.getSession('+33100000001', CONTACT)).toBeUndefined();
      expect(await db.getSession('+33100000002', CONTACT)).toBeUndefined();
    });

    // revue 2b-3 M-1
    it("deux branchements du même numéro avec le même détenteur attendu (null) : le second est refusé holder_changed, le premier agent IA garde numéro et statut", async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      expect((await db.assignNumber('acme', 'A1', ids[0]!, { expectedHolder: { kind: 'expected', bot_id: null } })).ok).toBe(true);
      await putInService('acme', 'A1', 'limited');

      expect(await db.assignNumber('acme', 'A2', ids[0]!, { expectedHolder: { kind: 'expected', bot_id: null } })).toEqual({ ok: false, reason: 'holder_changed' });
      expect(await statusOf('acme', 'A1')).toEqual({ status: 'limited', status_reason: null });
      expect((await db.getWhatsAppNumberForBot('acme', 'A1'))?.id).toBe(ids[0]);
      expect(await db.getWhatsAppNumberForBot('acme', 'A2')).toBeUndefined();
      expect((await db.getWhatsAppNumber('acme', ids[0]!))?.bot_id).toBe('A1');

      // Le détenteur lu à jour est accepté.
      expect(await db.assignNumber('acme', 'A2', ids[0]!, { expectedHolder: { kind: 'expected', bot_id: 'A1' } })).toMatchObject({ ok: true, changed: true, previous_bot_id: 'A1' });
      expect(await statusOf('acme', 'A1')).toEqual({ status: 'draft', status_reason: null });
    });

    // revue 2b-3 M-1
    it("détenteur attendu : un numéro libre attendu pris, un numéro pris attendu libre ou tenu par un autre refusent ; le même agent IA reste un no-op", async () => {
      const { ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED);
      expect(await db.assignNumber('acme', 'A2', ids[0]!, { expectedHolder: { kind: 'expected', bot_id: 'A3' } })).toEqual({ ok: false, reason: 'holder_changed' });
      // Numéro libre que l'écran croyait tenu par A1.
      expect(await db.assignNumber('acme', 'A2', ids[1]!, { expectedHolder: { kind: 'expected', bot_id: 'A1' } })).toEqual({ ok: false, reason: 'holder_changed' });
      expect((await db.getWhatsAppNumber('acme', ids[1]!))?.bot_id).toBeNull();
      // Déjà tenu par l'agent IA cible : rien à écrire, pas de refus.
      expect(await db.assignNumber('acme', 'A1', ids[0]!, { expectedHolder: { kind: 'expected', bot_id: null } })).toMatchObject({ ok: true, changed: false });
      // `unchecked` (tests et amorçage seulement) : pas de contrôle.
      expect((await db.assignNumber('acme', 'A2', ids[0]!, UNCHECKED)).ok).toBe(true);
    });

    // revue finale 2b-2 : le motif de pause d'un ancien numéro ne survit pas au branchement d'un nouveau numéro
    it("agent IA en pause (number_removed) branché sur un numéro présent : motif effacé, statut paused inchangé", async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await putInService('acme', 'ventes', 'limited');
      await db.applyInventory('acme', account.id, [num(2)]);
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'paused', status_reason: 'number_removed' });

      const res = await db.assignNumber('acme', 'ventes', ids[1]!, UNCHECKED);
      expect(res).toMatchObject({ ok: true, changed: true });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'paused', status_reason: null });
      expect((await db.getWhatsAppNumberForBot('acme', 'ventes'))?.id).toBe(ids[1]);
    });

    it('rebrancher le même numéro ne change rien', async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED);
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'A1');
      expect(await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED)).toEqual({ ok: true, changed: false, previous_bot_id: null, previous_number_id: ids[0] });
      expect(await db.getSession('+33100000001', CONTACT)).toBeDefined();
    });

    // choix 8
    it("A2 actif branché vers un numéro dont le compte est en erreur : refus, rien n'a changé", async () => {
      const { ids } = await acmeWith([num(1)]);
      const { account: other } = await createOk(
        newAccount('acme', { webhook_key_hash: 'hash-acme-2', provider_account_id: 'waba-2' }), [num(2)]);
      const otherId = (await db.listWhatsAppNumbers('acme', other.id))[0]!.id;
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      await db.assignNumber('acme', 'A2', ids[0]!, UNCHECKED);
      await putInService('acme', 'A2', 'active');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'A2');
      await db.setWhatsAppAccountError(other.id, 'token_invalid', 'Jeton refusé');
      const before = await db.listWhatsAppNumbers('acme');

      expect(await db.assignNumber('acme', 'A2', otherId, UNCHECKED)).toEqual({ ok: false, reason: 'account_not_connected' });
      expect(await db.listWhatsAppNumbers('acme')).toEqual(before);
      expect(await statusOf('acme', 'A2')).toEqual({ status: 'active', status_reason: null });
      expect(await db.getSession('+33100000001', CONTACT)).toBeDefined();
    });

    // choix 4, choix 8
    it('un compte bloqué en mémoire compte comme non connecté pour un agent IA actif', async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      await db.assignNumber('acme', 'A2', ids[0]!, UNCHECKED);
      await putInService('acme', 'A2', 'active');
      expect(await db.assignNumber('acme', 'A2', ids[1]!, { ...UNCHECKED, isAccountBlocked: (id) => id === account.id }))
        .toEqual({ ok: false, reason: 'account_not_connected' });
      expect((await db.getWhatsAppNumberForBot('acme', 'A2'))?.id).toBe(ids[0]);
    });

    it('un agent IA en brouillon peut prendre un numéro dont le compte est en erreur', async () => {
      const { account, ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.setWhatsAppAccountError(account.id, 'other', 'x');
      expect(await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED)).toMatchObject({ ok: true, changed: true });
    });

    // audit 1.1
    it("un numéro d'une autre organisation répond not_found", async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('beta', 'accueil', 'draft'));
      expect(await db.assignNumber('beta', 'accueil', ids[0]!, UNCHECKED)).toEqual({ ok: false, reason: 'not_found' });
      expect((await db.getWhatsAppNumber('acme', ids[0]!))?.bot_id).toBeNull();
      expect(await db.assignNumber('acme', 'inconnu', ids[0]!, UNCHECKED)).toEqual({ ok: false, reason: 'not_found' });
    });

    it('un numéro retiré ne se branche pas', async () => {
      const { account, ids } = await acmeWith([num(1)]);
      await db.applyInventory('acme', account.id, [num(9)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      expect(await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED)).toEqual({ ok: false, reason: 'number_removed' });
    });

    it("l'ancien numéro retiré de l'agent IA cible est libéré ; les sessions du nouveau détenteur de ce numéro sont intactes", async () => {
      const { account: acmeAcc, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await putInService('acme', 'ventes', 'active');
      await db.setWhatsAppAccountError(acmeAcc.id, 'other', 'x');
      await createOk(newAccount('beta'), [num(1)]);
      await db.upsertBotRecord(bot('beta', 'accueil', 'draft'));
      const betaNumber = (await db.listWhatsAppNumbers('beta'))[0]!;
      await db.assignNumber('beta', 'accueil', betaNumber.id, UNCHECKED);
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'beta', 'accueil');
      await db.markWhatsAppAccountVerified(acmeAcc.id, { token_expiry: null, verified_at: '2026-11-08T12:00:00.000Z' });

      // ventes (en pause, numéro retiré) prend le numéro 2.
      expect(await db.assignNumber('acme', 'ventes', ids[1]!, UNCHECKED)).toEqual({ ok: true, changed: true, previous_bot_id: null, previous_number_id: ids[0] });
      expect((await db.getWhatsAppNumber('acme', ids[0]!))?.bot_id).toBeNull();
      expect((await db.getWhatsAppNumberForBot('acme', 'ventes'))?.id).toBe(ids[1]);
      expect(await db.getSession('+33100000001', CONTACT)).toMatchObject({ client_id: 'beta', bot_id: 'accueil' });
    });

    it('unassignNumber : numéro libéré, sessions supprimées, agent IA actif repassé en brouillon', async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED);
      await putInService('acme', 'A1', 'active');
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'A1');
      expect(await db.unassignNumber('beta', 'A1', ids[0]!)).toEqual({ ok: false, reason: 'not_found' });
      expect(await db.unassignNumber('acme', 'A1', ids[0]!)).toEqual({ ok: true, number_id: ids[0] });
      expect((await db.getWhatsAppNumber('acme', ids[0]!))?.bot_id).toBeNull();
      expect(await db.getSession('+33100000001', CONTACT)).toBeUndefined();
      expect(await statusOf('acme', 'A1')).toEqual({ status: 'draft', status_reason: null });
      // plus de numéro branché : le numéro attendu n'est plus celui de l'agent IA
      expect(await db.unassignNumber('acme', 'A1', ids[0]!)).toEqual({ ok: false, reason: 'holder_changed' });
    });

    // revue finale 2b-3 I-2 : A passe du numéro N au numéro M, l'écran visait encore N
    it('unassignNumber avec un numéro attendu périmé : holder_changed, A garde son numéro, son statut et ses sessions', async () => {
      const { ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED);
      await db.assignNumber('acme', 'A1', ids[1]!, UNCHECKED);
      await putInService('acme', 'A1', 'active');
      await db.createSessionIfAbsent('+33100000002', CONTACT, 'acme', 'A1');
      expect(await db.unassignNumber('acme', 'A1', ids[0]!)).toEqual({ ok: false, reason: 'holder_changed' });
      expect((await db.getWhatsAppNumberForBot('acme', 'A1'))?.id).toBe(ids[1]);
      expect(await statusOf('acme', 'A1')).toMatchObject({ status: 'active' });
      expect(await db.getSession('+33100000002', CONTACT)).toBeDefined();
      expect(await db.unassignNumber('acme', 'A1', ids[1]!)).toEqual({ ok: true, number_id: ids[1] });
    });

    it('deux branchements simultanés du même numéro : un seul détenteur, aucune exception', async () => {
      const { ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      await db.assignNumber('acme', 'A1', ids[1]!, UNCHECKED);
      await warmUp(db);
      for (let round = 0; round < 5; round += 1) {
        const results = await Promise.all([
          db.assignNumber('acme', 'A1', ids[0]!, UNCHECKED),
          db.assignNumber('acme', 'A2', ids[0]!, UNCHECKED),
          db.assignNumber('acme', 'A2', ids[1]!, UNCHECKED),
          db.assignNumber('acme', 'A1', ids[1]!, UNCHECKED),
        ]);
        expect(results.every((r) => r.ok)).toBe(true);
        const rows = await db.listWhatsAppNumbers('acme');
        const holders = rows.map((r) => r.bot_id).filter((b): b is string => b !== null);
        expect(new Set(holders).size).toBe(holders.length);
      }
    });
  });

  describe('transitions de statut', () => {
    async function limitedBot(): Promise<number[]> {
      const { ids } = await acmeWith([num(1), num(2, { is_test: true })]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await db.replaceAllowlist('acme', 'ventes', ['+33612345678']);
      return ids;
    }

    // audit 3.5
    it('les règles de la machine sont appliquées sur les faits en base', async () => {
      await db.upsertBotRecord(bot('acme', 'seul', 'draft'));
      expect(await db.transitionBotStatus('acme', 'seul', 'limited')).toEqual({ ok: false, reason: 'no_number' });
      await limitedBot();
      expect(await db.transitionBotStatus('acme', 'ventes', 'active')).toEqual({ ok: false, reason: 'not_from_draft' });
      expect(await db.transitionBotStatus('acme', 'ventes', 'limited')).toEqual({ ok: true, from: 'draft', to: 'limited' });
      expect(await db.transitionBotStatus('acme', 'ventes', 'active')).toEqual({ ok: true, from: 'limited', to: 'active' });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'active', status_reason: null });
      expect(await db.transitionBotStatus('beta', 'ventes', 'draft')).toEqual({ ok: false, reason: 'not_found' });
    });

    // choix 4
    it('isAccountBlocked : le compte compte comme non connecté', async () => {
      await limitedBot();
      expect(await db.transitionBotStatus('acme', 'ventes', 'limited', { isAccountBlocked: () => true }))
        .toEqual({ ok: false, reason: 'account_not_connected' });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'draft', status_reason: null });
    });

    // revue 2b-1 I-3
    it('une transition explicite efface le motif de pause automatique', async () => {
      const { account, ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.assignNumber('acme', 'ventes', ids[0]!, UNCHECKED);
      await putInService('acme', 'ventes', 'active');
      await db.applyInventory('acme', account.id, [num(9)]);
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'paused', status_reason: 'number_removed' });
      expect(await db.transitionBotStatus('acme', 'ventes', 'active')).toEqual({ ok: false, reason: 'number_removed' });
      expect(await db.transitionBotStatus('acme', 'ventes', 'draft')).toEqual({ ok: true, from: 'paused', to: 'draft' });
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'draft', status_reason: null });
    });

    // revue 2b-1 I-3
    it('pause et activation simultanées depuis limited : la base suit le dernier résultat ok', async () => {
      await limitedBot();
      await db.transitionBotStatus('acme', 'ventes', 'limited');
      await warmUp(db);
      const [p, a] = await Promise.all([
        db.transitionBotStatus('acme', 'ventes', 'paused'),
        db.transitionBotStatus('acme', 'ventes', 'active'),
      ]);
      const oks = [p, a].filter((r): r is { ok: true; from: 'draft' | 'limited' | 'active' | 'paused'; to: 'draft' | 'limited' | 'active' | 'paused' } => r.ok);
      expect(oks).toHaveLength(2);
      // Sérialisées : la première part de limited, la seconde part du statut écrit par la première.
      const first = oks.find((r) => r.from === 'limited')!;
      const second = oks.find((r) => r !== first)!;
      expect(second.from).toBe(first.to);
      expect((await statusOf('acme', 'ventes')).status).toBe(second.to);
    });
  });

  describe('activation en une opération (spec §8.2)', () => {
    it('branche, remplace la liste et passe en accès limité', async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      const res = await db.activateWithNumber('acme', 'ventes', ids[0]!, 'limited', ['+33612345678'], UNCHECKED);
      expect(res).toMatchObject({ ok: true, from: 'draft', to: 'limited', assign: { ok: true, changed: true } });
      expect((await db.getWhatsAppNumberForBot('acme', 'ventes'))?.id).toBe(ids[0]);
      expect(await db.getAllowlist('acme', 'ventes')).toEqual(['+33612345678']);
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'limited', status_reason: null });
    });

    it('active directement depuis le brouillon sur un numéro de test, liste gardée si null', async () => {
      const { ids } = await acmeWith([num(1, { is_test: true })]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.replaceAllowlist('acme', 'ventes', ['+33611111111']);
      expect(await db.activateWithNumber('acme', 'ventes', ids[0]!, 'active', null, UNCHECKED)).toMatchObject({ ok: true, from: 'draft', to: 'active' });
      expect(await db.getAllowlist('acme', 'ventes')).toEqual(['+33611111111']);
    });

    // spec §8.2
    it('liste vide en accès limité : refus empty_allowlist, numéro non branché, liste inchangée', async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.replaceAllowlist('acme', 'ventes', ['+33611111111']);
      const res = await db.activateWithNumber('acme', 'ventes', ids[0]!, 'limited', [], UNCHECKED);
      expect(res).toEqual({ ok: false, reason: 'empty_allowlist' });
      expect(await db.getWhatsAppNumberForBot('acme', 'ventes')).toBeUndefined();
      expect((await db.getWhatsAppNumber('acme', ids[0]!))?.bot_id).toBeNull();
      expect(await db.getAllowlist('acme', 'ventes')).toEqual(['+33611111111']);
      expect(await statusOf('acme', 'ventes')).toEqual({ status: 'draft', status_reason: null });
    });

    // revue 2b-3 M-1
    it("activation avec un détenteur attendu périmé : holder_changed, rien d'écrit (numéro, liste, statut), le détenteur réel garde le sien", async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('acme', 'A1', 'draft'));
      await db.upsertBotRecord(bot('acme', 'A2', 'draft'));
      expect(await db.activateWithNumber('acme', 'A1', ids[0]!, 'limited', ['+33611111111'], { expectedHolder: { kind: 'expected', bot_id: null } })).toMatchObject({ ok: true, to: 'limited' });

      const res = await db.activateWithNumber('acme', 'A2', ids[0]!, 'limited', ['+33622222222'], { expectedHolder: { kind: 'expected', bot_id: null } });
      expect(res).toEqual({ ok: false, reason: 'holder_changed', assign: { ok: false, reason: 'holder_changed' } });
      expect(await statusOf('acme', 'A1')).toEqual({ status: 'limited', status_reason: null });
      expect((await db.getWhatsAppNumberForBot('acme', 'A1'))?.id).toBe(ids[0]);
      expect(await db.getWhatsAppNumberForBot('acme', 'A2')).toBeUndefined();
      expect(await db.getAllowlist('acme', 'A2')).toEqual([]);
      expect(await statusOf('acme', 'A2')).toEqual({ status: 'draft', status_reason: null });
    });

    it('un refus du branchement est renvoyé tel quel', async () => {
      const { ids } = await acmeWith([num(1)]);
      await db.upsertBotRecord(bot('beta', 'accueil', 'draft'));
      expect(await db.activateWithNumber('beta', 'accueil', ids[0]!, 'limited', ['+33611111111'], UNCHECKED))
        .toEqual({ ok: false, reason: 'not_found', assign: { ok: false, reason: 'not_found' } });
      expect(await db.getAllowlist('beta', 'accueil')).toEqual([]);
    });
  });

  describe("suppression d'un agent IA concurrente d'une opération de topologie", () => {
    /** Aucun numéro ni liste d'accès limité ne désigne un agent IA absent. */
    async function expectNoDanglingReference(botId: string): Promise<void> {
      if (await db.getBotRecord('acme', botId)) return;
      expect(await db.getWhatsAppNumberForBot('acme', botId)).toBeUndefined();
      expect(await db.getAllowlist('acme', botId)).toEqual([]);
    }

    // choix 10
    it('deleteBotRecord et activateWithNumber simultanés : aucune exception, aucune référence pendante', async () => {
      const { ids } = await acmeWith([num(1)]);
      await warmUp(db);
      for (let round = 0; round < 8; round += 1) {
        await db.upsertBotRecord(bot('acme', `b${round}`, 'draft'));
        const [, activated] = await Promise.all([
          db.deleteBotRecord('acme', `b${round}`),
          db.activateWithNumber('acme', `b${round}`, ids[0]!, 'limited', ['+33612345678'], UNCHECKED),
        ]);
        expect([true, false]).toContain(activated.ok);
        await expectNoDanglingReference(`b${round}`);
        expect((await db.listWhatsAppNumbers('acme')).every((n) => n.bot_id === null)).toBe(true);
      }
    });

    // choix 10
    it('deleteBotRecord et transitionBotStatus simultanés : aucune exception, aucune référence pendante', async () => {
      const { ids } = await acmeWith([num(1)]);
      await warmUp(db);
      for (let round = 0; round < 8; round += 1) {
        await db.upsertBotRecord(bot('acme', `t${round}`, 'draft'));
        await db.activateWithNumber('acme', `t${round}`, ids[0]!, 'limited', ['+33612345678'], UNCHECKED);
        await Promise.all([
          db.deleteBotRecord('acme', `t${round}`),
          db.transitionBotStatus('acme', `t${round}`, 'active'),
        ]);
        expect(await db.getBotRecord('acme', `t${round}`)).toBeUndefined();
        await expectNoDanglingReference(`t${round}`);
        expect((await db.listWhatsAppNumbers('acme')).every((n) => n.bot_id === null)).toBe(true);
      }
    });
  });

  describe('déconnexion (choix 6)', () => {
    it("refusée tant qu'un agent IA limited l'utilise, acceptée après passage en brouillon", async () => {
      const { account, ids } = await acmeWith([num(1), num(2)]);
      await db.upsertBotRecord(bot('acme', 'ventes', 'draft'));
      await db.upsertBotRecord(bot('acme', 'brouillon', 'draft'));
      await db.activateWithNumber('acme', 'ventes', ids[0]!, 'limited', ['+33612345678'], UNCHECKED);
      await db.assignNumber('acme', 'brouillon', ids[1]!, UNCHECKED);
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'acme', 'ventes');

      expect(await db.disconnectWhatsAppAccount('acme', account.id)).toEqual({ ok: false, reason: 'number_in_use', bot_ids: ['ventes'] });
      expect((await db.getWhatsAppAccount('acme', account.id))?.state).toBe('connected');
      expect(await db.listWhatsAppNumbers('acme', account.id)).toHaveLength(2);

      expect(await db.disconnectWhatsAppAccount('beta', account.id)).toEqual({ ok: false, reason: 'not_found' });

      await db.transitionBotStatus('acme', 'ventes', 'draft');
      expect(await db.disconnectWhatsAppAccount('acme', account.id)).toEqual({ ok: true });
      const acc = await db.getWhatsAppAccount('acme', account.id);
      expect(acc).toMatchObject({ state: 'disconnected', webhook_key_hash: null });
      expect(decryptJson(acc!.secret_encrypted, acc!.key_version)).toEqual({});
      expect(await db.findWhatsAppAccountByWebhookKeyHash('hash-acme')).toBeUndefined();
      expect(await db.listWhatsAppNumbers('acme', account.id)).toEqual([]);
      expect(await db.getWhatsAppNumberForBot('acme', 'ventes')).toBeUndefined();
      expect(await db.getWhatsAppNumberForBot('acme', 'brouillon')).toBeUndefined();
      expect(await db.getSession('+33100000001', CONTACT)).toBeUndefined();
      // Le compte reste listé.
      expect((await db.listWhatsAppAccounts('acme')).map((a) => a.state)).toEqual(['disconnected']);
    });

    it("ne touche pas aux sessions d'un numéro retiré repris par une autre organisation", async () => {
      const { account: acmeAcc } = await acmeWith([num(1)]);
      await db.setWhatsAppAccountError(acmeAcc.id, 'other', 'x');
      await createOk(newAccount('beta'), [num(1)]);
      await db.upsertBotRecord(bot('beta', 'accueil', 'draft'));
      await db.assignNumber('beta', 'accueil', (await db.listWhatsAppNumbers('beta'))[0]!.id, UNCHECKED);
      await db.createSessionIfAbsent('+33100000001', CONTACT, 'beta', 'accueil');
      expect(await db.disconnectWhatsAppAccount('acme', acmeAcc.id)).toEqual({ ok: true });
      expect(await db.getSession('+33100000001', CONTACT)).toMatchObject({ client_id: 'beta' });
      expect((await db.listWhatsAppNumbers('beta'))[0]).toMatchObject({ provider_state: 'present', bot_id: 'accueil' });
    });
  });
});

describe('withTopologyTransaction : ROLLBACK en échec', () => {
  it("garde l'erreur d'origine et détruit la connexion", async () => {
    const queries: string[] = [];
    const rollbackError = new Error('connexion perdue');
    const release = vi.fn();
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql === 'ROLLBACK') throw rollbackError;
        return { rows: [] };
      },
      release,
    };
    const pool = { connect: async () => client } as unknown as pg.Pool;
    const origin = new Error('erreur métier');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(withTopologyTransaction(pool, async () => { throw origin; })).rejects.toBe(origin);
    expect(queries[0]).toBe('BEGIN');
    expect(queries[1]).toContain('wab:whatsapp-topology');
    expect(queries).toContain('ROLLBACK');
    expect(release).toHaveBeenCalledWith(rollbackError);
    vi.restoreAllMocks();
  });

  it('rend une connexion saine au pool sans erreur', async () => {
    const release = vi.fn();
    const client = { query: async () => ({ rows: [] }), release };
    const pool = { connect: async () => client } as unknown as pg.Pool;
    expect(await withTopologyTransaction(pool, async () => 42)).toBe(42);
    expect(release).toHaveBeenCalledWith(undefined);
  });
});
