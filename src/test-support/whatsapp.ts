/**
 * Éléments génériques des tests de webhook WhatsApp : enregistreur de `fetch`, constructeurs de
 * corps Meta et CM.com, lecture des envois sortants. Partagés par les tests de src/webhooks et la
 * suite d'isolation (src/__tests__/isolation) ; aucun identifiant d'organisation ici.
 */
import { createHmac } from 'crypto';
import { vi } from 'vitest';
import type { Database, BotRecord } from '../core/database/types.js';
import type { BotStatus, WhatsAppAccountRecord, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';
import { CM_SEND_URL } from '../transport/cm-com.js';
import { encryptAccountSecrets } from '../transport/index.js';
import { hashWebhookKey } from '../whatsapp/webhook-key.js';
import { upsertBot } from '../core/config-store.js';

export const CONTACT = '33600000001';

export function botRecord(clientId: string, botId: string, overrides: Partial<BotRecord> = {}): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, status: 'active',
    status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Tu es un agent IA.' }, lead_fields: 'prenom',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
    ...overrides,
  };
}

/**
 * Change le statut d'un agent IA par la machine d'états du store (écriture ciblée en base, cache de configuration
 * non touché : le statut est relu en base à chaque message). Lève si la transition est refusée.
 */
export async function setBotStatus(db: Database, clientId: string, botId: string, status: BotStatus): Promise<void> {
  const result = await db.transitionBotStatus(clientId, botId, status);
  if (!result.ok) throw new Error(`[Test] transition vers ${status} refusée : ${result.reason}`);
}

export interface NumberSpec {
  phone: string;
  providerNumberId: string;
  isTest?: boolean;
}

export interface MetaAccountSpec {
  clientId: string;
  wabaId: string;
  metaAppId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  webhookKey: string;
  numbers: NumberSpec[];
}

export interface CmAccountSpec {
  clientId: string;
  cmAccountId: string;
  productToken: string;
  webhookKey: string;
  numbers: NumberSpec[];
}

/** Compte WhatsApp créé par le store, avec la clé d'URL en clair et ses numéros par E.164. */
export interface AccountFixture {
  account: WhatsAppAccountRecord;
  webhookKey: string;
  numbers: Record<string, WhatsAppNumberRecord>;
}

async function createAccount(
  db: Database,
  base: { clientId: string; mode: 'meta_manual' | 'cm_com'; providerAccountId: string; metaAppId: string | null; webhookKey: string; numbers: NumberSpec[] },
  encrypted: { secret_encrypted: string; key_version: number },
): Promise<AccountFixture> {
  const result = await db.createWhatsAppAccountWithInventory({
    client_id: base.clientId, name: `Compte ${base.providerAccountId}`, mode: base.mode,
    provider_account_id: base.providerAccountId, waba_id: base.mode === 'meta_manual' ? base.providerAccountId : null,
    meta_app_id: base.metaAppId, ...encrypted, webhook_key_hash: hashWebhookKey(base.webhookKey),
    token_expiry: null, last_verified_at: new Date().toISOString(),
  }, base.numbers.map((n) => ({
    provider_number_id: n.providerNumberId, phone_e164: n.phone, display_name: n.phone, meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: n.isTest ?? false, cm_channel_id: null,
  })));
  if (!result.ok) throw new Error(`[Test] compte refusé : ${result.reason}`);
  const numbers: Record<string, WhatsAppNumberRecord> = {};
  for (const n of await db.listWhatsAppNumbers(base.clientId, result.account.id)) numbers[n.phone_e164] = n;
  return { account: result.account, webhookKey: base.webhookKey, numbers };
}

/** Compte Meta (mode manuel) avec ses secrets chiffrés, sa clé d'URL et ses numéros inventoriés. */
export async function createMetaAccount(db: Database, spec: MetaAccountSpec): Promise<AccountFixture> {
  return createAccount(db, {
    clientId: spec.clientId, mode: 'meta_manual', providerAccountId: spec.wabaId, metaAppId: spec.metaAppId,
    webhookKey: spec.webhookKey, numbers: spec.numbers,
  }, encryptAccountSecrets({
    mode: 'meta_manual', access_token: spec.accessToken, app_secret: spec.appSecret, verify_token: spec.verifyToken, webhook_key: spec.webhookKey,
  }));
}

/** Compte CM.com avec son jeton de produit chiffré, sa clé d'URL et ses numéros inventoriés. */
export async function createCmAccount(db: Database, spec: CmAccountSpec): Promise<AccountFixture> {
  return createAccount(db, {
    clientId: spec.clientId, mode: 'cm_com', providerAccountId: spec.cmAccountId, metaAppId: null,
    webhookKey: spec.webhookKey, numbers: spec.numbers,
  }, encryptAccountSecrets({ mode: 'cm_com', product_token: spec.productToken, webhook_key: spec.webhookKey }));
}

export interface ConnectedBotSpec {
  clientId: string;
  botId: string;
  /** Identifiant du numéro inventorié à brancher. */
  numberId: number;
  status?: BotStatus;
  /** Liste d'accès limité, écrite avant le branchement (exigée en `limited`). */
  allowlist?: string[];
  overrides?: Partial<BotRecord>;
}

/**
 * Agent IA créé avec son statut puis branché sur le numéro par le store (`assignNumber`, qui applique la
 * machine d'états au statut de l'agent IA). Lève si le branchement est refusé.
 */
export async function createConnectedBot(db: Database, spec: ConnectedBotSpec): Promise<void> {
  await upsertBot(botRecord(spec.clientId, spec.botId, { status: spec.status ?? 'active', ...(spec.overrides ?? {}) }));
  if (spec.allowlist) {
    const written = await db.replaceAllowlist(spec.clientId, spec.botId, spec.allowlist);
    if (!written.ok) throw new Error(`[Test] liste d'accès limité refusée : ${written.reason}`);
  }
  const result = await db.assignNumber(spec.clientId, spec.botId, spec.numberId);
  if (!result.ok) throw new Error(`[Test] branchement refusé : ${result.reason}`);
}

export interface FetchCall { url: string; headers: Record<string, string>; body: Record<string, unknown> }

/**
 * Remplace `fetch` par un enregistreur qui répond 200 ; à restaurer avec `vi.unstubAllGlobals()`.
 * Les appels sont accumulés dans `calls`.
 */
export function stubFetch(): { calls: FetchCall[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url: String(input), headers: { ...(init?.headers ?? {}) }, body });
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

/** Réponses texte envoyées par l'API Meta (hors accusés de lecture et indicateurs de saisie). */
export function metaTexts(calls: FetchCall[]): Array<{ phoneNumberId: string; authorization: string; to: string; text: string }> {
  return calls.flatMap((c) => {
    const match = /graph\.facebook\.com\/[^/]+\/([^/]+)\/messages$/.exec(c.url);
    if (!match || c.body['type'] !== 'text') return [];
    const text = (c.body['text'] as { body?: string } | undefined)?.body ?? '';
    // Destinataire : `to` pour un numéro, `recipient` pour un BSUID (doc Meta).
    return [{ phoneNumberId: match[1] ?? '', authorization: c.headers['Authorization'] ?? '', to: String(c.body['to'] ?? c.body['recipient']), text }];
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

/** Destinataires des envois de texte CM.com (`to[].number`). */
export function cmRecipients(calls: FetchCall[]): string[] {
  return calls.flatMap((c) => {
    if (c.url !== CM_SEND_URL) return [];
    const msg = ((c.body['messages'] as { msg?: Array<Record<string, unknown>> } | undefined)?.msg ?? [])[0] ?? {};
    const to = (msg['to'] as Array<{ number?: string }> | undefined) ?? [];
    return to.map((t) => String(t.number));
  });
}

export interface MetaMessageSpec {
  /** WABA de l'entrée (`entry.id`) : celle du compte de l'URL pour un message servi. */
  wabaId: string;
  displayPhone: string;
  phoneNumberId: string;
  id: string;
  /** Numéro du contact (`from`) ; CONTACT par défaut, sauf si `fromUserId` est seul donné. */
  from?: string;
  /** BSUID du contact (`from_user_id`). Seul (sans `from`), il simule un numéro masqué. */
  fromUserId?: string;
  text?: string;
  type?: string;
  /** Secondes depuis l'époque Unix ; maintenant par défaut. */
  timestamp?: number;
}

function metaFrom(spec: MetaMessageSpec): string | undefined {
  if (spec.from !== undefined) return spec.from;
  return spec.fromUserId !== undefined ? undefined : CONTACT;
}

function metaMessage(spec: MetaMessageSpec): Record<string, unknown> {
  const type = spec.type ?? 'text';
  const from = metaFrom(spec);
  const base: Record<string, unknown> = {
    ...(from !== undefined ? { from } : {}),
    ...(spec.fromUserId !== undefined ? { from_user_id: spec.fromUserId } : {}),
    id: spec.id,
    timestamp: String(spec.timestamp ?? Math.floor(Date.now() / 1000)),
    type,
  };
  if (type === 'text') base['text'] = { body: spec.text ?? 'Bonjour' };
  if (type === 'audio') base['audio'] = { id: 'media-1', mime_type: 'audio/ogg' };
  if (type === 'reaction') base['reaction'] = { message_id: 'x', emoji: 'ok' };
  return base;
}

/** Corps Meta : une entrée par message, chacune avec sa WABA et les métadonnées de son numéro. */
export function metaBody(specs: MetaMessageSpec[]): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: specs.map((spec) => {
      const from = metaFrom(spec);
      return {
        id: spec.wabaId,
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: spec.displayPhone.replace('+', ''), phone_number_id: spec.phoneNumberId },
            contacts: [{
              ...(from !== undefined ? { wa_id: from } : {}),
              ...(spec.fromUserId !== undefined ? { user_id: spec.fromUserId } : {}),
              profile: { name: 'Camille' },
            }],
            messages: [metaMessage(spec)],
          },
        }],
      };
    }),
  };
}

/** Signature `x-hub-signature-256` d'un corps brut avec un secret d'application. */
export function signBody(raw: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(raw, 'utf8')).digest('hex');
}

export interface CmMessageSpec {
  to: string;
  /** `reference` (identifiant du message entrant) ; absent : `reference` omis. */
  id?: string;
  /** `messageContext` : référence du message cité, absent si le message n'est pas une réponse. */
  quoted?: string;
  text?: string;
  /** `from.number` ; `00` + CONTACT par défaut, sauf si `fromUserId` est seul donné. */
  from?: string;
  /** `from.whatsapp.user_id` (BSUID). Seul (sans `from`), `from.number` est omis. */
  fromUserId?: string;
  timeUtc?: string;
}

export function cmBody(spec: CmMessageSpec): Record<string, unknown> {
  const fromNumber = spec.from ?? (spec.fromUserId !== undefined ? undefined : `00${CONTACT}`);
  return {
    ...(spec.id !== undefined ? { reference: spec.id } : {}),
    ...(spec.quoted !== undefined ? { messageContext: spec.quoted } : {}),
    from: {
      ...(fromNumber !== undefined ? { number: fromNumber } : {}),
      name: 'Camille',
      ...(spec.fromUserId !== undefined ? { whatsapp: { user_id: spec.fromUserId } } : {}),
    },
    to: { number: spec.to },
    message: { text: spec.text ?? 'Bonjour' },
    ...(spec.timeUtc !== undefined ? { timeUtc: spec.timeUtc } : {}),
  };
}

export async function unservedCount(db: Database, clientId: string, botId: string): Promise<number> {
  return (await db.getBotRuntimeState(clientId, botId))?.unserved_count ?? 0;
}
