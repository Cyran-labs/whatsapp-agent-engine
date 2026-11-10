import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../database/index.js';
import { getBotConfig, resetConfigStore, upsertBot } from '../config-store.js';
import { checkRoute, type Route } from '../router.js';
import { loadNotResponding } from '../services/bot-responding.js';
import { BotService } from '../services/bot-service.js';
import { botRecord, createConnectedBot, createMetaAccount, setBotStatus, type AccountFixture } from '../../test-support/whatsapp.js';
import { SIGNATURE_REJECTION_THRESHOLD, recordSignatureFailure, resetSignatureMonitor } from '../../webhooks/signature-monitor.js';
import type { Database } from '../database/types.js';

// nav 15.1 : la mention « Ne répond pas » (`decideResponding`, calculée par le moteur) est vraie si et seulement si le
// routeur (`checkRoute`, chemin réel des messages entrants) refuse tout contact, listé ou non. Les deux moteurs.
//
// Une organisation par combinaison, toutes dans la même base. Deux états ne sont pas atteignables par le store pour un
// agent IA en service : numéro retiré (le moteur le met en pause, motif `number_removed`) et compte déconnecté avec un
// numéro (la déconnexion supprime les numéros). Ils sont simulés par des lectures surchargées, les mêmes pour le routeur
// et pour la mention : `getWhatsAppNumber` (routeur), `getWhatsAppNumberForBot` (résumé du numéro) et
// `getWhatsAppAccount` (les deux).

const LISTED = '33600000001';
const OUTSIDE = '33600000002';
const BOT_ID = 'ventes';

type StoredState = 'connected' | 'error' | 'disconnected';
interface Combo {
  status: 'limited' | 'active';
  present: boolean;
  state: StoredState;
  orgActive: boolean;
  allowlist: 0 | 1;
}

const COMBOS: Combo[] = [];
for (const status of ['limited', 'active'] as const) {
  for (const present of [true, false]) {
    for (const state of ['connected', 'error', 'disconnected'] as const) {
      for (const orgActive of [true, false]) {
        for (const allowlist of [0, 1] as const) COMBOS.push({ status, present, state, orgActive, allowlist });
      }
    }
  }
}

function label(c: Combo): string {
  return `${c.status}, numéro ${c.present ? 'présent' : 'retiré'}, compte ${c.state}, organisation ${c.orgActive ? 'active' : 'suspendue'}, liste ${c.allowlist}`;
}

describe('mention « Ne répond pas » et routeur : équivalence', () => {
  let db: Database;
  const removedNumbers = new Set<number>();
  const disconnectedAccounts = new Set<number>();
  let seq = 0;

  beforeEach(async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '0'.repeat(64));
    db = await createTestDatabase();
    __setDatabaseForTests(db);
    resetConfigStore();
    removedNumbers.clear();
    disconnectedAccounts.clear();
    const getNumber = db.getWhatsAppNumber.bind(db);
    const getNumberForBot = db.getWhatsAppNumberForBot.bind(db);
    const getAccount = db.getWhatsAppAccount.bind(db);
    vi.spyOn(db, 'getWhatsAppNumber').mockImplementation(async (clientId, id) => {
      const n = await getNumber(clientId, id);
      return n && removedNumbers.has(n.id) ? { ...n, provider_state: 'removed' } : n;
    });
    vi.spyOn(db, 'getWhatsAppNumberForBot').mockImplementation(async (clientId, botId) => {
      const n = await getNumberForBot(clientId, botId);
      return n && removedNumbers.has(n.id) ? { ...n, provider_state: 'removed' } : n;
    });
    vi.spyOn(db, 'getWhatsAppAccount').mockImplementation(async (clientId, id) => {
      const a = await getAccount(clientId, id);
      return a && disconnectedAccounts.has(a.id) ? { ...a, state: 'disconnected' } : a;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    resetSignatureMonitor();
    resetConfigStore();
    vi.unstubAllEnvs();
    await db.close();
  });

  /** Organisation neuve avec un compte Meta, un numéro branché sur `ventes` (statut demandé, liste d'une entrée). */
  async function orgWith(status: 'draft' | 'limited' | 'active'): Promise<{ clientId: string; fixture: AccountFixture; phone: string }> {
    seq += 1;
    const clientId = `org${seq}`;
    const phone = `+3310000${String(seq).padStart(4, '0')}`;
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
    const fixture = await createMetaAccount(db, {
      clientId, wabaId: `WABA-${seq}`, metaAppId: `APP-${seq}`, accessToken: 'T', appSecret: 'S', verifyToken: 'V', webhookKey: `cle-${seq}`,
      numbers: [{ phone, providerNumberId: `PN-${seq}` }],
    });
    await createConnectedBot(db, {
      clientId, botId: BOT_ID, numberId: fixture.numbers[phone]!.id, status, allowlist: [`+${LISTED}`],
    });
    return { clientId, fixture, phone };
  }

  async function routeOf(clientId: string, fixture: AccountFixture, phone: string): Promise<Route> {
    const n = fixture.numbers[phone]!;
    const number = (await db.getWhatsAppNumber(clientId, n.id))!;
    return { account: (await db.getWhatsAppAccount(clientId, n.account_id))!, number, bot: getBotConfig(clientId, BOT_ID) };
  }

  async function refusesEveryone(route: Route): Promise<boolean> {
    const listed = await checkRoute(route, LISTED);
    const outside = await checkRoute(route, OUTSIDE);
    return listed.servable !== 'ok' && outside.servable !== 'ok';
  }

  // nav 15.1
  it(`${COMBOS.length} combinaisons : mention si et seulement si le routeur refuse tout contact`, async () => {
    const svc = new BotService({ db });
    const rows: Array<{ combo: string; mention: string | null; refusesEveryone: boolean }> = [];
    for (const combo of COMBOS) {
      const { clientId, fixture, phone } = await orgWith(combo.status);
      const n = fixture.numbers[phone]!;
      if (combo.allowlist === 0) expect((await db.replaceAllowlist(clientId, BOT_ID, [])).ok).toBe(true);
      if (combo.state === 'error') expect(await db.setWhatsAppAccountError(n.account_id, 'token_invalid', 'Jeton refusé.')).toBe(true);
      if (combo.state === 'disconnected') disconnectedAccounts.add(n.account_id);
      if (!combo.present) removedNumbers.add(n.id);
      if (!combo.orgActive) await db.upsertClient({ client_id: clientId, name: clientId, status: 'suspended' });

      const bot = (await db.getBotRecord(clientId, BOT_ID))!;
      expect(bot.status).toBe(combo.status);
      const mention = await loadNotResponding(db, clientId, bot);
      // Le détail de l'agent IA (`GET /bots`) calcule la même mention à partir des faits qu'il a déjà lus (A-12).
      expect((await svc.getBot(clientId, BOT_ID)).not_responding).toBe(mention);
      rows.push({ combo: label(combo), mention, refusesEveryone: await refusesEveryone(await routeOf(clientId, fixture, phone)) });
    }
    const mismatches = rows.filter((r) => (r.mention !== null) !== r.refusesEveryone);
    expect(mismatches).toEqual([]);
    // Témoins : la règle n'est pas toujours vraie ni toujours fausse.
    expect(rows.some((r) => r.mention === null)).toBe(true);
    expect(new Set(rows.map((r) => r.mention))).toEqual(new Set([null, 'number_removed', 'account_not_connected', 'organization_suspended', 'empty_allowlist']));
  });

  // nav 15.1 : écart voulu, la pastille Draft ou Offline dit déjà que l'agent IA ne répond pas.
  it.each(['draft', 'paused'] as const)('écart voulu : agent IA %s, le routeur refuse tout contact, aucune mention', async (status) => {
    const { clientId, fixture, phone } = await orgWith(status === 'draft' ? 'draft' : 'limited');
    if (status === 'paused') await setBotStatus(db, clientId, BOT_ID, 'paused');
    const bot = (await db.getBotRecord(clientId, BOT_ID))!;
    expect(bot.status).toBe(status);
    expect(await refusesEveryone(await routeOf(clientId, fixture, phone))).toBe(true);
    expect(await loadNotResponding(db, clientId, bot)).toBeNull();
  });

  // nav 15.1 : écart voulu, état affiché du compte (spec navigation §7.1) : les messages sont refusés avant le routage,
  // par l'authentification du webhook ; le routeur, qui ne lit que l'état stocké, servirait.
  it('écart voulu : signatures rejetées en série sur un compte stocké connected, mention account_not_connected, le routeur sert', async () => {
    const { clientId, fixture, phone } = await orgWith('active');
    const accountId = fixture.numbers[phone]!.account_id;
    for (let i = 0; i <= SIGNATURE_REJECTION_THRESHOLD; i++) recordSignatureFailure(accountId);
    expect((await db.getWhatsAppAccount(clientId, accountId))?.state).toBe('connected');
    const bot = (await db.getBotRecord(clientId, BOT_ID))!;
    expect(await loadNotResponding(db, clientId, bot)).toBe('account_not_connected');
    expect((await checkRoute(await routeOf(clientId, fixture, phone), LISTED)).servable).toBe('ok');
  });

  // nav 15.1 : écart voulu, sans numéro aucune route n'existe (routage par le numéro destinataire).
  it('écart voulu : agent IA Online sans numéro, mention no_number (aucune route à éprouver)', async () => {
    await db.upsertClient({ client_id: 'sans-numero', name: 'Sans numéro', status: 'active' });
    await upsertBot(botRecord('sans-numero', BOT_ID, { status: 'active' }));
    const bot = (await db.getBotRecord('sans-numero', BOT_ID))!;
    expect(bot.status).toBe('active');
    expect(await loadNotResponding(db, 'sans-numero', bot)).toBe('no_number');
  });
});
