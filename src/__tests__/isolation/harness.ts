/**
 * Harnais de la suite d'isolation « deux organisations ». Tout passe par le vrai chemin HTTP :
 * `createApp` monté sur 127.0.0.1, URL de webhook propre à chaque compte WhatsApp, signatures Meta réelles,
 * clé d'URL CM.com, secrets des comptes chiffrés en base, agents IA branchés sur les numéros inventoriés.
 * Seuls le LLM (llm-mock.ts) et `fetch` (appels sortants vers WhatsApp) sont simulés.
 *
 * Organisations :
 *   acme  : compte Meta WABA-A (clé ACME_META_KEY, TOKEN-A / SECRET-A), numéro ACME_NUMBER (PNID-A)
 *           branché sur acme/ventes
 *   beta  : compte Meta WABA-B (clé BETA_META_KEY, TOKEN-B / SECRET-B), numéro BETA_NUMBER (PNID-B)
 *           branché sur beta/accueil ; compte CM.com (clé BETA_CM_KEY, PRODUIT-B), numéro BETA_CM_NUMBER
 *           branché sur beta/cm
 */
import request from 'supertest';
import { serve } from '../../test-support/http.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import {
  cmBody, createCmAccount, createConnectedBot, createMetaAccount, metaBody, signBody, stubFetch,
} from '../../test-support/whatsapp.js';
import type { AccountFixture, FetchCall } from '../../test-support/whatsapp.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import { resetConfigStore } from '../../core/config-store.js';
import { resetSignatureMonitor } from '../../webhooks/signature-monitor.js';
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
export const WABA_A = 'WABA-A';
export const WABA_B = 'WABA-B';
export const ACME_META_KEY = 'cle-meta-acme';
export const BETA_META_KEY = 'cle-meta-beta';
export const BETA_CM_KEY = 'cle-cm-beta';

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
  /** Remplace la WABA de l'entrée (`entry.id`), celle de l'organisation par défaut. */
  wabaId?: string;
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
  /** POST sur l'URL du compte Meta de l'organisation `account`, signé avec `secret` (null : sans signature). */
  postMeta(account: 'acme' | 'beta', payload: Record<string, unknown>, secret: string | null): Promise<request.Response>;
  /** POST sur l'URL Meta de clé `key`, signé avec `secret` (null : sans signature). */
  postMetaKey(key: string, payload: Record<string, unknown>, secret: string | null): Promise<request.Response>;
  /** POST sur l'URL CM.com de clé `key`. */
  postCm(key: string, payload: Record<string, unknown>): Promise<request.Response>;
  /** POST sur un chemin quelconque (anciennes formes d'URL). */
  postPath(path: string, payload: Record<string, unknown>): Promise<request.Response>;
  metaMessage(opts: MetaMessageOptions): Record<string, unknown>;
  cmMessage(opts: CmMessageOptions): Record<string, unknown>;
  dataOf(contactId: string): Promise<ContactData>;
  accounts: { acme: AccountFixture; beta: AccountFixture; betaCm: AccountFixture };
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
  resetSignatureMonitor();
  for (const clientId of ['acme', 'beta']) {
    await db.upsertClient({ client_id: clientId, name: clientId, status: 'active' });
  }
  const accounts = {
    acme: await createMetaAccount(db, {
      clientId: 'acme', wabaId: WABA_A, metaAppId: 'APP-A', accessToken: TOKEN_A, appSecret: SECRET_A, verifyToken: 'VERIF-A',
      webhookKey: ACME_META_KEY, numbers: [{ phone: ACME_NUMBER, providerNumberId: PNID_A }],
    }),
    beta: await createMetaAccount(db, {
      clientId: 'beta', wabaId: WABA_B, metaAppId: 'APP-B', accessToken: TOKEN_B, appSecret: SECRET_B, verifyToken: 'VERIF-B',
      webhookKey: BETA_META_KEY, numbers: [{ phone: BETA_NUMBER, providerNumberId: PNID_B }],
    }),
    betaCm: await createCmAccount(db, {
      clientId: 'beta', cmAccountId: 'CM-B', productToken: CM_TOKEN_B, webhookKey: BETA_CM_KEY,
      numbers: [{ phone: BETA_CM_NUMBER, providerNumberId: 'CM-NUM-B' }],
    }),
  };
  await createConnectedBot(db, { clientId: 'acme', botId: 'ventes', numberId: accounts.acme.numbers[ACME_NUMBER]!.id });
  await createConnectedBot(db, { clientId: 'beta', botId: 'accueil', numberId: accounts.beta.numbers[BETA_NUMBER]!.id });
  await createConnectedBot(db, { clientId: 'beta', botId: 'cm', numberId: accounts.betaCm.numbers[BETA_CM_NUMBER]!.id });

  const { calls: sent, fetchMock } = stubFetch();
  const tracker = createInFlightTracker();
  const app = createApp({ tracker });

  const postMetaKey = async (key: string, payload: Record<string, unknown>, secret: string | null): Promise<request.Response> => {
    const raw = JSON.stringify(payload);
    const req = request(await serve(app)).post(`/webhook/meta/${key}`).set('Content-Type', 'application/json');
    if (secret !== null) req.set('x-hub-signature-256', signBody(raw, secret));
    return req.send(raw);
  };

  return {
    db, app, tracker, sent, fetchMock, llmCalls, accounts,

    postMetaKey,

    async postMeta(account, payload, secret) {
      return postMetaKey(account === 'acme' ? ACME_META_KEY : BETA_META_KEY, payload, secret);
    },

    async postCm(key, payload) {
      return request(await serve(app)).post(`/webhook/cm-com/${encodeURIComponent(key)}`).set('Content-Type', 'application/json').send(JSON.stringify(payload));
    },

    async postPath(path, payload) {
      return request(await serve(app)).post(path).set('Content-Type', 'application/json').send(JSON.stringify(payload));
    },

    metaMessage(opts) {
      const number = opts.org === 'acme' ? ACME_NUMBER : BETA_NUMBER;
      const pnid = opts.phoneNumberId ?? (opts.org === 'acme' ? PNID_A : PNID_B);
      return metaBody([{
        wabaId: opts.wabaId ?? (opts.org === 'acme' ? WABA_A : WABA_B),
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

    async settle() {
      // Un délai dépassé est un échec explicite, pas un test qui continue sur un traitement inachevé.
      if (!(await tracker.drain(10_000))) throw new Error('[Harnais] Traitements non terminés après 10 s');
    },

    async close() {
      await tracker.drain(10_000);
      vi.unstubAllGlobals();
      resetConfigStore();
      resetSignatureMonitor();
      resetLlmMock();
      await db.close();
    },
  };
}
