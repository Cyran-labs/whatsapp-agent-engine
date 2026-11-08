import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../database/index.js';
import { getBotConfig, resetConfigStore } from '../config-store.js';
import { resolveServable } from '../router.js';
import type { Route } from '../router.js';
import { createConnectedBot, createMetaAccount } from '../../test-support/whatsapp.js';
import type { AccountFixture } from '../../test-support/whatsapp.js';
import type { Database } from '../database/types.js';

// Route relue en base à chaque message : numéro, compte, organisation, statut de l'agent IA, liste d'accès limité.
// Les deux moteurs (SQLite par défaut, Postgres avec TEST_DATABASE_URL).

const ACME_NUMBER = '+33100000001';
const ACME_OTHER = '+33100000002';
const BETA_NUMBER = '+33100000003';
const CONTACT = '33600000001';

describe('resolveServable : route lue en base', () => {
  let db: Database;
  let acme: AccountFixture;
  let beta: AccountFixture;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase();
    __setDatabaseForTests(db);
    resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    acme = await createMetaAccount(db, {
      clientId: 'acme', wabaId: 'WABA_A', metaAppId: 'app-a', accessToken: 'T', appSecret: 'S', verifyToken: 'V', webhookKey: 'K-A',
      numbers: [{ phone: ACME_NUMBER, providerNumberId: 'PN_A' }, { phone: ACME_OTHER, providerNumberId: 'PN_A2' }],
    });
    beta = await createMetaAccount(db, {
      clientId: 'beta', wabaId: 'WABA_B', metaAppId: 'app-b', accessToken: 'T', appSecret: 'S', verifyToken: 'V', webhookKey: 'K-B',
      numbers: [{ phone: BETA_NUMBER, providerNumberId: 'PN_B' }],
    });
    await createConnectedBot(db, { clientId: 'acme', botId: 'ventes', numberId: acme.numbers[ACME_NUMBER]!.id });
    await createConnectedBot(db, { clientId: 'beta', botId: 'accueil', numberId: beta.numbers[BETA_NUMBER]!.id });
  });

  afterEach(async () => {
    resetConfigStore();
    vi.unstubAllEnvs();
    await db.close();
  });

  async function route(fixture: AccountFixture = acme, phone: string = ACME_NUMBER): Promise<Route> {
    const n = fixture.numbers[phone]!;
    const number = (await db.getWhatsAppNumber(n.client_id, n.id))!;
    return { account: (await db.getWhatsAppAccount(n.client_id, n.account_id))!, number, bot: getBotConfig(n.client_id, number.bot_id!) };
  }

  it('agent IA actif, compte connecté, organisation active : ok', async () => {
    expect(await resolveServable(await route(), CONTACT)).toBe('ok');
    expect(await resolveServable(await route(beta, BETA_NUMBER), CONTACT)).toBe('ok');
  });

  // audit 3.1
  it.each([
    ['draft', 'bot_inactive'],
    ['paused', 'bot_inactive'],
  ] as const)('agent IA %s : %s', async (status, expected) => {
    const r = await route();
    expect((await db.transitionBotStatus('acme', 'ventes', status)).ok).toBe(true);
    expect(await resolveServable(r, CONTACT)).toBe(expected);
  });

  // audit 3.1
  it("organisation suspendue : org_inactive, l'autre organisation reste servie", async () => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'suspended' });
    expect(await resolveServable(await route(), CONTACT)).toBe('org_inactive');
    expect(await resolveServable(await route(beta, BETA_NUMBER), CONTACT)).toBe('ok');
  });

  // revue finale 2b-1 m8, spec §7.7
  it('compte en erreur : account_error, quel que soit le statut de l\'agent IA', async () => {
    const r = await route();
    await db.setWhatsAppAccountError(acme.account.id, 'token_invalid', 'Jeton refusé par le fournisseur WhatsApp.');
    expect(await resolveServable(r, CONTACT)).toBe('account_error');
    expect(await resolveServable(await route(beta, BETA_NUMBER), CONTACT)).toBe('ok');
  });

  // spec §7.4
  it('numéro retiré chez le fournisseur : number_removed', async () => {
    const r = await route();
    await db.applyInventory('acme', acme.account.id, [{
      provider_number_id: 'PN_A2', phone_e164: ACME_OTHER, display_name: 'x', meta_status: null, quality: null, is_test: false, cm_channel_id: null,
    }]);
    expect(await resolveServable(r, CONTACT)).toBe('number_removed');
  });

  // spec §7.5
  it('numéro rebranché sur un autre agent IA : route_changed pour l\'ancien', async () => {
    const r = await route();
    await createConnectedBot(db, { clientId: 'acme', botId: 'nouveau', numberId: acme.numbers[ACME_NUMBER]!.id });
    expect(await resolveServable(r, CONTACT)).toBe('route_changed');
    expect(await resolveServable(await route(), CONTACT)).toBe('ok');
  });

  // choix 6
  it('numéro supprimé (compte déconnecté) : route_changed', async () => {
    const r = await route();
    await db.transitionBotStatus('acme', 'ventes', 'draft');
    expect(await db.disconnectWhatsAppAccount('acme', acme.account.id)).toEqual({ ok: true });
    expect(await resolveServable(r, CONTACT)).toBe('route_changed');
  });

  // audit 1.5 : une route assemblée avec des éléments de deux organisations n'est jamais servie.
  it("route mêlant le compte d'une organisation et le numéro ou l'agent IA d'une autre : route_changed", async () => {
    const a = await route();
    const b = await route(beta, BETA_NUMBER);
    expect(await resolveServable({ account: a.account, number: b.number, bot: b.bot }, CONTACT)).toBe('route_changed');
    expect(await resolveServable({ account: a.account, number: a.number, bot: b.bot }, CONTACT)).toBe('route_changed');
    expect(await resolveServable({ account: b.account, number: a.number, bot: a.bot }, CONTACT)).toBe('route_changed');
  });

  // spec §8.4, point d'attention 4
  it('accès limité : contact de la liste ok, hors liste not_allowed ; BSUID et numéro ne se confondent pas', async () => {
    await createConnectedBot(db, {
      clientId: 'acme', botId: 'pilote', numberId: acme.numbers[ACME_OTHER]!.id, status: 'limited', allowlist: ['+33612345678', 'FR.abc123'],
    });
    const r = await route(acme, ACME_OTHER);
    expect(await resolveServable(r, '33612345678')).toBe('ok');
    expect(await resolveServable(r, 'FR.abc123')).toBe('ok');
    expect(await resolveServable(r, CONTACT)).toBe('not_allowed');
    expect(await resolveServable(r, 'FR.abc124')).toBe('not_allowed');
    await db.replaceAllowlist('acme', 'pilote', ['+33612345678']);
    expect(await resolveServable(r, 'FR.abc123')).toBe('not_allowed');
  });

  // audit 3.1, revue d'isolation I-1 : le statut de l'agent IA est lu en base, pas dans le cache.
  it("cache resté actif alors que la base dit en pause : non servi ; cache en pause, base active : servi", async () => {
    const r = await route();
    expect(r.bot.status).toBe('active');
    await db.transitionBotStatus('acme', 'ventes', 'paused');
    expect(getBotConfig('acme', 'ventes').status).toBe('active');
    expect(await resolveServable(r, CONTACT)).toBe('bot_inactive');
    await db.transitionBotStatus('acme', 'ventes', 'active');
    expect(await resolveServable({ ...r, bot: { ...r.bot, status: 'paused' } }, CONTACT)).toBe('ok');
  });

  // audit 3.1, revue d'isolation I-1
  it("agent IA supprimé en base mais présent en cache : non servi (son numéro est libéré)", async () => {
    const r = await route();
    await db.deleteBotRecord('acme', 'ventes');
    expect(await resolveServable(r, CONTACT)).toBe('route_changed');
  });

  // audit 3.1
  it("le statut de l'organisation est lu en base à chaque appel", async () => {
    const r = await route();
    expect(await resolveServable(r, CONTACT)).toBe('ok');
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'suspended' });
    expect(await resolveServable(r, CONTACT)).toBe('org_inactive');
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect(await resolveServable(r, CONTACT)).toBe('ok');
  });

  it("lecture seule : ni session, ni compteur", async () => {
    await db.transitionBotStatus('acme', 'ventes', 'paused');
    await resolveServable(await route(), CONTACT);
    expect(await db.getSession(ACME_NUMBER, CONTACT)).toBeUndefined();
    expect((await db.getBotRuntimeState('acme', 'ventes'))?.unserved_count ?? 0).toBe(0);
  });
});
