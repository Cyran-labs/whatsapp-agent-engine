/**
 * Monde de test des webhooks : deux organisations, des agents IA Meta et CM.com avec leurs vrais
 * identifiants chiffrés en base, `fetch` simulé (200) pour observer les envois réels des transports.
 * Le LLM est simulé par chaque fichier de test (vi.mock est propre au fichier).
 */
import { vi } from 'vitest';
import type express from 'express';
import type { Database } from '../../core/database/types.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../core/config-store.js';
import { CredentialsService } from '../../core/services/credentials-service.js';
import { ConnectionsService } from '../../core/services/connections-service.js';
import { getCmWebhookSecret, invalidateTransports } from '../../transport/index.js';
import { createInFlightTracker } from '../../core/in-flight.js';
import type { InFlightTracker } from '../../core/in-flight.js';
import { createApp } from '../../app.js';
import { botRecord, signBody, stubFetch } from '../../test-support/whatsapp.js';
import type { FetchCall } from '../../test-support/whatsapp.js';

export const ACME_APP_SECRET = 'secret-app-acme';
export const BETA_APP_SECRET = 'secret-app-beta';
export const SHARED_APP_SECRET = 'secret-app-partage';
export const ACME_NUMBER = '+33100000001';
export const BETA_NUMBER = '+33100000002';
export const ACME_CM_NUMBER = '+33100000003';
export const BETA_CM_NUMBER = '+33100000004';
export const ACME_PNID = 'PNID_ACME';
export const BETA_PNID = 'PNID_BETA';
export const ACME_TOKEN = 'JETON_ACME';
export const BETA_TOKEN = 'JETON_BETA';
export const ACME_CM_TOKEN = 'PRODUIT_ACME';
export const BETA_CM_TOKEN = 'PRODUIT_BETA';
export const LLM_REPLY = 'Réponse de l\'agent IA';

export interface World {
  db: Database;
  tracker: InFlightTracker;
  app: express.Express;
  calls: FetchCall[];
  fetchMock: ReturnType<typeof stubFetch>['fetchMock'];
  cmSecret(clientId: string, botId: string): Promise<string>;
  close(): Promise<void>;
}

export interface WorldOptions {
  /** Vrai : acme et beta ont le même secret d'app (SHARED_APP_SECRET), pour un lot mêlé signé une seule fois. */
  sharedAppSecret?: boolean;
}

/**
 * Organisations acme et beta, actives, avec des secrets d'app distincts (ACME_APP_SECRET, BETA_APP_SECRET)
 * sauf `sharedAppSecret`. Agents IA :
 *   acme/ventes (meta-cloud, ACME_NUMBER), beta/accueil (meta-cloud, BETA_NUMBER), même secret d'app ;
 *   acme/cm (cm-com, ACME_CM_NUMBER), beta/cm (cm-com, BETA_CM_NUMBER).
 */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
  const db = await createTestDatabase();
  __setDatabaseForTests(db);
  resetConfigStore();
  for (const clientId of ['acme', 'beta']) {
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
    invalidateTransports(clientId);
  }
  await upsertBot(botRecord('acme', 'ventes', 'meta-cloud'), [ACME_NUMBER]);
  await upsertBot(botRecord('beta', 'accueil', 'meta-cloud'), [BETA_NUMBER]);
  await upsertBot(botRecord('acme', 'cm', 'cm-com'), [ACME_CM_NUMBER]);
  await upsertBot(botRecord('beta', 'cm', 'cm-com'), [BETA_CM_NUMBER]);

  const connections = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
  await connections.setTransport('acme', 'ventes', null, { phone_number_id: ACME_PNID, access_token: ACME_TOKEN, app_secret: options.sharedAppSecret ? SHARED_APP_SECRET : ACME_APP_SECRET });
  await connections.setTransport('beta', 'accueil', null, { phone_number_id: BETA_PNID, access_token: BETA_TOKEN, app_secret: options.sharedAppSecret ? SHARED_APP_SECRET : BETA_APP_SECRET });
  await connections.setTransport('acme', 'cm', null, { product_token: ACME_CM_TOKEN, from_number: '0033100000003' });
  await connections.setTransport('beta', 'cm', null, { product_token: BETA_CM_TOKEN, from_number: '0033100000004' });

  const { calls, fetchMock } = stubFetch();

  const tracker = createInFlightTracker();
  const app = createApp({ tracker });

  return {
    db, tracker, app, calls, fetchMock,
    async cmSecret(clientId: string, botId: string): Promise<string> {
      const secret = await getCmWebhookSecret(clientId, botId);
      if (!secret) throw new Error('secret CM.com absent');
      return secret;
    },
    async close(): Promise<void> {
      await tracker.drain(10_000);
      vi.unstubAllGlobals();
      resetConfigStore();
      await db.close();
    },
  };
}

/** Signature avec le secret d'app d'acme (par défaut), ou avec un autre secret. */
export function sign(raw: string, secret: string = ACME_APP_SECRET): string {
  return signBody(raw, secret);
}
