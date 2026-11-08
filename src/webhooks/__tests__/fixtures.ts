/**
 * Monde de test des webhooks : deux organisations, des agents IA Meta et CM.com avec leurs vrais
 * identifiants chiffrés en base, `fetch` simulé (200) pour observer les envois réels des transports.
 * Le LLM est simulé par chaque fichier de test (vi.mock est propre au fichier).
 */
import { createHmac } from 'crypto';
import { vi } from 'vitest';
import type express from 'express';
import type { Database, BotRecord } from '../../core/database/types.js';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../../core/database/index.js';
import { resetConfigStore, upsertBot } from '../../core/config-store.js';
import { CredentialsService } from '../../core/services/credentials-service.js';
import { ConnectionsService } from '../../core/services/connections-service.js';
import { getCmWebhookSecret, invalidateTransports } from '../../transport/index.js';
import { CM_SEND_URL } from '../../transport/cm-com.js';
import { createInFlightTracker } from '../../core/in-flight.js';
import type { InFlightTracker } from '../../core/in-flight.js';
import { createApp } from '../../app.js';

export const APP_SECRET = 'secret-app-partage';
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
export const CONTACT = '33600000001';
export const LLM_REPLY = 'Réponse de l\'agent IA';

export function botRecord(clientId: string, botId: string, transport: string, overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, transport, status: 'active',
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Tu es un agent IA.' }, lead_fields: 'prenom',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
    ...overrides,
  };
}

export interface FetchCall { url: string; headers: Record<string, string>; body: Record<string, unknown> }

export interface World {
  db: Database;
  tracker: InFlightTracker;
  app: express.Express;
  calls: FetchCall[];
  fetchMock: ReturnType<typeof vi.fn>;
  cmSecret(clientId: string, botId: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Organisations acme et beta, actives. Agents IA :
 *   acme/ventes (meta-cloud, ACME_NUMBER), beta/accueil (meta-cloud, BETA_NUMBER), même secret d'app ;
 *   acme/cm (cm-com, ACME_CM_NUMBER), beta/cm (cm-com, BETA_CM_NUMBER).
 */
export async function createWorld(): Promise<World> {
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
  await connections.setTransport('acme', 'ventes', null, { phone_number_id: ACME_PNID, access_token: ACME_TOKEN, app_secret: APP_SECRET });
  await connections.setTransport('beta', 'accueil', null, { phone_number_id: BETA_PNID, access_token: BETA_TOKEN, app_secret: APP_SECRET });
  await connections.setTransport('acme', 'cm', null, { product_token: ACME_CM_TOKEN, from_number: '0033100000003' });
  await connections.setTransport('beta', 'cm', null, { product_token: BETA_CM_TOKEN, from_number: '0033100000004' });

  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: String(input), headers: { ...(init?.headers ?? {}) }, body });
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);

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

/** Réponses texte envoyées par l'API Meta (hors accusés de lecture et indicateurs de saisie). */
export function metaTexts(calls: FetchCall[]): Array<{ phoneNumberId: string; authorization: string; to: string; text: string }> {
  return calls.flatMap((c) => {
    const match = /graph\.facebook\.com\/[^/]+\/([^/]+)\/messages$/.exec(c.url);
    if (!match || c.body['type'] !== 'text') return [];
    const text = (c.body['text'] as { body?: string } | undefined)?.body ?? '';
    return [{ phoneNumberId: match[1] ?? '', authorization: c.headers['Authorization'] ?? '', to: String(c.body['to']), text }];
  });
}

/** Réponses envoyées par l'API CM.com. */
export function cmTexts(calls: FetchCall[]): Array<{ productToken: string; from: string; text: string }> {
  return calls.flatMap((c) => {
    if (c.url !== CM_SEND_URL) return [];
    const msg = ((c.body['messages'] as { msg?: Array<Record<string, unknown>> } | undefined)?.msg ?? [])[0] ?? {};
    const conversation = ((msg['richContent'] as { conversation?: Array<{ text?: string }> } | undefined)?.conversation ?? []);
    return [{ productToken: c.headers['X-CM-PRODUCTTOKEN'] ?? '', from: String(msg['from']), text: conversation[0]?.text ?? '' }];
  });
}

export interface MetaMessageSpec {
  displayPhone: string;
  phoneNumberId: string;
  id: string;
  from?: string;
  text?: string;
  type?: string;
  /** Secondes depuis l'époque Unix ; maintenant par défaut. */
  timestamp?: number;
}

function metaMessage(spec: MetaMessageSpec): Record<string, unknown> {
  const type = spec.type ?? 'text';
  const base: Record<string, unknown> = {
    from: spec.from ?? CONTACT,
    id: spec.id,
    timestamp: String(spec.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
  };
  if (type === 'text') base['text'] = { body: spec.text ?? 'Bonjour' };
  if (type === 'audio') base['audio'] = { id: 'media-1', mime_type: 'audio/ogg' };
  if (type === 'reaction') base['reaction'] = { message_id: 'x', emoji: 'ok' };
  return base;
}

/** Corps Meta : une entrée par message, chacune avec ses métadonnées de numéro. */
export function metaBody(specs: MetaMessageSpec[]): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: specs.map((spec, i) => ({
      id: `waba-${i}`,
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: spec.displayPhone.replace('+', ''), phone_number_id: spec.phoneNumberId },
          contacts: [{ wa_id: spec.from ?? CONTACT, profile: { name: 'Camille' } }],
          messages: [metaMessage(spec)],
        },
      }],
    })),
  };
}

export function sign(raw: string, secret: string = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');
}

export function cmBody(spec: { to: string; id: string; text?: string; from?: string; timeUtc?: string }): Record<string, unknown> {
  return {
    reference: spec.id,
    messageContext: spec.id,
    from: { number: spec.from ?? `00${CONTACT}`, name: 'Camille' },
    to: { number: spec.to },
    message: { text: spec.text ?? 'Bonjour' },
    ...(spec.timeUtc !== undefined ? { timeUtc: spec.timeUtc } : {}),
  };
}

export async function unservedCount(db: Database, clientId: string, botId: string): Promise<number> {
  return (await db.getBotRuntimeState(clientId, botId))?.unserved_count ?? 0;
}
