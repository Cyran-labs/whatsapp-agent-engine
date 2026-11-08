/**
 * Harnais de la suite d'isolation « deux organisations ». Tout passe par le vrai chemin HTTP :
 * `createApp` monté sur 127.0.0.1, signatures Meta réelles, URL CM.com avec secret, identifiants
 * chiffrés en base. Seuls le LLM (llm-mock.ts) et `fetch` (appels sortants vers WhatsApp) sont simulés.
 *
 * Organisations :
 *   acme  : agent IA acme/ventes (Meta, ACME_NUMBER, PNID-A / TOKEN-A / SECRET-A)
 *   beta  : agents IA beta/accueil (Meta, BETA_NUMBER, PNID-B / TOKEN-B / SECRET-B)
 *           et beta/cm (CM.com, BETA_CM_NUMBER)
 */
import request from 'supertest';
import { serve } from '../../test-support/http.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { botRecord, cmBody, metaBody, signBody, stubFetch } from '../../test-support/whatsapp.js';
import type { FetchCall } from '../../test-support/whatsapp.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../core/config-store.js';
import { CredentialsService } from '../../core/services/credentials-service.js';
import { ConnectionsService } from '../../core/services/connections-service.js';
import { getCmWebhookSecret, invalidateTransports } from '../../transport/index.js';
import { createInFlightTracker } from '../../core/in-flight.js';
import { createApp } from '../../app.js';
import { vi } from 'vitest';
import type express from 'express';
import type { Database, Session } from '../../core/database/types.js';
import type { InFlightTracker } from '../../core/in-flight.js';
import { llmCalls, resetLlmMock } from './llm-mock.js';
import type { LlmCall } from './llm-mock.js';

export type { LlmCall } from './llm-mock.js';
export type SentRequest = FetchCall;

export const ACME_NUMBER = '+33100000001';
export const BETA_NUMBER = '+33100000002';
export const BETA_CM_NUMBER = '+33100000003';
export const PNID_A = 'PNID-A';
export const PNID_B = 'PNID-B';
export const TOKEN_A = 'TOKEN-A';
export const TOKEN_B = 'TOKEN-B';
export const SECRET_A = 'SECRET-A';
export const SECRET_B = 'SECRET-B';
export const CM_TOKEN_B = 'PRODUIT-B';

/** Contact qui écrit aux deux organisations. */
export const SHARED_CONTACT = '33699999999';

/** Les trois agents IA de la suite, dans l'ordre de lecture des données. */
export const BOTS = [
  { clientId: 'acme', botId: 'ventes', waNumber: ACME_NUMBER },
  { clientId: 'beta', botId: 'accueil', waNumber: BETA_NUMBER },
  { clientId: 'beta', botId: 'cm', waNumber: BETA_CM_NUMBER },
] as const;

export interface MetaMessageOptions {
  org: 'acme' | 'beta';
  id: string;
  from?: string;
  text?: string;
  /** Remplace le phone_number_id de l'organisation (message mal adressé). */
  phoneNumberId?: string;
}

export interface CmMessageOptions {
  id: string;
  from?: string;
  text?: string;
  /** Numéro destinataire ; BETA_CM_NUMBER par défaut. */
  to?: string;
}

/** Données d'un contact, par agent IA (clé `<organisation>/<agent IA>`). */
export interface ContactData {
  sessions: Array<Pick<Session, 'wa_number' | 'client_id' | 'bot_id'>>;
  conversations: Record<string, Array<{ role: string; content: string }>>;
  leads: Record<string, Record<string, unknown> | null>;
  unserved: Record<string, number>;
}

export interface TwoOrgs {
  db: Database;
  app: express.Express;
  tracker: InFlightTracker;
  /** Tous les appels sortants (WhatsApp) depuis le début du test. */
  sent: SentRequest[];
  fetchMock: ReturnType<typeof stubFetch>['fetchMock'];
  /** Tous les appels du LLM depuis le début du test. */
  llmCalls: LlmCall[];
  postMeta(payload: Record<string, unknown>, secret: string | null): Promise<request.Response>;
  postCm(clientId: string, botId: string, secret: string, payload: Record<string, unknown>): Promise<request.Response>;
  metaMessage(opts: MetaMessageOptions): Record<string, unknown>;
  cmMessage(opts: CmMessageOptions): Record<string, unknown>;
  dataOf(contactId: string): Promise<ContactData>;
  /** Secret de l'URL de webhook CM.com d'un agent IA. */
  cmSecret(clientId: string, botId: string): Promise<string>;
  /** Attend la fin de tous les traitements en cours. */
  settle(): Promise<void>;
  close(): Promise<void>;
}

export async function setupTwoOrgs(): Promise<TwoOrgs> {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
  resetLlmMock();
  const db = await createTestDatabase();
  __setDatabaseForTests(db);
  resetConfigStore();
  for (const clientId of ['acme', 'beta']) {
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
    invalidateTransports(clientId);
  }
  await upsertBot(botRecord('acme', 'ventes', 'meta-cloud'), [ACME_NUMBER]);
  await upsertBot(botRecord('beta', 'accueil', 'meta-cloud'), [BETA_NUMBER]);
  await upsertBot(botRecord('beta', 'cm', 'cm-com'), [BETA_CM_NUMBER]);

  const connections = new ConnectionsService({ db, credentials: new CredentialsService({ db }) });
  await connections.setTransport('acme', 'ventes', null, { phone_number_id: PNID_A, access_token: TOKEN_A, app_secret: SECRET_A });
  await connections.setTransport('beta', 'accueil', null, { phone_number_id: PNID_B, access_token: TOKEN_B, app_secret: SECRET_B });
  await connections.setTransport('beta', 'cm', null, { product_token: CM_TOKEN_B, from_number: BETA_CM_NUMBER.replace('+', '00') });

  const { calls: sent, fetchMock } = stubFetch();
  const tracker = createInFlightTracker();
  const app = createApp({ tracker });

  return {
    db, app, tracker, sent, fetchMock, llmCalls,

    async postMeta(payload, secret) {
      const raw = JSON.stringify(payload);
      const req = request(await serve(app)).post('/webhook/meta').set('Content-Type', 'application/json');
      if (secret !== null) req.set('x-hub-signature-256', signBody(raw, secret));
      return req.send(raw);
    },

    async postCm(clientId, botId, secret, payload) {
      const url = `/webhook/cm-com/${encodeURIComponent(clientId)}/${encodeURIComponent(botId)}/${encodeURIComponent(secret)}`;
      return request(await serve(app)).post(url).set('Content-Type', 'application/json').send(JSON.stringify(payload));
    },

    metaMessage(opts) {
      const number = opts.org === 'acme' ? ACME_NUMBER : BETA_NUMBER;
      const pnid = opts.phoneNumberId ?? (opts.org === 'acme' ? PNID_A : PNID_B);
      return metaBody([{
        displayPhone: number, phoneNumberId: pnid, id: opts.id,
        ...(opts.from !== undefined ? { from: opts.from } : {}),
        ...(opts.text !== undefined ? { text: opts.text } : {}),
      }]);
    },

    cmMessage(opts) {
      return cmBody({
        to: opts.to ?? BETA_CM_NUMBER, id: opts.id,
        ...(opts.from !== undefined ? { from: opts.from } : {}),
        ...(opts.text !== undefined ? { text: opts.text } : {}),
      });
    },

    async dataOf(contactId) {
      const data: ContactData = { sessions: [], conversations: {}, leads: {}, unserved: {} };
      for (const bot of BOTS) {
        const label = `${bot.clientId}/${bot.botId}`;
        const session = await db.getSession(bot.waNumber, contactId);
        if (session) data.sessions.push({ wa_number: session.wa_number, client_id: session.client_id, bot_id: session.bot_id });
        data.conversations[label] = await db.getConversation(contactId, bot.clientId, bot.botId, 100);
        data.leads[label] = await db.getLeadData(contactId, bot.clientId, bot.botId);
        data.unserved[label] = (await db.getBotRuntimeState(bot.clientId, bot.botId))?.unserved_count ?? 0;
      }
      return data;
    },

    async cmSecret(clientId, botId) {
      const secret = await getCmWebhookSecret(clientId, botId);
      if (!secret) throw new Error('secret CM.com absent');
      return secret;
    },

    async settle() {
      await tracker.drain(10_000);
    },

    async close() {
      await tracker.drain(10_000);
      vi.unstubAllGlobals();
      resetConfigStore();
      resetLlmMock();
      await db.close();
    },
  };
}
