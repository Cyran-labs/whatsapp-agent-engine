// Recherche du compte WhatsApp d'une clé d'URL de webhook (src/webhooks/account-key.ts). Les deux moteurs
// (SQLite par défaut, Postgres avec TEST_DATABASE_URL).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test-support/test-database.js';
import { createCmAccount, createMetaAccount } from '../../test-support/whatsapp.js';
import type { AccountFixture } from '../../test-support/whatsapp.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import type { Database } from '../../core/database/types.js';
import { hashWebhookKey } from '../../whatsapp/webhook-key.js';
import { findAccountByKey } from '../account-key.js';

describe('findAccountByKey', () => {
  let db: Database;
  let meta: AccountFixture;
  let cm: AccountFixture;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase();
    __setDatabaseForTests(db);
    meta = await createMetaAccount(db, {
      clientId: 'acme', wabaId: 'WABA-A', metaAppId: 'APP-A', accessToken: 'TOKEN-A', appSecret: 'SECRET-A',
      verifyToken: 'VERIF-A', webhookKey: 'cle-meta-acme', numbers: [{ phone: '+33100000001', providerNumberId: 'PNID-A' }],
    });
    cm = await createCmAccount(db, {
      clientId: 'acme', cmAccountId: 'CM-A', productToken: 'PRODUIT-A', webhookKey: 'cle-cm-acme', numbers: [],
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await db.close();
  });

  it('compte connecté du mode attendu : renvoyé, recherché par l\'empreinte de la clé', async () => {
    const spy = vi.spyOn(db, 'findWhatsAppAccountByWebhookKeyHash');
    expect((await findAccountByKey('cle-meta-acme', 'meta_manual'))?.id).toBe(meta.account.id);
    expect((await findAccountByKey('cle-cm-acme', 'cm_com'))?.id).toBe(cm.account.id);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([hashWebhookKey('cle-meta-acme'), hashWebhookKey('cle-cm-acme')]);
  });

  // spec §6 (choix 6), audit 4.1 : le filtre de findAccountByKey tient seul, même si la base renvoyait un compte
  // déconnecté (filtre SQL absent, empreinte restée en place).
  it('compte déconnecté renvoyé par la base pour cette empreinte : null', async () => {
    vi.spyOn(db, 'findWhatsAppAccountByWebhookKeyHash').mockResolvedValue({ ...meta.account, state: 'disconnected' });
    expect(await findAccountByKey('cle-meta-acme', 'meta_manual')).toBeNull();
  });

  it('compte en erreur renvoyé par la base : renvoyé (la route le refuse ensuite, compteur compris)', async () => {
    vi.spyOn(db, 'findWhatsAppAccountByWebhookKeyHash').mockResolvedValue({ ...meta.account, state: 'error' });
    expect((await findAccountByKey('cle-meta-acme', 'meta_manual'))?.id).toBe(meta.account.id);
  });

  // audit 4.1
  it("clé d'un autre mode ou clé inconnue : null", async () => {
    expect(await findAccountByKey('cle-meta-acme', 'cm_com')).toBeNull();
    expect(await findAccountByKey('cle-cm-acme', 'meta_manual')).toBeNull();
    expect(await findAccountByKey('cle-inconnue', 'meta_manual')).toBeNull();
  });
});
