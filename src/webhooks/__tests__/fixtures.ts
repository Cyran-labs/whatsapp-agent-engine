/**
 * Monde de test des webhooks : deux organisations, des comptes WhatsApp Meta et CM.com créés par le store
 * (secrets chiffrés, clé d'URL, numéros inventoriés) et des agents IA branchés sur leurs numéros ; `fetch`
 * simulé (200) pour observer les envois réels des transports. Le LLM est simulé par chaque fichier de test
 * (vi.mock est propre au fichier).
 *
 *   acme : compte Meta acmeMeta (ACME_WABA) : ACME_NUMBER -> acme/ventes, ACME_FREE_NUMBER libre ;
 *          compte Meta acmeMeta2 (ACME_WABA_2, autre app) : ACME_SUPPORT_NUMBER -> acme/support ;
 *          compte CM.com acmeCm : ACME_CM_NUMBER -> acme/cm.
 *   beta : compte Meta betaMeta (BETA_WABA) : BETA_NUMBER -> beta/accueil ;
 *          compte CM.com betaCm : BETA_CM_NUMBER -> beta/cm.
 * Tous les agents IA sont `active`, sans liste d'accès limité.
 */
import { vi } from 'vitest';
import type express from 'express';
import type { Database } from '../../core/database/types.js';
import type { WhatsAppNumberRecord } from '../../core/database/whatsapp-types.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import { resetConfigStore } from '../../core/config-store.js';
import { createInFlightTracker } from '../../core/in-flight.js';
import type { InFlightTracker } from '../../core/in-flight.js';
import { createApp } from '../../app.js';
import { resetSignatureMonitor } from '../signature-monitor.js';
import { createCmAccount, createConnectedBot, createMetaAccount, signBody, stubFetch } from '../../test-support/whatsapp.js';
import type { AccountFixture, FetchCall } from '../../test-support/whatsapp.js';

export const ACME_WABA = 'WABA_ACME';
export const ACME_WABA_2 = 'WABA_ACME_2';
export const BETA_WABA = 'WABA_BETA';
export const ACME_APP_SECRET = 'secret-app-acme';
export const ACME_APP_SECRET_2 = 'secret-app-acme-2';
export const BETA_APP_SECRET = 'secret-app-beta';
export const ACME_NUMBER = '+33100000001';
export const BETA_NUMBER = '+33100000002';
export const ACME_CM_NUMBER = '+33100000003';
export const BETA_CM_NUMBER = '+33100000004';
export const ACME_FREE_NUMBER = '+33100000005';
export const ACME_SUPPORT_NUMBER = '+33100000006';
export const ACME_PNID = 'PNID_ACME';
export const ACME_FREE_PNID = 'PNID_ACME_LIBRE';
export const ACME_SUPPORT_PNID = 'PNID_ACME_SUPPORT';
export const BETA_PNID = 'PNID_BETA';
export const ACME_TOKEN = 'JETON_ACME';
export const ACME_TOKEN_2 = 'JETON_ACME_2';
export const BETA_TOKEN = 'JETON_BETA';
export const ACME_CM_TOKEN = 'PRODUIT_ACME';
export const BETA_CM_TOKEN = 'PRODUIT_BETA';
export const ACME_VERIFY = 'verif-acme';
export const BETA_VERIFY = 'verif-beta';
export const ACME_META_KEY = 'cle-meta-acme';
export const ACME_META_KEY_2 = 'cle-meta-acme-2';
export const BETA_META_KEY = 'cle-meta-beta';
export const ACME_CM_KEY = 'cle-cm-acme';
export const BETA_CM_KEY = 'cle-cm-beta';
export const LLM_REPLY = 'Réponse de l\'agent IA';

export interface WorldAccounts {
  acmeMeta: AccountFixture;
  acmeMeta2: AccountFixture;
  betaMeta: AccountFixture;
  acmeCm: AccountFixture;
  betaCm: AccountFixture;
}

export interface World {
  db: Database;
  tracker: InFlightTracker;
  app: express.Express;
  calls: FetchCall[];
  fetchMock: ReturnType<typeof stubFetch>['fetchMock'];
  accounts: WorldAccounts;
  /** Numéro inventorié par son E.164, quel que soit son compte. */
  number(phone: string): WhatsAppNumberRecord;
  close(): Promise<void>;
}

export async function createWorld(): Promise<World> {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
  const db = await createTestDatabase();
  __setDatabaseForTests(db);
  resetConfigStore();
  resetSignatureMonitor();
  for (const clientId of ['acme', 'beta']) {
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
  }

  const accounts: WorldAccounts = {
    acmeMeta: await createMetaAccount(db, {
      clientId: 'acme', wabaId: ACME_WABA, metaAppId: 'app-acme', accessToken: ACME_TOKEN, appSecret: ACME_APP_SECRET,
      verifyToken: ACME_VERIFY, webhookKey: ACME_META_KEY,
      numbers: [{ phone: ACME_NUMBER, providerNumberId: ACME_PNID }, { phone: ACME_FREE_NUMBER, providerNumberId: ACME_FREE_PNID }],
    }),
    acmeMeta2: await createMetaAccount(db, {
      clientId: 'acme', wabaId: ACME_WABA_2, metaAppId: 'app-acme-2', accessToken: ACME_TOKEN_2, appSecret: ACME_APP_SECRET_2,
      verifyToken: 'verif-acme-2', webhookKey: ACME_META_KEY_2,
      numbers: [{ phone: ACME_SUPPORT_NUMBER, providerNumberId: ACME_SUPPORT_PNID }],
    }),
    betaMeta: await createMetaAccount(db, {
      clientId: 'beta', wabaId: BETA_WABA, metaAppId: 'app-beta', accessToken: BETA_TOKEN, appSecret: BETA_APP_SECRET,
      verifyToken: BETA_VERIFY, webhookKey: BETA_META_KEY,
      numbers: [{ phone: BETA_NUMBER, providerNumberId: BETA_PNID }],
    }),
    acmeCm: await createCmAccount(db, {
      clientId: 'acme', cmAccountId: 'cm-acme', productToken: ACME_CM_TOKEN, webhookKey: ACME_CM_KEY,
      numbers: [{ phone: ACME_CM_NUMBER, providerNumberId: 'CM_ACME_1' }],
    }),
    betaCm: await createCmAccount(db, {
      clientId: 'beta', cmAccountId: 'cm-beta', productToken: BETA_CM_TOKEN, webhookKey: BETA_CM_KEY,
      numbers: [{ phone: BETA_CM_NUMBER, providerNumberId: 'CM_BETA_1' }],
    }),
  };
  const all = [accounts.acmeMeta, accounts.acmeMeta2, accounts.betaMeta, accounts.acmeCm, accounts.betaCm]
    .flatMap((a) => Object.values(a.numbers));
  const number = (phone: string): WhatsAppNumberRecord => {
    const found = all.find((n) => n.phone_e164 === phone);
    if (!found) throw new Error(`[Test] numéro inconnu du monde : ${phone}`);
    return found;
  };

  await createConnectedBot(db, { clientId: 'acme', botId: 'ventes', numberId: number(ACME_NUMBER).id });
  await createConnectedBot(db, { clientId: 'acme', botId: 'support', numberId: number(ACME_SUPPORT_NUMBER).id });
  await createConnectedBot(db, { clientId: 'beta', botId: 'accueil', numberId: number(BETA_NUMBER).id });
  await createConnectedBot(db, { clientId: 'acme', botId: 'cm', numberId: number(ACME_CM_NUMBER).id });
  await createConnectedBot(db, { clientId: 'beta', botId: 'cm', numberId: number(BETA_CM_NUMBER).id });

  const { calls, fetchMock } = stubFetch();

  const tracker = createInFlightTracker();
  const app = createApp({ tracker });

  return {
    db, tracker, app, calls, fetchMock, accounts, number,
    async close(): Promise<void> {
      await tracker.drain(10_000);
      vi.unstubAllGlobals();
      resetConfigStore();
      resetSignatureMonitor();
      await db.close();
    },
  };
}

/** Signature avec le secret d'app du compte Meta d'acme (par défaut), ou avec un autre secret. */
export function sign(raw: string, secret: string = ACME_APP_SECRET): string {
  return signBody(raw, secret);
}
