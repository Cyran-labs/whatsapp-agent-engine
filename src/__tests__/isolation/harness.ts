/**
 * Harnais de la suite d'isolation « deux organisations ». Tout passe par le vrai chemin HTTP :
 * `createApp` monté sur 127.0.0.1, URL de webhook propre à chaque compte WhatsApp, signatures Meta réelles,
 * clé d'URL CM.com, secrets des comptes chiffrés en base, agents IA branchés sur les numéros inventoriés.
 * Seuls le LLM (llm-mock.ts), `fetch` (appels sortants vers WhatsApp) et les clients des fournisseurs de l'API
 * d'administration (vérification et inventaire d'un compte, `providerAccounts`) sont simulés. Un événement de compte
 * Meta (`account_update`, `phone_number_*`) déclenche le vrai rafraîchissement sur événement, sans délai minimal.
 *
 * API d'administration : le vrai routeur (`createAdminRouter`), monté par `createApp`, avec un admin par
 * organisation (`api('acme')`, `api('beta')`), un super admin de la plateforme (`api('platform')`) et tout membre
 * créé par le test avec ses appartenances (`memberApi('acme', email, grants)`).
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
import type { ProviderNumber } from '../../core/database/whatsapp-types.js';
import type { MembershipGrantRecord } from '../../core/database/accounts-types.js';
import type { ProviderListing, ProviderVerification } from '../../whatsapp/provider-common.js';
import { createAdminRouter } from '../../api/admin/router.js';
import { AuthService } from '../../core/auth/auth-service.js';
import { AdminService } from '../../core/auth/admin-service.js';
import type { Mailer } from '../../core/auth/mailer.js';
import { BotService } from '../../core/services/bot-service.js';
import { UserAdminService } from '../../core/services/user-admin-service.js';
import { EntityService } from '../../core/services/entity-service.js';
import { SettingsService } from '../../core/services/settings-service.js';
import { CredentialsService } from '../../core/services/credentials-service.js';
import { ConnectionsService } from '../../core/services/connections-service.js';
import { DashboardService } from '../../core/services/dashboard-service.js';
import { SimulateService } from '../../core/services/simulate-service.js';
import { WhatsAppAccountService } from '../../core/services/whatsapp-account-service.js';
import type { WhatsAppProviders } from '../../core/services/whatsapp-account-service.js';
import { fakeMetaWebhooks, keyOfMetaUrl, type FakeMetaWebhooks, type MetaWebhookCall } from '../../test-support/meta-webhooks-fake.js';
import { resetPendingVerificationsForTests } from '../../webhooks/pending-verification.js';
import { invalidateAccountTransports } from '../../transport/index.js';
import { createRefreshScheduler } from '../../whatsapp/refresh-scheduler.js';
import { seedOrgMember, seedSuperAdmin } from '../../core/auth/__tests__/fixtures.js';
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

/** Mot de passe des utilisateurs de la suite (admins, plateforme et membres créés par `memberApi`). */
const ADMIN_PASSWORD = 'motdepasse123';
const ADMIN_EMAILS = { acme: 'admin@acme.test', beta: 'admin@beta.test', platform: 'root@plateforme.test' } as const;

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

/**
 * Compte tel que le voit le fournisseur simulé de l'API d'administration (clé : WABA ID). `verifyError` : la
 * vérification et la lecture de l'inventaire répondent « jeton refusé ».
 */
export interface FakeProviderAccount {
  appId: string;
  numbers: ProviderNumber[];
  verifyError?: 'token_invalid';
}

/** Appels de l'API d'administration, authentifiés comme un utilisateur ; chemins relatifs à /api/admin/v1. */
export interface AdminApi {
  get(path: string): Promise<request.Response>;
  post(path: string, body?: object): Promise<request.Response>;
  put(path: string, body?: object): Promise<request.Response>;
  patch(path: string, body?: object): Promise<request.Response>;
  delete(path: string): Promise<request.Response>;
}

/** Numéro tel que l'inventaire du fournisseur le renvoie. */
export function providerNumber(phone: string, providerNumberId: string): ProviderNumber {
  return {
    provider_number_id: providerNumberId, phone_e164: phone, display_name: phone, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null,
  };
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
  /** Comptes connus du fournisseur simulé, par WABA ID (WABA_A et WABA_B au départ). */
  providerAccounts: Map<string, FakeProviderAccount>;
  providers: WhatsAppProviders;
  /** Inscription des webhooks chez le Meta simulé (lot R1), avec le journal de chaque appel. */
  metaWebhooks: FakeMetaWebhooks;
  /** Écritures chez le Meta simulé (inscription, retrait, webhook de l'app) depuis le début du test. */
  metaWrites(): MetaWebhookCall[];
  /** Clé d'URL inscrite chez Meta pour cette WABA par le dernier raccordement (le moteur ne la rend plus, lot R1). */
  inscribedKey(wabaId: string): string;
  /** API d'administration, en tant qu'admin de l'organisation (ou super admin de la plateforme). */
  api(who: 'acme' | 'beta' | 'platform'): Promise<AdminApi>;
  /**
   * Crée (par `seedOrgMember`) le membre `email` de l'organisation `org` avec ces appartenances, et rend l'API
   * d'administration authentifiée comme lui. Les appartenances remplacent celles qu'il avait dans `org`.
   */
  memberApi(org: 'acme' | 'beta', email: string, grants: MembershipGrantRecord[]): Promise<AdminApi>;
  /** Attend la fin de tous les traitements en cours. */
  settle(): Promise<void>;
  close(): Promise<void>;
}

class SilentMailer implements Mailer {
  async sendInvitation(): Promise<void> {}
  async sendPasswordReset(): Promise<void> {}
}

const TOKEN_REFUSED = 'Jeton refusé par le fournisseur';

/**
 * Clients des fournisseurs simulés, lus dans `accounts` (Meta seulement ; CM.com répond « compte inconnu »). Comme le
 * vrai client, la vérification Meta est en lecture seule (lot R1, ruling R-2) : elle n'écrit jamais chez Meta.
 */
function fakeProviders(accounts: Map<string, FakeProviderAccount>, metaWebhooks: FakeMetaWebhooks): WhatsAppProviders {
  const unknown: ProviderVerification = { ok: false, checks: [], error_reason: 'other', message: 'Compte inconnu du fournisseur' };
  const noSkip = { sandbox: 0, invalid_number: 0 };
  return {
    verifyMeta: vi.fn(async (c): Promise<ProviderVerification> => {
      const found = accounts.get(c.waba_id);
      if (!found) return unknown;
      if (found.verifyError) {
        return { ok: false, checks: [{ key: 'token', status: 'failed', detail: TOKEN_REFUSED }], error_reason: 'token_invalid', message: TOKEN_REFUSED };
      }
      return {
        ok: true, checks: [{ key: 'token', status: 'ok' }], account_name: 'Compte du fournisseur', waba_id: c.waba_id,
        meta_app_id: found.appId, token_expiry: null, numbers: found.numbers, skipped: noSkip, meta_health: null,
      };
    }),
    listMeta: vi.fn(async (c): Promise<ProviderListing> => {
      const found = accounts.get(c.waba_id);
      if (!found) return { numbers: [], skipped: noSkip, error: { reason: 'other', message: 'Compte inconnu du fournisseur' } };
      if (found.verifyError) return { numbers: [], skipped: noSkip, error: { reason: 'token_invalid', message: TOKEN_REFUSED } };
      return { numbers: found.numbers, skipped: noSkip };
    }),
    verifyCm: vi.fn(async (): Promise<ProviderVerification> => unknown),
    listCm: vi.fn(async (): Promise<ProviderListing> => ({ numbers: [], skipped: noSkip, error: { reason: 'other', message: 'Compte inconnu du fournisseur' } })),
    metaWebhooks,
  };
}

/** Adresse publique du moteur dans la suite : obligatoire pour raccorder un compte Meta (lot R1). */
export const ISOLATION_BASE_URL = 'https://moteur.isolation.test';

export async function setupTwoOrgs(): Promise<TwoOrgs> {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
  vi.stubEnv('ADMIN_JWT_SECRET', 'secret-jwt-de-la-suite-isolation-32+');
  vi.stubEnv('ADMIN_BCRYPT_ROUNDS', '4');
  vi.stubEnv('PUBLIC_BASE_URL', ISOLATION_BASE_URL);
  resetPendingVerificationsForTests();
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

  for (const org of ['acme', 'beta'] as const) {
    await seedOrgMember(db, { email: ADMIN_EMAILS[org], password: ADMIN_PASSWORD, clientId: org, grants: 'admin' });
  }
  await seedSuperAdmin(db, ADMIN_EMAILS.platform, ADMIN_PASSWORD);

  const providerAccounts = new Map<string, FakeProviderAccount>([
    [WABA_A, { appId: 'APP-A', numbers: [providerNumber(ACME_NUMBER, PNID_A)] }],
    [WABA_B, { appId: 'APP-B', numbers: [providerNumber(BETA_NUMBER, PNID_B)] }],
  ]);
  const metaWebhooks = fakeMetaWebhooks();
  const providers = fakeProviders(providerAccounts, metaWebhooks);
  const mailer = new SilentMailer();
  const credentials = new CredentialsService({ db });
  const whatsappAccountService = new WhatsAppAccountService({ db, providers });
  const adminRouter = createAdminRouter({
    db, authService: new AuthService({ db, mailer }), adminService: new AdminService({ db, mailer }),
    botService: new BotService({ db }), entityService: new EntityService({ db }), settingsService: new SettingsService({ db }),
    userAdminService: new UserAdminService({ db, mailer }), connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }), simulateService: new SimulateService({}),
    whatsappAccountService,
  });

  const { calls: sent, fetchMock } = stubFetch();
  const tracker = createInFlightTracker();
  // Rafraîchissement sur événement Meta câblé comme src/index.ts, sans intervalle minimal entre deux rafraîchissements.
  const refreshScheduler = createRefreshScheduler((clientId, accountId) =>
    tracker.track(whatsappAccountService.refreshOnProviderEvent(clientId, accountId)).then(() => undefined), 0);
  const app = createApp({ tracker, adminRouter, refreshScheduler });

  const login = async (email: string): Promise<string> => {
    const res = await request(await serve(app)).post('/api/admin/v1/auth/login').send({ email, password: ADMIN_PASSWORD });
    if (res.status !== 200) throw new Error(`[Harnais] Connexion refusée pour ${email} (${res.status})`);
    return res.body.access_token as string;
  };
  const apiAs = (token: string): AdminApi => {
    const headers = { Authorization: `Bearer ${token}` };
    const url = (path: string): string => `/api/admin/v1${path}`;
    return {
      get: async (path) => request(await serve(app)).get(url(path)).set(headers),
      post: async (path, body) => request(await serve(app)).post(url(path)).set(headers).send(body ?? {}),
      put: async (path, body) => request(await serve(app)).put(url(path)).set(headers).send(body ?? {}),
      patch: async (path, body) => request(await serve(app)).patch(url(path)).set(headers).send(body ?? {}),
      delete: async (path) => request(await serve(app)).delete(url(path)).set(headers),
    };
  };
  const tokens = new Map<string, string>();
  const api = async (who: 'acme' | 'beta' | 'platform'): Promise<AdminApi> => {
    let token = tokens.get(who);
    if (token === undefined) {
      token = await login(ADMIN_EMAILS[who]);
      tokens.set(who, token);
    }
    return apiAs(token);
  };
  const memberApi = async (org: 'acme' | 'beta', email: string, grants: MembershipGrantRecord[]): Promise<AdminApi> => {
    await seedOrgMember(db, { email, password: ADMIN_PASSWORD, clientId: org, grants });
    return apiAs(await login(email));
  };

  const postMetaKey = async (key: string, payload: Record<string, unknown>, secret: string | null): Promise<request.Response> => {
    const raw = JSON.stringify(payload);
    const req = request(await serve(app)).post(`/webhook/meta/${key}`).set('Content-Type', 'application/json');
    if (secret !== null) req.set('x-hub-signature-256', signBody(raw, secret));
    return req.send(raw);
  };

  return {
    db, app, tracker, sent, fetchMock, llmCalls, accounts, providerAccounts, providers, api, memberApi,
    metaWebhooks,
    metaWrites: () => metaWebhooks.writes(),
    inscribedKey(wabaId) {
      const inscription = metaWebhooks.calls.filter((c) => c.op === 'setWabaOverride' && c.target === wabaId).pop();
      if (!inscription?.url) throw new Error(`[Harnais] Aucune adresse inscrite chez Meta pour la WABA ${wabaId}`);
      return keyOfMetaUrl(inscription.url);
    },

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
      refreshScheduler.stop();
      await tracker.drain(10_000);
      // Transports en cache par identifiant de compte : les identifiants sont réutilisés d'une base à l'autre.
      for (const account of (await db.listWhatsAppAccounts('acme')).concat(await db.listWhatsAppAccounts('beta'))) {
        invalidateAccountTransports(account.id);
      }
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      resetConfigStore();
      resetSignatureMonitor();
      resetLlmMock();
      await db.close();
    },
  };
}
